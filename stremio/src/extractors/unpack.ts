/** Dé-obfuscation « Dean Edwards packer » — le `eval(function(p,a,c,k,e,d))`
 *  qu'on retrouve sur la moitié des hébergeurs. On ne l'évalue jamais : on
 *  refait la substitution à la main. Évaluer du JS distant dans le serveur
 *  reviendrait à lui donner les clés de la maison. */

/** Chiffre -> symbole dans la base `a` utilisée par le packer. */
function encodeBase(c: number, base: number): string {
  const low = c < base ? '' : encodeBase(Math.floor(c / base), base);
  const rest = c % base;
  return low + (rest > 35 ? String.fromCharCode(rest + 29) : rest.toString(36));
}

/** Déballe un bloc packé. Rend null si le texte n'en est pas un. */
export function unpack(source: string): string | null {
  const args = source.match(
    /}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\s*\.split\('\|'\)/,
  );
  if (!args) return null;

  let payload = (args[2] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const base = parseInt(args[3] ?? '0', 10);
  let count = parseInt(args[4] ?? '0', 10);
  const words = (args[6] ?? '').split('|');

  if (!base || !Number.isFinite(count)) return null;

  while (count--) {
    const word = words[count];
    if (!word) continue;
    const token = encodeBase(count, base);
    payload = payload.replace(new RegExp(`\\b${token}\\b`, 'g'), word);
  }
  return payload;
}

/** Déballe tous les blocs packés d'une page et rend le tout concaténé, pour
 *  pouvoir chercher l'URL dans l'ensemble sans se soucier du bloc d'origine. */
export function unpackAll(html: string): string {
  const blocks = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/g);
  if (!blocks) return '';
  return blocks.map(b => unpack(b) ?? '').join('\n');
}

/** Première URL de média trouvée dans un texte (page brute ou déballée).
 *
 *  Le déséchappement vient AVANT la recherche, pas après : dans un JSON
 *  inline l'URL s'écrit `https:\/\/cdn\/master.m3u8`, et un motif qui attend
 *  `://` n'y accroche tout simplement pas. Nettoyer d'abord fait tomber les
 *  deux formes sur le même chemin. */
export function findMediaUrl(text: string): string | null {
  const clean = text.replace(/\\\//g, '/');
  const m = clean.match(/(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)[^"'\s\\]*)/i);
  return m?.[1]?.trim() ?? null;
}

/** Lien HLS déclaré par la page, dans l'ordre de préférence du lecteur.
 *
 *  Toute une famille de lecteurs (vibuxer, dingtezuni, hanerix, morencius…)
 *  publie ses variantes ainsi :
 *
 *      var links = { "hls4": "/stream/…", "hls3": "https://…/master.txt",
 *                    "hls2": "https://…/master.m3u8?t=…" };
 *
 *  et les consomme dans cet ordre : `links.hls4 || links.hls3 || links.hls2`.
 *  Une recherche de la première URL de média retient hls2 — le dernier
 *  recours — parce que hls4 est relatif et que hls3 se sert en `.txt`. On suit
 *  donc la préférence déclarée plutôt que l'ordre d'apparition. */
export function declaredHlsLink(text: string, base: string): string | null {
  const bloc = text.match(/\blinks\s*=\s*(\{[\s\S]{0,2000}?\})\s*[;,\n]/);
  if (!bloc?.[1]) return null;

  let obj: Record<string, unknown>;
  try { obj = JSON.parse(bloc[1]); } catch { return null; }

  const variantes = Object.keys(obj)
    .filter(k => /^hls\d+$/.test(k))
    .sort((a, b) => Number(b.slice(3)) - Number(a.slice(3)));

  for (const k of variantes) {
    const v = obj[k];
    if (typeof v !== 'string' || v.length === 0) continue;
    try { return new URL(v, base).toString(); } catch { /* variante illisible */ }
  }
  return null;
}
