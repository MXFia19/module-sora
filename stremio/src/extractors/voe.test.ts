import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeVoe } from './voe';

/** Encodeur VOE : l'inverse exact du décodeur. Il n'existe que pour les
 *  tests — il permet de vérifier la chaîne de déchiffrement sans dépendre de
 *  la disponibilité de voe.sx, et de fixer le comportement attendu le jour où
 *  quelqu'un retouchera decodeVoe. */
function encodeVoe(payload: unknown): string {
  const json = JSON.stringify(payload);
  const step5 = Buffer.from(json, 'binary').toString('base64');
  const step4 = [...step5].reverse().join('');
  const step3 = [...step4].map(c => String.fromCharCode(c.charCodeAt(0) + 3)).join('');
  const step2 = Buffer.from(step3, 'binary').toString('base64');
  // rot13 est sa propre réciproque : l'appliquer ici suffit.
  return step2.replace(/[a-zA-Z]/g, c => {
    const code = c.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function page(encoded: string): string {
  return `<html><head><script type="application/json">["${encoded}"]</script></head></html>`;
}

test('decodeVoe remonte direct_access_url à travers toute la chaîne', () => {
  const url = 'https://delivery.voe-network.test/engine/hls2/01/00042/master.m3u8?t=abc';
  const html = page(encodeVoe({ direct_access_url: url }));
  assert.equal(decodeVoe(html), url);
});

test('decodeVoe accepte la variante où l’URL est dans source[]', () => {
  const url = 'https://delivery.voe-network.test/engine/hls2/02/x/index.m3u8';
  const html = page(encodeVoe({ source: [{ label: '720p' }, { direct_access_url: url }] }));
  assert.equal(decodeVoe(html), url);
});

test('decodeVoe rend null sans planter quand la page a changé de forme', () => {
  assert.equal(decodeVoe('<html>plus de script json</html>'), null);
  assert.equal(decodeVoe(page('pas-du-base64-valide!!')), null);
});
