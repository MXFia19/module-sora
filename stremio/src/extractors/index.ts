import { getText, origin } from '../http';
import { cached } from '../cache';
import { logger } from '../log';
import { unpackAll, findMediaUrl } from './unpack';
import { extractEmbed4me } from './embed4me';
import {
  extractVoe, extractStreamtape, extractSendvid, extractVidmoly, extractSibnet,
} from './voe';
import { extractYourUpload, extractMailru } from './misc';

const log = logger('Extract');

export interface ExtractedStream {
  url: string;
  /** Nom de l'hébergeur, pour l'affichage. */
  server: string;
  /** Headers exigés à la lecture — c'est eux qui déclenchent le proxy. */
  headers: Record<string, string>;
}

/** Table des hébergeurs. Chaque entrée : comment reconnaître le lien, et
 *  comment en tirer l'URL. Ajouter un hébergeur = ajouter une ligne, et les
 *  trois scrapers anime en profitent d'un coup — c'est tout l'intérêt d'avoir
 *  sorti ça des modules, où le même VOE était recopié quatre fois. */
interface Host {
  name: string;
  match: RegExp;
  /** Un hébergeur peut rendre plusieurs variantes (Mail.ru publie ses
   *  qualités séparément) : le tableau évite de choisir à sa place. */
  extract(embedUrl: string, referer: string): Promise<ExtractedStream | ExtractedStream[] | null>;
}

const HOSTS: Host[] = [
  {
    name: 'VOE',
    match: /voe\.sx|voe\.network|\bvoe\b|lancewhosedifficult/i,
    async extract(embedUrl, referer) {
      const url = await extractVoe(embedUrl, referer);
      return url ? { url, server: 'VOE', headers: { Referer: embedUrl } } : null;
    },
  },
  {
    name: 'Streamtape',
    match: /streamtape/i,
    async extract(embedUrl, referer) {
      const url = await extractStreamtape(embedUrl, referer);
      return url ? { url, server: 'Streamtape', headers: { Referer: 'https://streamtape.com/' } } : null;
    },
  },
  {
    name: 'Vidmoly',
    match: /vidmoly/i,
    async extract(embedUrl) {
      const url = await extractVidmoly(embedUrl);
      return url ? { url, server: 'Vidmoly', headers: { Referer: 'https://vidmoly.biz/' } } : null;
    },
  },
  {
    name: 'Sendvid',
    match: /sendvid/i,
    async extract(embedUrl, referer) {
      const url = await extractSendvid(embedUrl, referer);
      return url ? { url, server: 'Sendvid', headers: { Referer: embedUrl } } : null;
    },
  },
  {
    name: 'Sibnet',
    match: /sibnet\.ru/i,
    async extract(embedUrl) {
      const url = await extractSibnet(embedUrl);
      return url ? { url, server: 'Sibnet', headers: { Referer: embedUrl } } : null;
    },
  },
  {
    name: 'Lplayer',
    match: /lplayer|embed4me|embedseek|neocine|seekplayer|flemmix|p2pstream/i,
    async extract(embedUrl) {
      const r = await extractEmbed4me(embedUrl);
      return r ? { url: r.url, server: 'Lplayer', headers: r.headers } : null;
    },
  },
  {
    name: 'YourUpload',
    match: /yourupload/i,
    extract: (embedUrl, referer) => extractYourUpload(embedUrl, referer),
  },
  {
    name: 'Mail.ru',
    match: /my\.mail\.ru/i,
    extract: embedUrl => extractMailru(embedUrl),
  },
];

/** Repli générique : la page contient soit l'URL en clair, soit un bloc packé
 *  qui la contient. Couvre Vidhide et toute la famille qui partage ce lecteur,
 *  sans avoir à les nommer une par une. */
async function extractGeneric(embedUrl: string, referer: string): Promise<ExtractedStream | null> {
  const html = await getText(embedUrl, { headers: { Referer: referer } });
  if (!html) return null;

  const url = findMediaUrl(html) ?? findMediaUrl(unpackAll(html));
  if (!url) return null;

  const host = origin(embedUrl);
  const name = embedUrl.match(/https?:\/\/(?:www\.)?([^/]+)/i)?.[1] ?? 'direct';
  return { url, server: name, headers: { Referer: host ? `${host}/` : referer } };
}

