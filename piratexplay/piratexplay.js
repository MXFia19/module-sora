// ==========================================
// ⚙️ SORA MODULE — PIRATEXPLAY
// ==========================================
// PirateXplay (piratexplay.com is a landing page for piratexplay.cc): anime
// with Indian dubs (Hindi, Tamil, Telugu) plus English and Japanese tracks.
//
// Catalog:
//   Search   : /?s=<q>  -> <article> cards: title, TMDB poster, /series/<slug> or /movies/<slug>
//   Seasons  : the series page links /series/<name>-season-<n>-<tmdbId>/ (data-season)
//   Episodes : GET /api/episodes.php?id=<season slug>
//              -> {data:{tmdb:{overview, release_year, genre…}, episodes:[{season, episode, image}]}}
//   Episode  : /episode/<season slug>-<s>x<e>/   Film: /movies/<slug>/
//
// Playback: each page lists ~15 embeds (iframe src / data-src), all tagged
// "Multi Audio". Read here (November 2026):
//   - Ravok     /proxy/play.php?url=https://ravok.buzz/video/<hash>
//               -> POST /player/index.php?data=<hash>&do=getVideo -> {hls, videoSource}
//   - Rubystm   StreamRuby (XFileSharing): GET /dl?op=embed&file_code=<code> -> jwplayer file:"…m3u8"
//   - index11   /public/player/index11.php?id=… lists data-link servers in clear;
//               the Byse one (bysezejataos.com…) answers /api/videos/<code>/ with
//               an AES-256-GCM "playback" block, decrypted locally (no attestation)
//   - Blakite   blakiteapi.xyz/embed/<tmdb>/<s>-<e>: window.CFG -> Rumble CDN mp4/HLS
//   - Vidmoly   `sources: [{ file: '<master.m3u8>' }]`, often under .net and .biz
// Not read: Abyss (short.icu / abyssplayer, also behind proxy/multi.php) is a
// protected player; GDMirror (gdmirrorbot / iqsmartgames) checks the embedding
// domain with obfuscated code and a fingerprint; UPNS answers "not found" for
// every file; Strmup, Vidstreaming and Vudeo are parked domains; Emturbovid /
// Turbovidhls do not resolve. They are reported, not offered.

const PX_BASE = "https://piratexplay.cc";
const PX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ==========================================
// 🗄️ SUPABASE TRACKER
// ==========================================
const SUPABASE_URL = "https://qyeisgowjisqbatrmqta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F68CBjFVPh71U0SdD9BQJg_UJgL9-Fj";

async function sendSupabaseLog(moduleName, actionType, dataPayload) {
    try {
        const payload = { module: moduleName, action: actionType, data: dataPayload };
        const headers = {
            "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Prefer": "return=minimal"
        };
        if (typeof fetchv2 !== 'undefined') {
            await fetchv2(`${SUPABASE_URL}/rest/v1/app_logs`, headers, "POST", JSON.stringify(payload));
        } else {
            await fetch(`${SUPABASE_URL}/rest/v1/app_logs`, { method: "POST", headers: headers, body: JSON.stringify(payload) });
        }
    } catch (e) {
        console.log(`[Tracker] 🚨 Failed to send to Supabase: ${e.message}`);
    }
}

// ==========================================
// 🌐 NETWORK
// ==========================================

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = PX_UA;
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, headers, options.method ?? 'GET', options.body ?? null);
        } else {
            return await fetch(url, { ...options, headers: headers });
        }
    } catch (e) {
        try { return await fetch(url, { ...options, headers: headers }); } catch (error) { return null; }
    }
}

async function readBody(response) {
    if (!response) return "";
    if (typeof response.text === 'function') return await response.text();
    if (typeof response.data === 'string') return response.data;
    return "";
}

