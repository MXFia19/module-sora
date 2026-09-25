import { proxify } from './proxy';
import { config } from './config';
import type { RawStream } from './types';

/** Mise en forme des flux pour Stremio : nom, sous-titre, tri, dédoublonnage.
 *  Isolé ici parce que c'est la partie qu'on a envie de retoucher souvent
 *  sans risquer de casser un scraper. */

export interface StremioStream {
  name: string;
  title: string;
  url: string;
  subtitles?: { id: string; url: string; lang: string }[];
  behaviorHints?: Record<string, unknown>;
}

const QUALITY_RANK: Record<string, number> = {
  '4k': 6, '2160p': 6, '1440p': 5, '1080p': 4, 'fhd': 4,
  '720p': 3, 'hd': 2, '480p': 1, '360p': 0,
};

const LANGUAGE_RANK: Record<string, number> = {
  vf: 4, truefrench: 4, french: 4, multi: 3, vostfr: 2, vo: 1,
};

function rank(map: Record<string, number>, value: string, fallback: number): number {
  return map[(value || '').toLowerCase()] ?? fallback;
}

/** VF d'abord, puis la meilleure définition. C'est l'ordre attendu sur des
 *  sources françaises ; un 4K en VO sous un 720p VF frustre plus qu'il n'aide. */
export function sortStreams(streams: RawStream[]): RawStream[] {
  return [...streams].sort((a, b) => {
    const lang = rank(LANGUAGE_RANK, b.language, 0) - rank(LANGUAGE_RANK, a.language, 0);
    if (lang !== 0) return lang;
    const q = rank(QUALITY_RANK, b.quality, 2) - rank(QUALITY_RANK, a.quality, 2);
    if (q !== 0) return q;
    // À langue et qualité égales, un flux qui se lit en direct passe devant :
    // il ne coûte rien au serveur et évite un intermédiaire au lecteur. Le
    // critère arrive en dernier pour ne jamais dégrader ce que l'utilisateur
    // voit en premier.
    const direct = Number(hasMeaningfulHeaders(a.headers)) - Number(hasMeaningfulHeaders(b.headers));
    if (direct !== 0) return direct;
    return (a.source ?? '').localeCompare(b.source ?? '');
  });
}

/** Deux sources qui re-hébergent le même fichier rendent la même URL : on ne
 *  l'affiche qu'une fois, en gardant la première (donc la mieux classée). */
/** Paramètres de query qui désignent le fichier, par opposition à ceux qui
 *  n'en autorisent que l'accès (token, expires, ip, signature...). */
const IDENTIFYING_PARAMS = ['id', 'v', 'videoid', 'file'];

/** Clé d'identité d'un flux : deux URLs qui la partagent pointent le même
 *  fichier.
 *
 *  Jeter toute la query serait plus simple mais faux : la plupart des
 *  hébergeurs mettent le fichier dans le chemin et ne signent que la query,
 *  mais Streamtape sert TOUTES ses vidéos sur `/get_video`, où seul `id`
 *  distingue la VF de la VOSTFR. Les écraser ensemble faisait disparaître un
 *  flux sur deux. */
export function identityKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const ids = IDENTIFYING_PARAMS
      .map(p => [p, u.searchParams.get(p)] as const)
      .filter((e): e is readonly [string, string] => e[1] !== null)
      .map(([p, v]) => `${p}=${v}`);
    return `${u.origin}${u.pathname}${ids.length ? `?${ids.join('&')}` : ''}`;
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl;
  }
}

export function dedupe(streams: RawStream[]): RawStream[] {
  const seen = new Set<string>();
  const out: RawStream[] = [];
  for (const s of streams) {
    const key = identityKey(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function sizeLabel(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? ` • ${gb.toFixed(2)} Go` : ` • ${Math.round(bytes / 1024 ** 2)} Mo`;
}

/** Headers qui changent réellement la réponse de l'hébergeur, et justifient
 *  donc de faire transiter la vidéo par nous.
 *
 *  `Accept` et `User-Agent` n'en font pas partie : tout lecteur envoie déjà
 *  les siens. Mesuré sur un CDN qui refuse les requêtes sans User-Agent —
 *  Chrome, VLC, mpv et AppleCoreMedia passent tous, seule l'absence d'UA est
 *  rejetée. Proxifier pour ça reviendrait à relayer chaque octet de vidéo
 *  sans rien apporter, ce qui se paie cher dès qu'on héberge pour d'autres. */
const MEANINGFUL_HEADERS = ['referer', 'origin', 'cookie', 'authorization'];

export function hasMeaningfulHeaders(headers?: Record<string, string>): boolean {
  if (!headers) return false;
  return Object.keys(headers).some(h => MEANINGFUL_HEADERS.includes(h.toLowerCase()));
}

/** Un flux -> l'objet attendu par Stremio.
 *  Les headers exigés par l'hébergeur déclenchent le passage par le proxy :
 *  c'est le seul endroit où cette décision est prise. */
export function toStremio(s: RawStream): StremioStream {
  const needsProxy = config.proxyEnabled && hasMeaningfulHeaders(s.headers);
  const url = needsProxy ? proxify(s.url, s.headers) : s.url;

  const source = s.source ?? s.server;
  // L'hébergeur réel (« Lulustream », « VOE »...) : c'est LUI qui distingue
  // deux flux d'une même source. Sans lui dans le nom, une source qui rend
  // quinze hébergeurs différents produit quinze entrées d'apparence identique
  // (« Sora Movix / HD » à l'identique), et tout ce qui déduplique en aval —
  // le déduplicateur d'AIOStreams, la vue « versions » de Jellyfin — les fond
  // en une poignée. On met donc l'hébergeur dans le nom, et on ne le répète
  // pas quand il EST la source.
  const host = s.server && s.server !== source ? s.server : '';

  // 2e ligne du nom : hébergeur + langue + qualité. Les trois ensemble, car
  // un même hébergeur sert souvent la VF ET la VOSTFR à la même qualité (« VOE
  // (cpasmal) » ci-dessus) : sans la langue, ces deux-là redeviendraient
  // identiques et se refondraient en aval.
  const detail = [host, s.language, s.quality].filter(Boolean).join(' • ');

  return {
    // 1re ligne : marque + source (l'agrégateur). 2e ligne : le détail complet,
    // ce qui rend chaque flux visuellement et surtout *textuellement* distinct.
    name: `Sora ${source}\n${detail}`,
    title: `${sizeLabel(s.size).replace(/^ • /, '') || s.language}${needsProxy ? '\n(via proxy)' : ''}`,
    url,
    subtitles: (s.subtitles ?? []).map((sub, i) => ({
      id: `${source}-${sub.lang}-${i}`,
      // Un sous-titre a les mêmes contraintes de headers que le flux.
      url: config.proxyEnabled && hasMeaningfulHeaders(sub.headers) ? proxify(sub.url, sub.headers) : sub.url,
      lang: sub.lang,
    })),
    behaviorHints: {
      // Grouper par hébergeur + langue (et non plus par source) :
      // l'enchaînement d'épisodes reste sur le même hébergeur dans la même
      // langue d'un épisode à l'autre, mais deux flux distincts ne partagent
      // plus jamais le même groupe — ce qui les faisait traiter comme un seul
      // flux en aval.
      bingeGroup: `sora-${host || source}-${s.language}`,
      notWebReady: !needsProxy,
    },
  };
}
