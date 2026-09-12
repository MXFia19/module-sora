import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Test d'intégration du proxy : un vrai serveur d'origine exigeant un
 *  Referer, un vrai addon devant, et une vraie requête HTTP entre les deux.
 *
 *  C'est le chemin que Stremio emprunte à la lecture. Les tests unitaires
 *  vérifient la signature et la réécriture ; celui-ci vérifie que les headers
 *  arrivent réellement chez l'hébergeur — c'est-à-dire la raison d'être du
 *  proxy. */

// Doit être posé avant le premier import des modules applicatifs.
process.env.PROXY_SECRET = 'secret-de-test';
process.env.PROXY_ENABLED = 'true';

const REQUIRED_REFERER = 'https://hebergeur.test/';

let originServer: http.Server;
let addonServer: http.Server;
let originBase = '';
let proxify: (url: string, headers?: Record<string, string>) => string;

function listen(server: http.Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

before(async () => {
  // Origine : refuse tout ce qui n'a pas le bon Referer, comme le ferait un
  // hébergeur réel.
  originServer = http.createServer((req, res) => {
    if (req.headers.referer !== REQUIRED_REFERER) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('referer manquant');
      return;
    }

    if (req.url === '/hls/master.m3u8') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720/index.m3u8\n');
      return;
    }
    if (req.url === '/hls/720/index.m3u8') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXTINF:10.0,\nseg1.ts\n#EXT-X-ENDLIST\n');
      return;
    }
    if (req.url === '/hls/720/seg1.ts') {
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      res.end(Buffer.from('charge-utile-du-segment'));
      return;
    }
    res.writeHead(404).end();
  });

  const originPort = await listen(originServer);
  originBase = `http://127.0.0.1:${originPort}`;

  const { app } = await import('./index');
  addonServer = http.createServer(app);
  const addonPort = await listen(addonServer);
  process.env.PUBLIC_URL = `http://127.0.0.1:${addonPort}`;

  ({ proxify } = await import('./proxy'));
});

after(() => {
  originServer?.close();
  addonServer?.close();
});

test('le proxy réinjecte le Referer exigé par l’hébergeur', async () => {
  // Sans proxy, Stremio taperait l'origine sans Referer et prendrait un 403.
  const direct = await fetch(`${originBase}/hls/master.m3u8`);
  assert.equal(direct.status, 403);

  const res = await fetch(proxify(`${originBase}/hls/master.m3u8`, { Referer: REQUIRED_REFERER }));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /^#EXTM3U/);
});

test('la chaîne HLS entière passe par le proxy, jusqu’au segment', async () => {
  const master = await fetch(proxify(`${originBase}/hls/master.m3u8`, { Referer: REQUIRED_REFERER }));
  const masterBody = await master.text();

  // La variante doit avoir été réécrite en URL absolue vers le proxy.
  const variantUrl = masterBody.split('\n').find(l => l.startsWith('http'));
  assert.ok(variantUrl, `variante non réécrite:\n${masterBody}`);

  const variant = await fetch(variantUrl);
  assert.equal(variant.status, 200);
  const variantBody = await variant.text();

  const segUrl = variantBody.split('\n').find(l => l.startsWith('http'));
  assert.ok(segUrl, `segment non réécrit:\n${variantBody}`);

  const seg = await fetch(segUrl);
  assert.equal(seg.status, 200);
  assert.equal(await seg.text(), 'charge-utile-du-segment');
});

test('une signature falsifiée est refusée', async () => {
  // Sans cette vérification, l'addon relaierait n'importe quelle cible pour
  // n'importe qui.
  const url = new URL(proxify(`${originBase}/hls/master.m3u8`, { Referer: REQUIRED_REFERER }));
  url.searchParams.set('t', 'signature-bidon');

  const res = await fetch(url);
  assert.equal(res.status, 403);
});

test('un payload modifié invalide la signature', async () => {
  const url = new URL(proxify(`${originBase}/hls/master.m3u8`, { Referer: REQUIRED_REFERER }));
  const forged = Buffer.from(JSON.stringify({
    u: 'http://cible-interne.test/secret',
    e: Date.now() + 60_000,
  })).toString('base64url');
  url.searchParams.set('d', forged);

  const res = await fetch(url);
  assert.equal(res.status, 403);
});

test('un lien expiré est refusé même correctement signé', async () => {
  process.env.PROXY_TTL_MS = '-1000';
  const { proxify: freshProxify } = await import('./proxy');
  const expired = freshProxify(`${originBase}/hls/master.m3u8`, { Referer: REQUIRED_REFERER });
  delete process.env.PROXY_TTL_MS;

  const res = await fetch(expired);
  assert.equal(res.status, 403);
});
