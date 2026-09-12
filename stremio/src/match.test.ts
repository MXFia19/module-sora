import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, stripNoise, pickBest, similarity } from './match';

test('normalize aplatit accents, casse et ponctuation', () => {
  assert.equal(normalize('Démon Slayer : Le Train'), 'demon slayer le train');
  assert.equal(normalize("L'Attaque des Titans"), 'lattaque des titans');
  assert.equal(normalize('Tom & Jerry'), 'tom and jerry');
});

test('stripNoise retire langue, qualité, saison et année', () => {
  assert.equal(stripNoise('Dune (2021) VF 1080p streaming'), 'dune');
  assert.equal(stripNoise('One Piece Saison 3 VOSTFR'), 'one piece');
});

test('similarity reconnaît une faute de frappe et sépare deux titres distincts', () => {
  assert.ok(similarity('interstellar', 'intersteller') > 0.9);
  assert.ok(similarity('interstellar', 'inception') < 0.5);
});

test('pickBest retient le bon titre malgré le bruit du site', () => {
  const best = pickBest(
    [
      { title: 'Inception (2010) VF' },
      { title: 'Interstellar streaming vf 1080p' },
      { title: 'Interstellar 5150' },
    ],
    { aliases: ['Interstellar'], year: 2014 },
  );
  assert.ok(best);
  assert.equal(best.item.title, 'Interstellar streaming vf 1080p');
});

test('pickBest refuse plutôt que de rendre un voisin', () => {
  // Le piège du portage : sans seuil, « Dune » attraperait « Dune : Deuxième
  // partie », et l'utilisateur lancerait le mauvais film sans comprendre.
  const best = pickBest(
    [{ title: 'La Planète des singes' }, { title: 'Avatar' }],
    { aliases: ['Interstellar'] },
  );
  assert.equal(best, null);
});

test('pickBest départage deux homonymes par leur année', () => {
  const best = pickBest(
    [
      { title: 'Dune', year: 1984 },
      { title: 'Dune', year: 2021 },
    ],
    { aliases: ['Dune'], year: 2021 },
  );
  assert.ok(best);
  assert.equal(best.item.year, 2021);
});

test('pickBest accepte un titre alternatif quand le titre principal ne colle pas', () => {
  const best = pickBest(
    [{ title: 'Shingeki no Kyojin' }],
    { aliases: ["L'Attaque des Titans", 'Attack on Titan', 'Shingeki no Kyojin'] },
  );
  assert.ok(best);
  assert.equal(best.matchedOn, 'Shingeki no Kyojin');
});
