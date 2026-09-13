import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageMorte } from './index';

/** Phrases relevées telles quelles sur les hébergeurs rencontrés. Ce qui
 *  compte ici n'est pas d'extraire quoi que ce soit : c'est que « vidéo
 *  supprimée » et « hébergeur qu'on ne sait pas lire » cessent de produire le
 *  même message dans les logs. */
test('les pages qui annoncent un fichier absent sont reconnues', () => {
  const cas: Array<[string, RegExp]> = [
    ['<div>File is no longer available as it expired or has been deleted.</div>', /no longer available/i],
    ['<p>No such file=jvy7ykc1jh2t</p>', /No such file/i],
    ['<h1>This domain is for sale</h1>', /domain is for sale/i],
    ['<title>Video not found — FireStream</title>', /Video not found/i],
    ['<div>Video does not exist or is still processing.</div>', /does not exist/i],
  ];
  for (const [html, attendu] of cas) {
    const m = pageMorte(html);
    assert.ok(m, `non reconnu : ${html}`);
    assert.match(m, attendu);
  }
});

test('un vrai lecteur n’est pas pris pour une page morte', () => {
  assert.equal(pageMorte('<html><script>var p={"file":"https://cdn.invalid/a/master.m3u8"};</script></html>'), null);
  assert.equal(pageMorte('<html><body>Lecture en cours</body></html>'), null);
});
