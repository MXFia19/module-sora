import crypto from 'node:crypto';
import { cached } from './cache';
import { request } from './http';
import type { HttpResponse } from './http';
import { logger } from './log';
import { toIso639_2 } from './lang';
import type { MediaRequest, RawStream, SubtitleTrack } from './types';

/** Naka (ex-Nakastream) — source à compte.
 *
 *  nakastream.tv redirige désormais vers une page d'annonce : le service est
 *  devenu un espace privé, sur naka.cx, et toute l'API répond AUTH_REQUIRED
 *  sans session. On s'y connecte comme l'application TV du site :
 *
 *    1. l'utilisateur, connecté sur naka.cx, clique « Générer un code »
 *       (page /app-tv, réservée aux abonnés) — 5 caractères ;
 *    2. on envoie ce code à POST /api/v1/auth/pair/claim {code}, sans
 *       authentification, et on reçoit une session ;
 *    3. ensuite tout passe par `Authorization: Bearer <jeton>`, plus
 *       `X-Profile-Id` quand un profil est choisi.
 *
 *  Pas de jeton de rafraîchissement côté site : un 401 veut dire session
 *  morte, il faut refaire un code.
 *
 *  Le jeton est À L'UTILISATEUR : il voyage dans son lien d'installation,
 *  comme sa clé TMDB, et les flux qu'il ouvre ne doivent jamais servir à
 *  quelqu'un d'autre. D'où un circuit à part du cache partagé des autres
 *  sources (voir `nakaCacheKey`). */

const log = logger('Naka');

export const NAKA_ORIGIN = 'https://naka.cx';
const API = `${NAKA_ORIGIN}/api/v1`;
/** Les liens rendus par l'API expirent : on ne les garde pas longtemps. */
const STREAMS_TTL_MS = 10 * 60 * 1000;

export interface NakaAuth {
  token: string;
  /** Profil Naka (en-tête X-Profile-Id) ; absent = profil par défaut du compte. */
  profile?: number;
}

function apiHeaders(auth: NakaAuth | null): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    Origin: NAKA_ORIGIN,
    Referer: `${NAKA_ORIGIN}/`,
  };
  if (auth) h.Authorization = `Bearer ${auth.token}`;
  if (auth?.profile != null) h['X-Profile-Id'] = String(auth.profile);
  return h;
}

/** Clé de cache propre à un compte : un condensat du jeton, jamais le jeton. */
export function nakaCacheKey(auth: NakaAuth): string {
  const digest = crypto.createHash('sha256').update(auth.token).digest('hex').slice(0, 16);
  return `${digest}:${auth.profile ?? '-'}`;
}

type WallResponse = Pick<HttpResponse, 'status' | 'headers' | 'text'>;

/** naka.cx est derrière Cloudflare, qui peut arrêter une requête avant
 *  qu'elle n'atteigne Naka : page de défi (« Just a moment… ») ou page de
 *  blocage (« Attention Required! », typique d'une IP de datacenter). Ce
 *  n'est pas un refus de Naka — son API répond toujours en JSON — et le dire
 *  tel quel évite de chercher la panne du côté du compte ou du profil. */
export function isBotWall(res: WallResponse): boolean {
  if (res.status !== 403 && res.status !== 503 && res.status !== 429) return false;
  if (res.headers.get('cf-mitigated') === 'challenge' || /<title>Just a moment/i.test(res.text)) return true;
  const isJson = (() => { try { JSON.parse(res.text); return true; } catch { return false; } })();
  if (isJson) return false;
  return /cloudflare/i.test(res.headers.get('server') ?? '') || res.headers.has('cf-ray') || /cloudflare/i.test(res.text);
}

/** Ce que Cloudflare a répondu, sans rien de sensible : de quoi savoir s'il
 *  s'agit d'un défi ou d'un blocage, et le signaler à Naka (`cf-ray`). */
