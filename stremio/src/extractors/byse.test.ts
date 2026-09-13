import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { decodeByse, keyParts, isBysePage, type BysePlayback } from './byse';

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Fabrique un bloc `playback` comme le fait le site : trente fragments dont
 *  deux seulement portent la vraie clé, désignés par `version`. */
function forge(version: number, payload: unknown) {
  const real = [crypto.randomBytes(16), crypto.randomBytes(16)];
  const key = Buffer.concat(real);
  const iv = crypto.randomBytes(12);

  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(payload), 'utf-8'), c.final()]);

  const parts = Array.from({ length: 30 }, () => b64url(crypto.randomBytes(16)));
  parts[version - 1] = b64url(real[0]!);
  parts[31 - version - 1] = b64url(real[1]!);

  return {
    algorithm: 'AES-256-GCM',
    iv: b64url(iv),
    payload: b64url(Buffer.concat([body, c.getAuthTag()])),
    key_parts: parts,
    version,
  } satisfies BysePlayback;
}

test('les fragments sont choisis par la version, pas devinés', () => {
  // La table du bundle : l'entrée n vaut [n, 31-n]. La version change à chaque
  // appel de l'API — la supposer constante marche une fois, puis plus jamais.
  const p = forge(7, { sources: [] });
  assert.deepEqual(keyParts(p), [p.key_parts[6], p.key_parts[23]]);
});

test('la charge se déchiffre pour toutes les versions de la table', () => {
  for (const v of [1, 6, 7, 15, 20]) {
    const url = 'https://cdn.invalid/hls2/' + v + '/master.m3u8?t=x';
    const out = decodeByse(forge(v, { sources: [{ url, label: '720p' }] }));
    assert.equal(out.sources[0].url, url, 'version ' + v);
  }
});

test('une version hors table retombe sur tous les fragments', () => {
  // Le code d'origine fait ce repli ; échouer serait plus strict que le site
  // lui-même, et casserait le jour où ils étendent la table.
  const p = forge(7, { sources: [] });
  const inconnue = { ...p, version: 99 };
  assert.equal(keyParts(inconnue).length, 30);
});

test('isBysePage reconnaît la coquille et rien d\'autre', () => {
  assert.equal(isBysePage('<html><head><title>Byse Frontend</title>'), true);
  assert.equal(isBysePage('<html><head><title>Loading...</title>'), false);
});
