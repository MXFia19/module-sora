import * as crypto from 'crypto';
import { getText } from '../http';
import { logger } from '../log';

const log = logger('Embed4me');

/** Famille embedseek (lplayer, embed4me, neocine, seekplayer, flemmix,
 *  p2pstream). L'API /api/v1/video rend un blob hexadécimal chiffré en
 *  AES-128-CBC avec clé et IV statiques.
 *
 *  Les modules Sora embarquaient une implémentation AES en JS pur (≈120
 *  lignes) parce que le sandbox de l'app n'offre pas de primitive crypto.
 *  Côté Node, `crypto` fait la même chose, en natif : c'est le genre de
 *  simplification que le portage rend possible. */

const KEY = Buffer.from('kiemtienmua911ca', 'latin1');
const IV = Buffer.from('1234567890oiuytr', 'latin1');

export interface Embed4meResult {
  url: string;
  headers: Record<string, string>;
}

export async function extractEmbed4me(embedUrl: string): Promise<Embed4meResult | null> {
  const host = embedUrl.match(/https?:\/\/([^/]+)/i)?.[1];
  // L'identifiant est tantôt dans le fragment (#abc), tantôt en query (?id=abc).
  const id = embedUrl.match(/#([a-zA-Z0-9]+)/)?.[1] ?? embedUrl.match(/[?&]id=([a-zA-Z0-9]+)/)?.[1];
  if (!host || !id) return null;

  const api = `https://${host}/api/v1/video?id=${id}&w=1680&h=1050&r=`;
  // Cette famille répond 400 si on envoie Origin ou Referer : on n'envoie
  // que le User-Agent. Contre-intuitif, mais vérifié dans les modules Sora.
  const hex = (await getText(api, { headers: { Accept: '*/*' } })).trim();
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 32 !== 0) {
    // Cette API dit pourquoi elle refuse, et ça vaut la peine de le répéter :
    // « Video not found or deleted » est une fin de course normale, alors
    // qu'un « rien extrait » nu ressemble à une panne de notre côté et envoie
    // chercher un bug qui n'existe pas. Le message tient en quelques octets,
    // on le relaie tel quel.
    const raison = hex.startsWith('{')
      ? (() => { try { return JSON.parse(hex).message ?? JSON.parse(hex).error; } catch { return null; } })()
      : null;
    log.debug(`${id} : ${raison ?? `réponse non chiffrée (${hex.length}o)`}`);
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', KEY, IV);
    const plain = Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()]);
    const data = JSON.parse(plain.toString('utf-8'));

    const url: string | null = data?.source
      ?? (data?.hlsVideoTiktok ? `https://${host}${data.hlsVideoTiktok}` : null);
    if (!url) return null;

    return { url, headers: { Referer: `https://${host}/`, Origin: `https://${host}` } };
  } catch (e) {
    log.debug(`déchiffrement échoué: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
