import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, identityKey } from './display';

const stream = (url: string) => ({ url, quality: 'HD', language: 'VF', server: 'x' });

test("identityKey ignore les paramètres de signature", () => {
  const a = identityKey('https://dv97.sibnet.ru/47/85/90/4785909.mp4?st=AAA&e=1&stor=32');
  const b = identityKey('https://dv97.sibnet.ru/47/85/90/4785909.mp4?st=BBB&e=2&stor=46');
  assert.equal(a, b);
});

test("identityKey garde ce qui désigne le fichier", () => {
  // Régression : Streamtape sert toutes ses vidéos sur /get_video, seul `id`
  // sépare la VF de la VOSTFR. En jetant toute la query, l'une des deux
  // disparaissait de la liste.
  const vf = identityKey('https://streamtape.com/get_video?id=AAA&expires=1&token=x&dl=1');
  const vostfr = identityKey('https://streamtape.com/get_video?id=BBB&expires=2&token=y&dl=1');
  assert.notEqual(vf, vostfr);

  const rejoue = identityKey('https://streamtape.com/get_video?id=AAA&expires=9&token=z&dl=1');
  assert.equal(vf, rejoue);
});

test('dedupe garde le premier de deux flux identiques', () => {
  const out = dedupe([
    stream('https://host.tld/a.mp4?t=1'),
    stream('https://host.tld/a.mp4?t=2'),
    stream('https://streamtape.com/get_video?id=A&token=1'),
    stream('https://streamtape.com/get_video?id=B&token=2'),
  ]);
  assert.equal(out.length, 3);
});
