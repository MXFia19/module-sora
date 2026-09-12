import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey } from './nakanime';

/** Chiffre comme le ferait le serveur : le XOR est symétrique, donc cette
 *  fonction sert aussi de déchiffreur de référence. */
function xor(data: Buffer, key: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! ^ key[i % key.length]!;
  return out;
}

test('deriveKey rend 32 octets et dépend de la route', () => {
  const a = deriveKey('/api/catalog/search?q=naruto');
  const b = deriveKey('/api/catalog/search?q=bleach');

  assert.equal(a.length, 32);
  assert.notDeepEqual([...a], [...b], 'deux routes ne doivent pas partager une clé');
  assert.deepEqual([...deriveKey('/api/x')], [...deriveKey('/api/x')], 'la dérivation doit être stable');
});

test('la clé déchiffre ce que la même route a chiffré', () => {
  const route = '/api/sources/anime';
  const payload = JSON.stringify([{ host: 'vidmoly', language: 'VOSTFR', url: 'https://vidmoly.to/embed-x.html' }]);

  const key = deriveKey(route);
  const cipher = xor(Buffer.from(payload, 'utf-8'), key);
  assert.notEqual(cipher.toString('utf-8'), payload, 'le chiffré ne doit pas être lisible');

  const plain = xor(cipher, key).toString('utf-8');
  assert.deepEqual(JSON.parse(plain), JSON.parse(payload));
});

test('une clé dérivée d’une autre route ne déchiffre pas', () => {
  const payload = '{"data":[{"id":42}]}';
  const cipher = xor(Buffer.from(payload, 'utf-8'), deriveKey('/api/route/a'));
  const wrong = xor(cipher, deriveKey('/api/route/b')).toString('utf-8');
  assert.notEqual(wrong, payload);
});
