import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedsAt, epsArraysOnly } from './animesama';

// Forme de la page de saison depuis novembre 2026 : les tableaux sont écrits
// dans le HTML, sans point-virgule, et portent des « lien:<id> ».
const PAGE = `<html><script>
  var eps1 = ["lien:186672","lien:186675","lien:186678"]
  var eps2 = ['https://vidmoly.biz/embed-a.html', 'https://vidmoly.biz/embed-b.html']
  epsJeton = "5279.1795075";
</script></html>`;

test('epsArraysOnly extrait les tableaux de la page au format episodes.js', () => {
  const js = epsArraysOnly(PAGE);
  assert.match(js, /var eps1 = \[.*\];/);
  assert.match(js, /var eps2 = \[.*\];/);
  assert.doesNotMatch(js, /epsJeton|<html/);
});

test('embedsAt garde les « lien: » et les URLs, à l\'index demandé', () => {
  const js = epsArraysOnly(PAGE);
  assert.deepEqual(embedsAt(js, 1), ['lien:186675', 'https://vidmoly.biz/embed-b.html']);
  assert.deepEqual(embedsAt(js, 2), ['lien:186678']);
});

test('embedsAt lit toujours un ancien episodes.js', () => {
  const js = `var eps1 = [\n'https://a.example/1',\n'https://a.example/2',\n];\nvar eps2 = ['https://b.example/1'];`;
  assert.deepEqual(embedsAt(js, 0), ['https://a.example/1', 'https://b.example/1']);
});
