import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeXshotcok, extractXshotcok } from './xshotcok';

const CLAIR = `\t(function() {\n\t\tvar targetDomains = ['https://xshotcok.com'];\n\t})();\n`
  + `\tvar __setup = { sources: [ { "type":"video/mp4", "file":"https://svrx-cdn.ctmp.world/?uid=AAA&fc=tjjw7gj1hsz6" } ] };\n`
  + 'x'.repeat(300);

/** Rejoue le chiffrement du site : XOR à clé répétée, puis base64 de l'UTF-8. */
function chiffre(clair: string, cle: string): string {
  let xored = '';
  for (let i = 0; i < clair.length; i++) {
    xored += String.fromCharCode(clair.charCodeAt(i) ^ cle.charCodeAt(i % cle.length));
  }
  return Buffer.from(xored, 'utf-8').toString('base64');
}

const bloc = (payload: string, decl: string) =>
  `var _6cd0d1="${payload}";${decl}var _0210ed=_52ad59(_6cd0d1);var _a25304=_92e7f3(_0210ed,_0x3e68eb);eval(_a25304);`;

test('la clé se lit dans le nom de la variable du bloc dépaqueté', () => {
  const unpacked = bloc(chiffre(CLAIR, '_0x3e68eb'), 'var _0x3e68eb=_2e625d();');
  const plain = decodeXshotcok(unpacked);
  assert.ok(plain?.includes('svrx-cdn.ctmp.world'));
});

test('sans ce nom, le clair connu suffit à retrouver la clé', () => {
  // La déclaration nommée est retirée : seule l'attaque à clair connu reste.
  const unpacked = bloc(chiffre(CLAIR, 'unecleplusongue!'), '');
  const plain = decodeXshotcok(unpacked);
  assert.ok(plain?.includes('svrx-cdn.ctmp.world'));
});

test('extractXshotcok pose le Referer du domaine servi', () => {
  const unpacked = bloc(chiffre(CLAIR, '_0x3e68eb'), 'var _0x3e68eb=_2e625d();');
  const s = extractXshotcok(unpacked, 'https://xshotcok.com/embed-tjjw7gj1hsz6.html');
  assert.equal(s?.url, 'https://svrx-cdn.ctmp.world/?uid=AAA&fc=tjjw7gj1hsz6');
  assert.equal(s?.headers.Referer, 'https://xshotcok.com/');
});

test('un bloc sans charge utile ne rend rien', () => {
  assert.equal(decodeXshotcok('var a=1;'), null);
});
