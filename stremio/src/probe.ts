import { resolveStreams } from './index';
import { parseStremioId } from './index';
import { allScrapers, enabledScrapers } from './scrapers';
import type { MediaType } from './types';

/** Sonde en ligne de commande : joue exactement ce que ferait Stremio, mais
 *  dans un terminal, avec les logs. C'est l'outil à dégainer quand une source
 *  rend zéro flux — il dit à quelle étape ça s'est arrêté.
 *
 *  Exemples :
 *    npm run probe -- movie tt0816692
 *    npm run probe -- series tt0944947:1:1
 *    npm run probe -- series tmdb:1429:1:1 --only animesama
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
  const positional = argv.filter((a, i) =>
    !a.startsWith('--') && argv[i - 1] !== '--only');

  const type = positional[0] as MediaType | undefined;
  const rawId = positional[1];

  if (!type || !rawId || (type !== 'movie' && type !== 'series')) {
    console.error('usage: npm run probe -- <movie|series> <id> [--only <scraper>]');
    console.error(`sources disponibles: ${allScrapers().map(s => s.id).join(', ')}`);
    process.exit(2);
  }

  // --only surcharge la sélection le temps de la sonde.
  if (only) process.env.SCRAPERS = only;

  console.log(`sonde ${type} ${rawId} — sources: ${enabledScrapers().map(s => s.id).join(', ')}`);
  const { id, season, episode } = parseStremioId(rawId);

  const started = Date.now();
  const streams = await resolveStreams(type, id, season, episode);
  console.log(`\n${streams.length} flux en ${Date.now() - started}ms`);

  for (const s of streams) {
    const subs = s.subtitles?.length ? ` +${s.subtitles.length} sous-titre(s)` : '';
    const proxied = s.headers && Object.keys(s.headers).length > 0 ? ' [proxy]' : '';
    console.log(`  ${s.language.padEnd(7)} ${s.quality.padEnd(6)} ${(s.source ?? '').padEnd(12)} ${s.server}${subs}${proxied}`);
    console.log(`      ${s.url.slice(0, 140)}`);
  }
}

main().catch(e => {
  console.error('sonde en échec:', e);
  process.exit(1);
});