/** Marqueurs de fichier absent servis par certains hébergeurs à la place d'une
 *  erreur : l'URL a la bonne forme mais ne contient aucune vidéo. */
const PLACEHOLDER = /novideo|void\.mp4|no_video|deleted/i;

/** Une URL n'est retenue que si elle est absolue et ne porte pas un marqueur
 *  de fichier absent. Un lien relatif (`/embed/novideo.mp4`) a bien
 *  l'extension attendue mais n'est pas joignable, et le servir donnerait une
 *  entrée qui échoue à la lecture — pire que ne rien proposer. */
export function isPlayable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  return !PLACEHOLDER.test(url);
}

/** Exigence supplémentaire pour le repli générique UNIQUEMENT : l'URL doit
 *  porter une extension de média.
 *
 *  Le repli ramasse la première URL plausible d'une page qu'il ne connaît
 *  pas ; sans ce garde-fou il rendrait des pages HTML et des images. Un
 *  extracteur nommé, lui, sait ce qu'il a extrait — et l'exiger de lui coûtait
 *  cher : Streamtape sert ses vidéos sur `/get_video?id=…`, sans extension,
 *  et chacun de ses flux était jeté après avoir été correctement extrait. */
export function looksLikeMedia(url: string): boolean {
  return /\.(m3u8|mp4)(\?|$)/i.test(url);
}

/** Durée de mémorisation d'une extraction. Courte : les URLs rendues sont
 *  signées et expirent. Elle sert surtout à l'intérieur d'une même requête,
 *  où deux sources tombent régulièrement sur le même lecteur. */
const EXTRACT_TTL_MS = 5 * 60 * 1000;

/** Résout un lien d'embed en flux jouables. Ne jette jamais : un hébergeur
 *  cassé ne doit retirer que sa propre entrée de la liste.
 *
 *  Mémorisé par URL d'embed : sur un film, nakanime, anime-sama et voir-anime
 *  pointent souvent le MÊME lecteur, et voir-anime le pointe deux fois (une
 *  fiche VF, une fiche VOSTFR). Sans ça la même page de 125 Ko est téléchargée
 *  et déchiffrée autant de fois qu'il y a de sources qui la citent. La
 *  déduplication des appels en vol de `cached` couvre le cas concurrent, qui
 *  est le cas normal ici. */
export function extractEmbed(embedUrl: string, referer: string): Promise<ExtractedStream[]> {
  return cached(`extract:${embedUrl}`, () => extractOnce(embedUrl, referer), {
    ttlMs: EXTRACT_TTL_MS,
  });
}

async function extractOnce(embedUrl: string, referer: string): Promise<ExtractedStream[]> {
  const host = HOSTS.find(h => h.match.test(embedUrl));
  try {
    const result = host
      ? await host.extract(embedUrl, referer)
      : await extractGeneric(embedUrl, referer);

    if (!result) {
      log.debug(`rien extrait de ${embedUrl}${host ? ` (${host.name})` : ''}`);
      return [];
    }

    const playable = (Array.isArray(result) ? result : [result])
      .filter(r => isPlayable(r.url) && (host ? true : looksLikeMedia(r.url)));

    if (playable.length === 0) log.debug(`aucune URL jouable depuis ${embedUrl}`);
    return playable;
  } catch (e) {
    log.debug(`échec ${embedUrl}: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/** Résout plusieurs embeds en parallèle, en ignorant les échecs. */
export async function extractAll(
  embeds: Array<{ url: string; lang: string }>,
  referer: string,
): Promise<Array<ExtractedStream & { lang: string }>> {
  const out = await Promise.all(embeds.map(async e => {
    const streams = await extractEmbed(e.url, referer);
    return streams.map(s => ({ ...s, lang: e.lang }));
  }));
  return out.flat();
}