export function wallDetails(res: WallResponse): Record<string, string> {
  const title = res.text.match(/<title>([^<]{0,120})<\/title>/i)?.[1]?.trim() ?? '';
  const out: Record<string, string> = { http: String(res.status) };
  if (title) out.title = title;
  const server = res.headers.get('server');
  if (server) out.server = server;
  const mitigated = res.headers.get('cf-mitigated');
  if (mitigated) out.cfMitigated = mitigated;
  const ray = res.headers.get('cf-ray');
  if (ray) out.cfRay = ray;
  return out;
}

export function botWallMessage(res: WallResponse): string {
  const challenge = res.headers.get('cf-mitigated') === 'challenge' || /<title>Just a moment/i.test(res.text);
  return challenge
    ? 'naka.cx oppose un défi anti-robots Cloudflare aux requêtes de ce serveur : liaison et lecture impossibles depuis cette instance.'
    : 'Cloudflare bloque les requêtes de ce serveur vers naka.cx (souvent : IP de datacenter refusée) : liaison et lecture impossibles depuis cette instance.';
}

// ---------------------------------------------------------------------------
// Appairage

/** Forme d'une réponse JSON, valeurs remplacées par leur type : de quoi
 *  comprendre une réponse inattendue sans faire fuir le moindre secret. */
export function describeShape(value: unknown, depth = 0): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return depth > 3 ? `array(${value.length})` : value.slice(0, 2).map(v => describeShape(v, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth > 3) return 'object';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = describeShape(v, depth + 1);
    return out;
  }
  if (typeof value === 'string') return `string(${value.length})`;
  return typeof value;
}

const TOKEN_KEYS = ['token', 'accessToken', 'access_token', 'jwt', 'sessionToken', 'authToken', 'bearer'];

/** Le jeton de session dans la réponse d'appairage. Sa forme exacte n'est pas
 *  documentée : on le cherche sous les noms usuels, à plat ou un niveau plus
 *  bas (`data`, `auth`, `session`…). */
