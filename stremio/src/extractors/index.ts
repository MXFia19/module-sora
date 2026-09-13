import { getText, origin } from '../http';
import { cached } from '../cache';
import { logger } from '../log';
import { unpackAll, findMediaUrl } from './unpack';
import { extractEmbed4me } from './embed4me';
import { extractFsvid } from './fsvid';
import {
  extractVoe, extractStreamtape, extractSendvid, extractVidmoly, extractSibnet, decodeVoe,
} from './voe';
import { extractYourUpload, extractMailru, extractVidara, extractLulustream } from './misc';

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
    name: 'Fsvid',
    // vidzy est le même exploitant : même obfuscation, et le leurre des deux
    // pointe le même fichier sur s1.fsvid.lol.
    match: /fsvid\.|vidzy\./i,
    extract: (embedUrl, referer) => extractFsvid(embedUrl, referer),
  },
  {
    name: 'Lulustream',
    match: /luluvdo|lulustream|luluvid|lulu\.st/i,
    extract: (embedUrl, referer) => extractLulustream(embedUrl, referer),
  },
  {
    name: 'Vidara',
    match: /\bvidaraa?\b|vidara\.(to|so|cc|net|org)/i,
    extract: (embedUrl, referer) => extractVidara(embedUrl, referer),
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
  let page = embedUrl;
  let html = await getText(embedUrl, { headers: { Referer: referer } });
  if (!html) return null;

  // Coquille de redirection. VOE renouvelle ses domaines de façade en
  // permanence (rebeccapracticeloss.com, kokoflix.lol/osaka_go.php…) et les
  // reconnaître par leur nom est une course perdue : la page, elle, est
  // toujours la même — un <title>Redirecting…</title> et un saut vers le
  // vrai lecteur. On la suit, et le domaine du jour n'a plus d'importance.
  const jump = html.match(/(?:window\.)?location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
  if (jump?.[1] && html.length < 4000) {
    log.debug(`coquille de redirection -> ${jump[1]}`);
    page = jump[1];
    html = await getText(page, { headers: { Referer: referer } });
    if (!html) return null;
  }

  // Page quasi vide qui ne charge son lecteur qu'en JS : c'est la signature de
  // la famille embedseek, qui essaime sous des noms qui changent
  // (serix.upns.live…). Inutile de les nommer un par un — mais inutile aussi
  // d'essayer son API sur tout ce qui porte un identifiant : six requêtes
  // perdues en 404 par film sur des pages qui n'ont rien à voir.
  if (html.length < 4000 && /assets\/index-[\w.-]+\.js/.test(html)) {
    const seek = await extractEmbed4me(page);
    if (seek) {
      log.debug(`embedseek reconnu sur ${page}`);
      return { ...seek, server: 'Embedseek' };
    }
  }

  // Le lecteur d'arrivée est très souvent un VOE, dont l'URL est chiffrée et
  // qu'aucune regex générique ne trouverait.
  const voe = decodeVoe(html);
  const url = voe ?? findMediaUrl(html) ?? findMediaUrl(unpackAll(html));
  if (!url) return null;

  const host = origin(page);
  const name = page.match(/https?:\/\/(?:www\.)?([^/]+)/i)?.[1] ?? 'direct';
  return { url, server: voe ? 'VOE' : name, headers: { Referer: host ? `${host}/` : referer } };
}

/** Marqueurs de fichier absent servis par certains hébergeurs à la place d'une
 *  erreur : l'URL a la bonne forme mais ne contient aucune vidéo.
 *
 *  Le dernier n'est pas une erreur mais un piège : fsvid.lol pose cette URL en
 *  clair dans sa page pour que la vraie, chiffrée, passe inaperçue. Elle ne
 *  devrait plus jamais arriver ici puisque cet hébergeur a son extracteur,
 *  mais une filature qui se termine en cul-de-sac vaut mieux qu'un flux mort
 *  proposé à l'utilisateur. */
const PLACEHOLDER = /novideo|void\.mp4|no_video|deleted|\/troll\/master\.m3u8/i;

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
/** Budget d'un lecteur. Un extracteur enchaîne parfois deux ou trois requêtes
 *  (VOE redirige, YourUpload résout sa redirection) : sans plafond, un seul
 *  hôte qui traîne consomme le budget entier du scraper, et la source rend
 *  zéro flux alors qu'elle en avait déjà résolu huit. */
const EMBED_BUDGET_MS = 15_000;

export async function extractAll(
  embeds: Array<{ url: string; lang: string }>,
  referer: string,
): Promise<Array<ExtractedStream & { lang: string }>> {
  const out = await Promise.all(embeds.map(async e => {
    const streams = await withBudget(extractEmbed(e.url, referer), EMBED_BUDGET_MS, e.url);
    return streams.map(s => ({ ...s, lang: e.lang }));
  }));
  return out.flat();
}

/** Rend un tableau vide au lieu de faire attendre : un lecteur perdu vaut
 *  mieux que toute la source perdue. */
function withBudget(
  p: Promise<ExtractedStream[]>,
  ms: number,
  label: string,
): Promise<ExtractedStream[]> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<ExtractedStream[]>(resolve => {
      timer = setTimeout(() => {
        log.debug(`abandon de ${label} après ${ms}ms`);
        resolve([]);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
