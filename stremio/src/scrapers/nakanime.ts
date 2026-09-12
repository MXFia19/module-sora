import { cached } from '../cache';
import { request, getText } from '../http';
import { logger } from '../log';
import { pickBest } from '../match';
import { audioLabel } from '../lang';
import { extractEmbed } from '../extractors';
import type { MediaRequest, RawStream, Scraper } from '../types';

/** nakanime — API dont les réponses sont chiffrées par un XOR dont la clé
 *  dérive de la route appelée, et dont l'endpoint « sources » est protégé par
 *  un jeton CSRF AdonisJS.
 *
 *  Le module Sora devait deviner la forme des octets rendus par le sandbox
 *  (base64 ? latin1 ? binaire ?) et tentait chaque interprétation, avec un
 *  worker distant en dernier recours. Côté Node on lit l'arrayBuffer : les
 *  octets sont les octets, et tout ce contournement disparaît. */

const log = logger('Nakanime');

const BASE = 'https://nakanime.tv';
const SEARCH_TTL_MS = 30 * 60 * 1000;
const PAGE_TTL_MS = 60 * 60 * 1000;

/** Clé XOR de 32 octets dérivée de la route. Reproduit exactement l'algorithme
 *  du site : un repli de chaîne en base 31, décalé par l'index de l'octet. */
export function deriveKey(apiRoute: string): Uint8Array {
  const seed = `nkapiv1${apiRoute}`;
  const key = new Uint8Array(32);
  for (let k = 0; k < 32; k++) {
    let m = 0;
    for (let i = 0; i < seed.length; i++) {
      m = (m * 31 + seed.charCodeAt(i) + k) & 255;
    }
    key[k] = m;
  }
  return key;
}

/** Appel de l'API chiffrée. Rend null si la réponse n'est pas du chiffré
 *  valide (rejet CSRF, redirection, page d'erreur). */