async function getPage(url, referer) {
    const response = await soraFetch(url, {
        method: 'GET',
        headers: { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": referer || `${PX_BASE}/` }
    });
    return await readBody(response);
}

async function getJson(url, referer) {
    const response = await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json", "Referer": referer || `${PX_BASE}/` } });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// ==========================================
// 🧰 HELPERS
// ==========================================

function decodeEntities(text) {
    return String(text || "")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function hostOf(url) {
    return (String(url).match(/^https?:\/\/([^/]+)/) || [])[1] || "";
}

function parseHref(url) {
    const m = String(url).match(/^piratexplay(?:-play)?:\/\/(series|movies|episode)\/([^/?#]+)/);
    if (m) return { kind: m[1], slug: m[2] };
    const web = String(url).match(/\/(series|movies|episode)\/([^/?#]+)/);
    return web ? { kind: web[1], slug: web[2] } : { kind: 'series', slug: String(url) };
}

async function seasonData(seasonSlug) {
    const data = await getJson(`${PX_BASE}/api/episodes.php?id=${encodeURIComponent(seasonSlug)}`);
    return data && data.status === 'success' && data.data ? data.data : null;
}

// ==========================================
// 🔌 HOSTS
// ==========================================

async function vidmolyExtract(embedUrl) {
    const url = embedUrl.replace(/vidmoly\.(?:to|me|net|ru|is)\//i, "vidmoly.biz/");
    const html = await getPage(url, `${PX_BASE}/`);
    if (!html) return null;
    const m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/) ||
        html.match(/file\s*:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/);
    if (!m) return null;
    const origin = `https://${hostOf(url)}`;
    return { title: "Vidmoly · HLS · Multi Audio", streamUrl: m[1], headers: { "User-Agent": PX_UA, "Referer": `${origin}/`, "Origin": origin } };
}

// --- Ravok (FirePlayer): the iframe gives the hash, one POST gives the HLS master.
// The signed link is tied to the caller's IP: use it right away, never cache it.
async function ravokExtract(embedUrl) {
    const m = String(embedUrl).match(/^https?:\/\/([^/]+)\/video\/([a-f0-9]{16,64})/i);
    if (!m) return null;
    const host = m[1], hash = m[2];
    const response = await soraFetch(`https://${host}/player/index.php?data=${hash}&do=getVideo`, {
        method: 'POST',
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `https://${host}/video/${hash}`
        },
        body: `hash=${hash}&r=${encodeURIComponent(PX_BASE + "/")}`
    });
    let data = null;
    try { data = JSON.parse(await readBody(response)); } catch (e) { return null; }
    // Only the HLS form is in clear; the other one hides its mp4 list behind CryptoJS.
    if (!data || !data.hls || typeof data.videoSource !== 'string' || !/^https?:\/\//.test(data.videoSource)) return null;
    return [{ title: "Ravok · HLS · Multi Audio", streamUrl: data.videoSource, headers: { "User-Agent": PX_UA, "Referer": `https://${host}/` } }];
}

// --- StreamRuby (rubystm.com, redirects to its current domain): XFileSharing
// embed form, sent as GET so the 301 to the current domain keeps it.
async function streamRubyExtract(embedUrl) {
    const host = hostOf(embedUrl);
    const code = (String(embedUrl).match(/\/(?:e|embed-|d)\/?([A-Za-z0-9]{12})/) || [])[1];
    if (!host || !code) return null;
    let html = await getPage(`https://${host}/dl?op=embed&file_code=${code}&auto=1&referer=`, `https://${host}/e/${code}.html`);
    if (html && html.indexOf('eval(function(p,a,c,k,e,d)') !== -1) html += "\n" + unpackAll(html);
    const m = html && html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (!m) return null;
    return [{ title: "StreamRuby · HLS · Multi Audio", streamUrl: m[1], headers: { "User-Agent": PX_UA, "Referer": `https://${host}/` } }];
}

// --- Blakite: the page carries window.CFG; the files sit on Rumble's CDN under
// <dataId>.<quality code>.mp4 (or a chunklist for M3U8), as the page builds them.
async function blakiteExtract(embedUrl) {
    const html = await getPage(embedUrl, `${PX_BASE}/`);
    const cfgText = (html.match(/window\.CFG\s*=\s*(\{[\s\S]*?\});/) || [])[1];
    if (!cfgText) return null;
    let cfg = null;
    try { cfg = JSON.parse(cfgText); } catch (e) { return null; }
    if (!cfg || cfg.err || !cfg.dataId) return null;
    const base = (html.match(/const\s+B\s*=\s*'(https:\/\/[^']+)'/) || [])[1];
    if (!base) return null;

    const CODE = { 240: 'oaa', 360: 'baa', 480: 'caa', 720: 'gaa', 1080: 'haa' }, ORDER = [240, 360, 480, 720, 1080];
    const isHls = String(cfg.format || '').toUpperCase() === 'M3U8';
    const hlsUrl = (c, r) => `${base}${cfg.dataId}.${c}.tar?r_file=chunklist.m3u8&r_type=application%2Fvnd.apple.mpegurl${r ? `&r_range=${r}` : ''}`;
    const list = [];
    if (isHls && cfg.ranges) {
        String(cfg.ranges).split(/\r?\n/).forEach(line => {
            const m = line.match(/(\d+-\d+)\s*\(\s*(\d+)\s*p\s*\)/i);
            if (m && CODE[+m[2]] && !list.some(x => x.h === +m[2])) list.push({ h: +m[2], url: hlsUrl(CODE[+m[2]], m[1]) });
        });
    }
    if (!list.length) {
        const n = Math.min(cfg.qid || ORDER.length, ORDER.length);
        for (let i = 0; i < n; i++) list.push({ h: ORDER[i], url: isHls ? hlsUrl(CODE[ORDER[i]], '') : `${base}${cfg.dataId}.${CODE[ORDER[i]]}.mp4` });
    }
    list.sort((a, b) => b.h - a.h);

    // The page probes each quality before playing it; keep the best one that answers.
    const lang = (String(cfg.animeTitle || cfg.title || '').match(/\((\w+) Dubbed\)/i) || [])[1] || '';
    for (const item of list.slice(0, 3)) {
        try {
            const r = await soraFetch(item.url, { method: isHls ? 'GET' : 'HEAD', headers: {} });
            const ok = r && (r.status === undefined || r.status === 200 || r.status === 206);
            if (!ok) continue;
            if (isHls && (await readBody(r)).indexOf('#EXTM3U') === -1) continue;
            return [{ title: `Blakite · ${isHls ? 'HLS' : 'MP4'} ${item.h}p${lang ? ` · ${lang}` : ''}`, streamUrl: item.url, headers: { "User-Agent": PX_UA } }];
        } catch (e) { }
    }
    return null;
}

// --- Byse (bysezejataos.com and the platform's other domains): /api/videos/<code>/
// returns a "playback" block in AES-256-GCM whose key is two of the key_parts,
// picked by `version` ([n, 31-n]). Decrypted here; no attestation or PoW is sent:
// if the API does not give the block, the server is reported.
async function byseExtract(embedUrl) {
    const host = hostOf(embedUrl);
    const code = (String(embedUrl).match(/\/(?:e|d|v)\/([A-Za-z0-9_-]+)/) || [])[1];
    if (!host || !code) return null;
    const data = await getJson(`https://${host}/api/videos/${code}/`, embedUrl);
    const pb = data && data.playback;
    if (!pb || !pb.payload || !pb.iv || !Array.isArray(pb.key_parts)) return null;

    const n = parseInt(String(pb.version), 10);
    let parts = pb.key_parts;
    if (n >= 1 && n <= 20 && pb.key_parts[n - 1] && pb.key_parts[30 - n]) parts = [pb.key_parts[n - 1], pb.key_parts[30 - n]];
    const keyChunks = parts.map(b64urlBytes);
    let total = 0; keyChunks.forEach(k => { total += k.length; });
    const key = new Uint8Array(total);
    let off = 0; keyChunks.forEach(k => { key.set(k, off); off += k.length; });
    if (key.length !== 32) return null;

    let sources = [];
    try {
        const plain = aesGcmDecrypt256(key, b64urlBytes(pb.iv), b64urlBytes(pb.payload));
        let txt = "";
        for (let i = 0; i < plain.length; i++) txt += String.fromCharCode(plain[i]);
        try { txt = decodeURIComponent(escape(txt)); } catch (e) { }
        sources = (JSON.parse(txt) || {}).sources || [];
    } catch (e) { return null; }

    const out = [];
    for (const s of sources) {
        if (!s || typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) continue;
        const kind = /mpegurl|\.m3u8/i.test(`${s.mime_type || ''} ${s.url}`) ? 'HLS' : 'MP4';
        const headers = { "User-Agent": PX_UA, "Referer": `https://${host}/` };
        // Some files answer 404 on the CDN although the API lists them: check the playlist.
        if (kind === 'HLS') {
            const body = await readBody(await soraFetch(s.url, { method: 'GET', headers: { "Referer": `https://${host}/` } }).catch(() => null));
            if (body.indexOf('#EXTM3U') === -1) continue;
        }
        out.push({ title: `Byse · ${kind}${s.label ? ` ${s.label}` : ''} · Multi Audio`, streamUrl: s.url, headers: headers });
    }
    return out.length ? out : null;
}

// --- index11 hub: the server list is in clear (data-link). Only the hosts above
// are tried; the others go to the report.
async function index11Links(hubUrl) {
    const html = await getPage(hubUrl, `${PX_BASE}/`);
    const links = [];
    const re = /data-link="(https?:\/\/[^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const link = decodeEntities(m[1]);
        if (links.indexOf(link) === -1) links.push(link);
    }
    return links;
}

// Which reader handles a link; null = not supported (with the reason).
function hostKind(link) {
    const h = hostOf(link).toLowerCase();
    if (/\/proxy\/play\.php\?url=/i.test(link)) return 'ravok-proxy';
    if (/\/public\/player\/index\d*\.php/i.test(link)) return 'index11';
    if (/vidmoly\./.test(h)) return 'vidmoly';
    if (/\/video\/[a-f0-9]{16,64}/i.test(link)) return 'ravok';
    if (/rubystm|streamruby/.test(h)) return 'streamruby';
    if (/blakiteapi/.test(h)) return 'blakite';
    if (/byse|filemoon/.test(h)) return 'byse';
    return null;
}

function unsupportedReason(link) {
    const h = hostOf(link).toLowerCase();
    if (/short\.icu|abyss|hydrax/.test(h) || /\/proxy\/multi\.php/.test(link)) return "Abyss/Hydrax: protected player";
    if (/gdmirror|iqsmartgames/.test(h)) return "GDMirror: domain check with obfuscated code and fingerprint";
    if (/upns|upn\.one/.test(h)) return "UPNS: file not found";
    if (/strmup|vidstreaming|vudeo/.test(h)) return "Parked domain";
    if (/turbovid/.test(h)) return "Host unreachable";
    return "Unsupported host";
}

// ==========================================
// 🔐 PURE-JS HELPERS (no atob / crypto on iOS)
// ==========================================

function b64urlBytes(s) {
    const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const out = [];
    for (let bc = 0, bs = 0, idx = 0; idx < b64.length; idx++) {
        const c = chars.indexOf(b64.charAt(idx)); if (c < 0) continue;
        bs = bc % 4 ? bs * 64 + c : c;
        if (bc++ % 4) out.push(255 & (bs >> ((-2 * bc) & 6)));
    }
    return new Uint8Array(out);
}

// AES-256-GCM decryption through CTR (the tag is not checked), from movix.
const aesGcmDecrypt256 = (function () {
    const sbox = new Uint8Array(256);
    (function () {
        let p = 1, q = 1;
        const rotl8 = (x, s) => ((x << s) | (x >> (8 - s))) & 0xff;
        do {
            p = (p ^ (p << 1) ^ ((p & 0x80) ? 0x11b : 0)) & 0xff;
            q &= 0xff; q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09; q &= 0xff;
            sbox[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
        } while (p !== 1);
        sbox[0] = 0x63;
    })();
    const rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];
    function expandKey256(key) {
        const Nk = 8, words = 60, w = new Array(words);
        for (let i = 0; i < Nk; i++) w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
        for (let i = Nk; i < words; i++) {
            let t = w[i - 1].slice();
            if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => sbox[b]); t[0] ^= rcon[i / Nk - 1]; }
            else if (i % Nk === 4) { t = t.map(b => sbox[b]); }
            w[i] = w[i - Nk].map((b, j) => (b ^ t[j]) & 0xff);
        }
        return w;
    }
    const gmul = (a, b) => { let r = 0; for (let i = 0; i < 8; i++) { if (b & 1) r ^= a; const hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return r & 0xff; };
    function encryptBlock(inp, w) {
        let s = inp.slice();
        const addRK = (round) => { for (let c = 0; c < 16; c++) s[c] ^= w[round * 4 + (c >> 2)][c & 3]; };
        const subBytes = () => { for (let i = 0; i < 16; i++) s[i] = sbox[s[i]]; };
        const shiftRows = () => { const t = s.slice(); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s[r + 4 * c] = t[r + 4 * ((c + r) % 4)]; };
        const mixCols = () => { for (let c = 0; c < 4; c++) { const i = 4 * c, a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3]; s[i] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3; s[i + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3; s[i + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3); s[i + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2); } };
        addRK(0);
        for (let round = 1; round < 14; round++) { subBytes(); shiftRows(); mixCols(); addRK(round); }
        subBytes(); shiftRows(); addRK(14);
        return s;
    }
    return function (key, iv, payload) {
        const w = expandKey256(key);
        const ct = payload.subarray(0, payload.length - 16);
        const counter = new Uint8Array(16);
        counter.set(iv.subarray(0, 12), 0); counter[15] = 1;
        const inc = () => { for (let i = 15; i >= 12; i--) { counter[i] = (counter[i] + 1) & 0xff; if (counter[i]) break; } };
        const out = new Uint8Array(ct.length);
        for (let off = 0; off < ct.length; off += 16) {
            inc();
            const ks = encryptBlock(Array.from(counter), w);
            for (let i = 0; i < 16 && off + i < ct.length; i++) out[off + i] = ct[off + i] ^ ks[i];
        }
        return out;
    };
})();

// p.a.c.k.e.r, for the hosts that wrap their player config in it.
function unpackAll(html) {
    const out = [];
    let i = 0;
    while ((i = html.indexOf("eval(function(p,a,c,k,e,d)", i)) !== -1) {
        const s = html.slice(i); i += 10;
        const m = s.match(/\}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!m) continue;
        const a = parseInt(m[2], 10), k = m[4].split("|");
        let c = parseInt(m[3], 10);
        const enc = n => (n < a ? "" : enc(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
        const dict = {};
        while (c--) dict[enc(c)] = k[c] || enc(c);
        out.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, w => (dict[w] !== undefined ? dict[w] : w)));
    }
    return out.join("\n");
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 PirateXplay — searching for "${keyword}"`);
    try {
        const html = await getPage(`${PX_BASE}/?s=${encodeURIComponent(String(keyword || "").trim())}`);
        const results = [];
        const re = /<article class="post[^"]*">([\s\S]*?)<\/article>/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const card = m[1];
            const link = (card.match(/<a href="([^"]+)" class="lnk-blk"/) || [])[1] || "";
            const ref = link.match(/\/(series|movies)\/([^/?#]+)/);
            if (!ref) continue;
            const title = decodeEntities((card.match(/<h2 class="entry-title">([^<]+)<\/h2>/) || [])[1] || ref[2]).trim();
            const image = (card.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
            const href = `piratexplay://${ref[1]}/${ref[2]}`;
            if (results.some(r => r.href === href)) continue;
            results.push({ title: ref[1] === 'movies' ? `${title} · Movie` : title, image: image, href: href });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("PirateXplay", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("PirateXplay", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

async function extractDetails(url) {
    const ref = parseHref(url);
    const pageUrl = `${PX_BASE}/${ref.kind}/${ref.slug}/`;
    console.log(`[Details] 📖 PirateXplay — ${pageUrl}`);
    sendSupabaseLog("PirateXplay", "DETAILS", { media_url: pageUrl });

    try {
        if (ref.kind === 'series') {
            const data = await seasonData(ref.slug);
            const tmdb = data && data.tmdb;
            if (tmdb) {
                const aliasParts = [];
                if (tmdb.rating) aliasParts.push(`TMDB ${Number(tmdb.rating).toFixed(1)}/10`);
                if (Array.isArray(tmdb.genre) && tmdb.genre.length) aliasParts.push(tmdb.genre.slice(0, 6).join(', '));
                if (tmdb.status) aliasParts.push(tmdb.status);
                if (tmdb.total_episodes) aliasParts.push(`${tmdb.total_episodes} episode(s)`);
                return JSON.stringify([{
                    description: String(tmdb.overview || "").trim() || "No synopsis available.",
                    aliases: aliasParts.join(' | '),
                    airdate: tmdb.release_year ? String(tmdb.release_year) : ""
                }]);
            }
        }

        // Films (and a failed API call): the page's own description.
        const html = await getPage(pageUrl);
        const description = decodeEntities((html.match(/<meta (?:name="description"|property="og:description") content="([^"]*)"/) || [])[1] || "").trim();
        const year = (html.match(/class="year[^"]*">\s*<span[^>]*>\s*(\d{4})/) || [])[1] || "";
        return JSON.stringify([{ description: description || "No synopsis available.", aliases: "", airdate: year }]);
    } catch (error) {
        sendSupabaseLog("PirateXplay", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 PirateXplay — ${ref.kind} ${ref.slug}`);

    try {
        if (ref.kind === 'movies') {
            return JSON.stringify([{ href: `piratexplay-play://movies/${ref.slug}`, number: 1, title: "Movie" }]);
        }

        // Every season of the show is linked from any season page.
        const html = await getPage(`${PX_BASE}/series/${ref.slug}/`);
        const seasons = [];
        const re = /href="\/series\/([^/"]+)\/?"[^>]*class="season-btn[^"]*"[^>]*data-season="(\d+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            if (!seasons.some(s => s.slug === m[1])) seasons.push({ slug: m[1], season: parseInt(m[2], 10) });
        }
        if (seasons.length === 0) seasons.push({ slug: ref.slug, season: parseInt((ref.slug.match(/-season-(\d+)-/) || [])[1] || "1", 10) });
        seasons.sort((a, b) => a.season - b.season);

        // Season lists, a few at a time.
        const lists = [];
        for (let i = 0; i < seasons.length; i += 5) {
            const batch = await Promise.all(seasons.slice(i, i + 5).map(s => seasonData(s.slug).catch(() => null)));
            batch.forEach((data, j) => lists.push({ season: seasons[i + j], data: data }));
        }

        const episodes = [];
        for (const entry of lists) {
            const items = entry.data && Array.isArray(entry.data.episodes) ? entry.data.episodes : [];
            for (const ep of items) {
                const s = parseInt(ep.season, 10) || entry.season.season;
                const e = parseInt(ep.episode, 10);
                if (!e) continue;
                episodes.push({
                    href: `piratexplay-play://episode/${entry.season.slug}-${s}x${e}`,
                    number: episodes.length + 1,
                    season: s,
                    title: seasons.length > 1 ? `S${s} · E${e}` : `Episode ${e}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) over ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("PirateXplay", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = `${PX_BASE}/${ref.kind}/${ref.slug}/`;
    const epNumber = String((ref.slug.match(/-\d+x(\d+)$/) || [])[1] || "1");
    const seasonNumber = String((ref.slug.match(/-(\d+)x\d+$/) || [])[1] || "1");
    console.log(`[Player] 🎬 PirateXplay — ${mediaUrl}`);

    const streams = [];
    const failedLinks = [];

    try {
        const html = await getPage(mediaUrl);
        const embeds = [];
        const re = /<iframe[^>]+(?:data-src|src)="(https?:\/\/[^"]+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const link = decodeEntities(m[1]);
            if (embeds.indexOf(link) === -1) embeds.push(link);
        }

        // The index11 hubs list more servers in clear: open them all at once.
        const hubs = embeds.filter(link => hostKind(link) === 'index11');
        const hubLinks = await Promise.all(hubs.map(h => index11Links(h).catch(() => [])));
        const all = embeds.filter(link => hostKind(link) !== 'index11');
        hubLinks.forEach(list => list.forEach(link => { if (all.indexOf(link) === -1) all.push(link); }));

        // One job per distinct file (Vidmoly often appears under .net and .biz).
        const jobs = [];
        for (let link of all) {
            let kind = hostKind(link);
            if (kind === 'ravok-proxy') {
                const inner = (link.match(/[?&]url=([^&]+)/) || [])[1] || "";
                link = /^https?%3A/i.test(inner) ? decodeURIComponent(inner) : inner;
                kind = /\/video\/[a-f0-9]{16,64}/i.test(link) ? 'ravok' : null;
            }
            if (!kind) {
                failedLinks.push({ server_name: hostOf(link) || "unknown", url: link, reason: unsupportedReason(link) });
                continue;
            }
            const id = kind === 'vidmoly' ? ((link.match(/embed-([a-z0-9]+)/i) || [])[1] || link)
                : kind === 'ravok' ? (link.match(/\/video\/([a-f0-9]+)/i) || [])[1]
                : kind === 'streamruby' ? ((link.match(/\/(?:e|d)\/([A-Za-z0-9]{12})/) || [])[1] || link)
                : kind === 'byse' ? ((link.match(/\/(?:e|d|v)\/([A-Za-z0-9_-]+)/) || [])[1] || link)
                : link;
            if (!jobs.some(j => j.kind === kind && j.id === id)) jobs.push({ kind: kind, id: id, url: link });
        }

        const readers = { ravok: ravokExtract, byse: byseExtract, streamruby: streamRubyExtract, vidmoly: async u => { const r = await vidmolyExtract(u); return r ? [r] : null; }, blakite: blakiteExtract };
        const order = ['ravok', 'byse', 'streamruby', 'vidmoly', 'blakite'];
        jobs.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
        const results = await Promise.all(jobs.map(j => readers[j.kind](j.url).catch(() => null)));

        const found = [];
        jobs.forEach((job, i) => {
            const list = results[i];
            if (!list || !list.length) {
                failedLinks.push({ server_name: job.kind, url: job.url, reason: "Extraction failed" });
                return;
            }
            list.forEach(s => { if (!found.some(f => f.streamUrl === s.streamUrl)) found.push(s); });
        });
        // Same name twice (several files on one host): number them.
        found.forEach(s => {
            const same = found.filter(f => f.title === s.title);
            streams.push({ title: same.length > 1 ? `${s.title} #${same.indexOf(s) + 1}` : s.title, streamUrl: s.streamUrl, headers: s.headers });
        });

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${failedLinks.length} unsupported.`);

        sendSupabaseLog("PirateXplay", "PLAYER", {
            media_url: mediaUrl,
            season_number: seasonNumber,
            ep_number: epNumber,
            streams_found: streams.length,
            subtitles_found: false,
            allSubtitles_count: 0,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("PirateXplay", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: seasonNumber, ep_number: epNumber,
                failed_count: failedLinks.length, failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: "",
            subtitlesHeaders: {},
            allSubtitles: []
        });
    } catch (error) {
        sendSupabaseLog("PirateXplay", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
