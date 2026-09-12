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
    return (a.source ?? '').localeCompare(b.source ?? '');
  });
}

/** Deux sources qui re-hébergent le même fichier rendent la même URL : on ne
 *  l'affiche qu'une fois, en gardant la première (donc la mieux classée). */
export function dedupe(streams: RawStream[]): RawStream[] {
  const seen = new Set<string>();
  const out: RawStream[] = [];
  for (const s of streams) {
    // La query porte souvent un token de session : deux URLs qui ne diffèrent
    // que par lui pointent le même fichier.
    const key = s.url.split('?')[0] ?? s.url;
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

/** Un flux -> l'objet attendu par Stremio.
 *  Les headers exigés par l'hébergeur déclenchent le passage par le proxy :
 *  c'est le seul endroit où cette décision est prise. */
export function toStremio(s: RawStream): StremioStream {
  const needsProxy = config.proxyEnabled && s.headers && Object.keys(s.headers).length > 0;
  const url = needsProxy ? proxify(s.url, s.headers) : s.url;

  const source = s.source ?? s.server;
  const badges = [s.language, s.server !== source ? s.server : null]
    .filter(Boolean)
    .join(' • ');

  return {
    name: `Sora ${source}\n${s.quality}`,
    title: `${badges}${sizeLabel(s.size)}${needsProxy ? '\n(via proxy)' : ''}`,
    url,
    subtitles: (s.subtitles ?? []).map((sub, i) => ({
      id: `${source}-${sub.lang}-${i}`,
      // Un sous-titre a les mêmes contraintes de headers que le flux.
      url: config.proxyEnabled && sub.headers ? proxify(sub.url, sub.headers) : sub.url,
      lang: sub.lang,
    })),
    behaviorHints: {
      // Regrouper par source : Stremio enchaîne alors les épisodes sur la
      // même source sans redemander à l'utilisateur.
      bingeGroup: `sora-${source}-${s.quality}`,
      notWebReady: !needsProxy,
    },
  };
}
