import type { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { logger } from './log';

const log = logger('Limite');

/** Garde-fous pour une instance ouverte au public.
 *
 *  Deux ressources très différentes à protéger :
 *
 *  - `/stream` coûte du CPU et surtout des requêtes vers les sites sources.
 *    Trop d'appels et c'est l'IP du serveur qui se fait bannir chez eux, pas
 *    l'utilisateur. Limite PAR IP, en fenêtre fixe.
 *
 *  - `/proxy` coûte de la bande passante, et c'est l'uplink de la machine qui
 *    sature, pas une IP en particulier. Limite GLOBALE en nombre de flux
 *    simultanés : au-delà, mieux vaut refuser proprement que dégrader la
 *    lecture de tout le monde. */

interface Window { count: number; resetAt: number }

const windows = new Map<string, Window>();

/** Purge paresseuse : on nettoie en même temps qu'on lit, plutôt que de tenir
 *  un timer. Une instance sans trafic ne doit rien faire tourner. */
function sweep(now: number): void {
  if (windows.size < 10_000) return;
  for (const [key, w] of windows) {
    if (w.resetAt < now) windows.delete(key);
  }
}

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const max = config.rateLimitStreamPerMin;
  if (max <= 0) return next();

  const now = Date.now();
  sweep(now);

  const key = req.ip ?? 'inconnu';
  const w = windows.get(key);

  if (!w || w.resetAt < now) {
    windows.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }

  w.count++;
  if (w.count > max) {
    const retry = Math.ceil((w.resetAt - now) / 1000);
    log.warn(`${key} au-delà de ${max} requêtes/min — refusée`);
    res.set('Retry-After', String(retry)).status(429).json({ streams: [] });
    return;
  }
  next();
}

let active = 0;

/** Plafond de flux proxifiés simultanés. */
export function concurrencyGuard(req: Request, res: Response, next: NextFunction): void {
  const max = config.proxyMaxConcurrent;
  if (max <= 0) return next();

  if (active >= max) {
    log.warn(`${active} flux simultanés — nouvelle demande refusée`);
    res.status(503).type('text/plain').send('trop de flux simultanés, réessayez dans un instant');
    return;
  }

  active++;
  // `close` part aussi bien sur une fin normale que sur un client parti :
  // c'est le seul signal qui garantit qu'on ne fuit pas un compteur.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    active--;
  };
  res.on('close', release);
  res.on('finish', release);
  next();
}

export function activeStreams(): number {
  return active;
}
