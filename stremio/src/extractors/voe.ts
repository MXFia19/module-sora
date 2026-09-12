import { request, getText } from '../http';
import { logger } from '../log';

const log = logger('VOE');

/** VOE cache l'URL dans un <script type="application/json"> passé à la
 *  moulinette : ROT13, retrait de marqueurs parasites, base64, décalage -3,
 *  inversion, base64. La chaîne est stable depuis des mois ; ce qui change,
 *  c'est le domaine (d'où le suivi de redirection avant extraction). */

const JUNK = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];

function rot13(s: string): string {
  return s.replace(/[a-zA-Z]/g, c => {
    const code = c.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function shift(s: string, by: number): string {
  return [...s].map(c => String.fromCharCode(c.charCodeAt(0) + by)).join('');
}

function b64(s: string): string {
  return Buffer.from(s, 'base64').toString('binary');
}

/** Décode la charge utile VOE d'une page déjà téléchargée. */
export function decodeVoe(html: string): string | null {
  const script = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script?.[1]) return null;

  try {
    const data = JSON.parse(script[1].trim());
    const first = Array.isArray(data) ? data[0] : data;
    if (typeof first !== 'string') return null;

    let s = rot13(first);
    for (const junk of JUNK) s = s.split(junk).join('');
    s = b64(s);
    s = shift(s, -3);
    s = [...s].reverse().join('');
    s = b64(s);

    const result = JSON.parse(s);
    const direct = result?.direct_access_url
      ?? (Array.isArray(result?.source)
        ? result.source.find((x: any) => x?.direct_access_url)?.direct_access_url
        : null);
    return typeof direct === 'string' ? direct : null;
  } catch (e) {
    log.debug(`décodage échoué: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Télécharge l'embed VOE et en extrait l'URL. VOE change de domaine
 *  régulièrement et redirige alors en JavaScript : on suit ce saut une fois. */
export async function extractVoe(embedUrl: string, referer: string): Promise<string | null> {
  let html = await getText(embedUrl, { headers: { Referer: referer } });

  const jump = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
  if (jump?.[1]) {
    log.debug(`redirection -> ${jump[1]}`);
    html = await getText(jump[1], { headers: { Referer: referer } });
  }

  const url = decodeVoe(html);
  if (!url) log.debug(`aucune URL extraite de ${embedUrl}`);
  return url;
}

/** Streamtape masque l'URL dans un innerHTML reconstruit côté client. */
export async function extractStreamtape(embedUrl: string, referer: string): Promise<string | null> {
  const html = await getText(embedUrl, { headers: { Referer: referer } });
  const m = html.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*[^;]*?\(['"]([^'"]+)['"]\)/i)
    ?? html.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]/i);
  if (!m?.[1]) return null;

  const token = m[1];
  const idx = token.indexOf('/get_video');
  if (idx < 0) return null;
  return `https://streamtape.com${token.slice(idx)}&dl=1`;
}

/** Sendvid : l'URL est en clair dans la page, sous trois formes selon l'âge
 *  du lecteur servi. */
export async function extractSendvid(embedUrl: string, referer: string): Promise<string | null> {
  const html = await getText(embedUrl, { headers: { Referer: referer } });
  const m = html.match(/og:video:secure_url["']?\s+content=["']([^"']+)["']/i)
    ?? html.match(/var\s+video_source\s*=\s*["']([^"']+)["']/i)
    ?? html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
  if (!m?.[1]) return null;

  const url = m[1].replace(/&amp;/g, '&');
  return url.startsWith('//') ? `https:${url}` : url;
}

/** Vidmoly : les domaines historiques renvoient une page vide ; .biz sert
 *  encore le lecteur. Le fichier est dans la config JWPlayer. */
export async function extractVidmoly(embedUrl: string): Promise<string | null> {
  const fixed = embedUrl.replace(/vidmoly\.(to|me|net|ru|is)/i, 'vidmoly.biz');
  const html = await getText(fixed, { headers: { Referer: 'https://vidmoly.biz/' } });
  const m = html.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i)
    ?? html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
  return m?.[1] ?? null;
}

/** Sibnet sert une page en windows-1251 et redirige ensuite vers le fichier
 *  réel. On suit la redirection pour livrer une URL qui ne périme pas au
 *  premier saut. */
export async function extractSibnet(embedUrl: string): Promise<string | null> {
  const page = await request(embedUrl, {
    headers: { Referer: 'https://anime-sama.fr/' },
    encoding: 'windows-1251',
  });
  if (!page.text || page.text.length < 100) return null;

  const m = page.text.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i)
    ?? page.text.match(/src:\s*["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i)
    ?? page.text.match(/["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
  if (!m?.[1]) return null;

  const src = m[1].startsWith('http') ? m[1] : `https://video.sibnet.ru${m[1]}`;
  const head = await request(src, { headers: { Referer: embedUrl }, redirect: 'manual' });
  const location = head.headers.get('location');
  return location ? new URL(location, src).toString() : src;
}
