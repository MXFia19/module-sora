import * as fs from 'node:fs';
import * as path from 'node:path';
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

/* ------------------------------ persistance ------------------------------ */
/* Le journal tenait en mémoire seule : un redémarrage — donc chaque
 * `docker compose up --build` — effaçait tout, y compris la trace de l'incident
 * qu'on venait de déployer pour corriger. On l'écrit donc à côté.
 *
 * NDJSON, une ligne par événement, en ajout : c'est ce qui survit le mieux à
 * une coupure (une ligne tronquée se jette, le reste se lit), et ça se relit
 * sans rien charger d'autre.
 *
 * L'écriture est groupée : en LOG_LEVEL=debug chaque requête sortante produit
 * une ligne, et un write() par ligne ferait du bien plus de travail que
 * l'addon lui-même. */

const FLUSH_MS = 2000;
const MAX_LINES = 20000;

let enAttente: LiveEvent[] = [];
let minuteur: NodeJS.Timeout | null = null;
let ecritureCassee = false;

function fichier(): string {
  return config.liveLogFile;
}

function flush(): void {
  minuteur = null;
  if (!enAttente.length) return;
  const lignes = enAttente;
  enAttente = [];

  const cible = fichier();
  if (!cible || ecritureCassee) return;
  try {
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.appendFileSync(cible, lignes.map(e => JSON.stringify(e)).join('\n') + '\n');
  } catch (e) {
    // Disque plein, volume absent, droits : on le dit UNE fois et on continue
    // sans persistance. Un journal qui empêche le serveur de tourner serait
    // une belle inversion des priorités.
    ecritureCassee = true;
    console.warn(`[LiveLog] journal non persisté (${e instanceof Error ? e.message : e})`);
  }
}

function planifier(e: LiveEvent): void {
  if (!fichier() || ecritureCassee) return;
  enAttente.push(e);
  if (!minuteur) {
    minuteur = setTimeout(flush, FLUSH_MS);
    // Ce minuteur ne doit pas retenir le process au moment de s'arrêter.
    minuteur.unref?.();
  }
}

/** Relit la fin du journal pour que la page montre déjà quelque chose après un
 *  redémarrage. Seules les CAPACITY dernières lignes comptent : le reste ne
 *  serait de toute façon pas affiché. */
export function restore(): number {
  const cible = fichier();
  if (!cible) return 0;

  let lignes: string[];
  try {
    lignes = fs.readFileSync(cible, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return 0;   // premier démarrage : il n'y a rien à relire.
  }

  // Le fichier grandit indéfiniment sinon. On le retaille au démarrage, seul
  // moment où personne n'écrit dedans.
  if (lignes.length > MAX_LINES) {
    lignes = lignes.slice(-MAX_LINES);
    try { fs.writeFileSync(cible, lignes.join('\n') + '\n'); } catch { /* tant pis */ }
  }

  let repris = 0;
  for (const ligne of lignes.slice(-CAPACITY)) {
    try {
      const e = JSON.parse(ligne) as LiveEvent;
      if (!e || (e.kind !== 'log' && e.kind !== 'request')) continue;
      buffer.push(e);
      if (e.seq > seq) seq = e.seq;
      repris++;
    } catch { /* ligne tronquée par une coupure : on la laisse */ }
  }
  if (buffer.length > CAPACITY) buffer.splice(0, buffer.length - CAPACITY);
  return repris;
}

/** Vide le journal, en mémoire ET sur disque : « Effacer » qui laisserait le
 *  fichier intact ferait revenir tout l'historique au redémarrage suivant. */
export function purge(): number {
  const n = buffer.length;
  buffer.length = 0;
  enAttente = [];
  const cible = fichier();
  if (cible) { try { fs.rmSync(cible, { force: true }); } catch { /* ignoré */ } }
  return n;
}

function push(e: LiveEvent): void {
  buffer.push(e);
  if (buffer.length > CAPACITY) buffer.shift();
  planifier(e);
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
