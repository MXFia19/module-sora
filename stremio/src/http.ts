import { config } from './config';
import { logger } from './log';

const log = logger('HTTP');

export interface HttpOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string | URLSearchParams;
  /** 'follow' (défaut) ou 'manual' pour lire un Location sans le suivre —
   *  plusieurs hébergeurs cachent l'URL finale dans une 302. */
  redirect?: 'follow' | 'manual';
  timeoutMs?: number;
  /** Nombre de tentatives supplémentaires sur erreur réseau (pas sur 4xx/5xx). */
  retries?: number;
  /** Jeu de caractères de la réponse quand ce n'est pas de l'UTF-8. Les sites
   *  FR anciens servent encore du windows-1252 : décodé en UTF-8 sinon les
   *  accents des titres cassent le matching. */
  encoding?: string;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  url: string;
  headers: Headers;
  text: string;
  json<T = unknown>(): T | null;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': config.userAgent,
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

function emptyResponse(url: string): HttpResponse {
  return {
    status: 0,
    ok: false,
    url,
    headers: new Headers(),
    text: '',
    json: () => null,
  };
}

/** Requête HTTP unique. Ne jette jamais : rend un statut 0 en cas d'échec
 *  réseau. Un scraper qui plante ne doit pas emporter les autres sources,
 *  et le code appelant est plus court sans try/catch à chaque ligne. */
export async function request(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const attempts = (opts.retries ?? 1) + 1;
  const timeoutMs = opts.timeoutMs ?? config.httpTimeoutMs;

  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) },
        body: opts.body,
        redirect: opts.redirect ?? 'follow',
        signal: ctrl.signal,
      });

      const buf = Buffer.from(await res.arrayBuffer());
      const text = opts.encoding && opts.encoding.toLowerCase() !== 'utf-8'
        ? new TextDecoder(opts.encoding).decode(buf)
        : buf.toString('utf-8');

      log.debug(`${opts.method ?? 'GET'} ${res.status} ${url} (${text.length}o)`);
      return {
        status: res.status,
        ok: res.ok,
        url: res.url || url,
        headers: res.headers,
        text,
        json<T>() {
          try { return JSON.parse(text) as T; } catch { return null; }
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      // Une expiration n'est pas un raté de réseau : l'hôte est joignable, il
      // est lent. Réessayer, c'est repayer le budget entier — 12 s + 12 s
      // suffisaient à faire sauter les 25 s d'un scraper et à jeter tous les
      // flux qu'il avait déjà résolus. On ne réessaie que ce qui a de bonnes
      // chances de passer au coup suivant : coupure, reset, DNS.
      if (ctrl.signal.aborted) {
        log.debug(`expiré ${url} (${timeoutMs}ms) — pas de seconde tentative`);
        return emptyResponse(url);
      }

      if (i < attempts - 1) {
        log.debug(`échec ${url} (${msg}) — nouvelle tentative`);
        await sleep(400 * (i + 1));
        continue;
      }
      log.debug(`échec définitif ${url} (${msg})`);
      return emptyResponse(url);
    } finally {
      clearTimeout(timer);
    }
  }
  return emptyResponse(url);
}

/** Raccourci JSON. Rend null plutôt que de jeter sur un corps non-JSON
 *  (page d'erreur HTML, défi anti-bot). */
export async function getJson<T = any>(url: string, opts: HttpOptions = {}): Promise<T | null> {
  const res = await request(url, {
    ...opts,
    headers: { Accept: 'application/json, text/plain, */*', ...(opts.headers ?? {}) },
  });
  return res.json<T>();
}

export async function getText(url: string, opts: HttpOptions = {}): Promise<string> {
  return (await request(url, opts)).text;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Résout une URL éventuellement relative contre une base. */
export function absolute(url: string, base: string): string {
  try { return new URL(url, base).toString(); } catch { return url; }
}

/** Origine d'une URL ('https://exemple.com'), pour fabriquer un Referer. */
export function origin(url: string): string {
  try { return new URL(url).origin; } catch { return ''; }
}
