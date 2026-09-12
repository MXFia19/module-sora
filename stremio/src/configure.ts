import { ALL_LANGUAGES, ALL_QUALITIES, DEFAULT_CONFIG, decodeConfig } from './userconfig';
import type { Scraper } from './types';

/** Page de configuration : l'utilisateur choisit ses réglages, la page fabrique
 *  son lien d'installation.
 *
 *  Tout se passe dans le navigateur — rien n'est envoyé au serveur, et la
 *  config n'est stockée nulle part. C'est volontaire : la clé TMDB saisie ici
 *  finit dans le lien de l'utilisateur, pas dans une base chez l'hébergeur. */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function configurePage(base: string, scrapers: Scraper[], encoded?: string): string {
  const c = decodeConfig(encoded);
  const sources = scrapers.map(s => ({
    id: s.id,
    name: s.name,
    note: s.animeOnly ? 'anime uniquement' : s.supports.join(' + '),
  }));

  return `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sora — installation</title>
<style>
:root{color-scheme:dark;--bg:#0d1117;--card:#161b22;--line:#30363d;--fg:#e6edf3;--dim:#8b949e;--accent:#3b82f6;--ok:#238636}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1rem;background:var(--bg);color:var(--fg);
 font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:44rem;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 .25rem}
.sub{color:var(--dim);margin:0 0 2rem}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1.25rem;margin-bottom:1rem}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:0 0 1rem;font-weight:600}
label{display:block;margin:.9rem 0 .3rem;font-weight:500}
.hint{color:var(--dim);font-size:.85rem;margin:.3rem 0 0}
input[type=text],select{width:100%;padding:.6rem .7rem;background:#0d1117;color:var(--fg);
 border:1px solid var(--line);border-radius:7px;font:inherit}
input:focus,select:focus{outline:2px solid var(--accent);outline-offset:-1px}
.chips{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}
.chip{display:inline-flex;align-items:center;gap:.4rem;padding:.35rem .7rem;border:1px solid var(--line);
 border-radius:999px;cursor:pointer;user-select:none;font-size:.9rem}
.chip input{margin:0}
.chip:has(input:checked){border-color:var(--accent);background:#132a4d}
.mode{display:block;border:1px solid var(--line);border-radius:9px;padding:.9rem;margin-bottom:.6rem;cursor:pointer}
.mode:has(input:checked){border-color:var(--accent);background:#111c33}
.mode b{display:block;margin-bottom:.2rem}
.mode span{color:var(--dim);font-size:.88rem}
.badge{font-size:.7rem;padding:.1rem .45rem;border-radius:4px;background:#1f6feb33;color:#79c0ff;
 margin-left:.5rem;vertical-align:middle;letter-spacing:.03em}
ol.langs{list-style:none;padding:0;margin:.5rem 0 0}
ol.langs li{display:flex;align-items:center;gap:.6rem;padding:.5rem .7rem;border:1px solid var(--line);
 border-radius:7px;margin-bottom:.4rem;background:#0d1117}
ol.langs .grab{cursor:grab;color:var(--dim)}
ol.langs li.drag{opacity:.4}
.out{background:#0d1117;border:1px solid var(--line);border-radius:7px;padding:.7rem;
 word-break:break-all;font-family:ui-monospace,monospace;font-size:.82rem;margin-top:.5rem}
.row{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.8rem}
button{padding:.6rem 1.1rem;border-radius:7px;border:1px solid var(--line);background:#21262d;
 color:var(--fg);font:inherit;cursor:pointer}
button.primary{background:var(--ok);border-color:var(--ok)}
button:hover{filter:brightness(1.15)}
.warn{background:#3d2b0c;border:1px solid #9e6a03;border-radius:8px;padding:.8rem;margin-top:1rem;font-size:.88rem}
a{color:#79c0ff}
</style>
<main>
<h1>Sora</h1>
<p class="sub">Réglez, puis copiez votre lien d'installation Stremio.</p>

<section>
  <h2>Livraison des flux</h2>
  <label class="mode"><input type="radio" name="mode" value="direct"${c.mode === 'direct' ? ' checked' : ''}>
    <b>Direct — sans proxy<span class="badge">RECOMMANDÉ</span></b>
    <span>Stremio lit directement depuis les CDN. Aucune bande passante côté serveur.
    Les rares flux qui exigent un proxy ne sont pas proposés.</span></label>
  <label class="mode"><input type="radio" name="mode" value="proxy"${c.mode === 'proxy' ? ' checked' : ''}>
    <b>Via le proxy de l'instance</b>
    <span>Ajoute les flux dont l'hébergeur exige un Referer précis. Plus de sources,
    mais chaque octet transite par le serveur — demandez à son hébergeur avant.</span></label>
</section>

<section>
  <h2>Votre clé TMDB</h2>
  <p class="hint">Elle sert à retrouver titres, saisons et épisodes. Gratuite en deux minutes sur
  <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org → Paramètres → API</a>.
  Les deux formats marchent : clé v3 (32 caractères) ou jeton v4 (eyJ…).</p>
  <label for="key">Clé TMDB</label>
  <input type="text" id="key" placeholder="clé v3 ou jeton v4" value="${esc(c.tmdbKey ?? '')}">
  <p class="hint">En apporter une vous rend indépendant du quota de l'hébergeur. Laissez vide
  pour utiliser le sien, s'il l'autorise.</p>
</section>

<section>
  <h2>Sources</h2>
  <div class="chips">
    ${sources.map(s => `<label class="chip"><input type="checkbox" class="src" value="${s.id}"${
      c.sources.length === 0 || c.sources.includes(s.id) ? ' checked' : ''}>${esc(s.name)}
      <span class="hint">${esc(s.note)}</span></label>`).join('\n    ')}
  </div>
  <p class="hint">Tout décocher revient à tout activer. Moins de sources = réponse plus rapide.</p>
</section>

<section>
  <h2>Qualités, tri et langues</h2>

  <label>Qualités à afficher</label>
  <div class="chips">
    ${ALL_QUALITIES.map(q => `<label class="chip"><input type="checkbox" class="q" value="${q}"${
      c.qualities.includes(q) ? ' checked' : ''}>${q}</label>`).join('\n    ')}
  </div>
  <p class="hint">« HD » = source qui n'annonce pas sa résolution (movix, coflix…).</p>

  <label for="pq">Qualité préférée — remontée en tête</label>
  <select id="pq">
    <option value="">aucune</option>
    ${ALL_QUALITIES.map(q => `<option value="${q}"${c.preferredQuality === q ? ' selected' : ''}>${q}</option>`).join('\n    ')}
  </select>

  <label for="sort">Priorité de tri</label>
  <select id="sort">
    <option value="lang"${c.sort === 'lang' ? ' selected' : ''}>Langue puis qualité</option>
    <option value="quality"${c.sort === 'quality' ? ' selected' : ''}>Qualité puis langue</option>
  </select>

  <label for="min">Réponse rapide — rendre la main dès ce nombre de flux</label>
  <select id="min">
    <option value="0"${c.minStreams === 0 ? ' selected' : ''}>Attendre toutes les sources</option>
    ${[3, 5, 8, 12].map(n => `<option value="${n}"${c.minStreams === n ? ' selected' : ''}>${n} flux${n === 5 ? ' — recommandé' : ''}</option>`).join('\n    ')}
  </select>
  <p class="hint">Une seule source lente peut faire attendre 25 s alors que quatre autres ont déjà
  répondu. Les retardataires continuent en arrière-plan : la fois suivante, la liste est complète.</p>

  <label for="fb">Si aucun flux ne correspond à vos filtres</label>
  <select id="fb">
    <option value="souple"${c.fallback === 'souple' ? ' selected' : ''}>Montrer les meilleurs flux dispos (souple)</option>
    <option value="strict"${c.fallback === 'strict' ? ' selected' : ''}>Ne rien montrer (strict)</option>
  </select>
  <p class="hint">Souple relâche la langue mais garde vos exclusions de qualité : personne ne veut
  du 360p sous prétexte qu'il n'y a rien d'autre.</p>

  <label>Ordre des langues — glissez pour réordonner, décochez pour exclure</label>
  <ol class="langs" id="langs">
    ${(() => {
      const rest = ALL_LANGUAGES.filter(l => !c.languages.includes(l));
      return [...c.languages, ...rest].map(l => `<li draggable="true" data-lang="${l}">
      <span class="grab">⠿</span>
      <input type="checkbox"${c.languages.includes(l) ? ' checked' : ''}>
      <b>${l}</b></li>`).join('\n    ');
    })()}
  </ol>
</section>

<section>
  <h2>Pseudo — facultatif</h2>
  <input type="text" id="nick" maxlength="24" placeholder="pour que l'hébergeur vous identifie si vous signalez un souci"
    value="${esc(c.nickname ?? '')}">
</section>

<section>
  <h2>Votre lien</h2>
  <div class="out" id="url"></div>
  <div class="row">
    <button class="primary" id="install">Installer dans Stremio</button>
    <button id="copy">Copier le lien</button>
  </div>
  <div class="warn" id="warn" hidden></div>
</section>
</main>
<script>
const BASE = ${JSON.stringify(base)};
const $ = s => document.querySelector(s);
const all = s => [...document.querySelectorAll(s)];

function langs() {
  return all('#langs li').filter(li => li.querySelector('input').checked)
    .map(li => li.dataset.lang);
}

function build() {
  const cfg = {
    m: $('[name=mode]:checked').value,
    l: langs(),
    q: all('.q').filter(i => i.checked).map(i => i.value),
    s: $('#sort').value,
    f: $('#fb').value,
  };
  const min = Number($('#min').value);
  if (min > 0) cfg.min = min;
  const key = $('#key').value.trim();
  if (key) cfg.k = key;
  const pq = $('#pq').value;
  if (pq) cfg.pq = pq;
  const nick = $('#nick').value.trim();
  if (nick) cfg.n = nick;

  const src = all('.src').filter(i => i.checked).map(i => i.value);
  if (src.length && src.length < all('.src').length) cfg.src = src;

  // base64url, comme côté serveur.
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(cfg))))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  return BASE + '/c/' + b64 + '/manifest.json';
}

function refresh() {
  const url = build();
  $('#url').textContent = url;

  const msgs = [];
  if (!$('#key').value.trim())
    msgs.push("Sans clé TMDB, l'addon dépend de celle de l'hébergeur — qui peut ne pas en fournir.");
  if (langs().length === 0)
    msgs.push('Aucune langue cochée : aucun flux ne passera le filtre.');
  if (all('.q').every(i => !i.checked))
    msgs.push('Aucune qualité cochée : aucun flux ne passera le filtre.');
  if ($('#key').value.trim())
    msgs.push('Votre clé TMDB est inscrite dans ce lien : ne le partagez pas.');

  $('#warn').hidden = msgs.length === 0;
  $('#warn').innerHTML = msgs.map(m => '⚠️ ' + m).join('<br>');
}

document.addEventListener('input', refresh);
document.addEventListener('change', refresh);

$('#install').addEventListener('click', () => {
  // Le schéma stremio:// ouvre l'application sur la fenêtre d'installation.
  location.href = build().replace(/^https?:\\/\\//, 'stremio://');
});

$('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(build());
    $('#copy').textContent = 'Copié ✓';
    setTimeout(() => ($('#copy').textContent = 'Copier le lien'), 1500);
  } catch {
    // clipboard indisponible (page non sécurisée) : on sélectionne, l'utilisateur copie.
    const r = document.createRange();
    r.selectNodeContents($('#url'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  }
});

// Réordonnancement des langues par glisser-déposer.
let dragged = null;
const list = $('#langs');
list.addEventListener('dragstart', e => {
  dragged = e.target.closest('li');
  dragged.classList.add('drag');
});
list.addEventListener('dragend', () => {
  dragged?.classList.remove('drag');
  dragged = null;
  refresh();
});
list.addEventListener('dragover', e => {
  e.preventDefault();
  const over = e.target.closest('li');
  if (!over || !dragged || over === dragged) return;
  const after = over.getBoundingClientRect().top + over.offsetHeight / 2 < e.clientY;
  list.insertBefore(dragged, after ? over.nextSibling : over);
});

refresh();
</script>
</html>`;
}
