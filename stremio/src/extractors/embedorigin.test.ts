import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmbedOriginUrl, embedOriginCode, streamsFromPlay } from './embedorigin';

test('embedorigin : reconnaît les liens de lecteur, pas le reste', () => {
  assert.equal(isEmbedOriginUrl('https://embedorigin.cc/e/cwae23uit4ix'), true);
  assert.equal(isEmbedOriginUrl('https://streamorigin.cc/e/cwae23uit4ix'), true);
  assert.equal(isEmbedOriginUrl('https://embedorigin.cc/'), false);
  assert.equal(isEmbedOriginUrl('https://voe.sx/e/cwae23uit4ix'), false);
  assert.equal(embedOriginCode('https://embedorigin.cc/e/cwae23uit4ix'), 'cwae23uit4ix');
});

test('embedorigin : HLS puis MP4, liens vides ignorés', () => {
  const s = streamsFromPlay({
    file_code: 'x',
    hls: 'https://t3.so279tk.cc/file/1/a/b/master.m3u8',
    mp4: '',
  }, 'https://embedorigin.cc');
  assert.equal(s.length, 1);
  assert.equal(s[0]!.url, 'https://t3.so279tk.cc/file/1/a/b/master.m3u8');
  assert.equal(s[0]!.headers.Referer, 'https://embedorigin.cc/');

  const both = streamsFromPlay({ hls: 'https://a/m.m3u8', mp4: 'https://a/v.mp4' }, 'https://embedorigin.cc');
  assert.deepEqual(both.map(x => x.server), ['StreamOrigin', 'StreamOrigin MP4']);
});

test('embedorigin : réponse d\'erreur -> rien', () => {
  assert.deepEqual(streamsFromPlay({ message: 'Not found' }, 'https://embedorigin.cc'), []);
  assert.deepEqual(streamsFromPlay(null, 'https://embedorigin.cc'), []);
});
