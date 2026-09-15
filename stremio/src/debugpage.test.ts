import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'node:vm';
import { debugPage } from './debugpage';
import { livePage } from './livepage';

/** Le <script> d'une page, tel que le navigateur le recevra. */
function scriptOf(html: string): string {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]!).join('\n;\n');
}

/** Ces pages sont écrites dans un gabarit TypeScript, donc leurs apostrophes
 *  traversent DEUX couches d'échappement : celle du gabarit, puis celle du JS
 *  émis. Une apostrophe échappée une seule fois (`l\'hôte`) compile sans
 *  broncher côté TypeScript et sort en `l'hôte` dans une chaîne à quotes
 *  simples — le script entier cesse alors de se parser, et TOUS les boutons de
 *  la page meurent d'un coup, sans la moindre erreur visible côté serveur.
 *
 *  C'est arrivé. Une page dont l'interactivité tient à un seul <script> mérite
 *  qu'on vérifie qu'il se parse. */
for (const [nom, html] of [['debug', debugPage()], ['live', livePage()]] as const) {
  test(`le script de la page ${nom} se parse`, () => {
    const source = scriptOf(html);
    assert.ok(source.length > 100, 'la page doit embarquer un script');
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: `${nom}.js` }),
      `le <script> de /${nom} ne se parse pas — tous ses boutons seraient morts`);
  });
}
