import { cached } from './cache';
import { config } from './config';
import { tmdbGet } from './tmdb';
import { trending, search, type CatalogEntry } from './catalog';
import type { MediaType } from './types';

/** Ressources Stremio « catalog » et « meta ».
 *
 *  Jusqu'ici l'addon ne servait que des flux : il fallait un autre addon
 *  (Cinemeta) pour peupler les bibliothèques. Ce module ajoute les deux
 *  ressources manquantes pour qu'il tienne seul dans un client Stremio — ou
 *  dans une façade Jellyfin comme AIOStreams, qui transforme les catalogues en
 *  bibliothèques et les flux en versions.
 *
 *  Tout est keyé TMDB, comme le reste de l'addon. Les identifiants rendus
 *  (`tmdb:123`, `tmdb:123:1:1`) sont exactement ceux que /stream sait déjà
 *  résoudre — la boucle est donc fermée sans nouvelle glu. */

const META_TTL_MS = 6 * 60 * 60 * 1000;
const POSTER = 'https://image.tmdb.org/t/p/w342';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280';
const STILL = 'https://image.tmdb.org/t/p/w300';

/** Aperçu de catalogue : la carte cliquable d'une bibliothèque. */
export interface MetaPreview {
  id: string;
  type: MediaType;
  name: string;
  poster: string | null;
  posterShape: 'poster';
  releaseInfo: string;
  imdbRating?: string;
}

/** Une entrée vidéo d'une série : un épisode. */
interface Video {
  id: string;
  title: string;
  season: number;
  episode: number;
  released?: string;
  thumbnail?: string | null;
  overview?: string;
}

/** Fiche complète rendue à l'ouverture d'un titre. */
export interface MetaDetail {
  id: string;
  type: MediaType;
  name: string;
  poster: string | null;
  background?: string | null;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
  runtime?: string;
  videos?: Video[];
}

function preview(entry: CatalogEntry): MetaPreview {
  return {
    id: entry.id,
    type: entry.type,
    name: entry.title,
    // Le catalogue de diagnostic sert des affiches w185 ; on repasse en w342,
    // plus lisible dans une bibliothèque.
    poster: entry.poster ? entry.poster.replace('/w185', '/w342') : null,
    posterShape: 'poster',
    releaseInfo: entry.year,
    ...(entry.rating != null ? { imdbRating: String(entry.rating) } : {}),
  };
}

/** Catalogue Stremio : tendances par défaut, ou résultats de recherche quand
 *  Stremio passe `?search=`. Réutilise le catalogue déjà écrit pour /debug. */
export async function catalog(type: MediaType, query?: string): Promise<MetaPreview[]> {
  const entries = query && query.trim() ? await search(query) : await trending(type);
  // La recherche multi mêle films et séries ; un catalogue Stremio est typé,
  // donc on filtre sur le type demandé.
  return entries.filter(e => e.type === type).map(preview);
}

/** Numéro TMDB nu à partir d'un identifiant `tmdb:123` ou `tt…`. */
function tmdbNumber(id: string): string | null {
  if (id.startsWith('tmdb:')) return id.slice(5);
  if (/^\d+$/.test(id)) return id;
  return null;
}

/** Fiche + liste d'épisodes pour une série, la liste d'un seul « épisode »
 *  pour un film. */
export async function meta(type: MediaType, id: string): Promise<MetaDetail | null> {
  const tmdbId = tmdbNumber(id);
  if (!tmdbId) return null;

  return cached(`meta:${type}:${tmdbId}:${config.tmdbLanguage}`, async () => {
    const path = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
    const d = await tmdbGet<any>(path, { language: config.tmdbLanguage });
    if (!d || !d.id) return null;

    const name = String(d.title || d.name || d.original_title || d.original_name || 'Sans titre');
    const date = String(d.release_date || d.first_air_date || '');
    const detail: MetaDetail = {
      id: `tmdb:${tmdbId}`,
      type,
      name,
      poster: d.poster_path ? `${POSTER}${d.poster_path}` : null,
      background: d.backdrop_path ? `${BACKDROP}${d.backdrop_path}` : null,
      description: d.overview ? String(d.overview) : undefined,
      releaseInfo: date.slice(0, 4),
      imdbRating: d.vote_average ? String(Math.round(d.vote_average * 10) / 10) : undefined,
      genres: Array.isArray(d.genres) ? d.genres.map((g: any) => String(g.name)).filter(Boolean) : undefined,
      runtime: d.runtime ? `${d.runtime} min` : undefined,
    };

    if (type === 'movie') {
      // Stremio attend au moins une entrée vidéo pour proposer « Regarder ».
      detail.videos = [{
        id: `tmdb:${tmdbId}`,
        title: name,
        season: 1,
        episode: 1,
        released: date || undefined,
      }];
      return detail;
    }

    detail.videos = await episodes(tmdbId, d);
    return detail;
  }, { ttlMs: META_TTL_MS, shouldCache: v => v !== null });
}

/** Épisodes d'une série : une passe par saison réelle, en parallèle. Les
 *  identifiants vidéo (`tmdb:123:S:E`) sont ceux que /stream résout déjà. */
async function episodes(tmdbId: string, tvDetail: any): Promise<Video[]> {
  const seasons: any[] = Array.isArray(tvDetail.seasons) ? tvDetail.seasons : [];
  const real = seasons.filter(s => typeof s.season_number === 'number' && s.season_number >= 1);

  const perSeason = await Promise.all(real.map(async (s) => {
    const data = await tmdbGet<any>(`/tv/${tmdbId}/season/${s.season_number}`, { language: config.tmdbLanguage });
    const list: any[] = data && Array.isArray(data.episodes) ? data.episodes : [];
    return list.map((ep): Video => ({
      id: `tmdb:${tmdbId}:${s.season_number}:${ep.episode_number}`,
      title: ep.name ? String(ep.name) : `Épisode ${ep.episode_number}`,
      season: s.season_number,
      episode: ep.episode_number,
      released: ep.air_date || undefined,
      thumbnail: ep.still_path ? `${STILL}${ep.still_path}` : null,
      overview: ep.overview ? String(ep.overview) : undefined,
    }));
  }));

  return perSeason.flat();
}
