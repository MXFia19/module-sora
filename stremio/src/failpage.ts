/** Page /debug/failures : les liens qu'on n'a pas su transformer en flux.
 *
 *  Deux vues sur le même journal (failures.ts) : un hébergeur par ligne pour
 *  voir d'un coup d'œil ce qui coûte le plus de flux, puis le détail lien par
 *  lien pour retrouver un cas précis. Tout se charge depuis
 *  /debug/failures.json : la page ne contient aucune donnée, elle peut rester
 *  ouverte et se rafraîchir.
 *
 *  Le script est écrit dans un gabarit TypeScript : pas d'antislash ni
 *  d'apostrophe dans une chaîne à quotes simples (voir debugpage.test.ts). */
export function failPage(): string {
  return `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sora — liens en échec</title>
<style>
:root{color-scheme:dark;--bg:#0d1117;--card:#161b22;--line:#30363d;--fg:#e6edf3;--dim:#8b949e;
 --ok:#3fb950;--warn:#d29922;--err:#f85149;--accent:#3b82f6}
*{box-sizing:border-box}
body{margin:0;padding:1rem;background:var(--bg);color:var(--fg);
 font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:72rem;margin:0 auto}
header{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.6rem}
h1{font-size:1.3rem;margin:0}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:1.4rem 0 .5rem}
a{color:#79c0ff}
.sp{flex:1}
button,select,input{padding:.4rem .7rem;border-radius:7px;border:1px solid var(--line);background:#21262d;
 color:var(--fg);font:inherit}
button{cursor:pointer}
button:hover{border-color:var(--dim)}
button.on{border-color:var(--accent);background:#132a4d}
button.danger:hover{border-color:var(--err);color:var(--err)}
input[type=search]{background:#0d1117;min-width:14rem;flex:1}
.hint{color:var(--dim);font-size:.85rem;margin:0 0 .8rem}
.bar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-bottom:.4rem}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:.8rem}
tr:last-child td{border-bottom:none}
.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.host{font-family:ui-monospace,monospace;font-size:.85rem}
.badge{display:inline-block;font-size:.72rem;padding:.05rem .45rem;border-radius:4px;margin:0 .2rem .15rem 0;white-space:nowrap}
.k-echec{background:#f8514926;color:#ff7b72}
.k-ecarte{background:#8b949e26;color:#c9d1d9}
.k-budget{background:#d2992226;color:#e3b341}
.reason{color:var(--fg)}
.cnt{color:var(--dim)}
.dim{color:var(--dim);font-size:.82rem}
.url{font-family:ui-monospace,monospace;font-size:.78rem;word-break:break-all}
.empty{color:var(--dim);padding:1rem;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:8px}
.wrap{overflow-x:auto}
</style>
<main>
<header>
  <h1>Liens en échec</h1>
  <span class="dim" id="total"></span>
  <span class="sp"></span>
  <a href="/debug" style="font-size:.85rem">diagnostic</a>
  <a href="/debug/live" style="font-size:.85rem">console en direct</a>
</header>
<p class="hint">Chaque lien de lecteur qu'une source a fourni sans qu'on en tire un flux, avec la raison.
<span class="badge k-echec">échec</span> tenté, rien obtenu ·
<span class="badge k-ecarte">écarté</span> pas tenté, hébergeur connu pour ne pas marcher ·
<span class="badge k-budget">délai</span> abandonné, trop lent.
Gardé en mémoire (500 derniers), remis à zéro au redémarrage.</p>

<div class="bar">
  <input type="search" id="q" placeholder="filtrer : hébergeur, source, raison, titre, URL…">
  <select id="kind">
    <option value="">tous les types</option>
    <option value="echec">échecs</option>
    <option value="ecarte">écartés</option>
    <option value="budget">délais</option>
  </select>
  <button id="refresh">Rafraîchir</button>
  <button id="auto">Auto (10 s)</button>
  <button id="clear" class="danger">Vider</button>
</div>

<h2>Par hébergeur</h2>
<div class="wrap" id="hosts"></div>

<h2>Derniers liens</h2>
<div class="wrap" id="list"></div>
</main>
<script>
const $ = s => document.querySelector(s);
let data = { entries: [], total: 0 };
let timer = null;

const LABELS = { echec: "échec", ecarte: "écarté", budget: "délai" };

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function when(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString("fr-FR") : d.toLocaleString("fr-FR");
}

function badge(kind, count) {
  return '<span class="badge k-' + kind + '">' + esc(LABELS[kind] || kind) + (count ? " " + count : "") + "</span>";
}

function visible() {
  const q = $("#q").value.trim().toLowerCase();
  const kind = $("#kind").value;
  return data.entries.filter(f => {
    if (kind && f.kind !== kind) return false;
    if (!q) return true;
    const hay = [f.host, f.source, f.reason, f.title, f.url, f.extractor].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

/** Même regroupement que le serveur, mais sur la vue filtrée. */
function byHost(list) {
  const map = new Map();
  for (const f of list) {
    let h = map.get(f.host);
    if (!h) { h = { host: f.host, count: 0, kinds: {}, reasons: new Map(), sources: new Set(), lastAt: 0 }; map.set(f.host, h); }
    h.count++;
    h.kinds[f.kind] = (h.kinds[f.kind] || 0) + 1;
    h.reasons.set(f.reason, (h.reasons.get(f.reason) || 0) + 1);
    if (f.source) h.sources.add(f.source);
    h.lastAt = Math.max(h.lastAt, f.at);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

function render() {
  const list = visible();
  $("#total").textContent = list.length === data.entries.length
    ? data.entries.length + " lien(s)"
    : list.length + " / " + data.entries.length + " lien(s)";

  if (list.length === 0) {
    const msg = data.entries.length === 0
      ? "Rien pour l’instant : ouvrez un film ou un épisode dans Stremio, les liens ratés apparaîtront ici."
      : "Aucun lien ne correspond au filtre.";
    $("#hosts").innerHTML = '<div class="empty">' + esc(msg) + "</div>";
    $("#list").innerHTML = "";
    return;
  }

  const hosts = byHost(list).map(h => {
    const kinds = Object.entries(h.kinds).map(([k, n]) => badge(k, n)).join("");
    const reasons = [...h.reasons].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([r, n]) => '<div><span class="reason">' + esc(r) + '</span> <span class="cnt">×' + n + "</span></div>").join("");
    return "<tr><td class=\\"host\\">" + esc(h.host) + '</td><td class="num">' + h.count + "</td><td>" + kinds
      + "</td><td>" + reasons + '</td><td class="dim">' + esc([...h.sources].join(", ")) + '</td><td class="dim">' + when(h.lastAt) + "</td></tr>";
  }).join("");
  $("#hosts").innerHTML = "<table><tr><th>Hébergeur</th><th class=\\"num\\">Liens</th><th>Type</th><th>Raisons</th><th>Sources</th><th>Dernier</th></tr>"
    + hosts + "</table>";

  const rows = list.slice(0, 300).map(f =>
    "<tr><td class=\\"dim\\">" + when(f.at) + "</td><td>" + badge(f.kind) + '</td><td><div class="reason">' + esc(f.reason)
    + '</div><div class="dim">' + esc(f.source || "?") + (f.extractor ? " · " + esc(f.extractor) : "") + (f.title ? " · " + esc(f.title) : "")
    + '</div><div class="url"><a href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer">' + esc(f.url) + "</a></div></td></tr>"
  ).join("");
  $("#list").innerHTML = "<table><tr><th>Quand</th><th>Type</th><th>Raison · source · lien</th></tr>" + rows + "</table>";
}

async function load() {
  try {
    const r = await fetch("/debug/failures.json", { cache: "no-store" });
    data = await r.json();
  } catch (e) {
    $("#total").textContent = "journal injoignable";
  }
  render();
}

$("#q").addEventListener("input", render);
$("#kind").addEventListener("change", render);
$("#refresh").addEventListener("click", load);
$("#auto").addEventListener("click", () => {
  if (timer) { clearInterval(timer); timer = null; $("#auto").classList.remove("on"); return; }
  timer = setInterval(load, 10000);
  $("#auto").classList.add("on");
  load();
});
$("#clear").addEventListener("click", async () => {
  if (!confirm("Vider le journal des liens en échec ?")) return;
  try { await fetch("/debug/failures/clear", { method: "POST" }); } catch (e) { /* recharge quand même */ }
  load();
});

load();
</script>
</html>`;
}
