import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, stripNoise, pickBest, pickByKeywords, similarity, franchiseRoot } from './match';

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

test("pickBest ne se laisse plus piéger par un mot noyé dans le titre cherché", () => {
  // Régression : « Yaiba » est un anime à part entière, et il était contenu
  // dans l'alias TMDB « Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen
  // Train ». La contenance brute lui donnait 0.92 et le film partait chercher
  // ses flux sur la mauvaise fiche.
  const best = pickBest(
    [{ title: 'Yaiba' }],
    { aliases: ['Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen Train'] },
  );
  assert.equal(best, null);
});

test('pickBest accepte encore le préfixe qui nomme une déclinaison', () => {
  const best = pickBest(
    [{ title: 'Demon Slayer' }],
    { aliases: ["Demon Slayer - Le Film : Le train de l'infini"] },
  );
  assert.ok(best);
  assert.ok(best.score >= 0.9);
});

test('franchiseRoot ramène un titre de film à sa franchise', () => {
  assert.equal(franchiseRoot("Demon Slayer - Le Film : Le train de l'infini"), 'Demon Slayer');
  assert.equal(franchiseRoot('Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen Train'), 'Demon Slayer');
  assert.equal(franchiseRoot('One Piece Film: Strong World'), 'One Piece');
  assert.equal(franchiseRoot('Violet Evergarden: The Movie'), 'Violet Evergarden');
  // Rien à raccourcir : on ne veut pas d'une seconde requête identique.
  assert.equal(franchiseRoot('Your Name.'), null);
  assert.equal(franchiseRoot('Suzume'), null);
});

test('pickByKeywords rattrape une fiche préfixée du nom de la franchise', () => {
  // Le cas réel de nakanime : le site nomme ses films « franchise - Le film :
  // titre », TMDB non. La similarité tombe à 0.70, tous les mots sont là.
  const best = pickByKeywords(
    [
      { title: "Demon Slayer : Kimetsu no Yaiba - Le film : Le train de l'Infini" },
      { title: 'Demon Slayer : Kimetsu no Yaiba - Le film : La Forteresse infinie' },
    ],
    ["Demon Slayer - Le Film : Le train de l'infini", 'Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen Train'],
  );
  assert.ok(best);
  assert.match(best.item.title, /train de l'Infini/);
});

test('pickByKeywords se tait quand deux candidats se valent', () => {
  // Sans écart net, aucun mot ne sépare les deux : rendre l'un des deux
  // reviendrait à tirer au sort quel film l'utilisateur va lancer.
  const best = pickByKeywords(
    [{ title: 'One Piece' }, { title: 'One Piece' }],
    ['One Piece Film: Gold'],
  );
  assert.equal(best, null);
});
