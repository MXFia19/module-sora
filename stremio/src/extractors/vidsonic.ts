import { logger } from '../log';
import type { ExtractedStream } from './index';

const log = logger('Vidsonic');

/** VidSonic — l'URL n'est jamais écrite en clair, mais son obfuscation est
 *  purement décorative : une suite d'octets en hexadécimal, coupée par des
 *  « | » pour casser la recherche, décodée puis lue à l'envers.
 *
 *  Aucune clé, aucun appel réseau, rien qui dépende du domaine : on reconnaît
 *  la charge utile à sa forme et on la décode. C'est ce qui fait que ça
 *  survivra au prochain domaine de la maison.
 *
 *  Le manifeste rendu est un HLS signé (`expires` + `md5`) mais NON lié à
 *  l'IP — vérifié depuis plusieurs adresses de sortie, manifeste et segments.
 *  Il se lit donc en direct, sans proxy. */

/** Toutes les chaînes de la page qui pourraient être la charge utile :
 *  uniquement des chiffres hexadécimaux et des séparateurs. Le motif reste
 *  volontairement plat — une alternance imbriquée ferait repartir le moteur
 *  en arrière sur chaque longue suite hexadécimale d'une page de 700 Ko. */
const CANDIDATE = /["']([0-9a-fA-F|]{80,4000})["']/g;

function hexToString(hex: string): string | null {
  if (hex.length % 2 !== 0) return null;
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.substr(i, 2), 16);
    if (!Number.isInteger(code)) return null;
    out += String.fromCharCode(code);
  }
  return out;
}

export function decodeVidsonic(html: string): string | null {
  for (const m of html.matchAll(CANDIDATE)) {
    if (!m[1]!.includes('|')) continue;
    const plain = hexToString(m[1]!.split('|').join(''));
    if (!plain) continue;

    // La page inverse la chaîne. On essaie quand même les deux sens : ça
    // coûte une comparaison et ça couvre une variante sans relecture.
    for (const url of [plain.split('').reverse().join(''), plain]) {
      if (/^https?:\/\/\S+$/.test(url)) return url;
    }
  }
  return null;
}

export function extractVidsonic(html: string): ExtractedStream | null {
  const url = decodeVidsonic(html);
  if (!url) return null;
  log.debug(`charge utile décodée: ${url.split('?')[0]}`);
  return { url, server: 'VidSonic', headers: {} };
}
