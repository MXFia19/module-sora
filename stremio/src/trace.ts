import { AsyncLocalStorage } from 'node:async_hooks';

/** Capture des logs par exécution.
 *
 *  Les scrapers tournent en parallèle : leurs lignes de log s'entrelacent dans
 *  la console, et démêler après coup ce qui appartient à quelle source est
 *  pénible. `AsyncLocalStorage` suit le contexte à travers les `await`, donc
 *  chaque ligne sait d'elle-même à quelle exécution elle appartient.
 *
 *  Sans contexte actif — l'usage normal du serveur — la capture ne coûte
 *  rien : `current()` rend undefined et on écrit seulement dans la console. */

export interface TraceLine {
  at: number;
  level: string;
  scope: string;
  message: string;
}

interface TraceContext {
  lines: TraceLine[];
}

const storage = new AsyncLocalStorage<TraceContext>();

/** Exécute `fn` en capturant tout ce qu'elle journalise. */
export async function traced<T>(fn: () => Promise<T>): Promise<{ value: T; lines: TraceLine[] }> {
  const ctx: TraceContext = { lines: [] };
  const value = await storage.run(ctx, fn);
  return { value, lines: ctx.lines };
}

export function record(level: string, scope: string, message: string): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  // Une source qui part en boucle ne doit pas faire enfler la mémoire.
  if (ctx.lines.length >= 500) return;
  ctx.lines.push({ at: Date.now(), level, scope, message });
}

export function isTracing(): boolean {
  return storage.getStore() !== undefined;
}
