import * as fs from 'fs';
import * as path from 'path';
import { configurePage } from './configure';
import { allScrapers } from './scrapers';

/** Génère une page d'installation AUTONOME.
 *
 *  Le fichier produit ne dépend d'aucun serveur : il fabrique le lien dans le
 *  navigateur, à partir d'une adresse que l'utilisateur saisit. On peut donc
 *  le déposer sur n'importe quel hébergement statique — Vercel, Netlify,
 *  GitHub Pages — sans y faire tourner le moindre scraper, et donc sans se
 *  heurter aux conditions d'usage qui interdisent proxies et scrapers.
 *
 *  Ce que ça ne fait pas : dispenser chaque utilisateur de lancer l'addon chez
 *  lui. La page rend cette étape confortable, elle ne la supprime pas. Pour
 *  qu'il n'y ait rien à installer, il faut une vraie instance en ligne. */
function main(): void {
  const outDir = process.argv[2] ?? 'dist-static';
  fs.mkdirSync(outDir, { recursive: true });

  const html = configurePage(null, allScrapers());
  const file = path.join(outDir, 'index.html');
  fs.writeFileSync(file, html, 'utf-8');

  console.log(`page autonome écrite dans ${file} (${(html.length / 1024).toFixed(1)} Ko)`);
  console.log('à déposer telle quelle sur n’importe quel hébergement statique.');
}

main();
