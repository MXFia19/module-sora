import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteEpisode, isAnime } from './tmdb';

const SEASONS = [
  { season_number: 0, episode_count: 5 },   // spéciaux
  { season_number: 1, episode_count: 25 },
  { season_number: 2, episode_count: 12 },
  { season_number: 3, episode_count: 13 },
];

test('absoluteEpisode cumule les saisons précédentes', () => {
  assert.equal(absoluteEpisode({ seasons: SEASONS }, 1, 4), 4);
  assert.equal(absoluteEpisode({ seasons: SEASONS }, 2, 1), 26);
  assert.equal(absoluteEpisode({ seasons: SEASONS }, 3, 13), 50);
});

test('absoluteEpisode ignore les spéciaux (saison 0)', () => {
  // Les compter décalerait tout de 5 et ferait servir le mauvais épisode sur
  // les sources à numérotation continue.
  assert.equal(absoluteEpisode({ seasons: SEASONS }, 2, 1), 26);
});

test('absoluteEpisode renonce plutôt que de deviner sur une fiche incomplète', () => {
  const partial = [{ season_number: 1, episode_count: NaN }, { season_number: 2, episode_count: 10 }];
  assert.equal(absoluteEpisode({ seasons: partial }, 2, 3), undefined);
  assert.equal(absoluteEpisode(null, 2, 3), undefined);
});

test('isAnime demande animation ET origine japonaise', () => {
  assert.equal(isAnime({ id: 1, genres: [{ id: 16 }], origin_country: ['JP'] } as never), true);
  assert.equal(isAnime({ id: 1, genres: [{ id: 16 }], original_language: 'ja' } as never), true);
  // Un dessin animé américain n'a rien à faire sur anime-sama…
  assert.equal(isAnime({ id: 1, genres: [{ id: 16 }], origin_country: ['US'] } as never), false);
  // …et un film live japonais non plus.
  assert.equal(isAnime({ id: 1, genres: [{ id: 18 }], origin_country: ['JP'] } as never), false);
});
