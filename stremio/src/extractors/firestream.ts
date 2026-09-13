import { request, origin } from '../http';
import { logger } from '../log';
import type { ExtractedStream } from './index';

const log = logger('Firestream');

/** FireStream — la page le dit elle-même en commentaire : « no API call —
 *  URL never in page source ». Elle ne porte ni l'URL, ni de quoi la calculer,
 *  seulement un jeton à usage unique dans un `<script id="token-blob">` qu'il
 *  faut rendre à `/api/videos/<slug>/resolve` pour obtenir le manifeste signé.
 *
 *  Ce jeton est LIÉ À L'IP : la page et l'échange doivent partir de la même
 *  adresse, sinon l'API répond « Token bound to different IP ». Ça ne demande
 *  rien de particulier depuis un serveur à adresse fixe, et le message est
 *  assez clair pour qu'on le relaie tel quel plutôt que de chercher ailleurs.
 *
 *  Le manifeste rendu, lui, n'est pas lié à l'IP (vérifié depuis plusieurs
 *  adresses de sortie) : lecture en direct, sans proxy. */

export function isFirestreamPage(html: string): boolean {
  // Le chemin de l'API est concaténé dans le script (`'/api/videos/' + slug +
  // '/resolve'`) : on ne cherche donc pas la chaîne entière, elle n'existe pas.
  return /id=["']token-blob["']/.test(html) && html.includes('/api/videos/');
}

export function firestreamBlob(html: string): string | null {
  return html.match(/id=["']token-blob["'][^>]*>([\s\S]*?)<\/script>/)?.[1]?.trim() || null;
}

export async function extractFirestream(pageUrl: string, html: string): Promise<ExtractedStream[] | null> {
  const slug = pageUrl.match(/\/e\/([A-Za-z0-9_-]+)/)?.[1];
  const host = origin(pageUrl);
  const blob = firestreamBlob(html);

  if (!slug || !host || !blob) return null;

  const res = await request(`${host}/api/videos/${encodeURIComponent(slug)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: pageUrl, Origin: host },
    body: JSON.stringify({ blob }),
  });

  const data = res.json<any>();
  if (data?.error) {
    log.debug(`résolution refusée pour ${slug} : ${data.error}`);
    return null;
  }

  // HD et SD sont deux entrées distinctes : on ne choisit pas à la place du
  // lecteur, il saura laquelle prendre.
  const out = [
    { url: data?.signedVideoUrl, label: '' },
    { url: data?.signedVideoSdUrl, label: ' SD' },
  ]
    .filter((v): v is { url: string; label: string } =>
      typeof v.url === 'string' && v.url.startsWith('http'))
    .map(({ url, label }): ExtractedStream => ({
      url,
      server: `FireStream${label}`,
      headers: {},
    }));

  if (out.length === 0) log.debug(`aucune URL signée pour ${slug}`);
  return out.length > 0 ? out : null;
}
