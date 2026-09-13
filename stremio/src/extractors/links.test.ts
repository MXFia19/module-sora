import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaredHlsLink } from './unpack';

const BASE = 'https://vibuxer.invalid/e/abc';

test('la préférence déclarée par le lecteur est respectée', () => {
  // La page consomme ses variantes ainsi : links.hls4 || links.hls3 || links.hls2.
  const page = 'var links={"hls3":"https://cdn.invalid/hls3/x/master.txt",'
    + '"hls2":"https://cdn.invalid/hls2/x/master.m3u8?t=1",'
    + '"hls4":"/stream/tok/x/master.m3u8"};';
  assert.equal(declaredHlsLink(page, BASE), 'https://vibuxer.invalid/stream/tok/x/master.m3u8');
});

test('une variante relative est résolue contre la page', () => {
  assert.equal(
    declaredHlsLink('var links={"hls4":"/stream/a/master.m3u8"};', BASE),
    'https://vibuxer.invalid/stream/a/master.m3u8');
});

test('on retombe sur la variante suivante quand la meilleure est vide', () => {
  // Le lecteur fait pareil : `||` saute une chaîne vide.
  const page = 'var links={"hls4":"","hls3":"https://cdn.invalid/hls3/x/master.txt"};';
  assert.equal(declaredHlsLink(page, BASE), 'https://cdn.invalid/hls3/x/master.txt');
});

test('une page sans bloc links ne rend rien', () => {
  assert.equal(declaredHlsLink('<html>aucun lien</html>', BASE), null);
  assert.equal(declaredHlsLink('var links={cassé;', BASE), null);
});
