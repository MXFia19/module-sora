import { config } from './config';
import { logger } from './log';

const log = logger('Cache');

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/** Cache mémoire LRU-ish. Volontairement sans Redis : un addon perso tourne
 *  dans un seul conteneur, et une dépendance en moins est une panne en moins.
 *  L'ordre d'insertion d'une Map suffit à évincer le plus ancien. */
const store = new Map<string, Entry<unknown>>();

/** Déduplication des appels en vol : deux clients qui ouvrent la même fiche
 *  en même temps ne doivent scraper qu'une fois. */
const inflight = new Map<string, Promise<unknown>>();

function evictIfNeeded(): void {
  while (store.size > config.cacheMaxEntries) {
    const oldest = store.keys().next();
    if (oldest.done) return;
    store.delete(oldest.value);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  // Remise en fin de Map : les clés chaudes survivent à l'éviction.
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  evictIfNeeded();
}

export interface CachedOptions<T> {
  ttlMs?: number;
  /** TTL appliqué quand `shouldCache` refuse la valeur (échec / résultat vide). */
  negativeTtlMs?: number;
  /** Par défaut : on met en cache court un tableau vide, long le reste. */
  shouldCache?: (value: T) => boolean;
}

/** Mémoïse un calcul asynchrone, avec déduplication des appels concurrents. */
export async function cached<T>(
  key: string,
  producer: () => Promise<T>,
  opts: CachedOptions<T> = {},
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) {
    log.debug(`hit ${key}`);
    return hit;
  }

  const running = inflight.get(key);
  if (running) {
    log.debug(`join ${key}`);
    return running as Promise<T>;
  }

  const shouldCache = opts.shouldCache ?? ((v: T) => !Array.isArray(v) || v.length > 0);
  const promise = (async () => {
    try {
      const value = await producer();
      const ttl = shouldCache(value)
        ? (opts.ttlMs ?? config.cacheTtlMs)
        : (opts.negativeTtlMs ?? config.cacheNegativeTtlMs);
      cacheSet(key, value, ttl);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** Vide le cache (endpoint d'admin / tests). */
export function cacheClear(): number {
  const n = store.size;
  store.clear();
  return n;
}

export function cacheStats() {
  return { entries: store.size, inflight: inflight.size };
}
