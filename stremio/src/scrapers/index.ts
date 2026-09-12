import { config } from '../config';
import { logger } from '../log';
import type { Scraper } from '../types';

import { movix } from './movix';
import { purstream } from './purstream';
import { animesama } from './animesama';
import { voiranime } from './voiranime';
import { nakanime } from './nakanime';

const log = logger('Scrapers');

/** Registre. Ajouter une source = ajouter une ligne ici et un fichier à côté ;
 *  c'est tout ce que le serveur a besoin de savoir. */
const ALL: Scraper[] = [movix, purstream, animesama, voiranime, nakanime];

export function allScrapers(): Scraper[] {
  return ALL;
}

/** Scrapers réellement actifs, selon SCRAPERS dans l'environnement. */
export function enabledScrapers(): Scraper[] {
  if (config.enabledScrapers.length === 0) return ALL;
  const wanted = new Set(config.enabledScrapers.map(s => s.toLowerCase()));
  const picked = ALL.filter(s => wanted.has(s.id));
  const unknown = [...wanted].filter(w => !ALL.some(s => s.id === w));
  if (unknown.length) log.warn(`scrapers inconnus ignorés: ${unknown.join(', ')}`);
  return picked;
}
