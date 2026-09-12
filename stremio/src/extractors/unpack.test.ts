import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpack, unpackAll, findMediaUrl } from './unpack';

/** Bloc packé authentique dans sa forme (produit par le packer de Dean
 *  Edwards), réduit à ce qui nous intéresse : l'URL du fichier. */
const PACKED = `eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};` +
  `if(!''.replace(/^/,String)){while(c--){d[c.toString(a)]=k[c]||c.toString(a)}` +
  `k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};` +
  `while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p}` +
  `('0 1={2:"3://4.5/6/7.8"};',9,9,'var|sources|file|https|cdn|example|hls|master|m3u8'.split('|')))`;

test('unpack restitue le code déballé', () => {
  const out = unpack(PACKED);
  assert.ok(out);
  assert.match(out, /var sources=\{file:"https:\/\/cdn\.example\/hls\/master\.m3u8"\}/);
});

test('unpack rend null sur du texte qui n’est pas packé', () => {
  assert.equal(unpack('<html><body>rien ici</body></html>'), null);
});

test('unpackAll + findMediaUrl sortent l’URL d’une page entière', () => {
  const page = `<html><script>${PACKED}</script></html>`;
  const url = findMediaUrl(unpackAll(page));
  assert.equal(url, 'https://cdn.example/hls/master.m3u8');
});

test('findMediaUrl préfère une URL de média à un lien quelconque', () => {
  const html = '<a href="https://site/page.html">x</a><source src="https://cdn/v/film.mp4?t=1">';
  assert.equal(findMediaUrl(html), 'https://cdn/v/film.mp4?t=1');
});

test('findMediaUrl déséchappe les slashes d’un JSON inline', () => {
  assert.equal(
    findMediaUrl('{"src":"https:\\/\\/cdn.test\\/a\\/master.m3u8"}'),
    'https://cdn.test/a/master.m3u8',
  );
});
