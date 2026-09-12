import * as crypto from 'crypto';
import type { Request, Response } from 'express';
import { config, publicBase } from './config';
import { logger } from './log';
import { absolute } from './http';

const log = logger('Proxy');

/** Secret de signature. Sans PROXY_SECRET en environnement, on en tire un au
 *  démarrage : ça marche, mais les liens déjà distribués meurent au
 *  redémarrage — d'où l'avertissement. */
const SECRET: string = (() => {
  if (config.proxySecret) return config.proxySecret;
  const generated = crypto.randomBytes(32).toString('hex');
  log.warn('PROXY_SECRET absent — secret éphémère généré. Les liens proxifiés seront invalidés au prochain redémarrage.');
  return generated;
})();

interface Payload {
  /** URL amont. */
  u: string;
  /** Headers à réinjecter. */
  h?: Record<string, string>;
  /** Expiration (epoch ms). */
  e: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(data: string): string {
  return b64url(crypto.createHmac('sha256', SECRET).update(data).digest());
}

/** Les URLs proxifiées sont signées, pas chiffrées. Sans signature, l'addon
 *  deviendrait un proxy HTTP ouvert que n'importe qui pourrait faire relayer
 *  vers n'importe quelle cible. Le HMAC lie l'URL et les headers à cette
 *  instance, et l'expiration borne la fuite d'un lien partagé. */
export function proxify(url: string, headers?: Record<string, string>): string {
  const payload: Payload = { u: url, e: Date.now() + config.proxyTtlMs };
  if (headers && Object.keys(headers).length > 0) payload.h = headers;

  const data = b64url(Buffer.from(JSON.stringify(payload), 'utf-8'));
  const sig = sign(data);
  // L'extension finale aide les players à deviner le type avant la réponse.
  const ext = /\.m3u8(\?|$)/i.test(url) ? '.m3u8' : /\.mp4(\?|$)/i.test(url) ? '.mp4' : '';
  return `${publicBase()}/proxy/s${ext}?d=${data}&t=${sig}`;
}

function verify(data: string, sig: string): Payload | null {
  const expected = sign(data);
  // Comparaison à temps constant : une comparaison naïve laisse deviner la
  // signature octet par octet.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(unb64url(data).toString('utf-8')) as Payload;
    if (!payload?.u || typeof payload.u !== 'string') return null;
    if (!/^https?:\/\//i.test(payload.u)) return null;
    if (!payload.e || payload.e < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Headers de la requête cliente qu'on relaie tels quels. Le reste est
 *  reconstruit : on ne veut surtout pas propager le Referer de Stremio, qui
 *  écraserait celui qu'exige l'hébergeur. */
const FORWARD_FROM_CLIENT = ['range', 'if-range', 'accept'];

/** Headers de la réponse amont qu'on renvoie au client. On coupe tout ce qui
 *  décrit le transport (encodage, connexion) : undici a déjà décodé, les
 *  relayer produirait un flux illisible. */
const FORWARD_FROM_UPSTREAM = [
  'content-type', 'content-length', 'content-range', 'accept-ranges',
  'cache-control', 'expires', 'last-modified', 'etag',
];

/** Seul le CORPS fait foi.
 *
 *  Se fier à l'extension de l'URL ou au content-type annoncé est un piège
 *  vérifié : un CDN qui refuse la requête rend une page d'erreur nginx en
 *  gardant `.m3u8` dans l'URL. Réécrite comme un manifeste, chaque ligne de
 *  HTML devient un faux lien proxifié, et le player reçoit un playlist
 *  absurde au lieu de l'erreur. */
function isHls(body: string): boolean {
  return body.trimStart().startsWith('#EXTM3U');
}

/** Réécrit un manifeste HLS pour que variantes, segments et clés repassent
 *  par le proxy avec les mêmes headers. Sans ça, seul le manifeste est
 *  proxifié et les segments partent en direct — donc en 403. */
export function rewriteHls(body: string, baseUrl: string, headers?: Record<string, string>): string {
  const wrap = (u: string) => proxify(absolute(u, baseUrl), headers);

  return body.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      // URI="..." : clés de chiffrement (EXT-X-KEY), pistes audio/sous-titres
      // (EXT-X-MEDIA), segment d'init fMP4 (EXT-X-MAP).
      return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${wrap(u)}"`);
    }
    return wrap(trimmed);
  }).join('\n');
}

/** Handler Express du proxy. */
export async function handleProxy(req: Request, res: Response): Promise<void> {
  const data = String(req.query.d ?? '');
  const sig = String(req.query.t ?? '');

  const payload = data && sig ? verify(data, sig) : null;
  if (!payload) {
    res.status(403).type('text/plain').send('lien proxy invalide ou expiré');
    return;
  }

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': config.userAgent,
    ...(payload.h ?? {}),
  };
  for (const h of FORWARD_FROM_CLIENT) {
    const v = req.headers[h];
    if (typeof v === 'string') upstreamHeaders[h] = v;
  }

  const ctrl = new AbortController();
  // Un client qui ferme l'onglet ne doit pas laisser le téléchargement amont
  // tourner : sans ça, un zapping rapide accumule les transferts orphelins.
  res.on('close', () => ctrl.abort());

  try {
    const upstream = await fetch(payload.u, {
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: ctrl.signal,
    });

    const contentType = upstream.headers.get('content-type') ?? '';

    // Un manifeste est petit : on le lit en entier pour le réécrire. Un
    // segment ou un MP4 est gros : on le fait transiter en flux.
    const looksTextual = /mpegurl|text\//i.test(contentType) || /\.m3u8(\?|$)/i.test(payload.u);
    if (looksTextual) {
      const body = await upstream.text();
      if (isHls(body)) {
        const rewritten = rewriteHls(body, upstream.url || payload.u, payload.h);
        res.status(upstream.status)
          .set('content-type', 'application/vnd.apple.mpegurl')
          .set('cache-control', 'no-cache')
          .send(rewritten);
        return;
      }
      // Pas un manifeste : on relaie tel quel. Le player verra le vrai statut
      // de l'hébergeur, et les logs le vrai message d'erreur.
      if (!upstream.ok) {
        log.warn(`${upstream.status} de ${payload.u} — corps non-HLS (${body.length}o)`);
      }
      res.status(upstream.status).set('content-type', contentType || 'text/plain').send(body);
      return;
    }

    for (const h of FORWARD_FROM_UPSTREAM) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    res.status(upstream.status);

    if (!upstream.body) {
      res.end();
      return;
    }

    // Web ReadableStream -> réponse Express, avec contre-pression.
    const reader = upstream.body.getReader();
    const pump = async (): Promise<void> => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise<void>(r => res.once('drain', r));
        }
      }
    };
    await pump();
    res.end();
  } catch (e) {
    if (ctrl.signal.aborted) return;           // client parti : normal.
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`échec amont ${payload.u}: ${msg}`);
    if (!res.headersSent) res.status(502).type('text/plain').send('amont injoignable');
    else res.end();
  }
}
