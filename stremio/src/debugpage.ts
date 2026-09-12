import { allScrapers } from './scrapers';

/** Page de diagnostic. Un champ, un bouton, et le verdict de chaque source.
 *
 *  Volontairement servie par l'addon lui-même plutôt que par une application
 *  à part : elle doit interroger LE serveur qui pose problème, avec sa
 *  configuration et depuis son réseau. Une application locale testerait une
 *  autre machine et donnerait un autre résultat. */
export function debugPage(): string {
  const sources = allScrapers().map(s => s.name).join(', ');

  return `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sora — diagnostic</title>
<style>
:root{color-scheme:dark;--bg:#0d1117;--card:#161b22;--line:#30363d;--fg:#e6edf3;--dim:#8b949e;
 --ok:#3fb950;--warn:#d29922;--err:#f85149;--skip:#6e7681;--accent:#3b82f6}
*{box-sizing:border-box}
body{margin:0;padding:1.5rem 1rem;background:var(--bg);color:var(--fg);
 font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:56rem;margin:0 auto}
h1{font-size:1.35rem;margin:0 0 .2rem}
.sub{color:var(--dim);margin:0 0 1.5rem}
.bar{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem;margin-bottom:1rem}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:end}
label{display:block;font-size:.8rem;color:var(--dim);margin-bottom:.25rem}
input,select{padding:.5rem .6rem;background:#0d1117;color:var(--fg);border:1px solid var(--line);
 border-radius:7px;font:inherit}
input[type=text]{flex:1;min-width:14rem}
button{padding:.55rem 1.1rem;border-radius:7px;border:1px solid var(--accent);background:var(--accent);
 color:#fff;font:inherit;font-weight:500;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
button.ghost{background:#21262d;border-color:var(--line);color:var(--fg);font-weight:400}
.ex{margin-top:.7rem;font-size:.85rem;color:var(--dim)}
.ex a{color:#79c0ff;cursor:pointer;text-decoration:none;margin-right:.8rem}
.ex a:hover{text-decoration:underline}
.media{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.9rem 1rem;margin-bottom:1rem}
.media b{font-size:1.05rem}
.meta{color:var(--dim);font-size:.85rem;margin-top:.3rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:.7rem;overflow:hidden}
.head{display:flex;align-items:center;gap:.6rem;padding:.8rem 1rem;cursor:pointer;user-select:none}
.head:hover{background:#1c2128}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.s-ok .dot{background:var(--ok)} .s-vide .dot{background:var(--warn)}
.s-erreur .dot{background:var(--err)} .s-timeout .dot{background:var(--err)}
.s-ignorée .dot{background:var(--skip)}
.head .n{font-weight:600;flex:1}
.head .t{color:var(--dim);font-size:.85rem;font-variant-numeric:tabular-nums}
.badge{font-size:.72rem;padding:.12rem .45rem;border-radius:4px;background:#21262d;color:var(--dim)}
.body{border-top:1px solid var(--line);padding:.8rem 1rem;display:none}
.card.open .body{display:block}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;color:var(--dim);font-weight:500;padding:.3rem .5rem .4rem 0;font-size:.78rem}
td{padding:.3rem .5rem .3rem 0;border-top:1px solid #21262d;vertical-align:top}
td.u{color:var(--dim);font-family:ui-monospace,monospace;font-size:.75rem;word-break:break-all;max-width:22rem}
.pill{font-size:.72rem;padding:.1rem .4rem;border-radius:4px;white-space:nowrap}
.pill.y{background:#12261a;color:var(--ok)} .pill.n{background:#2a1315;color:var(--err)}
.pill.p{background:#1c2333;color:#79c0ff}
pre{background:#0d1117;border:1px solid var(--line);border-radius:7px;padding:.6rem;margin:.7rem 0 0;
 overflow:auto;max-height:20rem;font-size:.76rem;line-height:1.45}
pre .debug{color:var(--dim)} pre .warn{color:var(--warn)} pre .error{color:var(--err)}
.note{color:var(--dim);font-size:.85rem;margin:.6rem 0 0}
.err{background:#2a1315;border:1px solid var(--err);border-radius:8px;padding:.8rem;margin-bottom:1rem}
.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--line);
 border-top-color:var(--accent);border-radius:50%;animation:r .7s linear infinite;vertical-align:-1px}
@keyframes r{to{transform:rotate(360deg)}}
</style>
<main>
<h1>Diagnostic</h1>
<p class="sub">Sources enregistrées : ${sources} — <a href="/debug/live" style="color:#79c0ff">console en direct →</a></p>

<div class="bar">
  <div class="row">
    <div style="flex:1">
      <label for="id">Identifiant IMDb ou TMDB</label>
      <input type="text" id="id" value="tt0816692" placeholder="tt0816692, ou tmdb:157336">
    </div>
    <div>
      <label for="type">Type</label>
      <select id="type"><option value="movie">Film</option><option value="series">Série</option></select>
    </div>
    <div>
      <label for="se">Saison</label>
      <input type="number" id="se" value="1" min="1" style="width:5rem">
    </div>
    <div>
      <label for="ep">Épisode</label>
      <input type="number" id="ep" value="1" min="1" style="width:5rem">
    </div>
    <button id="go">Tester</button>
  </div>
  <div class="row" style="margin-top:.7rem">
    <label style="display:flex;align-items:center;gap:.4rem;color:var(--fg);margin:0">
      <input type="checkbox" id="check" checked> Vérifier que les flux répondent vraiment
    </label>
  </div>
  <p class="ex">Exemples :
    <a data-t="movie" data-i="tt0816692">Interstellar</a>
    <a data-t="series" data-i="tt0944947" data-s="1" data-e="1">Game of Thrones S1E1</a>
    <a data-t="series" data-i="tt2560140" data-s="1" data-e="1">L'Attaque des Titans S1E1</a>
  </p>
</div>

<div id="out"></div>
</main>
<script>
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

function toggleType() {
  const series = $('#type').value === 'series';
  $('#se').parentElement.style.display = series ? '' : 'none';
  $('#ep').parentElement.style.display = series ? '' : 'none';
}
$('#type').addEventListener('change', toggleType);
toggleType();

document.querySelectorAll('.ex a').forEach(a => a.addEventListener('click', () => {
  $('#id').value = a.dataset.i;
  $('#type').value = a.dataset.t;
  if (a.dataset.s) { $('#se').value = a.dataset.s; $('#ep').value = a.dataset.e; }
  toggleType();
  run();
}));

function logsHtml(lines) {
  if (!lines.length) return '<p class="note">Aucun log.</p>';
  const t0 = lines[0].at;
  return '<pre>' + lines.map(l =>
    '<span class="' + l.level + '">' +
    String(l.at - t0).padStart(5) + 'ms  ' + esc(l.scope) + '  ' + esc(l.message) +
    '</span>').join('\\n') + '</pre>';
}

function streamsHtml(streams, count) {
  if (!streams.length) return '';
  const checked = streams.some(s => s.httpStatus !== undefined);
  const rows = streams.map(s => {
    let verdict = '';
    if (checked) {
      verdict = s.playable
        ? '<span class="pill y">' + s.httpStatus + '</span>'
        : '<span class="pill n">' + (s.httpStatus === 0 ? 'injoignable' : s.httpStatus) + '</span>';
      if (s.checkMs) verdict += ' <span class="badge">' + s.checkMs + 'ms</span>';
    }
    return '<tr><td>' + esc(s.language) + '</td><td>' + esc(s.quality) + '</td>' +
      '<td>' + esc(s.server) + (s.proxied ? ' <span class="pill p">proxy</span>' : '') + '</td>' +
      '<td>' + esc(s.host) + '</td><td>' + verdict + '</td>' +
      '<td class="u">' + esc(s.url.slice(0, 110)) + '</td></tr>';
  }).join('');

  const more = count > streams.length
    ? '<p class="note">' + (count - streams.length) + ' flux supplémentaires non affichés.</p>' : '';

  return '<table><tr><th>Langue</th><th>Qualité</th><th>Serveur</th><th>Hôte</th>' +
    '<th>' + (checked ? 'Réponse' : '') + '</th><th>URL</th></tr>' + rows + '</table>' + more;
}

function render(r) {
  if (r.error) {
    $('#out').innerHTML = '<div class="err">' + esc(r.error) + '</div>' + logsHtml(r.resolveLogs);
    return;
  }

  const m = r.media;
  let html = '<div class="media"><b>' + esc(m.title) + '</b>' +
    (m.year ? ' <span class="badge">' + m.year + '</span>' : '') +
    (m.anime ? ' <span class="badge">anime</span>' : '') +
    '<div class="meta">tmdb ' + m.tmdbId +
    (m.season ? ' · s' + m.season + 'e' + m.episode : '') +
    (m.absoluteEpisode ? ' · épisode absolu ' + m.absoluteEpisode : '') +
    ' · ' + r.totalMs + 'ms' +
    '<br>titres essayés : ' + esc(m.aliases.slice(0, 6).join(' / ')) +
    '</div></div>';

  for (const s of r.scrapers) {
    const info = s.status === 'ok'
      ? s.streamCount + ' flux'
      : s.status === 'vide' ? 'aucun flux'
      : s.error ? esc(s.error) : s.status;
    const playable = s.streams.filter(x => x.playable).length;
    const checkInfo = s.streams.some(x => x.httpStatus !== undefined)
      ? ' <span class="badge">' + playable + '/' + s.streams.length + ' répondent</span>' : '';

    html += '<div class="card s-' + s.status + '">' +
      '<div class="head"><span class="dot"></span>' +
      '<span class="n">' + esc(s.name) + '</span>' +
      '<span class="badge">' + info + '</span>' + checkInfo +
      '<span class="t">' + s.ms + 'ms</span></div>' +
      '<div class="body">' + streamsHtml(s.streams, s.streamCount) + logsHtml(s.logs) + '</div></div>';
  }

  html += '<div class="card"><div class="head"><span class="dot" style="background:#6e7681"></span>' +
    '<span class="n">Résolution TMDB</span><span class="t">' + r.resolveLogs.length + ' lignes</span></div>' +
    '<div class="body">' + logsHtml(r.resolveLogs) + '</div></div>';

  $('#out').innerHTML = html;
  document.querySelectorAll('.head').forEach(h =>
    h.addEventListener('click', () => h.parentElement.classList.toggle('open')));

  // Ouvrir d'office ce qui ne va pas : c'est ce qu'on vient regarder.
  document.querySelectorAll('.card.s-vide, .card.s-erreur, .card.s-timeout')
    .forEach(c => c.classList.add('open'));
}

async function run() {
  const p = new URLSearchParams({
    type: $('#type').value,
    id: $('#id').value.trim(),
    check: $('#check').checked ? '1' : '0',
  });
  if ($('#type').value === 'series') { p.set('season', $('#se').value); p.set('episode', $('#ep').value); }

  $('#go').disabled = true;
  $('#out').innerHTML = '<div class="bar"><span class="spin"></span> Interrogation des sources…' +
    ' <span class="note">quelques secondes, chaque source est testée séparément</span></div>';
  try {
    const res = await fetch('/debug/run?' + p);
    render(await res.json());
  } catch (e) {
    $('#out').innerHTML = '<div class="err">Le serveur n\\'a pas répondu : ' + esc(e.message) + '</div>';
  } finally {
    $('#go').disabled = false;
  }
}

$('#go').addEventListener('click', run);
$('#id').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
</script>
</html>`;
}
