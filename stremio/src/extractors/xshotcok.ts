import { origin } from '../http';
import { logger } from '../log';
import type { ExtractedStream } from './index';

const log = logger('Xshotcok');

/** xshotcok.com — un clone hxfile.co (famille XFileSharing) qui empile trois
 *  couches devant son URL :
 *
 *    1. un bloc Dean Edwards packé, que le dépaqueteur générique ouvre déjà ;
 *    2. il ne contient qu'une charge utile base64 et quatre appels dont les
 *       fonctions sont, dans la page, des LEURRES : `var _52ad59 = "";`.
 *       Les vraies arrivent d'un second script, `xher_ads.js` — un nom choisi
 *       pour qu'un bloqueur de publicités le supprime ;
 *    3. la charge utile est du base64 lu en UTF-8, puis un XOR à clé répétée.
 *
 *  Plutôt que d'exécuter le JS du site — ce qu'on ne fait pas dans ce
 *  processus — on retrouve la clé. Deux voies, la première qui donne un
 *  résultat valide gagne :
 *
 *    a. le bloc packé écrit `var <clé>=<fn>();` : l'obfuscateur nomme la
 *       variable d'après la valeur qu'elle reçoit, le nom EST la clé ;
 *    b. sinon, attaque à clair connu — le clair commence toujours par le
 *       garde anti-iframe `\t(function() {`, ce qui suffit à reconstituer
 *       une clé de n'importe quelle longueur.
 *
 *  La validation ne se discute pas : on n'accepte une clé que si le clair
 *  obtenu contient bien une entrée `"file":"http…`.
 *
 *  L'URL rendue est une redirection signée vers le CDN. Le jeton de la
 *  redirection paraît lié à l'IP : on pose donc un Referer, ce qui fait
 *  passer le flux par le proxy — la redirection et le fichier sont alors
 *  demandés depuis la même adresse. */

/** Début invariable du clair : le garde qui renvoie la page sur son propre
 *  domaine quand elle est chargée ailleurs. Sa longueur borne la clé qu'on
 *  sait reconstituer — d'où l'intérêt d'en garder la ligne entière. */
const KNOWN_PREFIX = "\t(function() {\n\t\tvar targetDomains = ['https://";
const MAX_KEY_LEN = 40;

function xor(data: string, key: string): string {
  let out = '';
  for (let i = 0; i < data.length; i++) {
    out += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

/** base64 -> octets -> texte UTF-8, ce que fait `decodeURIComponent(atob(…))`. */
function b64Utf8(payload: string): string {
  return Buffer.from(payload, 'base64').toString('utf-8');
}

function* candidateKeys(unpacked: string, data: string): Generator<string> {
  // (a) `var _0x3e68eb=_2e625d();` — le nom de la variable est la clé.
  const named = unpacked.match(/var\s+(\w+)\s*=\s*\w+\s*\(\s*\)\s*;/)?.[1];
  if (named) yield named;

  // (b) clair connu : clé[i] = clair[i] ^ chiffré[i], pour chaque longueur.
  for (let len = 1; len <= Math.min(MAX_KEY_LEN, KNOWN_PREFIX.length, data.length); len++) {
    let key = '';
    for (let i = 0; i < len; i++) {
      key += String.fromCharCode(data.charCodeAt(i) ^ KNOWN_PREFIX.charCodeAt(i));
    }
    yield key;
  }
}

/** Rend le script en clair, ou null si aucune clé ne donne quelque chose de
 *  reconnaissable. */
export function decodeXshotcok(unpacked: string): string | null {
  const payload = [...unpacked.matchAll(/["']([A-Za-z0-9+/=]{200,})["']/g)]
    .map(m => m[1]!)
    .sort((a, b) => b.length - a.length)[0];
  if (!payload) return null;

  const data = b64Utf8(payload);
  for (const key of candidateKeys(unpacked, data)) {
    const plain = xor(data, key);
    if (/"file"\s*:\s*"https?:\/\//.test(plain)) return plain;
  }
  return null;
}

export function extractXshotcok(unpacked: string, pageUrl: string): ExtractedStream | null {
  const plain = decodeXshotcok(unpacked);
  if (!plain) return null;

  const url = plain.match(/"file"\s*:\s*"(https?:\/\/[^"]+)"/)?.[1];
  if (!url) return null;

  log.debug(`charge utile déchiffrée: ${url.split('?')[0]}`);
  return { url, server: 'Xshotcok', headers: { Referer: `${origin(pageUrl) || pageUrl}/` } };
}
