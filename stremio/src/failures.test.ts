import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'node:vm';
import { recordFailure, listFailures, clearFailures, summarize, hostOf } from './failures';
import { failPage } from './failpage';

beforeEach(() => { clearFailures(); });

test('le domaine sert de clé, sans « www. »', () => {
  assert.equal(hostOf('https://www.fembed.com/v/abc'), 'fembed.com');
  assert.equal(hostOf('https://voe.sx/e/abc'), 'voe.sx');
  assert.equal(hostOf('pas une url'), '?');
});

test('le journal rend le plus récent d’abord, avec son contexte', () => {
  recordFailure({ url: 'https://a.test/e/1', kind: 'echec', reason: 'HTTP 403', source: 'Movix · wiflix', title: 'Inception (2010)', at: 1 });
  recordFailure({ url: 'https://b.test/e/2', kind: 'ecarte', reason: 'captcha', at: 2 });
  const list = listFailures();
  assert.deepEqual(list.map(f => f.host), ['b.test', 'a.test']);
  assert.equal(list[1]!.source, 'Movix · wiflix');
  assert.equal(list[1]!.title, 'Inception (2010)');
});

test('le journal est borné : les plus anciens sortent', () => {
  for (let i = 0; i < 520; i++) recordFailure({ url: `https://h${i}.test/`, kind: 'echec', reason: 'x', at: i });
  const list = listFailures();
  assert.equal(list.length, 500);
  assert.equal(list[0]!.host, 'h519.test');
  assert.equal(list.at(-1)!.host, 'h20.test');
});

test('le résumé regroupe par hébergeur, les plus fautifs d’abord, raisons triées', () => {
  recordFailure({ url: 'https://voe.sx/e/1', kind: 'echec', reason: 'fichier absent', source: 'Movix · wiflix', at: 1 });
  recordFailure({ url: 'https://voe.sx/e/2', kind: 'echec', reason: 'HTTP 403', source: 'Anime-Sama', at: 2 });
  recordFailure({ url: 'https://voe.sx/e/3', kind: 'echec', reason: 'HTTP 403', at: 3 });
  recordFailure({ url: 'https://veev.to/e/1', kind: 'ecarte', reason: 'canvas', at: 4 });

  const [voe, veev] = summarize();
  assert.equal(voe!.host, 'voe.sx');
  assert.equal(voe!.count, 3);
  assert.deepEqual(voe!.reasons, [{ reason: 'HTTP 403', count: 2 }, { reason: 'fichier absent', count: 1 }]);
  assert.deepEqual(voe!.sources, ['Movix · wiflix', 'Anime-Sama']);
  assert.equal(voe!.lastAt, 3);
  assert.deepEqual(veev!.kinds, { ecarte: 1 });
});

test('vider le journal dit combien d’entrées sont parties', () => {
  recordFailure({ url: 'https://a.test/', kind: 'budget', reason: 'abandonné après 15 s' });
  assert.equal(clearFailures(), 1);
  assert.equal(listFailures().length, 0);
});

test('le script de la page des liens en échec se parse', () => {
  const html = failPage();
  const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]!).join('\n;\n');
  assert.ok(source.length > 100, 'la page doit embarquer un script');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'failures.js' }),
    'le <script> de /debug/failures ne se parse pas — tous ses boutons seraient morts');
});
