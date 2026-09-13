import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeVidsonic } from './vidsonic';

/** Fragment réel de vidsonic.net/e/0x3rjwfmzm9f : hexadécimal coupé par des
 *  « | », décodé puis lu à l'envers. Aucune URL n'est lisible dans la page. */
const page = `
        (function() {
            const _0x1 = '3032323464|6166373866|3565363331|6539623161|3536386137|3131633564|64343d3564|6d2666396d|7a6d66776a|723378303d|64695f656c|6966263534|3232313339|3837313d73|6572697078|6526333d64|695f726576|7265733f38|75336d2e78|65646e692f|34706d2e66|7035736b6d|30636b7173|343263762f|3234362f73|64616f6c70|752f657275|6365732f74|656e2e6369|6e6f736469|762e72662d|31302d7966|732f2f3a73|70747468';
            const _decode = function(s) { /* … */ };
            let _videoUrl = _decode(_0x1);
        })();`;

test('decodeVidsonic reconstitue le manifeste', () => {
  const url = decodeVidsonic(page);
  assert.equal(
    url,
    'https://sfy-01-fr.vidsonic.net/secure/uploads/642/vc24sqkc0mks5pf.mp4/index.m3u8'
    + '?server_id=3&expires=1789312245&file_id=0x3rjwfmzm9f&md5=4dd5c117a865a1b9e136e5f87fad4220');
});

test('une page ordinaire ne produit pas de faux positif', () => {
  assert.equal(decodeVidsonic('<html><body>rien de chiffré ici</body></html>'), null);
  // Une longue suite hexadécimale sans séparateur n'est pas une charge utile.
  assert.equal(decodeVidsonic(`<img data-hash="${'ab'.repeat(120)}">`), null);
});
