import type { DebugReport } from './debug';
import type { MediaType } from './types';

/** Historique des diagnostics lancés depuis /debug.
 *
 *  Sans ça, chaque test efface le précédent : comparer « avant/après une
 *  correction » ou revenir sur une recherche faite dix minutes plus tôt oblige
 *  à tout relancer — et les sources, elles, auront changé entre-temps. Les
 *  logs d'une exécution ne sont reproductibles qu'une fois.
 *
 *  En mémoire, volontairement : c'est un outil de mise au point, pas une
 *  archive. Un redémarrage repart de zéro, et l'anneau borne l'empreinte.
 *  Chaque exécution porte déjà un plafond de 500 lignes de trace par source
 *  (voir trace.ts), donc le coût est prévisible. */

export interface HistoryEntry {
  id: string;
  /** Epoch ms. L'heure absolue, pas un décalage : on revient sur ces entrées
   *  longtemps après, et « +412ms » ne dit pas quel jour. */
  at: number;
  type: MediaType;
  rawId: string;
  season?: number;
  episode?: number;
  /** Titre résolu par TMDB, ou l'identifiant brut si la résolution a échoué. */
  label: string;
  streams: number;
  sources: number;
  ok: number;
  totalMs: number;
  error?: string;
  report: DebugReport;
}

/** Résumé sans les logs ni les flux : c'est ce que la liste affiche, et le
 *  rapport complet pèse trop pour être envoyé vingt fois. */
export type HistorySummary = Omit<HistoryEntry, 'report'>;

const MAX_ENTRIES = 20;
const entries: HistoryEntry[] = [];
let counter = 0;

export function remember(
  type: MediaType,
  rawId: string,
  season: number | undefined,
  episode: number | undefined,
  report: DebugReport,
): HistoryEntry {
  const entry: HistoryEntry = {
    id: `${Date.now().toString(36)}-${(++counter).toString(36)}`,
    at: Date.now(),
    type,
    rawId,
    season,
    episode,
    label: report.media?.title ?? rawId,
    streams: report.scrapers.reduce((n, s) => n + s.streamCount, 0),
    sources: report.scrapers.length,
    ok: report.scrapers.filter(s => s.status === 'ok').length,
    totalMs: report.totalMs,
    error: report.error,
    report,
  };

  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  return entry;
}

function summarize(e: HistoryEntry): HistorySummary {
  const { report: _report, ...rest } = e;
  return rest;
}

/** Les exécutions, la plus récente d'abord. */
export function list(): HistorySummary[] {
  return entries.map(summarize);
}

export function find(id: string): HistoryEntry | undefined {
  return entries.find(e => e.id === id);
}

export function clear(): number {
  const n = entries.length;
  entries.length = 0;
  return n;
}
