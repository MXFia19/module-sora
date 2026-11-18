import { test } from 'node:test';
import assert from 'node:assert/strict';
import { luluEmbedUrl, LULU_HOST } from './misc';

// luluvdo.com ne résout plus : tous les anciens domaines doivent être rejoués
// sur le lecteur actuel, avec le seul code de fichier.
test('luluEmbedUrl réécrit les anciens domaines vers le lecteur actuel', () => {
  assert.equal(luluEmbedUrl('https://luluvdo.com/e/42ymne7i4uio'), `${LULU_HOST}/e/42ymne7i4uio`);
  assert.equal(luluEmbedUrl('https://luluvdo.com/d/g45atsukpk9z'), `${LULU_HOST}/e/g45atsukpk9z`);
  assert.equal(luluEmbedUrl('https://luluvdo.com/hxf9t7ejg570'), `${LULU_HOST}/e/hxf9t7ejg570`);
  assert.equal(luluEmbedUrl('https://lulustream.com/e/mre7y1zpf246'), `${LULU_HOST}/e/mre7y1zpf246`);
  assert.equal(luluEmbedUrl('https://lulu.st/e/ABCDEF123456?x=1'), `${LULU_HOST}/e/abcdef123456`);
});

test('luluEmbedUrl laisse intacte une URL sans code de fichier', () => {
  assert.equal(luluEmbedUrl('https://luluvdo.com/'), 'https://luluvdo.com/');
  assert.equal(luluEmbedUrl('https://luluvdo.com/e/short'), 'https://luluvdo.com/e/short');
});
