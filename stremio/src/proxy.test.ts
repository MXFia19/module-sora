import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxify, rewriteHls } from './proxy';

process.env.PROXY_SECRET = process.env.PROXY_SECRET || 'secret-de-test';

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

test('rewriteHls enveloppe une piste de sous-titres .vtt brute en playlist', () => {
  // Régression finepulfe/purstream : le master déclare la piste de sous-titres
  // directement sur le .vtt, ce que libav lit comme une playlist et rejette,
  // faisant tomber tout le master. L'URI doit repartir vers /proxy/vtt.m3u8
  // (playlist synthétique), pas vers /proxy/s (le .vtt brut).
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="FR",URI="subs_fre_forced.vtt"',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,SUBTITLES="subs"',
    '720p/playlist.m3u8',
    '',
  ].join('\n');

  const out = rewriteHls(master, 'https://cdn.test/tv/1-a/S01/E01/master.m3u8', { Referer: 'https://host.test/' });
  const lines = out.split('\n');

  const subUri = lines[1]!.match(/URI="([^"]+)"/)![1]!;
  assert.match(new URL(subUri).pathname, /\/proxy\/vtt\.m3u8$/, 'la piste .vtt doit passer par la playlist synthétique');
  assert.equal(payloadOf(subUri).u, 'https://cdn.test/tv/1-a/S01/E01/subs_fre_forced.vtt');
  // La variante vidéo, elle, reste un flux proxifié normal.
  assert.match(new URL(lines[3]!).pathname, /\/proxy\/s\.m3u8$/);
});

test('rewriteHls laisse une piste sous-titres déjà en .m3u8 telle quelle', () => {
  // Une source bien formée (URI vers une playlist) ne doit pas être enveloppée
  // une deuxième fois.
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="EN",URI="subs/en.m3u8"',
    '',
  ].join('\n');
  const out = rewriteHls(master, 'https://cdn.test/hls/master.m3u8');
  const subUri = out.split('\n')[1]!.match(/URI="([^"]+)"/)![1]!;
  assert.match(new URL(subUri).pathname, /\/proxy\/s\.m3u8$/, 'une playlist .m3u8 reste un flux proxifié normal');
});

test('rewriteHls laisse les lignes vides intactes', () => {
  const out = rewriteHls('#EXTM3U\n\n#EXT-X-ENDLIST\n', 'https://cdn.test/m.m3u8');
  assert.equal(out, '#EXTM3U\n\n#EXT-X-ENDLIST\n');
});

test('isHls ne se fie qu’au corps, jamais à l’extension de l’URL', async () => {
  // Régression vérifiée en conditions réelles : un CDN qui refuse la requête
  // rend une page nginx tout en gardant `.m3u8` dans l'URL. Réécrite comme un
  // manifeste, chaque ligne de HTML devenait un faux lien proxifié et le
  // player recevait une playlist absurde au lieu de l'erreur.
  const errorPage = '<html>\n<head><title>403 Forbidden</title></head>\n<body>\n<center><h1>403 Forbidden</h1></center>\n</body>\n</html>';

  const http = await import('node:http');
  const { app } = await import('./index');

  const origin = http.createServer((_req, res) => {
    res.writeHead(403, { 'content-type': 'text/html' });
    res.end(errorPage);
  });
  const originPort = await new Promise<number>(r =>
    origin.listen(0, '127.0.0.1', () => r((origin.address() as { port: number }).port)));

  const addon = http.createServer(app);
  const addonPort = await new Promise<number>(r =>
    addon.listen(0, '127.0.0.1', () => r((addon.address() as { port: number }).port)));

  process.env.PUBLIC_URL = `http://127.0.0.1:${addonPort}`;
  const { proxify: fresh } = await import('./proxy');

  try {
    const res = await fetch(fresh(`http://127.0.0.1:${originPort}/hls/master.m3u8`));
    const body = await res.text();

    assert.equal(res.status, 403, 'le vrai statut de l’hébergeur doit remonter');
    assert.equal(body, errorPage, 'le corps doit être relayé tel quel');
    assert.ok(!body.includes('/proxy/s'), 'aucune ligne ne doit avoir été réécrite');
  } finally {
    origin.close();
    addon.close();
  }
});
