import { cached } from '../cache';
import { getJson, getText, absolute } from '../http';
import { logger } from '../log';
import { pickBest } from '../match';
import { toIso639_2, isForced } from '../lang';
import type { MediaRequest, RawStream, Scraper, SubtitleTrack } from '../types';

/** purstream — agrégateur français, API JSON propre, HLS direct ré-hébergé.
 *
 *  Le domaine tourne : purstream.wiki publie le domaine courant, d'abord via
 *  une API de statut, sinon dans le HTML de sa page d'accueil. On ne code donc
 *  jamais le domaine en dur ailleurs que dans le repli de dernier recours.
 *
 *  Résolution : recherche par titre (la source n'est pas keyée TMDB) puis
 *  /api/v1/stream/{id} pour un film, /stream/{id}/episode?season=&episode=
 *  pour une série. */

const log = logger('Purstream');

const WIKI = 'https://purstream.wiki';
const FALLBACK_DOMAIN = 'purstream.ac';
const DOMAIN_TTL_MS = 60 * 60 * 1000;
const SEARCH_TTL_MS = 30 * 60 * 1000;

async function currentDomain(): Promise<string> {
  return cached('purstream:domain', async () => {
    // 1) API de statut — la voie officielle, et la plus rapide.
    const status = await getJson<any>(`${WIKI}/api/server-status`);
    const main = Array.isArray(status?.servers)
      ? status.servers.find((s: any) => s?.id === 'main')
      : null;
    if (main?.url) {
      const clean = String(main.url).replace(/^https?:\/\//, '').replace(/\/+$/, '');
      log.debug(`domaine via API: ${clean}`);
      return clean;
    }

    // 2) Repli HTML — quand l'API de statut tombe, le domaine reste écrit
    //    dans la page d'accueil du wiki.
    const html = await getText(`${WIKI}/`);
    const m = html.match(/https:\/\/(purstream\.[a-z]+)/);
    if (m?.[1]) {
      log.debug(`domaine via HTML: ${m[1]}`);
      return m[1];
    }

    log.warn(`domaine introuvable, repli sur ${FALLBACK_DOMAIN}`);
    return FALLBACK_DOMAIN;
  }, { ttlMs: DOMAIN_TTL_MS, shouldCache: v => typeof v === 'string' && v.length > 0 });
}

interface SearchHit {
  id: number | string;
  title?: string;
  name?: string;
  type?: string;
  releaseDate?: string;
  release_date?: string;
}

function hitYear(h: SearchHit): number | undefined {
  const d = h.releaseDate || h.release_date || '';
  const y = Number(String(d).slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : undefined;
}

async function search(domain: string, query: string): Promise<SearchHit[]> {
  return cached(`purstream:search:${query.toLowerCase()}`, async () => {
    const url = `https://api.${domain}/api/v1/search-bar/search/${encodeURIComponent(query)}`;
    const data = await getJson<any>(url, { headers: refererHeaders(domain) });
    const items = data?.data?.items?.movies?.items;
    return Array.isArray(items) ? (items as SearchHit[]) : [];
  }, { ttlMs: SEARCH_TTL_MS });
}

function refererHeaders(domain: string): Record<string, string> {
  return { Referer: `https://${domain}/`, Origin: `https://${domain}` };
}

/** Le média cherché, résolu en identifiant purstream.
 *  On essaie les titres TMDB dans l'ordre (FR puis EN puis original) et on
 *  s'arrête au premier qui donne un candidat au-dessus du seuil. */
async function resolveId(domain: string, req: MediaRequest): Promise<string | null> {
  const wantMovie = req.type === 'movie';

  for (const alias of req.aliases.slice(0, 3)) {
    const hits = await search(domain, alias);
    if (hits.length === 0) continue;

    const typed = hits.filter(h => {
      if (!h.type) return true;                    // type absent : on ne tranche pas.
      return wantMovie ? h.type === 'movie' : h.type !== 'movie';
    });

    const best = pickBest(
      typed.map(h => ({ title: String(h.title || h.name || ''), year: hitYear(h), raw: h })),
      { aliases: req.aliases, year: req.year },
    );

    if (best) {
      log.debug(`« ${alias} » -> #${best.item.raw.id} « ${best.item.title} » (score ${best.score.toFixed(2)})`);
      return String(best.item.raw.id);
    }
  }

  log.debug(`aucun résultat convaincant pour « ${req.title} »`);
  return null;
}

/** Sous-titres annoncés dans le master HLS.
 *  purstream range chaque piste dans un dossier dont le manifeste porte le
 *  même préfixe, et y dépose un subtitle.vtt : on cible ce fichier plutôt que
 *  le .m3u8 de sous-titres, que Stremio ne sait pas lire. */
async function subtitlesFromMaster(masterUrl: string, headers: Record<string, string>): Promise<SubtitleTrack[]> {
  if (!masterUrl.includes('.m3u8')) return [];

  const body = await getText(masterUrl, { headers });
  if (!body.startsWith('#EXTM3U')) return [];

  const base = masterUrl.slice(0, masterUrl.lastIndexOf('/') + 1);
  const out: SubtitleTrack[] = [];
  const seen = new Set<string>();

  for (const line of body.split('\n')) {
    if (!line.includes('TYPE=SUBTITLES')) continue;
    const uri = line.match(/URI="([^"]+)"/)?.[1];
    if (!uri) continue;

    const label = line.match(/NAME="([^"]+)"/)?.[1]
      ?? line.match(/LANGUAGE="([^"]+)"/i)?.[1]
      ?? 'und';
    const folder = uri.split('/')[0]!;
    const url = absolute(`${folder}/subtitle.vtt`, base);

    // Une langue non forcée prime sur sa variante forcée du même code.
    const key = `${toIso639_2(label)}:${isForced(label) ? 'f' : 'n'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      lang: isForced(label) ? `${toIso639_2(label)} (forcé)` : toIso639_2(label),
      url,
      headers,
    });
  }

  log.debug(`${out.length} piste(s) de sous-titres dans le master`);
  return out;
}

async function resolve(req: MediaRequest): Promise<RawStream[]> {
  const domain = await currentDomain();
  const id = await resolveId(domain, req);
  if (!id) return [];

  const headers = refererHeaders(domain);
  const url = req.type === 'movie'
    ? `https://api.${domain}/api/v1/stream/${id}`
    : `https://api.${domain}/api/v1/stream/${id}/episode?season=${req.season}&episode=${req.episode}`;

  const data = await getJson<any>(url, { headers });
  const sources: any[] = data?.data?.items?.sources ?? [];
  if (sources.length === 0) {
    log.debug(`aucune source pour #${id}`);
    return [];
  }

  // Les sous-titres vivent dans le master HLS, identique d'une source à
  // l'autre : on ne le télécharge qu'une fois.
  let subtitles: SubtitleTrack[] = [];
  const streams: RawStream[] = [];

  for (const source of sources) {
    const streamUrl = String(source?.stream_url ?? '');
    if (!streamUrl) continue;

    if (subtitles.length === 0) {
      subtitles = await subtitlesFromMaster(streamUrl, headers);
    }

    streams.push({
      url: streamUrl,
      quality: 'HD',
      language: 'VF',
      server: String(source?.source_name ?? 'direct'),
      subtitles,
      headers,
      container: streamUrl.includes('.m3u8') ? 'hls' : 'mp4',
    });
  }

  return streams;
}

export const purstream: Scraper = {
  id: 'purstream',
  name: 'Purstream',
  language: 'French',
  supports: ['movie', 'series'],
  resolve,
};
