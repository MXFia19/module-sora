import { getText, origin } from '../http';
import { logger } from './../log';
import { unpackAll } from './unpack';
import type { ExtractedStream } from './index';

const log = logger('Fsvid');

/** fsvid.lol — la page pose un leurre bien visible, et il porte son nom :
 *
 *     var _fsvHls = "https://s1.fsvid.lol/troll/master.m3u8";
 *
 *  C'est la première URL de média du script, donc exactement celle qu'une
 *  recherche générique ramasse. La vraie est calculée : base64, inversion,
 *  puis XOR avec une clé qui avance d'un pas fixe et démarre à une valeur
 *  dérivée de `location.hostname`. Ce dernier point est l'astuce : le script
 *  ne peut se déchiffrer que servi depuis le bon domaine, et le leurre est
 *  précisément la valeur de repli quand le déchiffrement échoue.
 *
 *  Les deux constantes sont relues dans la page plutôt que codées en dur :
 *  elles sont ce qu'un exploitant change en premier. */
export function decodeFsvid(page: string, embedUrl: string): string | null {
  const code = `${page}\n${unpackAll(page)}`;

  const payload = code.match(/\}\s*\)\s*\(\s*(['"])([A-Za-z0-9+/=]{40,})\1\s*\)/)?.[2];
  const params = code.match(/\(\s*(0x[0-9a-fA-F]+|\d+)\s*\+\s*\w+\s*\*\s*(\d+)\s*\+\s*\w+\s*\)\s*&\s*255/);
  if (!payload || !params) {
    log.debug('ni charge utile ni constantes dans la page');
    return null;
  }

  const start = Number(params[1]);
  const step = Number(params[2]);
  const reversed = [...Buffer.from(payload, 'base64').toString('binary')].reverse();

  // Le script lit `location.hostname`, qui vaut le domaine servant la page.
  // On essaie celui de l'URL et sa variante sans www, au cas où la requête
  // aurait été redirigée.
  const host = origin(embedUrl).replace(/^https?:\/\//, '');
  for (const candidate of [...new Set([host, host.replace(/^www\./, '')])]) {
    let seed = 0;
    for (const c of candidate) seed = (seed + c.charCodeAt(0)) & 255;

    const url = reversed
      .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((start + i * step + seed) & 255)))
      .join('');

    if (/^https?:\/\//.test(url)) return url;
  }

  log.debug(`déchiffrement infructueux pour ${host}`);
  return null;
}

export async function extractFsvid(embedUrl: string, referer: string): Promise<ExtractedStream | null> {
  const page = await getText(embedUrl, { headers: { Referer: referer } });
  if (!page) return null;

  const url = decodeFsvid(page, embedUrl);
  if (!url) return null;

  const host = origin(embedUrl);
  return { url, server: 'Fsvid', headers: { Referer: host ? `${host}/` : referer } };
}
