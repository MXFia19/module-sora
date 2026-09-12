import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlayable, looksLikeMedia } from './index';

test('isPlayable écarte le relatif et les marqueurs de fichier absent', () => {
  assert.equal(isPlayable('/embed/novideo.mp4'), false);
  assert.equal(isPlayable('https://www.yourupload.com/embed/novideo.mp4'), false);
  assert.equal(isPlayable('https://host.tld/void.mp4'), false);
  assert.equal(isPlayable('https://host.tld/v/abc.mp4'), true);
});

test('isPlayable accepte une URL de média sans extension', () => {
  // Régression : Streamtape sert ses vidéos sur /get_video?id=… (302 vers un
  // MP4). Le flux était correctement extrait, puis jeté parce qu'il ne
  // finissait pas en .mp4 — deux flux VF perdus par film sur voir-anime.
  assert.equal(isPlayable('https://streamtape.com/get_video?id=abc&dl=1'), true);
});

test("looksLikeMedia reste exigeant : c'est le garde-fou du repli générique", () => {
  // Le repli ramasse la première URL plausible d'une page inconnue ; sans
  // extension il rendrait des pages HTML et des images.
  assert.equal(looksLikeMedia('https://streamtape.com/get_video?id=abc'), false);
  assert.equal(looksLikeMedia('https://host.tld/master.m3u8?t=x'), true);
  assert.equal(looksLikeMedia('https://host.tld/v/abc.mp4'), true);
  assert.equal(looksLikeMedia('https://host.tld/page.html'), false);
});
