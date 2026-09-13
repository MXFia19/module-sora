import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFsvid } from './fsvid';

/** Fragment réel de fsvid.lol/embed-lxs17rvb2sr8.html.
 *
 *  Ce qui compte : la page contient DEUX URLs de média. Le leurre en clair —
 *  il s'appelle littéralement « troll » — et la vraie, chiffrée. Une
 *  recherche générique ramasse le leurre, et c'est ce que l'addon servait. */
const page = `var _fsvHls="https://s1.fsvid.lol/troll/master.m3u8";try{document.cookie="fsv_pe=1; domain=.fsvid.lol; path=/; secure; samesite=none; max-age=86400"}catch(e){}var player=videojs('vjsplayer',{sources:[{src:(function(s){var h=(location&&location.hostname)||"",H=0;for(var j=0;j<h.length;j++){H=(H+h.charCodeAt(j))&255}var b=atob(s),a=b.split("").reverse().join(""),r="";for(var i=0;i<a.length;i++){var kk=(0x3d+i*89+H)&255;r+=String.fromCharCode(a.charCodeAt(i)^kk)}return/^https?:/.test(r)?r:"https://s1.fsvid.lol/troll/master.m3u8"})("2a1HraMc/UocoUkvjFU4h2g9wWjFrHfcqQW6oBjgTxbwQi6GUj2OKSfPJ5T3dajlCpWyXuIkaPs3VvIHNPxqOpFihPsCq+p7g8lovRtSqiN3sSpiiCg8kiTL8mif8U+R6F34EXr0AWnzCnnEajXYKpWPd92lDNOlAOhQFL4Yc+0Ff9twYcUlicdm3uUSy7FBqfRTpg=="),type:"application/x-mpegURL"}],poster:"",controlBar:{children:['playToggle','volumePanel']}});`;

const EMBED = 'https://fsvid.lol/embed-lxs17rvb2sr8.html';

test('decodeFsvid rend la vraie URL, pas le leurre', () => {
  const url = decodeFsvid(page, EMBED);
  assert.ok(url, 'le déchiffrement doit aboutir');
  assert.match(url, /^https:\/\/s1\.fsvid\.lol\/hls2\/01\/00030\/lxs17rvb2sr8_o\/master\.m3u8\?/);
  assert.doesNotMatch(url, /troll/);
});

test("un hôte qui ne correspond pas ne rend rien plutôt que le leurre", () => {
  // La clé dérive de location.hostname : servi depuis un autre domaine, le
  // script lui-même retomberait sur le leurre. On préfère ne rien rendre.
  assert.equal(decodeFsvid(page, 'https://autre-domaine.invalid/embed-x.html'), null);
});

test('une page sans charge utile ne rend rien', () => {
  assert.equal(decodeFsvid('<html>rien ici</html>', EMBED), null);
});

test('le déchiffrement sert d’identification : vidzy.org est du fsvid', () => {
  // vidzy.org sert tantôt un enrobage, tantôt le lecteur fsvid lui-même.
  // L'aiguiller par son nom revenait à choisir la mauvaise moitié du temps ;
  // la graine vient de location.hostname, donc du domaine qui SERT la page.
  const pageVidzy = page.replace(/fsvid\.lol/g, 'vidzy.org');
  // La graine change avec l'hôte : la charge utile d'origine ne peut pas
  // donner d'URL sous un autre nom, et c'est exactement le garde-fou voulu.
  assert.equal(decodeFsvid(pageVidzy, 'https://vidzy.org/embed-x.html'), null);
});

test('une page ordinaire ne déclenche jamais le décodeur', () => {
  // Il tourne désormais sur CHAQUE page du chemin générique : un faux positif
  // coûterait un flux mort à l'utilisateur.
  assert.equal(decodeFsvid('<html><body>un lecteur ordinaire</body></html>', 'https://autre.invalid/e/x'), null);
  assert.equal(decodeFsvid('<script>var a=atob("aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8=")</script>',
    'https://autre.invalid/e/x'), null);
});
