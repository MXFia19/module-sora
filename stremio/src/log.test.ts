import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from './log';

test('la clé TMDB ne sort jamais dans un journal', () => {
  // Un log se colle dans une discussion ou une capture ; cette clé voyage
  // dans la query de chaque appel TMDB, donc dans chaque ligne de trace HTTP.
  const url = 'GET 200 https://api.themoviedb.org/3/movie/42?api_key=03fe187b1f6&language=fr-FR (1668o)';
  const out = redact(url);
  assert.doesNotMatch(out, /03fe187b1f6/);
  assert.match(out, /api_key=\*\*\*&language=fr-FR/);
});

test('un jeton Bearer est masqué aussi', () => {
  assert.equal(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdef'), 'Authorization: Bearer=***');
});

test('les jetons de flux ne sont pas masqués', () => {
  // Ceux-là ne sont pas des secrets de l'utilisateur, et les masquer rendrait
  // les logs inutilisables pour diagnostiquer une lecture.
  const u = 'https://cdn.tld/master.m3u8?t=abc123&e=43200&i=0.4';
  assert.equal(redact(u), u);
});