async function apiCall<T = any>(
  apiRoute: string,
  method = 'GET',
  body?: string,
  extraHeaders: Record<string, string> = {},
): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const res = await fetch(`${BASE}${apiRoute}`, {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Referer: `${BASE}/`,
        Origin: BASE,
        ...extraHeaders,
      },
      body,
      signal: ctrl.signal,
    });

    const raw = new Uint8Array(await res.arrayBuffer());
    if (raw.length === 0) return null;

    // Les réponses d'erreur arrivent en clair : les déchiffrer produirait du
    // bruit, autant les reconnaître à leur en-tête.
    const head = Buffer.from(raw.slice(0, 40)).toString('latin1');
    if (/^Redirecting|^\s*<|^\{"error/i.test(head)) {
      log.debug(`${apiRoute}: réponse en clair (${head.slice(0, 40)})`);
      return null;
    }

    const key = deriveKey(apiRoute);
    const plain = Buffer.allocUnsafe(raw.length);
    for (let i = 0; i < raw.length; i++) plain[i] = raw[i]! ^ key[i % key.length]!;

    try {
      return JSON.parse(plain.toString('utf-8')) as T;
    } catch {
      log.debug(`${apiRoute}: déchiffrement invalide (${raw.length}o)`);
      return null;
    }
  } catch (e) {
    log.debug(`${apiRoute}: ${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface Hit { id: number; slug: string; title: string }

async function search(keyword: string): Promise<Hit[]> {
  return cached(`nakanime:search:${keyword.toLowerCase()}`, async () => {
    const route = `/api/catalog/search?q=${encodeURIComponent(keyword.trim())}&sort=relevance&page=1&per_page=32`;
    const data = await apiCall<any>(route);
    const arr = Array.isArray(data?.data) ? data.data : [];
    return arr.map((a: any): Hit => ({
      id: a.id,
      slug: a.slug ?? String(a.id),
      title: String(a.title ?? a.name ?? ''),
    })).filter((h: Hit) => h.id && h.title);
  }, { ttlMs: SEARCH_TTL_MS });
}

interface AnimeData {
  id: number;
  episodesList?: Array<{ id: number; number: number; seasonId?: number; languages?: string[] }>;
  seasons?: Array<{ id: number; number: number }>;
}

/** La fiche porte ses données dans un <script id="anime-data">, en clair.
 *  L'URL canonique /anime/{id}/{slug} est obligatoire : /anime/{slug} rend
 *  une page de redirection JavaScript, pas un 301. */
async function animeData(id: number, slug: string): Promise<AnimeData | null> {
  return cached(`nakanime:anime:${id}`, async () => {
    const html = await getText(`${BASE}/anime/${id}/${slug}`, { headers: { Referer: `${BASE}/` } });
    const m = html.match(/<script id="anime-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m?.[1]) return null;
    try {
      return (JSON.parse(m[1])?.anime ?? null) as AnimeData | null;
    } catch {
      return null;
    }
  }, { ttlMs: PAGE_TTL_MS, shouldCache: v => v !== null });
}

interface Source { host?: string; language?: string; url?: string }

/** L'endpoint des sources exige le jeton CSRF d'AdonisJS : on visite d'abord
 *  le site pour récolter XSRF-TOKEN et la session, puis on les rejoue. */
async function fetchSources(animeId: number, episodeId: number, title: string): Promise<Source[]> {
  const home = await request(`${BASE}/`, { headers: { Referer: `${BASE}/` } });

  const jar: Record<string, string> = {};
  for (const line of home.headers.getSetCookie()) {
    const pair = line.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }

  const xsrf = jar['XSRF-TOKEN'] ? decodeURIComponent(jar['XSRF-TOKEN']) : '';
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  log.debug(`cookies: ${Object.keys(jar).join(', ') || 'aucun'} | xsrf=${xsrf ? 'oui' : 'non'}`);

  const body = JSON.stringify({
    title,
    anime_id: Number(animeId),
    turnstile_token: '',
    episode_id: Number(episodeId),
  });

  const data = await apiCall<Source[]>('/api/sources/anime', 'POST', body, {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'X-XSRF-TOKEN': xsrf,
    Cookie: cookie,
    Referer: `${BASE}/anime/${animeId}`,
  });

  return Array.isArray(data) ? data : [];
}

async function resolve(req: MediaRequest): Promise<RawStream[]> {
  if (req.type !== 'series' || !req.episode) return [];

  // 1) Trouver l'anime.
  let hit: Hit | null = null;
  for (const alias of req.aliases.slice(0, 4)) {
    const hits = await search(alias);
    const best = pickBest(hits.map(h => ({ title: h.title, raw: h })), { aliases: req.aliases });
    if (best) {
      hit = best.item.raw;
      log.debug(`fiche: #${hit.id} « ${hit.title} » (score ${best.score.toFixed(2)})`);
      break;
    }
  }
  if (!hit) {
    log.debug(`aucune fiche pour « ${req.title} »`);
    return [];
  }

  // 2) Trouver l'épisode. nakanime numérote par saison, comme Stremio : on
  //    peut donc rapprocher directement, avec le numéro absolu en secours.
  const data = await animeData(hit.id, hit.slug);
  const list = data?.episodesList ?? [];
  if (list.length === 0) {
    log.debug(`fiche #${hit.id} sans liste d'épisodes`);
    return [];
  }

  const seasonOf = new Map((data?.seasons ?? []).map(s => [s.id, s.number]));
  const season = req.season ?? 1;

  const episode = list.find(e => (seasonOf.get(e.seasonId ?? -1) ?? 1) === season && e.number === req.episode)
    ?? (req.absoluteEpisode ? list.find(e => e.number === req.absoluteEpisode) : undefined);

  if (!episode) {
    log.debug(`s${season}e${req.episode} absent (${list.length} épisodes listés)`);
    return [];
  }

  // 3) Résoudre les lecteurs annoncés par l'API.
  const sources = await fetchSources(hit.id, episode.id, `Episode ${episode.number}`);
  if (sources.length === 0) {
    log.debug(`aucune source pour l'épisode ${episode.id}`);
    return [];
  }
  log.debug(`${sources.length} source(s): ${sources.map(s => `${s.host}[${s.language}]`).join(', ')}`);

  const resolved = await Promise.all(sources.map(async src => {
    const embed = src.url ?? '';
    if (!embed) return [];
    const streams = await extractEmbed(embed.startsWith('//') ? `https:${embed}` : embed, `${BASE}/`);
    return streams.map(s => ({
      url: s.url,
      quality: 'HD',
      language: audioLabel(src.language ?? ''),
      // On garde le nom d'hôte annoncé par l'API quand il existe : il est
      // plus parlant que celui déduit de l'URL d'embed.
      server: src.host ?? s.server,
      headers: s.headers,
      container: s.url.includes('.m3u8') ? ('hls' as const) : ('mp4' as const),
    }));
  }));

  return resolved.flat();
}

export const nakanime: Scraper = {
  id: 'nakanime',
  name: 'Nakanime',
  language: 'French',
  supports: ['series'],
  animeOnly: true,
  resolve,
};