export function findToken(body: unknown, depth = 0): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || depth > 2) return null;
  const obj = body as Record<string, unknown>;
  for (const key of TOKEN_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.length >= 16) return v;
    // AdonisJS rend parfois { token: { type: 'bearer', token: '…' } }.
    if (v && typeof v === 'object') {
      const nested = findToken(v, depth + 1);
      if (nested) return nested;
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = findToken(v, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

export interface NakaProfile {
  id: number;
  name: string;
  /** Protégé par un code PIN : il faudra le déverrouiller sur le site. */
  locked: boolean;
}

export interface PairResult {
  ok: boolean;
  /** Message affichable à l'utilisateur. */
  message: string;
  token?: string;
  user?: string;
  profiles?: NakaProfile[];
  /** Forme des réponses de Naka, sans les valeurs (diagnostic). */
  shape?: Record<string, unknown>;
}

function toProfiles(body: unknown): NakaProfile[] {
  const list = Array.isArray(body)
    ? body
    : Array.isArray((body as any)?.data) ? (body as any).data
    : Array.isArray((body as any)?.profiles) ? (body as any).profiles
    : [];
  return list
    .filter((p: any) => p && Number.isFinite(Number(p.id)))
    .map((p: any) => ({
      id: Number(p.id),
      name: String(p.name ?? p.displayName ?? `Profil ${p.id}`),
      locked: Boolean(p.hasPin ?? p.pinEnabled ?? p.locked ?? p.isLocked ?? false),
    }));
}

/** Échange un code d'appairage contre une session, puis lit le compte et ses
 *  profils pour que l'utilisateur voie à qui il vient de se lier. */
export async function pairNaka(rawCode: string): Promise<PairResult> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,5}$/.test(code)) {
    return { ok: false, message: 'Le code fait 5 caractères (lettres et chiffres).' };
  }

  const res = await request(`${API}/auth/pair/claim`, {
    method: 'POST',
    headers: { ...apiHeaders(null), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    retries: 0,
  });
  const body = res.json<any>();

  if (res.status === 0) return { ok: false, message: 'naka.cx ne répond pas. Réessayez dans un instant.' };
  if (isBotWall(res)) {
    const wall = wallDetails(res);
    log.warn(`appairage : arrêté par Cloudflare ${JSON.stringify(wall)}`);
    return { ok: false, message: botWallMessage(res), shape: { cloudflare: wall } };
  }
  if (!res.ok) {
    const reason = body?.message ?? body?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    log.warn(`appairage refusé : ${reason}`);
    return { ok: false, message: `Naka a refusé le code : ${reason}`, shape: { claim: describeShape(body) } };
  }

  const token = findToken(body);
  if (!token) {
    log.warn(`appairage : réponse sans jeton reconnu ${JSON.stringify(describeShape(body))}`);
    return {
      ok: false,
      message: 'Naka a accepté le code mais sa réponse ne ressemble à rien de connu. Transmettez le diagnostic ci-dessous.',
      shape: { claim: describeShape(body) },
    };
  }

  const auth: NakaAuth = { token };
  const [me, profiles] = await Promise.all([
    request(`${API}/auth/me`, { headers: apiHeaders(auth), retries: 0 }),
    request(`${API}/profiles`, { headers: apiHeaders(auth), retries: 0 }),
  ]);
  const meBody = me.json<any>();
  const user = meBody?.username ?? meBody?.user?.username ?? meBody?.name ?? meBody?.user?.name;

  log.info(`compte lié${user ? ` (${user})` : ''}`);
  return {
    ok: true,
    message: user ? `Compte Naka lié : ${user}.` : 'Compte Naka lié.',
    token,
    user: user ? String(user) : undefined,
    profiles: toProfiles(profiles.json()),
    shape: {
      claim: describeShape(body),
      me: `HTTP ${me.status}`,
      profiles: `HTTP ${profiles.status}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Flux

/** '1080p', '2160p', '4K', 1080… -> l'échelle de qualités de l'addon. */
export function nakaQuality(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase();
  if (/2160|4k|uhd/.test(s)) return '4K';
  const n = Number(s.match(/(\d{3,4})/)?.[1]);
  if (n >= 1000) return '1080p';
  if (n >= 700) return '720p';
  if (n >= 450) return '480p';
  if (n >= 300) return '360p';
  return 'HD';
}

/** Langue d'une source, d'après les champs que Naka peut renseigner. */
export function nakaLanguage(source: any): string {
  const tracks = Array.isArray(source?.audioTracks) ? source.audioTracks : [];
  if (tracks.length > 1) return 'MULTI';
  const hint = [source?.language, source?.lang, source?.version, source?.audio, tracks[0]?.lang, tracks[0]?.label]
    .filter(Boolean).join(' ').toLowerCase();
  if (/multi/.test(hint)) return 'MULTI';
  if (/vostfr|vost|sub/.test(hint)) return 'VOSTFR';
  if (/\bvo\b|original|eng|english|jpn|japanese/.test(hint)) return 'VO';
  // Site français : sans indication, c'est de la VF.
  return 'VF';
}

function absoluteNaka(url: string): string {
  try { return new URL(url, NAKA_ORIGIN).toString(); } catch { return url; }
}

function isNakaHost(url: string): boolean {
  try { return new URL(url).hostname.endsWith('naka.cx'); } catch { return false; }
}

/** Comme le lecteur du site : quand une source a un `directUrl`, ses
 *  sous-titres vivent dans le même dossier que lui. */
function subtitleUrls(source: any, useDirect: boolean): Array<{ url: string; label: string }> {
  const subs: any[] = Array.isArray(source?.subtitles) ? source.subtitles : [];
  const direct = useDirect && typeof source?.directUrl === 'string' ? source.directUrl : '';
  const dirBase = direct.replace(/\/master\.m3u8$/, '');
  const urlBase = String(source?.url ?? '').replace(/\/master\.m3u8.*$/, '');
  return subs
    .filter(s => typeof s?.url === 'string')
    .map(s => {
      let url = String(s.url);
      if (direct && urlBase && url.startsWith(urlBase + '/')) {
        url = `${dirBase}/${url.slice(urlBase.length + 1).split('?')[0]}`;
      }
      return { url: absoluteNaka(url), label: String(s.lang ?? s.label ?? s.language ?? 'und') };
    });
}

/** Une source de l'API -> un flux. `directUrl` (lien CDN) d'abord : il se lit
 *  sans session, rien à relayer. Sinon le lien passe par naka.cx et exige le
 *  jeton : on le joint, ce qui envoie le flux par le proxy de l'addon. */
export function toRawStream(source: any, auth: NakaAuth): RawStream | null {
  const direct = typeof source?.directUrl === 'string' && /^https?:\/\//.test(source.directUrl)
    ? source.directUrl : '';
  const fallback = typeof source?.url === 'string' && source.url ? absoluteNaka(source.url) : '';
  const url = direct || fallback;
  if (!url) return null;

  const needsSession = isNakaHost(url);
  const headers: Record<string, string> = needsSession
    ? apiHeaders(auth)
    : { Referer: `${NAKA_ORIGIN}/`, Origin: NAKA_ORIGIN };
  // Accept JSON n'a rien à faire sur une requête vidéo.
  delete headers.Accept;

  const subtitles: SubtitleTrack[] = subtitleUrls(source, Boolean(direct)).map(s => ({
    lang: toIso639_2(s.label),
    url: s.url,
    headers: isNakaHost(s.url) ? { Authorization: `Bearer ${auth.token}` } : undefined,
  }));

  const kind = source?.type === 'encoded' ? 'Naka' : String(source?.provider ?? source?.host ?? 'Naka');
  return {
    url,
    quality: nakaQuality(source?.maxQuality ?? source?.quality),
    language: nakaLanguage(source),
    server: kind,
    source: 'Naka',
    headers,
    subtitles,
    container: /\.mp4(\?|$)/i.test(url) ? 'mp4' : 'hls',
  };
}

export class NakaAuthError extends Error {}

/** Flux Naka d'un contenu. L'API est keyée TMDB (le site route ses fiches en
 *  /content/:type/:tmdbId et son lecteur passe ce même id). On vérifie le
 *  tmdbId renvoyé : un id interne qui tomberait sur un autre contenu ne doit
 *  pas produire de flux. */
export async function resolveNaka(req: MediaRequest, auth: NakaAuth): Promise<RawStream[]> {
  const type = req.type === 'movie' ? 'movie' : 'tv';
  const params = new URLSearchParams({ type });
  if (type === 'tv') {
    params.set('season', String(req.season ?? 1));
    params.set('episode', String(req.episode ?? 1));
  }

  const key = `naka:${nakaCacheKey(auth)}:${type}:${req.tmdbId}:${req.season ?? ''}:${req.episode ?? ''}`;
  return cached(key, async () => {
    const res = await request(`${API}/streaming/sources/${req.tmdbId}?${params}`, {
      headers: apiHeaders(auth),
      retries: 0,
    });
    const body = res.json<any>();

    if (isBotWall(res)) throw new NakaAuthError(`${botWallMessage(res)} ${JSON.stringify(wallDetails(res))}`);
    if (res.status === 401) throw new NakaAuthError('session Naka expirée — refaites un code sur naka.cx/app-tv');
    if (res.status === 403) {
      const code = body?.code ?? body?.message ?? 'accès refusé';
      throw new NakaAuthError(`profil refusé par Naka (${code})`);
    }
    if (res.status === 429) throw new Error('Naka limite les requêtes (429)');
    if (!res.ok || !body) {
      log.debug(`HTTP ${res.status} pour tmdb ${req.tmdbId}`);
      return [];
    }

    if (body.tmdbId != null && String(body.tmdbId) !== String(req.tmdbId)) {
      log.warn(`tmdb ${req.tmdbId} -> Naka a rendu le tmdb ${body.tmdbId}, ignoré`);
      return [];
    }

    const sources: any[] = Array.isArray(body.sources) ? body.sources : [];
    const streams = sources
      .map(s => toRawStream(s, auth))
      .filter((s): s is RawStream => s !== null);
    log.debug(`tmdb ${req.tmdbId}: ${streams.length} flux sur ${sources.length} source(s)`);
    return streams;
  }, { ttlMs: STREAMS_TTL_MS });
}
