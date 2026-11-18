import { getJson, origin } from '../http';
import { logger } from '../log';
import type { ExtractedStream } from './index';

const log = logger('StreamOrigin');

/** Stream Origin (embedorigin.cc, streamorigin.cc) — une application Next.js
 *  dont la page /e/<code> ne contient rien : le lecteur demande ensuite à son
 *  propre domaine
 *
 *    GET /app/v1/play/<code>?embed=1
 *      -> { file_code, title, hls, mp4, subtitles:[{url, label…}], ads, … }
 *
 *  Pas de jeton, pas de chiffrement : la réponse porte le manifeste en clair.
 *  Ses segments sont servis par le CDN de TikTok, déguisés en images (un en-tête
 *  PNG de 70 octets), mais le manifeste déclare chaque segment par
 *  EXT-X-BYTERANGE à partir de l'octet 70 : le lecteur saute l'en-tête de
 *  lui-même. Le manifeste se lit sans Referer.
 *
 *  Reconnu au chemin et au domaine : la page ne se distingue de rien d'autre
 *  avant l'exécution de son JS. */

export function isEmbedOriginUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.)?(?:embedorigin|streamorigin)\.[a-z]+\/(?:e|d|v)\/[a-z0-9]{8,}/i.test(url);
}

export function embedOriginCode(url: string): string | null {
  return url.match(/\/(?:e|d|v)\/([a-z0-9]{8,})/i)?.[1] ?? null;
}

export interface StreamOriginPlay {
  file_code?: string;
  title?: string;
  hls?: string;
  mp4?: string;
  subtitles?: Array<{ url?: string; label?: string; lang?: string }>;
  message?: string;
}

/** Ce que la réponse donne à lire : HLS d'abord, MP4 sinon. */
export function streamsFromPlay(data: StreamOriginPlay | null, pageOrigin: string): ExtractedStream[] {
  if (!data) return [];
  const out: ExtractedStream[] = [];
  const headers = { Referer: `${pageOrigin}/` };
  if (typeof data.hls === 'string' && /^https?:\/\//.test(data.hls)) {
    out.push({ url: data.hls, server: 'StreamOrigin', headers });
  }
  if (typeof data.mp4 === 'string' && /^https?:\/\//.test(data.mp4)) {
    out.push({ url: data.mp4, server: 'StreamOrigin MP4', headers });
  }
  return out;
}

export async function extractEmbedOrigin(embedUrl: string): Promise<ExtractedStream[] | null> {
  const code = embedOriginCode(embedUrl);
  const host = origin(embedUrl);
  if (!code || !host) return null;

  const data = await getJson<StreamOriginPlay>(`${host}/app/v1/play/${code}?embed=1`, {
    headers: { Referer: embedUrl },
  });
  const out = streamsFromPlay(data, host);
  if (out.length === 0) {
    log.debug(`rien à lire pour ${code}${data?.message ? ` (${data.message})` : ''}`);
    return null;
  }
  return out;
}
