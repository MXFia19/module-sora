import { getText, origin } from '../http';
import { logger } from '../log';
import { unpackAll, findMediaUrl } from './unpack';
import type { ExtractedStream } from './index';

const log = logger('HgCloud');

/** Famille « hgcloud » : hglink.to et ses voisins ne servent qu'une coquille
 *  de 452 octets, « Page is loading, please wait… », dont tout le travail est
 *  fait par un main.js obfusqué qui saute vers un miroir.
 *
 *  Ce main.js ne cite aucun domaine en clair, donc on ne peut pas lire la
 *  cible : on rejoue le saut sur les miroirs connus, avec le même
 *  identifiant, et le premier qui rend un média gagne. C'est la seule
 *  reconnaissance par liste de domaines du projet, et c'est assumé faute de
 *  mieux — d'où le log explicite quand ils échouent tous, qui est le signal
 *  que la liste a vieilli. */

const MIROIRS = ['vibuxer.com', 'audinifer.com', 'huntrexus.com'];

/** La coquille, qui elle ne change pas d'une enseigne à l'autre. */
export function isHgCloudPage(html: string): boolean {
  return html.length < 1200
    && /Page is loading, please wait/i.test(html)
    && /src=["']\/main\.js/i.test(html);
}

export async function extractHgCloud(embedUrl: string, referer: string): Promise<ExtractedStream | null> {
  const id = embedUrl.match(/\/e\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id) return null;

  for (const miroir of MIROIRS) {
    const cible = `https://${miroir}/e/${id}`;
    const page = await getText(cible, { headers: { Referer: `${origin(embedUrl)}/` } });
    if (!page) continue;

    const url = findMediaUrl(page) ?? findMediaUrl(unpackAll(page));
    if (!url) continue;

    log.debug(`${id} résolu via ${miroir}`);
    return { url, server: 'HgCloud', headers: { Referer: `https://${miroir}/` } };
  }

  log.debug(`aucun miroir n'a rendu ${id} — la liste ${MIROIRS.join(', ')} a peut-être vieilli`);
  return null;
}
