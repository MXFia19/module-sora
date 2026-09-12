import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso639_2, isForced, audioLabel } from './lang';

test('toIso639_2 normalise codes courts, étiquettes régionales et libellés', () => {
  assert.equal(toIso639_2('fr'), 'fre');
  assert.equal(toIso639_2('fr-FR'), 'fre');
  assert.equal(toIso639_2('pt_BR'), 'por');
  assert.equal(toIso639_2('Français'), 'fre');
  assert.equal(toIso639_2('English'), 'eng');
  assert.equal(toIso639_2(''), 'und');
});

test('isForced repère les variantes d’écriture', () => {
  assert.equal(isForced('French (Forced)'), true);
  assert.equal(isForced('Français forcé'), true);
  assert.equal(isForced('Français'), false);
});

test('audioLabel lit la langue annoncée par une source française', () => {
  assert.equal(audioLabel('Episode 3 VOSTFR'), 'VOSTFR');
  assert.equal(audioLabel('/one-piece-1090-vf/'), 'VF');
  assert.equal(audioLabel('MULTI 1080p'), 'MULTI');
  // VOSTFR contient « vf » : l'ordre des tests compte, on vérifie qu'il tient.
  assert.equal(audioLabel('vostfr'), 'VOSTFR');
});
