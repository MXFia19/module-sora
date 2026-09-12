import { request, getText, absolute } from '../http';
import type { ExtractedStream } from './index';

/** YourUpload expose le MP4 dans la balise og:video, puis redirige vers un
 *  nœud de diffusion : on résout la redirection pour livrer l'URL finale. */
export async function extractYourUpload(embedUrl: string, referer: string): Promise<ExtractedStream | null> {
  const html = await getText(embedUrl, { headers: { Referer: referer } });
  const m = html.match(/property=["']og:video["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i);
  if (!m?.[1]) return null;

  // og:video est parfois relatif ('/embed/xyz.mp4') : le laisser tel quel
  // produirait une entrée injouable.
  let url = absolute(m[1], embedUrl);
  const head = await request(url, { headers: { Referer: embedUrl }, redirect: 'manual' });
  const location = head.headers.get('location');
  if (location) url = new URL(location, url).toString();

  return {
    url,
    server: 'YourUpload',
    headers: { Referer: embedUrl, Origin: 'https://www.yourupload.com' },
  };
}

/** Mail.ru publie ses variantes de qualité dans une API méta. On les rend
 *  toutes : la meilleure n'est pas toujours la plus lisible selon la
 *  connexion, et Stremio sait afficher plusieurs entrées. */
export async function extractMailru(embedUrl: string): Promise<ExtractedStream[] | null> {
  const id = embedUrl.match(/video\/embed\/(.+)/i)?.[1];
  if (!id) return null;

  const meta = await request(`https://my.mail.ru/+/video/meta/${id}`);
  const videos = meta.json<any>()?.videos;
  if (!Array.isArray(videos) || videos.length === 0) return null;

  return videos
    .filter((v: any) => typeof v?.url === 'string')
    .map((v: any) => ({
      url: v.url.startsWith('//') ? `https:${v.url}` : v.url,
      server: `Mail.ru ${v.key ?? ''}`.trim(),
      headers: { Referer: 'https://my.mail.ru/' },
    }));
}
