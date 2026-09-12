import { config } from './config';

/** Journal en direct : ce que fait le serveur, pendant qu'on s'en sert.
 *
 *  `/debug` répond à « cette source marche-t-elle ? » en la testant. Ici on
 *  répond à « que s'est-il passé quand mon téléphone a ouvert cet épisode ? »,
 *  ce qui n'est pas la même question : le client est ailleurs, on ne peut pas
 *  rejouer sa requête, il faut l'observer au vol.
 *
 *  Un tampon circulaire garde les derniers événements pour que la page montre
 *  déjà quelque chose à l'ouverture, et les abonnés reçoivent la suite en
 *  temps réel. */

export interface LiveLog {
  kind: 'log';
  seq: number;
  at: number;
  level: string;
  scope: string;
  message: string;
}

export interface LiveRequest {
  kind: 'request';
  seq: number;
  at: number;
  /** Adresse du client — utile pour distinguer le téléphone du PC. */
  client: string;
  type: string;
  id: string;
  title?: string;
  /** Pseudo de la configuration utilisée, s'il y en a un. */
  nickname?: string;
  ms: number;
  total: number;
  shown: number;
  cached: boolean;
  sources: Array<{ name: string; count: number; ms: number }>;
}

export type LiveEvent = LiveLog | LiveRequest;

const CAPACITY = 800;

const buffer: LiveEvent[] = [];
const subscribers = new Set<(e: LiveEvent) => void>();
let seq = 0;

function push(e: LiveEvent): void {
  buffer.push(e);
  if (buffer.length > CAPACITY) buffer.shift();
  for (const fn of subscribers) {
    // Un abonné qui jette — connexion morte — ne doit pas interrompre les
    // autres ni le serveur.
    try { fn(e); } catch { /* ignoré */ }
  }
}

export function pushLog(level: string, scope: string, message: string): void {
  // Sans la page de diagnostic, personne ne lira ce tampon : autant ne rien
  // accumuler du tout.
  if (!config.debugUi) return;
  push({ kind: 'log', seq: ++seq, at: Date.now(), level, scope, message });
}

export function pushRequest(r: Omit<LiveRequest, 'kind' | 'seq' | 'at'>): void {
  if (!config.debugUi) return;
  push({ kind: 'request', seq: ++seq, at: Date.now(), ...r });
}

export function snapshot(): LiveEvent[] {
  return [...buffer];
}

export function subscribe(fn: (e: LiveEvent) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function subscriberCount(): number {
  return subscribers.size;
}
