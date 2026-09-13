import { request, origin } from '../http';
import { logger } from '../log';
import type { ExtractedStream } from './index';

const log = logger('Blinkflux');

/** BlinkFlux — un lecteur maison indexé par identifiant TMDB, pas par code de
 *  fichier : movix nous passe directement
 *  `/api/v1/index.php?route=movies/<tmdb>/player&api_key=<clé>`.
 *
 *  La page ne contient jamais l'URL du média. Elle porte un couple
 *  `ENCRYPTED_PAYLOAD` / `ENCRYPTED_IV` que seul le serveur sait déchiffrer :
 *  on le lui renvoie sur `route=unlock` et il répond en clair. Le `token` que
 *  le lecteur joint est vide quand aucune protection n'est active — celle du
 *  navigateur l'est aussi, on ne simule donc rien.
 *
 *  La clé d'API est obligatoire, mais elle voyage dans l'URL que le scraper
 *  nous a donnée : on la relit plutôt que de la coder en dur, elle appartient
 *  à movix et peut tourner. Le Referer, lui, n'est pas vérifié.
 *
 *  Le lien rendu est un MP4 progressif signé pour quatre heures, servi par
 *  Cloudflare et non lié à l'IP : il se lit en direct, sans proxy. */

export function isBlinkfluxPage(html: string): boolean {
  return /\bENCRYPTED_PAYLOAD\s*=/.test(html) && /route=unlock/.test(html);
}

/** Ce que la page doit fournir pour qu'un déverrouillage soit possible.
 *  Isolé de l'appel réseau : c'est la partie qui casse quand la page change. */
export interface BlinkfluxUnlock {
  payload: string;
  iv: string;
  key: string;
}

export function blinkfluxUnlock(pageUrl: string, html: string): BlinkfluxUnlock | null {
  // Le payload est écrit dans du JS : ses « / » y sont échappés.
  const payload = html.match(/\bENCRYPTED_PAYLOAD\s*=\s*["']([^"']+)["']/)?.[1]?.replace(/\\\//g, '/');
  const iv = html.match(/\bENCRYPTED_IV\s*=\s*["']([^"']+)["']/)?.[1];

  // La clé d'API appartient à movix et peut tourner : on la relit dans l'URL
  // qu'il nous a donnée, avec la page comme second recours.
  const fromUrl = pageUrl.match(/[?&]api_key=([^&#]+)/)?.[1];
  const key = fromUrl ? decodeURIComponent(fromUrl) : html.match(/api_key=([A-Za-z0-9_-]{16,})/)?.[1];

  return payload && iv && key ? { payload, iv, key } : null;
}

export async function extractBlinkflux(pageUrl: string, html: string): Promise<ExtractedStream | null> {
  const host = origin(pageUrl);
  const unlock = blinkfluxUnlock(pageUrl, html);
  if (!host || !unlock) {
    log.debug(`${pageUrl} : bloc chiffré ou clé d'API absent — déverrouillage impossible`);
    return null;
  }

  const res = await request(`${host}/api/v1/index.php?route=unlock&api_key=${encodeURIComponent(unlock.key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: pageUrl, Origin: host },
    body: JSON.stringify({ token: '', payload: unlock.payload, iv: unlock.iv }),
  });

  const data = res.json<any>();
  if (!data?.success || typeof data.url !== 'string' || !data.url.startsWith('http')) {
    log.debug(`déverrouillage refusé : ${data?.error ?? 'réponse inattendue'}`);
    return null;
  }

  return { url: data.url, server: 'BlinkFlux', headers: {} };
}
