/** Contrat commun à tous les scrapers. Un scraper ne connaît QUE ce fichier :
 *  il reçoit une demande normalisée, il rend des flux normalisés. Tout le reste
 *  (Stremio, proxy, cache, TMDB) est en dehors de son périmètre — c'est ce qui
 *  permet d'en ajouter un sans toucher au serveur. */

export type MediaType = 'movie' | 'series';

/** Ce qu'on sait du contenu demandé, indépendamment de la source.
 *  Les scrapers keyés TMDB utilisent `tmdbId` ; ceux qui cherchent par titre
 *  utilisent `title` / `originalTitle` / `aliases` / `year`. */
export interface MediaRequest {
  type: MediaType;
  /** id TMDB, toujours résolu en amont (depuis l'id IMDb fourni par Stremio). */
  tmdbId: string;
  imdbId?: string;
  /** Titre dans la langue du scraper (FR pour les sources françaises). */
  title: string;
  /** Titre original (souvent EN ou JP) — indispensable pour l'anime. */
  originalTitle?: string;
  /** Titres alternatifs TMDB + synonymes, pour le matching approximatif. */
  aliases: string[];
  year?: number;
  season?: number;
  episode?: number;
  /** Numéro d'épisode absolu, calculé pour les sources anime qui numérotent
   *  en continu au lieu de repartir à 1 à chaque saison. */
  absoluteEpisode?: number;
  /** Animation japonaise d'après TMDB. Le serveur s'en sert pour écarter les
   *  sources anime-only ; movix s'en sert pour choisir quelles sondes lancer. */
  anime: boolean;
}

/** Sous-titre externe. `lang` est en ISO 639-2 (fre, eng...) : c'est ce que
 *  Stremio affiche, un code à 2 lettres y sort en libellé vide. */
export interface SubtitleTrack {
  lang: string;
  url: string;
  /** Headers requis pour télécharger le .vtt/.srt, s'il y en a. */
  headers?: Record<string, string>;
}

/** Un flux jouable rendu par un scraper. */
export interface RawStream {
  url: string;
  /** '1080p' | '720p' | 'HD'... Libre : sert à l'affichage et au tri. */
  quality: string;
  /** 'VF' | 'VOSTFR' | 'VO' | 'MULTI' — sert à l'affichage et au tri. */
  language: string;
  /** Nom de l'hébergeur final ('filemoon', 'voe'...) ou du site. */
  server: string;
  /** Site d'origine, rempli par le serveur si le scraper l'omet. */
  source?: string;
  subtitles?: SubtitleTrack[];
  /** Headers exigés par l'hébergeur à la lecture. Leur présence déclenche
   *  le passage par le proxy intégré : Stremio ne les transmet pas. */
  headers?: Record<string, string>;
  /** Renseigné quand on le connaît : évite au proxy de re-sniffer. */
  container?: 'hls' | 'mp4';
  /** Taille en octets si connue (affichage). */
  size?: number;
}

/** Un scraper = des métadonnées + une fonction. Rien d'autre. */
export interface Scraper {
  /** Identifiant stable, utilisé dans la config (SCRAPERS=movix,purstream). */
  id: string;
  /** Nom affiché dans le libellé des flux. */
  name: string;
  /** Langue dominante — purement informatif. */
  language: string;
  /** Types de contenu servis. Un scraper anime-only n'est pas appelé pour
   *  un film hors anime, ça économise une requête par recherche. */
  supports: MediaType[];
  /** Ne traite que de l'anime : le serveur saute l'appel si le contenu TMDB
   *  n'est pas identifié comme animation. */
  animeOnly?: boolean;
  resolve(req: MediaRequest): Promise<RawStream[]>;
}
