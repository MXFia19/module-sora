import { config } from './config';
import { cached } from './cache';
import { getJson } from './http';
import { logger } from './log';
import type { MediaRequest, MediaType } from './types';

const log = logger('TMDB');
const BASE = 'https://api.themoviedb.org/3';

const META_TTL_MS = 24 * 60 * 60 * 1000; // les métadonnées ne bougent pas.

function api(path: string, params: Record<string, string | number> = {}): string {
  const q = new URLSearchParams({ api_key: config.tmdbApiKey, ...Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ) });
  return `${BASE}${path}?${q}`;
}

interface TmdbDetails {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  genres?: { id: number }[];
  origin_country?: string[];
  original_language?: string;
  seasons?: { season_number: number; episode_count: number }[];
}

/** id IMDb (tt…) -> id TMDB. Stremio livre presque toujours du IMDb ; les
 *  sources, elles, sont keyées TMDB. C'est la seule vraie glu à ajouter au
 *  portage depuis Sora, qui partait d'une recherche par titre. */
export async function imdbToTmdb(imdbId: string, type: MediaType): Promise<string | null> {
  return cached(`tmdb:find:${imdbId}:${type}`, async () => {
    const data = await getJson<any>(api(`/find/${imdbId}`, { external_source: 'imdb_id' }));
    const arr = type === 'movie' ? data?.movie_results : data?.tv_results;
    const hit = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    if (!hit) {
      log.warn(`aucun équivalent TMDB pour ${imdbId} (${type})`);
      return null;
    }
    return String(hit.id);
  }, { ttlMs: META_TTL_MS, shouldCache: v => v !== null });
}

async function details(tmdbId: string, type: MediaType, language: string): Promise<TmdbDetails | null> {
  const path = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  return cached(`tmdb:det:${type}:${tmdbId}:${language}`,
    () => getJson<TmdbDetails>(api(path, { language })),
    { ttlMs: META_TTL_MS, shouldCache: v => v !== null });
}

/** Titres alternatifs déclarés par TMDB : c'est ce qui rattrape les sites FR
 *  qui titrent autrement que la fiche officielle. */
async function alternativeTitles(tmdbId: string, type: MediaType): Promise<string[]> {
  const path = type === 'movie'
    ? `/movie/${tmdbId}/alternative_titles`
    : `/tv/${tmdbId}/alternative_titles`;
  return cached(`tmdb:alt:${type}:${tmdbId}`, async () => {
    const data = await getJson<any>(api(path));
    const arr: any[] = data?.titles || data?.results || [];
    return arr
      .filter(t => !t.iso_3166_1 || ['FR', 'US', 'GB', 'JP', 'BE', 'CA'].includes(t.iso_3166_1))
      .map(t => String(t.title || ''))
      .filter(Boolean);
  }, { ttlMs: META_TTL_MS });
}

/** Animation japonaise ? Sert à ne pas déranger les scrapers anime pour un
 *  film live, et inversement à ne pas chercher un anime sur une source
 *  généraliste qui ne l'aura pas. Genre 16 = Animation. */
export function isAnime(d: TmdbDetails | null): boolean {
  if (!d) return false;
  const animation = (d.genres ?? []).some(g => g.id === 16);
  const japanese = (d.origin_country ?? []).includes('JP') || d.original_language === 'ja';
  return animation && japanese;
}

/** Numéro d'épisode absolu : somme des épisodes des saisons précédentes.
 *  Les sources anime (anime-sama, voiranime) numérotent souvent en continu
 *  alors que Stremio raisonne en saison/épisode. */
export function absoluteEpisode(d: { seasons?: { season_number: number; episode_count: number }[] } | null, season: number, episode: number): number | undefined {
  const seasons = d?.seasons;
  if (!seasons || season <= 1) return season === 1 ? episode : undefined;
  let total = 0;
  for (const s of seasons) {
    if (s.season_number === 0) continue;      // les spéciaux ne comptent pas.
    if (s.season_number >= season) continue;
    if (!Number.isFinite(s.episode_count)) return undefined;
    total += s.episode_count;
  }
  return total + episode;
}

/** Construit la demande normalisée que reçoivent les scrapers, à partir de
 *  l'identifiant brut donné par Stremio ('tt0816692' ou 'tmdb:157336'). */
export async function buildRequest(
  rawId: string,
  type: MediaType,
  season?: number,
  episode?: number,
): Promise<MediaRequest | null> {
  let tmdbId: string | null = null;
  let imdbId: string | undefined;

  if (/^tt\d+$/i.test(rawId)) {
    imdbId = rawId;
    tmdbId = await imdbToTmdb(rawId, type);
  } else if (/^tmdb:/i.test(rawId)) {
    tmdbId = rawId.slice(5);
  } else if (/^\d+$/.test(rawId)) {
    tmdbId = rawId;
  }

  if (!tmdbId) return null;

  const [fr, orig, alts] = await Promise.all([
    details(tmdbId, type, config.tmdbLanguage),
    details(tmdbId, type, 'en-US'),
    alternativeTitles(tmdbId, type),
  ]);

  if (!fr && !orig) {
    log.warn(`fiche TMDB introuvable: ${type}/${tmdbId}`);
    return null;
  }

  const d = fr ?? orig!;
  const title = String(fr?.title || fr?.name || orig?.title || orig?.name || '');
  const originalTitle = String(d.original_title || d.original_name || '');
  const englishTitle = String(orig?.title || orig?.name || '');
  const date = d.release_date || d.first_air_date || '';
  const year = date ? Number(date.slice(0, 4)) : undefined;

  // Dédoublonnage en gardant l'ordre : titre FR d'abord, c'est celui qui a
  // le plus de chances de matcher sur une source française.
  const aliases = [...new Set([title, englishTitle, originalTitle, ...alts].filter(Boolean))];

  return {
    type,
    tmdbId,
    imdbId,
    title,
    originalTitle: originalTitle || undefined,
    aliases,
    year,
    season,
    episode,
    absoluteEpisode: type === 'series' && season && episode
      ? absoluteEpisode(orig ?? fr, season, episode)
      : undefined,
    anime: isAnime(orig ?? fr),
  };
}
