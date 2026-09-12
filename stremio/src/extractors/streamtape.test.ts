import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamtapeLink } from './voe';

/** Les deux découpages réellement servis par streamtape.com, relevés le même
 *  jour sur deux vidéos du même film. C'est leur différence qui compte : la
 *  coupure se déplace, et « /get_video » change de côté. */
const page = (assign: string) => `
  <html><body>
    <div id="ideoolink"></div><div id="botlink"></div><div id="robotlink"></div>
    <script>
      document.getElementById('ideoolink').innerHTML = "/streamtape.com" + ''+ ('xcdb/get_video?id=LEURRE&token=zz').substring(1).substring(2);
      document.getElementById('botlink').innerHTML = '//streamtape.co'+ ('xyzam/get_video?id=LEURRE2&token=zz').substring(4);
      ${assign}
    </script>
  </body></html>`;

test('coupure laissant /get_video dans la chaîne rognée', () => {
  const html = page(
    `document.getElementById('robotlink').innerHTML = '//strea'+ ('xcdmtape.com/get_video?id=AAA&expires=1&token=t1').substring(2).substring(1);`,
  );
  assert.equal(
    streamtapeLink(html),
    'https://streamtape.com/get_video?id=AAA&expires=1&token=t1&dl=1',
  );
});

test('coupure laissant /get_video dans le préfixe littéral', () => {
  // Régression : cette forme rendait null, donc un flux sur deux disparaissait
  // selon la page servie — la VF passait, la VOSTFR non, ou l'inverse.
  const html = page(
    `document.getElementById('robotlink').innerHTML = '//streamtape.co'+ ('xcdm/get_video?id=BBB&expires=2&token=t2').substring(2).substring(1);`,
  );
  assert.equal(
    streamtapeLink(html),
    'https://streamtape.com/get_video?id=BBB&expires=2&token=t2&dl=1',
  );
});

test('les leurres ne sont jamais retenus', () => {
  const html = page(
    `document.getElementById('robotlink').innerHTML = '//strea'+ ('xcdmtape.com/get_video?id=VRAI&token=t').substring(2).substring(1);`,
  );
  const url = streamtapeLink(html);
  assert.ok(url);
  assert.ok(url.includes('id=VRAI'));
  assert.ok(!url.includes('LEURRE'));
});

test('une page sans lien ne produit rien', () => {
  assert.equal(streamtapeLink('<html><body>Please disable your adblocker!</body></html>'), null);
});
