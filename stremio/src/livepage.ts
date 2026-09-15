/** Console en direct : ce que le serveur fait, pendant qu'on s'en sert.
 *
 *  Pensée pour être ouverte sur un écran pendant qu'on manipule Stremio sur
 *  un autre appareil. Les requêtes apparaissent comme des cartes dépliables,
 *  et le détail technique reste replié tant qu'on n'en a pas besoin.
 *
 *  Le journal garde TOUT ce que le serveur envoie et ne filtre qu'à
 *  l'affichage. C'est ce qui permet de resserrer ou d'élargir la vue après
 *  coup : filtrer à la réception, comme on le faisait, revenait à jeter ce
 *  qu'on allait vouloir relire. */
export function livePage(): string {
  return `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sora — console</title>
<style>
:root{color-scheme:dark;--bg:#0d1117;--card:#161b22;--line:#30363d;--fg:#e6edf3;--dim:#8b949e;
 --ok:#3fb950;--warn:#d29922;--err:#f85149;--accent:#3b82f6}
*{box-sizing:border-box}
body{margin:0;padding:1rem;background:var(--bg);color:var(--fg);
 font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:60rem;margin:0 auto}
header{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem}
h1{font-size:1.3rem;margin:0}
.live{display:inline-flex;align-items:center;gap:.4rem;font-size:.85rem;color:var(--dim)}
.led{width:8px;height:8px;border-radius:50%;background:var(--err)}
.led.on{background:var(--ok);animation:p 2s infinite}
@keyframes p{50%{opacity:.35}}
.sp{flex:1}
button,select,input{padding:.4rem .7rem;border-radius:7px;border:1px solid var(--line);background:#21262d;
 color:var(--fg);font:inherit}
button{cursor:pointer}
button:hover{border-color:var(--dim)}
button.on{border-color:var(--accent);background:#132a4d}
button.danger:hover{border-color:var(--err);color:var(--err)}
input[type=search]{background:#0d1117;min-width:11rem;flex:1}
.hint{color:var(--dim);font-size:.85rem;margin:0 0 1rem}
.req{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);
 border-radius:8px;margin-bottom:.6rem;overflow:hidden}
.req.zero{border-left-color:var(--err)}
.req.cache{border-left-color:var(--dim)}
.rh{display:flex;align-items:center;gap:.6rem;padding:.7rem .9rem;cursor:pointer;flex-wrap:wrap}
.rh:hover{background:#1c2128}
.rh .ti{font-weight:600}
.rh .id{color:var(--dim);font-size:.82rem;font-family:ui-monospace,monospace}
.rb{border-top:1px solid var(--line);padding:.7rem .9rem;display:none}
.req.open .rb{display:block}
.badge{font-size:.72rem;padding:.12rem .45rem;border-radius:4px;background:#21262d;color:var(--dim);white-space:nowrap}
.badge.g{background:#12261a;color:var(--ok)} .badge.r{background:#2a1315;color:var(--err)}
.badge.o{background:#2b220c;color:var(--warn)}
.src{display:flex;gap:.5rem;align-items:center;padding:.2rem 0;font-size:.85rem}
.src .n{width:8rem;color:var(--dim)}
.bar{height:6px;border-radius:3px;background:var(--ok);min-width:2px}
.bar.z{background:#30363d} .bar.e{background:var(--err)}
.tools{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin:.6rem 0}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:1.4rem 0 0}
pre{background:#0d1117;border:1px solid var(--line);border-radius:7px;padding:.6rem;margin:0;
 overflow:auto;max-height:30rem;font-size:.76rem;line-height:1.5;
 font-family:ui-monospace,SFMono-Regular,monospace}
pre div{white-space:pre-wrap;word-break:break-all}
.debug{color:#6e7681} .info{color:var(--fg)} .warn{color:var(--warn)} .error{color:var(--err)}
.sc{color:#79c0ff;cursor:pointer}
.sc:hover{text-decoration:underline}
mark{background:#3b2f0b;color:#ffd75f;border-radius:2px}
.empty{color:var(--dim);text-align:center;padding:2rem}
.toast{position:fixed;bottom:1.2rem;left:50%;transform:translateX(-50%);background:#21262d;
 border:1px solid var(--line);border-radius:8px;padding:.6rem 1.1rem;opacity:0;
 transition:opacity .3s;pointer-events:none;z-index:9}
.toast.show{opacity:1}
</style>
<main>
<header>
  <h1>Console</h1>
  <span class="live"><span class="led" id="led"></span><span id="state">connexion…</span></span>
  <span class="sp"></span>
  <button id="cache" class="danger" title="Oblige les sources à tout re-chercher à la prochaine requête">Vider le cache <span class="badge" id="centries">?</span></button>
  <a href="/debug" style="color:#79c0ff;font-size:.85rem">diagnostic →</a>
</header>
<p class="hint">Laissez cette page ouverte et utilisez Stremio sur votre téléphone :
chaque requête apparaît ici, avec ce que chaque source a rendu.</p>

<div id="reqs"></div>

<h2>Journal</h2>
<div class="tools">
  <input type="search" id="q" placeholder="filtrer : movix, 403, m3u8…" autocomplete="off">
  <select id="lvl">
    <option value="debug">Tout</option>
    <option value="info" selected>info et plus</option>
    <option value="warn">avertissements</option>
    <option value="error">erreurs</option>
  </select>
  <button id="pause">Pause</button>
  <button id="copy">Copier</button>
  <button id="clear">Effacer</button>
  <span class="badge" id="count">0 ligne</span>
</div>
<pre id="raw"></pre>
</main>
<div class="toast" id="toast"></div>
<script>
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const RANK = { debug: 10, info: 20, warn: 30, error: 40 };
const KEEP = 3000;
let paused = false;
let logs = [];

function hhmmss(t) { return new Date(t).toLocaleTimeString('fr-FR'); }

/* La date, pas seulement l'heure : le journal survit maintenant aux
   redémarrages, donc une ligne à « 17:10:26 » peut dater d'avant-hier. Le jour
   n'est affiché que s'il n'est pas aujourd'hui — l'écrire sur chaque ligne
   d'une session en cours n'apporterait rien et mangerait la largeur. */
const AUJOURDHUI = new Date().toDateString();

function quand(t) {
  const d = new Date(t);
  const jour = d.toDateString() === AUJOURDHUI
    ? ''
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ';
  return jour + d.toLocaleTimeString('fr-FR');
}

/** Date complète, pour les infobulles et le presse-papier. */
function quandComplet(t) {
  return new Date(t).toLocaleString('fr-FR',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._id);
  t._id = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- requêtes ---------- */

function addRequest(r) {
  if ($('#reqs .empty')) $('#reqs').innerHTML = '';

  const zero = r.shown === 0;
  const el = document.createElement('div');
  el.className = 'req' + (zero ? ' zero' : '') + (r.cached ? ' cache' : '');

  const sources = r.sources.map(s => {
    const failed = s.count < 0;
    const w = Math.min(100, Math.round(s.ms / 150));
    return '<div class="src"><span class="n">' + esc(s.name) + '</span>' +
      '<span class="bar' + (failed ? ' e' : s.count === 0 ? ' z' : '') + '" style="width:' + Math.max(w, 2) + 'px"></span>' +
      '<span class="badge' + (failed ? ' r' : s.count > 0 ? ' g' : ' o') + '">' +
      (failed ? 'échec' : s.count + ' flux') + '</span>' +
      '<span class="badge">' + s.ms + 'ms</span></div>';
  }).join('') || '<p class="hint" style="margin:0">Servi depuis le cache, aucune source interrogée.</p>';

  el.innerHTML =
    '<div class="rh">' +
      '<span class="badge" title="' + quandComplet(r.at) + '">' + quand(r.at) + '</span>' +
      '<span class="ti">' + esc(r.title || r.id) + '</span>' +
      '<span class="id">' + esc(r.id) + '</span>' +
      (r.nickname ? '<span class="badge">' + esc(r.nickname) + '</span>' : '') +
      '<span class="sp"></span>' +
      (r.cached ? '<span class="badge">cache</span>' : '') +
      '<span class="badge' + (zero ? ' r' : ' g') + '">' + r.shown + '/' + r.total + ' flux</span>' +
      '<span class="badge">' + r.ms + 'ms</span>' +
      '<span class="badge">' + esc(r.client) + '</span>' +
    '</div><div class="rb">' + sources + '</div>';

  el.querySelector('.rh').addEventListener('click', () => el.classList.toggle('open'));
  if (zero) el.classList.add('open');

  $('#reqs').prepend(el);
  while ($('#reqs').children.length > 40) $('#reqs').lastElementChild.remove();
}

/* ---------- journal ---------- */

function visible() {
  const min = RANK[$('#lvl').value];
  const q = $('#q').value.trim().toLowerCase();
  return logs.filter(l =>
    RANK[l.level] >= min &&
    (q === '' || (l.scope + ' ' + l.message).toLowerCase().indexOf(q) >= 0));
}

function lineHtml(l, q) {
  let msg = esc(l.message);
  if (q) {
    // Surligner sans casser les entités : on ne cherche que dans le texte
    // déjà échappé, et la requête l'est aussi.
    const needle = esc(q).replace(/[.*+?^\${}()|[\]\\\\]/g, '\\\\$&');
    msg = msg.replace(new RegExp(needle, 'gi'), m => '<mark>' + m + '</mark>');
  }
  return '<span class="sc" data-s="' + esc(l.scope) + '" title="' + quandComplet(l.at) + '">' +
    quand(l.at) + ' ' + esc(l.scope) + '</span>  ' + msg;
}

function renderLogs(keepScroll) {
  const raw = $('#raw');
  const atBottom = raw.scrollHeight - raw.scrollTop - raw.clientHeight < 40;
  const q = $('#q').value.trim().toLowerCase();
  const rows = visible();

  raw.innerHTML = rows.map(l => '<div class="' + l.level + '">' + lineHtml(l, q) + '</div>').join('');
  $('#count').textContent = rows.length + ' ligne' + (rows.length > 1 ? 's' : '') +
    (rows.length < logs.length ? ' sur ' + logs.length : '');

  if (!keepScroll || atBottom) raw.scrollTop = raw.scrollHeight;
}

function addLog(l) {
  logs.push(l);
  if (logs.length > KEEP) logs = logs.slice(-KEEP);
  renderLogs(true);
}

/* ---------- flux d'événements ---------- */

function handle(e) {
  if (paused) return;
  if (e.kind === 'request') addRequest(e); else addLog(e);
}

let src;
function connect() {
  src = new EventSource('/debug/events');
  src.onopen = () => { $('#led').classList.add('on'); $('#state').textContent = 'en direct'; };
  src.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (Array.isArray(d)) d.forEach(handle); else handle(d);
  };
  src.onerror = () => {
    $('#led').classList.remove('on');
    $('#state').textContent = 'reconnexion…';
    // EventSource se reconnecte seul ; on ne ferme pas, on informe seulement.
  };
}

/* ---------- commandes ---------- */

$('#pause').addEventListener('click', () => {
  paused = !paused;
  $('#pause').textContent = paused ? 'Reprendre' : 'Pause';
  $('#pause').classList.toggle('on', paused);
});

$('#clear').addEventListener('click', async () => {
  logs = [];
  renderLogs();
  $('#reqs').innerHTML = '<p class="empty">En attente d\\'une requête…</p>';
  // Côté serveur aussi : effacer seulement l'écran laisserait le journal
  // revenir en entier au prochain redémarrage.
  try { await fetch('/debug/live/clear', { method: 'POST' }); } catch (e) { /* l'écran est déjà vide */ }
});

$('#lvl').addEventListener('change', () => renderLogs());
$('#q').addEventListener('input', () => renderLogs());

// Cliquer sur une source la met dans le filtre — et re-cliquer l'enlève.
$('#raw').addEventListener('click', ev => {
  const s = ev.target.closest('.sc');
  if (!s) return;
  const scope = s.dataset.s;
  $('#q').value = $('#q').value === scope ? '' : scope;
  renderLogs();
});

$('#copy').addEventListener('click', async () => {
  const text = visible()
    .map(l => quandComplet(l.at) + '  ' + l.scope + '  ' + l.message)
    .join('\\n');
  if (!text) { toast('Rien à copier'); return; }

  // L'API presse-papier exige un contexte sécurisé, et cette page est servie
  // en HTTP simple : le repli n'est pas un luxe, c'est le cas courant.
  try {
    await navigator.clipboard.writeText(text);
    toast(visible().length + ' ligne(s) copiée(s)');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    toast(ok ? visible().length + ' ligne(s) copiée(s)' : 'Copie refusée par le navigateur');
  }
});

async function refreshCache() {
  try {
    const r = await fetch('/health');
    const j = await r.json();
    $('#centries').textContent = j.cache.entries;
  } catch (e) { $('#centries').textContent = '?'; }
}

$('#cache').addEventListener('click', async () => {
  const b = $('#cache');
  b.disabled = true;
  try {
    const r = await fetch('/admin/cache/clear', { method: 'POST' });
    const j = await r.json();
    toast(j.cleared + ' entrée(s) vidée(s) — la prochaine requête re-cherchera tout');
  } catch (e) {
    toast('Échec : ' + e.message);
  }
  b.disabled = false;
  refreshCache();
});

$('#reqs').innerHTML = '<p class="empty">En attente d\\'une requête…</p>';
renderLogs();
connect();
refreshCache();
setInterval(refreshCache, 15000);
</script>
</html>`;
}
