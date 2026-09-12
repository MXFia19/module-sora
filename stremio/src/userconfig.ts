import { hasMeaningfulHeaders } from './display';
import type { RawStream } from './types';

/** Configuration par utilisateur, transportée dans l'URL d'installation.
 *
 *  Une seule instance sert alors des réglages différents à chacun : c'est ce
 *  qui permet d'héberger pour d'autres sans imposer ses propres choix. Deux
 *  conséquences valent d'être soulignées :
 *
 *  - chaque utilisateur apporte SA clé TMDB, donc le quota de l'hébergeur ne
 *    s'épuise pas et une clé révoquée ne pénalise que son propriétaire ;
 *  - le mode « direct » écarte les flux qui exigeraient le proxy, ce qui rend
 *    le coût en bande passante pour l'hébergeur strictement nul.
 *
 *  La config n'est ni signée ni chiffrée : elle est à l'utilisateur, elle voyage
 *  dans SON lien, et rien dedans ne donne de droits sur le serveur. La clé TMDB
 *  y est en clair — c'est pour ça que le lien généré ne doit pas être partagé,
 *  et la page de configuration le dit. */

export type Mode = 'direct' | 'proxy';
export type SortOrder = 'lang' | 'quality';
/** Que faire quand aucun flux ne passe les filtres. */
export type Fallback = 'souple' | 'strict';

export interface UserConfig {
  /** Clé TMDB v3 (32 caractères) ou jeton v4 (eyJ…). */
  tmdbKey?: string;
  mode: Mode;
  /** Sources actives ; vide = toutes celles du serveur. */
  sources: string[];
  /** Langues acceptées, dans l'ordre de préférence. */
  languages: string[];
  /** Qualités affichées. */
  qualities: string[];
  preferredQuality?: string;
  sort: SortOrder;
  fallback: Fallback;
  /** Rendre la main dès que ce nombre de flux est réuni, sans attendre les
   *  sources encore en route. 0 = attendre tout le monde. */
  minStreams: number;
  /** Pseudo, affiché dans les logs pour rattacher un signalement à une config. */
  nickname?: string;
}

export const ALL_LANGUAGES = ['MULTI', 'VF', 'VOSTFR', 'VO'];
export const ALL_QUALITIES = ['4K', '1080p', '720p', '480p', '360p', 'HD'];

export const DEFAULT_CONFIG: UserConfig = {
  // L'URL sans configuration montre TOUT ce qui est trouvable, proxy compris :
  // c'est le comportement attendu d'une instance personnelle. La page de
  // configuration recommande « direct » à l'inverse, parce qu'elle s'adresse
  // à quelqu'un qui installe sur l'instance d'un autre.
  mode: 'proxy',
  sources: [],
  languages: [...ALL_LANGUAGES],
  qualities: [...ALL_QUALITIES],
  sort: 'lang',
  fallback: 'souple',
  minStreams: 0,
};

/** Encodage compact en base64url. Les clés du JSON sont courtes parce que la
 *  chaîne finit dans une URL que l'utilisateur voit et recopie. */
export function encodeConfig(c: UserConfig): string {
  const compact: Record<string, unknown> = {
    m: c.mode,
    l: c.languages,
    q: c.qualities,
    s: c.sort,
    f: c.fallback,
  };
  if (c.tmdbKey) compact.k = c.tmdbKey;
  if (c.sources.length) compact.src = c.sources;
  if (c.preferredQuality) compact.pq = c.preferredQuality;
  if (c.minStreams > 0) compact.min = c.minStreams;
  if (c.nickname) compact.n = c.nickname;
  return Buffer.from(JSON.stringify(compact), 'utf-8').toString('base64url');
}

/** Décodage tolérant : une config illisible ou partielle retombe sur les
 *  valeurs par défaut plutôt que de casser l'installation de quelqu'un. */
export function decodeConfig(encoded?: string): UserConfig {
  if (!encoded) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    const list = (v: unknown, fallback: string[]) =>
      Array.isArray(v) && v.length > 0 ? v.map(String) : fallback;

    return {
      tmdbKey: typeof raw.k === 'string' && raw.k.trim() ? raw.k.trim() : undefined,
      mode: raw.m === 'direct' ? 'direct' : 'proxy',
      sources: Array.isArray(raw.src) ? raw.src.map(String) : [],
      languages: list(raw.l, DEFAULT_CONFIG.languages),
      qualities: list(raw.q, DEFAULT_CONFIG.qualities),
      preferredQuality: typeof raw.pq === 'string' ? raw.pq : undefined,
      sort: raw.s === 'quality' ? 'quality' : 'lang',
      fallback: raw.f === 'strict' ? 'strict' : 'souple',
      minStreams: Number.isFinite(raw.min) && raw.min > 0 ? Math.floor(raw.min) : 0,
      nickname: typeof raw.n === 'string' ? raw.n.slice(0, 24) : undefined,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function qualityRank(c: UserConfig, quality: string): number {
  if (c.preferredQuality && quality === c.preferredQuality) return -1;
  const i = ALL_QUALITIES.indexOf(quality);
  return i < 0 ? ALL_QUALITIES.length : i;
}

function languageRank(c: UserConfig, language: string): number {
  const i = c.languages.indexOf(language);
  return i < 0 ? c.languages.length : i;
}

/** Applique la configuration à une liste de flux : filtre puis trie.
 *
 *  Le repli « souple » relâche la langue mais GARDE les exclusions de
 *  qualité : quelqu'un qui a coché « pas de 360p » ne veut pas se retrouver
 *  avec du 360p sous prétexte qu'il n'y a rien d'autre — alors qu'une langue
 *  inattendue reste regardable. */
export function applyConfig(streams: RawStream[], c: UserConfig): RawStream[] {
  // Le mode direct est un filtre dur : proposer un flux qui exige le proxy
  // donnerait une entrée qui échoue à la lecture.
  const usable = c.mode === 'direct'
    ? streams.filter(s => !hasMeaningfulHeaders(s.headers))
    : streams;

  const byQuality = usable.filter(s => c.qualities.includes(s.quality));
  const byBoth = byQuality.filter(s => c.languages.includes(s.language));

  let kept = byBoth;
  if (kept.length === 0 && c.fallback === 'souple') kept = byQuality;

  return [...kept].sort((a, b) => {
    const lang = languageRank(c, a.language) - languageRank(c, b.language);
    const qual = qualityRank(c, a.quality) - qualityRank(c, b.quality);

    const primary = c.sort === 'lang' ? lang : qual;
    if (primary !== 0) return primary;
    const secondary = c.sort === 'lang' ? qual : lang;
    if (secondary !== 0) return secondary;

    // À égalité, un flux direct passe devant : rien à relayer côté serveur.
    return Number(hasMeaningfulHeaders(a.headers)) - Number(hasMeaningfulHeaders(b.headers));
  });
}
