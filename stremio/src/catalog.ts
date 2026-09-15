import { cached } from './cache';
import { config } from './config';
import { tmdbGet } from './tmdb';
import type { MediaType } from './types';

/** Catalogue de la page de diagnostic.
 *
 *  Taper « tt0816692 » à la main pour tester un titre est le genre de friction
 *  qui décourage d'ouvrir la page. Une grille d'affiches cliquables règle ça,
 *  et l'identifiant TMDB vient avec — donc plus d'aller-retour vers IMDb pour
 *  retrouver un code.
 *
 *  C'est un outil de diagnostic, pas un catalogue de lecture : on ne rend que
 *  ce qu'il faut pour lancer un test. */

export interface CatalogEntry {
  /** Forme acceptée telle quelle par /debug/run. */
  id: string;
  type: MediaType;
  title: string;
  year: string;
  poster: string | null;
  rating: number | null;
}

const TTL_MS = 60 * 60 * 1000;
const IMG = 'https://image.tmdb.org/t/p/w185';

function entry(raw: any, forced?: MediaType): CatalogEntry | null {
  const kind = forced ?? (raw?.media_type === 'tv' ? 'series' : raw?.media_type === 'movie' ? 'movie' : null);
  if (!kind || !raw?.id) return null;

  const date = String(raw.release_date || raw.first_air_date || '');
  return {
    id: `tmdb:${raw.id}`,
    type: kind,
    title: String(raw.title || raw.name || raw.original_title || raw.original_name || 'Sans titre'),
    year: date.slice(0, 4),
    poster: raw.poster_path ? `${IMG}${raw.poster_path}` : null,
    rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : null,
  };
}

function clean(list: any[], forced?: MediaType): CatalogEntry[] {
  return list.map(x => entry(x, forced)).filter((x): x is CatalogEntry => x !== null);
}

/** Tendances de la semaine, la porte d'entrée par défaut. */
export async function trending(type: MediaType): Promise<CatalogEntry[]> {
  const path = type === 'series' ? '/trending/tv/week' : '/trending/movie/week';
  return cached(`catalog:trending:${type}:${config.tmdbLanguage}`, async () => {
    const data = await tmdbGet<any>(path, { language: config.tmdbLanguage });
    return clean(data?.results ?? [], type);
  }, { ttlMs: TTL_MS, shouldCache: v => v.length > 0 });
}

/** Recherche multi : films et séries mélangés, comme on les cherche. Les
 *  personnes sont écartées — on ne teste pas un acteur. */
export async function search(query: string): Promise<CatalogEntry[]> {
  const q = query.trim();
  if (!q) return [];
  return cached(`catalog:search:${config.tmdbLanguage}:${q.toLowerCase()}`, async () => {
    const data = await tmdbGet<any>('/search/multi', {
      query: q,
      language: config.tmdbLanguage,
      include_adult: 'false',
    });
    return clean(data?.results ?? []).slice(0, 24);
  }, { ttlMs: TTL_MS, shouldCache: v => v.length > 0 });
}
