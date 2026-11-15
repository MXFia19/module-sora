/** Journal des liens qu'on n'a pas su transformer en flux.
 *
 *  Un lien de lecteur qui n'aboutit pas ne laissait qu'une ligne `debug` dans
 *  la console, noyée parmi les autres et perdue au redémarrage du conteneur.
 *  Or c'est exactement ce qu'on veut relire pour savoir quoi réparer : quel
 *  hébergeur échoue, combien de fois, et POURQUOI — un fichier supprimé, un
 *  captcha et un lecteur qu'on ne sait pas lire n'appellent pas la même
 *  réponse.
 *
 *  En mémoire, borné : c'est un outil de diagnostic, pas un historique. La
 *  page /debug/failures le lit (voir failpage.ts). */

export type FailureKind =
  /** Tenté, et rien n'en est sorti. */
  | 'echec'
  /** Écarté sans être tenté (hébergeur connu pour ne pas pouvoir marcher). */
  | 'ecarte'
  /** Abandonné parce qu'il dépassait son budget de temps. */
  | 'budget';

/** Qui a fourni le lien : affiché pour savoir quelle source perd des flux. */
export interface FailureContext {
  /** « Movix · wiflix », « Anime-Sama »… */
  source?: string;
  /** Titre du contenu demandé, pour retrouver le cas. */
  title?: string;
}

export interface Failure extends FailureContext {
  at: number;
  url: string;
  /** Domaine du lien, sans « www. » : la clé de regroupement. */
  host: string;
  kind: FailureKind;
  /** Extracteur choisi (« VOE », « générique »…). */
  extractor?: string;
  reason: string;
}

const MAX_ENTRIES = 500;
const entries: Failure[] = [];

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '?'; }
}

export function recordFailure(f: Omit<Failure, 'at' | 'host'> & { at?: number }): void {
  entries.push({ ...f, at: f.at ?? Date.now(), host: hostOf(f.url) });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/** Du plus récent au plus ancien. */
export function listFailures(): Failure[] {
  return [...entries].reverse();
}

export function clearFailures(): number {
  const n = entries.length;
  entries.length = 0;
  return n;
}

export interface HostSummary {
  host: string;
  count: number;
  /** Nombre d'entrées par type. */
  kinds: Partial<Record<FailureKind, number>>;
  /** Raisons distinctes, de la plus fréquente à la moins fréquente. */
  reasons: Array<{ reason: string; count: number }>;
  sources: string[];
  lastAt: number;
}

/** Un hébergeur par ligne, les plus fautifs d'abord. */
export function summarize(list: Failure[] = entries): HostSummary[] {
  const byHost = new Map<string, HostSummary & { reasonMap: Map<string, number> }>();
  for (const f of list) {
    let h = byHost.get(f.host);
    if (!h) {
      h = { host: f.host, count: 0, kinds: {}, reasons: [], sources: [], lastAt: 0, reasonMap: new Map() };
      byHost.set(f.host, h);
    }
    h.count++;
    h.kinds[f.kind] = (h.kinds[f.kind] ?? 0) + 1;
    h.reasonMap.set(f.reason, (h.reasonMap.get(f.reason) ?? 0) + 1);
    if (f.source && !h.sources.includes(f.source)) h.sources.push(f.source);
    h.lastAt = Math.max(h.lastAt, f.at);
  }
  return [...byHost.values()]
    .map(({ reasonMap, ...h }) => ({
      ...h,
      reasons: [...reasonMap].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}
