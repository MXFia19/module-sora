/** Console en direct : ce que le serveur fait, pendant qu'on s'en sert.
 *
 *  Pensée pour être ouverte sur un écran pendant qu'on manipule Stremio sur
 *  un autre appareil. Les requêtes apparaissent comme des cartes dépliables,
 *  et le détail technique reste replié tant qu'on n'en a pas besoin. */
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
header{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem}
h1{font-size:1.3rem;margin:0;flex:1}
.live{display:inline-flex;align-items:center;gap:.4rem;font-size:.85rem;color:var(--dim)}
.led{width:8px;height:8px;border-radius:50%;background:var(--err)}
.led.on{background:var(--ok);animation:p 2s infinite}
@keyframes p{50%{opacity:.35}}
button,select{padding:.4rem .8rem;border-radius:7px;border:1px solid var(--line);background:#21262d;
 color:var(--fg);font:inherit;cursor:pointer}
button.on{border-color:var(--accent);background:#132a4d}
.hint{color:var(--dim);font-size:.85rem;margin:0 0 1rem}
.req{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);
 border-radius:8px;margin-bottom:.6rem;overflow:hidden}
.req.zero{border-left-color:var(--err)}
.req.cache{border-left-color:var(--dim)}
.rh{display:flex;align-items:center;gap:.6rem;padding:.7rem .9rem;cursor:pointer;flex-wrap:wrap}
.rh:hover{background:#1c2128}
.rh .ti{font-weight:600}
.rh .id{color:var(--dim);font-size:.82rem;font-family:ui-monospace,monospace}
.rh .sp{flex:1}
.rb{border-top:1px solid var(--line);padding:.7rem .9rem;display:none}
.req.open .rb{display:block}
.badge{font-size:.72rem;padding:.12rem .45rem;border-radius:4px;background:#21262d;color:var(--dim);white-space:nowrap}
.badge.g{background:#12261a;color:var(--ok)} .badge.r{background:#2a1315;color:var(--err)}
.badge.o{background:#2b220c;color:var(--warn)}
.src{display:flex;gap:.5rem;align-items:center;padding:.2rem 0;font-size:.85rem}
.src .n{width:8rem;color:var(--dim)}
.bar{height:6px;border-radius:3px;background:var(--ok);min-width:2px}
.bar.z{background:#30363d} .bar.e{background:var(--err)}
pre{background:#0d1117;border:1px solid var(--line);border-radius:7px;padding:.6rem;margin:0;
 overflow:auto;max-height:26rem;font-size:.76rem;line-height:1.5;
 font-family:ui-monospace,SFMono-Regular,monospace}
pre div{white-space:pre-wrap;word-break:break-all}
.debug{color:#6e7681} .info{color:var(--fg)} .warn{color:var(--warn)} .error{color:var(--err)}
.sc{color:#79c0ff}
.empty{color:var(--dim);text-align:center;padding:2rem}
</style>
<main>
<header>
  <h1>Console</h1>
  <span class="live"><span class="led" id="led"></span><span id="state">connexion…</span></span>
  <button id="pause">Pause</button>
  <select id="lvl">
    <option value="debug">Tout</option>
    <option value="info" selected>info et plus</option>
    <option value="warn">avertissements</option>
  </select>
  <button id="clear">Vider</button>
</header>
<p class="hint">Laissez cette page ouverte et utilisez Stremio sur votre téléphone :
chaque requête apparaît ici, avec ce que chaque source a rendu.</p>

<div id="reqs"></div>
<h2 style="font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)">Journal brut</h2>
<pre id="raw"></pre>
</main>
<script>
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const RANK = { debug: 10, info: 20, warn: 30, error: 40 };
let paused = false;

function hhmmss(t) { return new Date(t).toLocaleTimeString('fr-FR'); }

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
      '<span class="badge">' + hhmmss(r.at) + '</span>' +
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

function addLog(l) {
  if (RANK[l.level] < RANK[$('#lvl').value]) return;
  const raw = $('#raw');
  const atBottom = raw.scrollHeight - raw.scrollTop - raw.clientHeight < 40;

  const d = document.createElement('div');
  d.className = l.level;
  d.innerHTML = '<span class="sc">' + hhmmss(l.at) + ' ' + esc(l.scope) + '</span>  ' + esc(l.message);
  raw.appendChild(d);

  while (raw.children.length > 600) raw.firstElementChild.remove();
  if (atBottom) raw.scrollTop = raw.scrollHeight;
}

function handle(e) {
  if (paused) return;
  if (e.kind === 'request') addRequest(e); else addLog(e);
}

let src;
function connect() {
  src = new EventSource('debug/events');
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

$('#pause').addEventListener('click', () => {
  paused = !paused;
  $('#pause').textContent = paused ? 'Reprendre' : 'Pause';
  $('#pause').classList.toggle('on', paused);
});
$('#clear').addEventListener('click', () => {
  $('#raw').innerHTML = '';
  $('#reqs').innerHTML = '<p class="empty">En attente d\\'une requête…</p>';
});

$('#reqs').innerHTML = '<p class="empty">En attente d\\'une requête…</p>';
connect();
</script>
</html>`;
}
