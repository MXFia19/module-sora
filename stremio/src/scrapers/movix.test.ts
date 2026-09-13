import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecarte } from './movix';

test('on n’écarte que ce qui ne peut pas marcher', () => {
  assert.match(ecarte('https://veev.to/e/y789aduzdq78') ?? '', /canvas/);
  assert.match(ecarte('https://listeamed.net/e/27BaOnaYl00EMDX') ?? '', /publicitaire/);
  assert.match(ecarte('https://www.fembed.com/v/ITUSbqa1V9TP') ?? '', /ne répond plus/);
});

test('un hôte devenu lisible ne doit plus être écarté', () => {
  // Régression : ces deux-là ont été jetés en silence alors que VOE, Byse et
  // embedseek savaient les lire — deux flux perdus par film, sans un log.
  assert.equal(ecarte('https://kakaflix.lol/voe1//newPlayer.php?id=c227c61c'), null);
  assert.equal(ecarte('https://kakaflix.lol/moon2//newPlayer.php?id=ca3a1955'), null);
  assert.equal(ecarte('https://coflix.upn.one/#eusjum'), null);
  // Un hôte simplement tombé ou bloqué par IP garde sa chance : le diagnostic
  // dira pourquoi, et il remarchera peut-être depuis une autre adresse.
  assert.equal(ecarte('https://up4fun.top/e/abc'), null);
  assert.equal(ecarte('https://waaw.to/f/0LjHYyWiE1EK'), null);
});

test('les motifs ne débordent pas sur des hôtes voisins', () => {
  assert.equal(ecarte('https://ansembed.net/embed-tu80oqm76nwd.html'), null);
  assert.equal(ecarte('https://vidmoly.net/embed-8itfk2l4rv9q.html'), null);
  assert.equal(ecarte('https://static.veevcdn.co/assets/x.js'), null);
});
