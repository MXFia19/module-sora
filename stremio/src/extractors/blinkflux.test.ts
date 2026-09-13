import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlinkfluxPage, blinkfluxUnlock } from './blinkflux';

/** Fragment réel de la page servie par movix pour Le Labyrinthe. Ce qui
 *  compte : aucune URL de média n'y figure, et les « / » du payload sont
 *  échappés à la mode JS — les renvoyer tels quels fait refuser l'appel. */
const page = `<!DOCTYPE html><html lang="fr"><head><title>BlinkFlux - Le Labyrinthe</title></head><body>
<script>
  let VIDEO_URL    = null;
  const ENCRYPTED_PAYLOAD = "JZNiZMal0UITiXCn+nJuHPNRWBWYlOh0iWcrh5JJox\\/OjHb7uD1h1hhc+r9TTS3moUYYFCPRSUR+qciu+Lt8fg==";
  const ENCRYPTED_IV      = "5cd7eb8b4a25b1e7d61b4279b7552b4d";
  const TITLE      = "Le Labyrinthe";
  function requestUnlock(token) {
    const apiKey = new URLSearchParams(window.location.search).get('api_key') || '';
    fetch('/api/v1/index.php?route=unlock&api_key=' + apiKey, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ token: token || '', payload: ENCRYPTED_PAYLOAD, iv: ENCRYPTED_IV })
    }).then(res => res.json()).then(data => { VIDEO_URL = data.url; });
  }
</script></body></html>`;

const KEY = 'ff_5ae9661d6220e612a00645cb2889d6da5231504cbb68cc32214030b1a783e8e3';
const PAGE_URL = `https://blinkflux.lol/api/v1/index.php?route=movies/198663/player&api_key=${KEY}`;

test('la page se reconnaît à son bloc chiffré, pas à son domaine', () => {
  assert.ok(isBlinkfluxPage(page));
  assert.equal(isBlinkfluxPage('<html>un lecteur ordinaire</html>'), false);
});

test('le payload est déséchappé et la clé relue dans l’URL', () => {
  const u = blinkfluxUnlock(PAGE_URL, page);
  assert.ok(u);
  assert.equal(u.key, KEY);
  assert.equal(u.iv, '5cd7eb8b4a25b1e7d61b4279b7552b4d');
  assert.doesNotMatch(u.payload, /\\\//, 'les « / » échappés doivent être rendus littéraux');
  assert.match(u.payload, /ox\/OjHb7uD1h1hhc/);
});

test('sans clé d’API dans l’URL, la page la fournit', () => {
  const u = blinkfluxUnlock('https://blinkflux.lol/lecteur', page.replace('api_key=\' + apiKey', `api_key=${KEY}'`));
  assert.equal(u?.key, KEY);
});

test('une page sans bloc chiffré ne rend rien', () => {
  assert.equal(blinkfluxUnlock(PAGE_URL, '<html>rien</html>'), null);
});
