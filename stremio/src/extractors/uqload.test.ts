import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUqloadRestricted, uqloadSource } from './uqload';

test('la page de refus est reconnue, et seulement elle', () => {
  assert.equal(isUqloadRestricted('Video embed restricted for this domain'), true);
  assert.equal(isUqloadRestricted('Video embed restricted for this domain\n'), true);
  // Une vraie page de lecteur peut contenir n'importe quoi : la taille compte.
  assert.equal(isUqloadRestricted(`<html>${'x'.repeat(500)} Video embed restricted for this domain</html>`), false);
  assert.equal(isUqloadRestricted('<html><body>lecteur</body></html>'), false);
});

test('la source JW Player est lue en clair', () => {
  const html = `jwplayer("vplayer").setup({sources:[{file:"https://strm7.uqload.vc/hls2/02/05861/dzxcdamizxt9_,l,n,h,.urlset/master.m3u8?t=eip&s=1&e=14400"}],image:"https://strm7.uqload.vc/i/02/05861/dzxcdamizxt9.jpg"});`;
  assert.equal(uqloadSource(html),
    'https://strm7.uqload.vc/hls2/02/05861/dzxcdamizxt9_,l,n,h,.urlset/master.m3u8?t=eip&s=1&e=14400');
});

test('ni source ni bloc paqué : rien', () => {
  assert.equal(uqloadSource('<html>File was deleted</html>'), null);
});
