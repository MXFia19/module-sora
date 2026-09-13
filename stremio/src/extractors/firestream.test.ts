import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFirestreamPage, firestreamBlob } from './firestream';

/** Fragment réel de firestream.to/e/gKSBI77S. La page ne porte aucune URL de
 *  média — seulement le jeton à rendre à l'API, et le chemin de celle-ci
 *  concaténé morceau par morceau dans le script. */
const page = `</script>
<script id="token-blob" type="text/plain">DauVKi3MvvXc2/QxLejGTZUotb+QBncHXa578eAUS+rDR1e66jNxMto1lfuWbZ0Q598510Or8lK16QahWTFv1w==</script>
<script>
  function resolveVideoUrls(slug, callback) {
    var blobEl = document.getElementById('token-blob')
    var blob = blobEl ? blobEl.textContent.trim() : ''
    fetch('/api/videos/' + encodeURIComponent(slug) + '/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob: blob })
    })
  }
</script>`;

test('la page se reconnaît au jeton, pas au domaine', () => {
  assert.ok(isFirestreamPage(page));
  assert.equal(isFirestreamPage('<html>un lecteur ordinaire</html>'), false);
});

test('le chemin de l’API est concaténé : ne pas le chercher entier', () => {
  // Le piège qui a coûté une passe : '/api/videos/<slug>/resolve' n'existe
  // nulle part dans la page, les deux moitiés sont séparées par du code.
  assert.doesNotMatch(page, /\/api\/videos\/[^'"]*\/resolve/);
  assert.ok(isFirestreamPage(page));
});

test('le jeton est extrait sans les espaces autour', () => {
  assert.equal(
    firestreamBlob(page),
    'DauVKi3MvvXc2/QxLejGTZUotb+QBncHXa578eAUS+rDR1e66jNxMto1lfuWbZ0Q598510Or8lK16QahWTFv1w==');
  assert.equal(firestreamBlob('<html>rien</html>'), null);
});
