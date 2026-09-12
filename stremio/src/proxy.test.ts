import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxify, rewriteHls } from './proxy';

function payloadOf(proxyUrl: string): { u: string; h?: Record<string, string>; e: number } {
  const data = new URL(proxyUrl).searchParams.get('d')!;
  return JSON.parse(Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
}

test('proxify transporte l’URL et les headers, et signe le tout', () => {
  const url = proxify('https://cdn.test/master.m3u8', { Referer: 'https://host.test/' });
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/proxy/s.m3u8');
  assert.ok(parsed.searchParams.get('t'), 'signature absente');

  const payload = payloadOf(url);
  assert.equal(payload.u, 'https://cdn.test/master.m3u8');
  assert.deepEqual(payload.h, { Referer: 'https://host.test/' });
  assert.ok(payload.e > Date.now(), 'expiration déjà dépassée');
});

test('proxify marque l’extension pour que le player devine le type', () => {
  assert.match(proxify('https://cdn.test/v/film.mp4'), /\/proxy\/s\.mp4\?/);
  assert.match(proxify('https://cdn.test/v/segment'), /\/proxy\/s\?/);
});

test('rewriteHls fait repasser variantes, segments et clés par le proxy', () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720',
    '720/index.m3u8',
    '#EXTINF:10.0,',
    'https://cdn.test/abs/seg1.ts',
    '',
  ].join('\n');

  const out = rewriteHls(manifest, 'https://cdn.test/hls/master.m3u8', { Referer: 'https://host.test/' });
  const lines = out.split('\n');

  // Les directives restent des directives ; seules leurs URI sont réécrites.
  assert.ok(lines[1]!.startsWith('#EXT-X-KEY:METHOD=AES-128,URI="http'), lines[1]);
  assert.equal(lines[2], '#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720');

  // Une URI relative est résolue contre le manifeste avant d'être signée :
  // sans ça, les segments partiraient en direct et l'hébergeur répondrait 403.
  assert.equal(payloadOf(lines[3]!).u, 'https://cdn.test/hls/720/index.m3u8');
  assert.equal(payloadOf(lines[1]!.match(/URI="([^"]+)"/)![1]!).u, 'https://cdn.test/hls/key.bin');
  assert.equal(payloadOf(lines[5]!).u, 'https://cdn.test/abs/seg1.ts');

  // Les headers de l'hébergeur suivent jusqu'aux segments.
  assert.deepEqual(payloadOf(lines[5]!).h, { Referer: 'https://host.test/' });
});

test('rewriteHls laisse les lignes vides intactes', () => {
  const out = rewriteHls('#EXTM3U\n\n#EXT-X-ENDLIST\n', 'https://cdn.test/m.m3u8');
  assert.equal(out, '#EXTM3U\n\n#EXT-X-ENDLIST\n');
});
