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

/** Région de disponibilité (watch_region) et pays des sorties, déduits de la
 *  langue TMDB du serveur : « fr-FR » -> « FR ». Faute de mieux, FR. */
function region(): string {
  const r = (config.tmdbLanguage.split('-')[1] || 'FR').toUpperCase();
  return /^[A-Z]{2}$/.test(r) ? r : 'FR';
}

/** Date ISO (AAAA-MM-JJ) il y a `days` jours — pour borner « Nouveautés ». */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/** Appel /discover commun aux plateformes et aux nouveautés. Une page TMDB
 *  (20 entrées) à la fois ; la pagination Stremio est traduite en `page`. */
async function discover(type: MediaType, page: number, params: Record<string, string | number>): Promise<CatalogEntry[]> {
  const path = type === 'series' ? '/discover/tv' : '/discover/movie';
  const data = await tmdbGet<any>(path, {
    language: config.tmdbLanguage,
    page,
    include_adult: 'false',
    ...params,
  });
  return clean(data?.results ?? [], type);
}

/** Tendances de la semaine, la porte d'entrée par défaut. */
export async function trending(type: MediaType, page = 1): Promise<CatalogEntry[]> {
  const path = type === 'series' ? '/trending/tv/week' : '/trending/movie/week';
  const data = await tmdbGet<any>(path, { language: config.tmdbLanguage, page });
  return clean(data?.results ?? [], type);
}

/** Les plus populaires du moment. */
async function popular(type: MediaType, page: number): Promise<CatalogEntry[]> {
  const path = type === 'series' ? '/tv/popular' : '/movie/popular';
  const data = await tmdbGet<any>(path, { language: config.tmdbLanguage, page, region: region() });
  return clean(data?.results ?? [], type);
}

/** Sorties récentes (≈ 4 derniers mois), les plus récentes d'abord. Le filtre
 *  de votes écarte le bruit (uploads sans fiche) sans masquer les vraies
 *  nouveautés. */
async function latest(type: MediaType, page: number): Promise<CatalogEntry[]> {
  const field = type === 'series' ? 'first_air_date' : 'primary_release_date';
  return discover(type, page, {
    sort_by: `${field}.desc`,
    [`${field}.lte`]: daysAgo(0),
    [`${field}.gte`]: daysAgo(120),
    'vote_count.gte': 5,
    watch_region: region(),
  });
}

/** Catalogue « disponible sur telle plateforme » : /discover filtré par
 *  fournisseur, en abonnement (flatrate), dans la région du serveur. Les IDs
 *  sont ceux de TMDB pour la région FR (vérifiés via /watch/providers). */
interface ProviderCatalog { key: string; label: string; id: number; }
const PROVIDERS: ProviderCatalog[] = [
  { key: 'netflix', label: 'Netflix', id: 8 },
  { key: 'prime', label: 'Amazon Prime Video', id: 119 },
  { key: 'appletv', label: 'Apple TV+', id: 350 },
  { key: 'paramount', label: 'Paramount+', id: 531 },
  { key: 'universal', label: 'Universal+', id: 1889 },
  { key: 'canal', label: 'Canal+', id: 381 },
  { key: 'hbomax', label: 'HBO Max', id: 1899 },
  { key: 'disney', label: 'Disney+', id: 337 },
  { key: 'crunchyroll', label: 'Crunchyroll', id: 283 },
];

function providerFetch(id: number) {
  return (type: MediaType, page: number) => discover(type, page, {
    with_watch_providers: id,
    watch_region: region(),
    with_watch_monetization_types: 'flatrate',
    sort_by: 'popularity.desc',
  });
}

/** Un catalogue proposable : une clé stable, un libellé, et comment le
 *  remplir. `searchable` déclare la recherche Stremio (une seule l'a : inutile
 *  de relancer la même recherche sur chaque plateforme). */
export interface CatalogDef {
  key: string;
  label: string;
  searchable?: boolean;
  fetch(type: MediaType, page: number): Promise<CatalogEntry[]>;
}

/** Registre, dans l'ordre d'affichage voulu (Nouveautés → Tendance →
 *  Populaire → plateformes). */
export const CATALOG_DEFS: CatalogDef[] = [
  { key: 'new', label: 'Nouveautés', fetch: latest },
  { key: 'trending', label: 'Tendance', searchable: true, fetch: trending },
  { key: 'popular', label: 'Populaire', fetch: popular },
  ...PROVIDERS.map(p => ({ key: p.key, label: p.label, fetch: providerFetch(p.id) })),
];

const BY_KEY = new Map(CATALOG_DEFS.map(d => [d.key, d]));

/** Définition d'un catalogue par sa clé. Les anciens identifiants
 *  `sora-movie` / `sora-series` (installations d'avant les catalogues par
 *  plateforme) retombent sur « Tendance » pour ne pas casser ces installs. */
export function catalogDef(key: string): CatalogDef {
  return BY_KEY.get(key) ?? BY_KEY.get(key === 'movie' || key === 'series' ? 'trending' : key) ?? BY_KEY.get('trending')!;
}

/** Remplit un catalogue (clé + type + page), avec cache. */
export async function fetchCatalog(key: string, type: MediaType, page = 1): Promise<CatalogEntry[]> {
  const def = catalogDef(key);
  return cached(`catalog:${def.key}:${type}:${page}:${config.tmdbLanguage}`, () => def.fetch(type, page),
    { ttlMs: TTL_MS, shouldCache: v => v.length > 0 });
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
