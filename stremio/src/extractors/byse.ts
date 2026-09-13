import * as crypto from 'crypto';
import { getJson, origin } from '../http';
import { logger } from '../log';
import type { ExtractedStream } from './index';

const log = logger('Byse');

/** « Byse Frontend » — la plateforme derrière filemoon.sx, bysebuho.com,
 *  gn1r5n.org et les domaines qu'ils ouvriront demain. Tous servent la même
 *  application : même bundle, même API.
 *
 *  La page est une coquille vide de 1,6 Ko ; tout vient de
 *  `/api/videos/<code>/`, dont le champ `playback` porte la liste des sources
 *  chiffrée en AES-256-GCM. La clé n'est pas transmise telle quelle : le JSON
 *  contient TRENTE fragments dont deux seulement comptent, et c'est le champ
 *  `version` qui dit lesquels. Il change à chaque appel — le lire plutôt que
 *  de le supposer est ce qui fait que ça marche deux fois de suite. */

export interface BysePlayback {
  algorithm?: string;
  iv: string;
  payload: string;
  key_parts: string[];
  version: number;
}

function b64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Fragments retenus pour une version donnée.
 *
 *  Le bundle construit une table de 1 à 20 où l'entrée n vaut [n, 31-n], puis
 *  refuse l'indice hors bornes. Une version inconnue n'est pas une erreur : le
 *  code d'origine retombe alors sur la totalité des fragments, et on fait
 *  pareil plutôt que d'échouer. */
export function keyParts(playback: BysePlayback): string[] {
  const total = playback.key_parts.length;
  const v = Number(playback.version);
  const pair = Number.isInteger(v) && v >= 1 && v <= 20 ? [v, 31 - v] : [];

  const picked = pair
    .filter(i => i >= 1 && i <= total)
    .map(i => playback.key_parts[i - 1])
    .filter((s): s is string => typeof s === 'string' && s.length > 0);

  return picked.length === pair.length && picked.length > 0 ? picked : playback.key_parts;
}

/** Déchiffre le bloc `playback` et rend le JSON des sources. */
export function decodeByse(playback: BysePlayback): any {
  const key = Buffer.concat(keyParts(playback).map(b64url));
  const iv = b64url(playback.iv);
  const full = b64url(playback.payload);

  // GCM colle son marqueur d'authenticité aux seize derniers octets.
  const decipher = crypto.createDecipheriv(`aes-${key.length * 8}-gcm` as any, key, iv);
  decipher.setAuthTag(full.subarray(-16));
  const plain = Buffer.concat([decipher.update(full.subarray(0, -16)), decipher.final()]);
  return JSON.parse(plain.toString('utf-8'));
}

/** Reconnaît la coquille servie par toute la famille. */
export function isBysePage(html: string): boolean {
  return /<title>\s*Byse\s+Frontend/i.test(html);
}

export async function extractByse(embedUrl: string, referer: string): Promise<ExtractedStream[] | null> {
  const code = embedUrl.match(/\/(?:e|d|v)\/([A-Za-z0-9_-]+)/)?.[1];
  const host = origin(embedUrl);
  if (!code || !host) return null;

  const data = await getJson<any>(`${host}/api/videos/${code}/`, {
    headers: { Referer: embedUrl, Accept: 'application/json' },
  });

  const playback = data?.playback;
  if (!playback?.payload || !Array.isArray(playback.key_parts)) {
    log.debug(`pas de bloc playback pour ${code}${data?.error ? ` (${data.error})` : ''}`);
    return null;
  }

  let sources: any[];
  try {
    sources = decodeByse(playback)?.sources ?? [];
  } catch (e) {
    log.debug(`déchiffrement échoué pour ${code}: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  const out = sources
    .filter((s: any) => typeof s?.url === 'string' && s.url.startsWith('http'))
    .map((s: any): ExtractedStream => ({
      url: s.url,
      server: `Byse${s.label ? ` ${s.label}` : ''}`,
      headers: { Referer: `${host}/` },
    }));

  if (out.length === 0) log.debug(`aucune source lisible pour ${code}`);
  return out.length > 0 ? out : null;
}
