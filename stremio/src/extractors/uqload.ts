import { request, origin } from '../http';
import { logger } from '../log';
import { unpackAll } from './unpack';
import type { ExtractedStream } from './index';

const log = logger('Uqload');

/** Uqload (uqload.vc ; uqload.cx n'est qu'un miroir qui redirige vers .vc).
 *
 *  Lecteur JW Player classique : la page porte un bloc p.a.c.k.e.r, et la
 *  source se lit dans `sources:[{file:"https://strmN.uqload.vc/hls2/…/master.m3u8"}]`.
 *
 *  La particularité est une liste de domaines autorisés à l'intégrer. Quand
 *  le Referer n'en fait pas partie, la page entière est remplacée par
 *  « Video embed restricted for this domain » (38 octets, HTTP 200) — ce que
 *  le chemin générique prenait pour un lecteur qu'il ne sait pas lire. Ouvert
 *  sans Referer, comme un lien collé dans la barre d'adresse, le même embed
 *  répond normalement. Ce n'est pas un contrôle anti-robot : la même requête
 *  depuis un navigateur donne la même page.
 *
 *  Le manifeste, lui, ne vérifie rien (200 avec ou sans Referer) ; on envoie
 *  tout de même celui du lecteur, c'est ce que fait le navigateur. */
const RESTRICTED = /Video embed restricted for this domain/i;

export function isUqloadRestricted(html: string): boolean {
  return html.length < 200 && RESTRICTED.test(html);
}

/** URL de la source déclarée dans la page (en clair ou dans le bloc paqué). */
export function uqloadSource(html: string): string | null {
  const code = `${html}\n${unpackAll(html)}`;
  const m = code.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  return m?.[1] ?? null;
}

export async function extractUqload(embedUrl: string, referer: string): Promise<ExtractedStream | null> {
  let res = await request(embedUrl, { headers: { Referer: referer } });
  if (res.text && isUqloadRestricted(res.text)) {
    log.debug(`${embedUrl} refusé pour ${origin(referer)} : nouvel essai sans Referer`);
    res = await request(embedUrl);
  }
  if (!res.ok || !res.text) return null;

  const url = uqloadSource(res.text);
  if (!url) return null;

  const page = res.url || embedUrl;
  const host = origin(page);
  return { url, server: 'Uqload', headers: { Referer: host ? `${host}/` : 'https://uqload.vc/' } };
}
