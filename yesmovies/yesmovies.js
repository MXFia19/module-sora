// ==========================================
// ⚙️ SORA MODULE — YESMOVIES
// ==========================================
// YesMovies (ww1/ww2.yesmovies.ag) has its own catalogue and plays everything
// through its own player, ployan.me.
//   search  : GET /searching?q=<q>&limit=40&offset=0
//             -> {data:[{t:title, s:slug, d:"m"|"s", n:season, y:year}]}
//             page /movie/<slug>.html, poster img.icdn.my.id/thumb/w_200/h_300/<slug>.jpg
//             (series are one page per season; episodes are li.ep-item data-id)
//   player  : the page builds https://ployan.me/watch/?v<sv><ep>#<blob>, and the
//             ployan player (an obfuscated bundle) turns that into one API call:
//               GET https://ployan.me/get/<hex salt>-<hex iv>-<hex ciphertext>
//             where ciphertext = AES-256-GCM(key = PBKDF2-HMAC-SHA256("player",
//             salt, 1000 iterations), iv, "<movie id>+<episode>+<server>+<unix time>")
//             -> {"info": <blob>, "mode": "direct"|"embed"}
//             "direct": the stream is https://ployan.me/hls/<info>/master.m3u8
//             (info itself decrypts, with the same password, to
//             "<voxzer stream id>-<time>"; ployan proxies the playlist and the
//             TS segments are served by voxzer.org). "embed" answers are third-party
//             embeds (TMDB paths) and are not used.
//             Subtitles: https://ployan.me/sub/<hex(XOR("<movie id>-<episode>", 0x13))>/index.json
// These parameters (password, iterations, plaintext layout) were read by
// watching the player's WebCrypto calls; the module re-implements SHA-256,
// HMAC, PBKDF2 and AES-256-GCM in pure JS since the runtime has no crypto API.

const YM_SITE = "https://ww2.yesmovies.ag";
const PLOYAN = "https://ployan.me";
const YM_IMG = "https://img.icdn.my.id/thumb/w_200/h_300";
const YM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PLOYAN_PASSWORD = "player";
const PLOYAN_ITERATIONS = 1000;

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
    if (!headers["User-Agent"]) headers["User-Agent"] = YM_UA;
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

async function getText(url, referer, accept) {
    const headers = { "Accept": accept || "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": referer || `${YM_SITE}/` };
    return await readBody(await soraFetch(url, { method: 'GET', headers: headers }));
}

function decodeEntities(s) {
    return String(s || "")
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&amp;/g, '&');
}

// ==========================================
// 🔐 CRYPTO (pure JS)
// ==========================================

// ---- pure-JS SHA-256 / HMAC / PBKDF2 / AES-256-GCM (encrypt) ----
const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256(bytes) {
    const len = bytes.length;
    const blocks = Math.ceil((len + 9) / 64);
    const m = new Uint8Array(blocks * 64);
    m.set(bytes);
    m[len] = 0x80;
    const bitLen = len * 8;
    m[m.length - 4] = (bitLen >>> 24) & 0xff; m[m.length - 3] = (bitLen >>> 16) & 0xff;
    m[m.length - 2] = (bitLen >>> 8) & 0xff; m[m.length - 1] = bitLen & 0xff;
    m[m.length - 5] = Math.floor(bitLen / 0x100000000) & 0xff;
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    for (let b = 0; b < blocks; b++) {
        for (let i = 0; i < 16; i++) {
            const o = b * 64 + i * 4;
            w[i] = ((m[o] << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3]) >>> 0;
        }
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15], y = w[i - 2];
            const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & bb) ^ (a & c) ^ (bb & c);
            const t2 = (S0 + maj) >>> 0;
            hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
        }
        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + bb) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) { out[i * 4] = h[i] >>> 24; out[i * 4 + 1] = (h[i] >>> 16) & 0xff; out[i * 4 + 2] = (h[i] >>> 8) & 0xff; out[i * 4 + 3] = h[i] & 0xff; }
    return out;
}

function hmacSha256(key, data) {
    let k = key.length > 64 ? sha256(key) : key;
    const ipad = new Uint8Array(64 + data.length), opad = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) { const b = i < k.length ? k[i] : 0; ipad[i] = b ^ 0x36; opad[i] = b ^ 0x5c; }
    ipad.set(data, 64);
    opad.set(sha256(ipad), 64);
    return sha256(opad);
}

// PBKDF2-HMAC-SHA256, one 32-byte block (all the AES-256 key needs).
function pbkdf2Sha256(password, salt, iterations) {
    const first = new Uint8Array(salt.length + 4);
    first.set(salt); first[salt.length + 3] = 1;
    let u = hmacSha256(password, first);
    const t = u.slice();
    for (let i = 1; i < iterations; i++) {
        u = hmacSha256(password, u);
        for (let j = 0; j < 32; j++) t[j] ^= u[j];
    }
    return t;
}

const AES256 = (function () {
    const sbox = new Uint8Array(256);
    (function init() {
        const log = new Uint8Array(256), alog = new Uint8Array(256);
        let a = 1;
        for (let i = 0; i < 255; i++) { alog[i] = a; log[a] = i; a ^= (a << 1) ^ ((a & 0x80) ? 0x11b : 0); a &= 0xff; }
        for (let i = 0; i < 256; i++) {
            let s = i === 0 ? 0 : alog[(255 - log[i]) % 255], x = s;
            for (let k = 0; k < 4; k++) { x = ((x << 1) | (x >> 7)) & 0xff; s ^= x; }
            sbox[i] = s ^ 0x63;
        }
    })();
    const rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40];
    function expand(key) {
        const w = [];
        for (let i = 0; i < 8; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
        for (let i = 8; i < 60; i++) {
            let t = w[i - 1].slice();
            if (i % 8 === 0) { t = [sbox[t[1]], sbox[t[2]], sbox[t[3]], sbox[t[0]]]; t[0] ^= rcon[i / 8 - 1]; }
            else if (i % 8 === 4) t = t.map(b => sbox[b]);
            w.push(w[i - 8].map((b, j) => b ^ t[j]));
        }
        return w;
    }
    const xt = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
    function encryptBlock(input, w) {
        const s = Array.from(input);
        const addRound = (r) => { for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) s[c * 4 + row] ^= w[r * 4 + c][row]; };
        addRound(0);
        for (let round = 1; round <= 14; round++) {
            for (let i = 0; i < 16; i++) s[i] = sbox[s[i]];
            const t = s.slice();
            for (let row = 1; row < 4; row++) for (let c = 0; c < 4; c++) s[c * 4 + row] = t[((c + row) % 4) * 4 + row];
            if (round !== 14) {
                for (let c = 0; c < 4; c++) {
                    const i = c * 4, a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3], all = a0 ^ a1 ^ a2 ^ a3;
                    s[i] ^= all ^ xt(a0 ^ a1); s[i + 1] ^= all ^ xt(a1 ^ a2); s[i + 2] ^= all ^ xt(a2 ^ a3); s[i + 3] ^= all ^ xt(a3 ^ a0);
                }
            }
            addRound(round);
        }
        return Uint8Array.from(s);
    }
    return { expand: expand, encryptBlock: encryptBlock };
})();

// GF(2^128) multiplication as used by GHASH (bit 0 = MSB of byte 0).
function gfMul(x, y) {
    const z = new Uint8Array(16), v = y.slice();
    for (let i = 0; i < 128; i++) {
        if ((x[i >> 3] >> (7 - (i & 7))) & 1) for (let j = 0; j < 16; j++) z[j] ^= v[j];
        const lsb = v[15] & 1;
        for (let j = 15; j > 0; j--) v[j] = (v[j] >>> 1) | ((v[j - 1] & 1) << 7);
        v[0] >>>= 1;
        if (lsb) v[0] ^= 0xe1;
    }
    return z;
}

// AES-256-GCM encryption with a 96-bit IV and no AAD -> ciphertext || 16-byte tag.
function aesGcmEncrypt(key, iv, plain) {
    const w = AES256.expand(key);
    const h = AES256.encryptBlock(new Uint8Array(16), w);
    const j0 = new Uint8Array(16); j0.set(iv); j0[15] = 1;
    const counter = j0.slice();
    const out = new Uint8Array(plain.length);
    for (let off = 0; off < plain.length; off += 16) {
        for (let i = 15; i >= 12; i--) { counter[i] = (counter[i] + 1) & 0xff; if (counter[i]) break; }
        const ks = AES256.encryptBlock(counter, w);
        for (let i = 0; i < 16 && off + i < plain.length; i++) out[off + i] = plain[off + i] ^ ks[i];
    }
    let y = new Uint8Array(16);
    for (let off = 0; off < out.length; off += 16) {
        const block = new Uint8Array(16);
        block.set(out.subarray(off, Math.min(off + 16, out.length)));
        for (let i = 0; i < 16; i++) y[i] ^= block[i];
        y = gfMul(y, h);
    }
    const lenBlock = new Uint8Array(16);
    const bits = out.length * 8;
    lenBlock[12] = (bits >>> 24) & 0xff; lenBlock[13] = (bits >>> 16) & 0xff; lenBlock[14] = (bits >>> 8) & 0xff; lenBlock[15] = bits & 0xff;
    for (let i = 0; i < 16; i++) y[i] ^= lenBlock[i];
    y = gfMul(y, h);
    const ek = AES256.encryptBlock(j0, w);
    const result = new Uint8Array(out.length + 16);
    result.set(out);
    for (let i = 0; i < 16; i++) result[out.length + i] = y[i] ^ ek[i];
    return result;
}


function utf8Bytes(str) {
    const s = unescape(encodeURIComponent(str));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

function toHex(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
}

function randomBytes(n) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
}

// ployan's request token: <salt>-<iv>-<AES-GCM(PBKDF2("player", salt))>.
function ployanToken(plaintext) {
    const salt = randomBytes(8), iv = randomBytes(12);
    const key = pbkdf2Sha256(utf8Bytes(PLOYAN_PASSWORD), salt, PLOYAN_ITERATIONS);
    return `${toHex(salt)}-${toHex(iv)}-${toHex(aesGcmEncrypt(key, iv, utf8Bytes(plaintext)))}`;
}

function subtitleId(movieId, episode) {
    const s = `${movieId}-${episode}`;
    let out = "";
    for (let i = 0; i < s.length; i++) { const b = s.charCodeAt(i) ^ 0x13; out += (b < 16 ? "0" : "") + b.toString(16); }
    return out;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 YesMovies — searching for "${keyword}"`);
    try {
        const body = await getText(`${YM_SITE}/searching?q=${encodeURIComponent(keyword)}&limit=40&offset=0`, `${YM_SITE}/search.html`, "application/json");
        let data = null;
        try { data = JSON.parse(body); } catch (e) { }
        const results = [];
        for (const item of ((data && data.data) || [])) {
            if (!item || !item.s || !item.t) continue;
            const badge = item.d === 's' ? 'TV' : 'Movie';
            results.push({
                title: `${decodeEntities(item.t)}${item.y ? ` (${item.y})` : ''} · ${badge}`,
                image: `${YM_IMG}/${item.s}.jpg`,
                href: `${YM_SITE}/movie/${item.s}.html`
            });
        }
        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("YesMovies", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("YesMovies", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function pageUrl(url) {
    return String(url).split('#')[0];
}

function movieIdOf(url) {
    return (pageUrl(url).match(/-(\d+)\.html/) || [])[1] || "";
}

async function extractDetails(url) {
    console.log(`[Details] 📖 YesMovies — ${url}`);
    sendSupabaseLog("YesMovies", "DETAILS", { media_url: pageUrl(url) });
    try {
        const html = await getText(pageUrl(url));
        const description = decodeEntities((html.match(/<meta name=description content="([^"]*)"/) || html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "") || "No synopsis available.";
        const year = (html.match(/Release:<\/strong>\s*<a[^>]*>(\d{4})/) || [])[1] || "";
        const imdb = (html.match(/IMDb:<\/strong>\s*([^<]+)</) || [])[1] || "";
        const duration = (html.match(/Duration:<\/strong>\s*([^<]+)</) || [])[1] || "";
        const aliases = [];
        if (imdb) aliases.push(`IMDb ${imdb.trim()}`);
        if (duration) aliases.push(duration.trim());
        return JSON.stringify([{ description: description, aliases: aliases.join(' | '), airdate: year }]);
    } catch (error) {
        sendSupabaseLog("YesMovies", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    console.log(`[Episodes] 📂 YesMovies — ${url}`);
    try {
        const page = pageUrl(url);
        const html = await getText(page);
        // Server 1 is the "direct" one; its list is the reference.
        const list = html.match(/<ul id=["']?episodes-sv-1["']?[^>]*>([\s\S]*?)<\/ul>/) || html.match(/<ul id=["']?episodes-sv-\d+["']?[^>]*>([\s\S]*?)<\/ul>/);
        const episodes = [];
        const seen = {};
        const re = /<li class=["']?ep-item["']?[^>]*data-id=["']?(\d+)["']?[^>]*>\s*<a[^>]*title=["']?([^"'>]*)["']?/g;
        let m;
        while (list && (m = re.exec(list[1])) !== null) {
            if (seen[m[1]]) continue;
            seen[m[1]] = true;
            episodes.push({ eid: m[1], title: decodeEntities(m[2]) });
        }
        const isSeries = /season-\d+/i.test(page) || episodes.length > 1;
        const season = parseInt((page.match(/season-(\d+)/i) || [])[1] || "1", 10);
        if (!isSeries) {
            return JSON.stringify([{ href: `${page}#ep=${episodes[0] ? episodes[0].eid : 1}`, number: 1, season: 1, title: "Movie" }]);
        }
        const out = episodes.map((ep, i) => {
            const n = parseInt((ep.title.match(/(\d+)/) || [])[1] || String(i + 1), 10);
            return { href: `${page}#ep=${ep.eid}`, number: n, season: season, title: ep.title || `Episode ${n}` };
        });
        out.sort((a, b) => a.number - b.number);
        console.log(`[Episodes] ✅ ${out.length} episode(s)`);
        return JSON.stringify(out);
    } catch (error) {
        sendSupabaseLog("YesMovies", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const page = pageUrl(url);
    const mid = movieIdOf(url);
    const eid = (String(url).match(/#ep=(\d+)/) || [])[1] || "1";
    console.log(`[Player] 🎬 YesMovies — movie ${mid} episode ${eid}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];

    try {
        // Server 1 answers "direct" (ployan's own HLS proxy); the others are embeds.
        for (const sv of ["1"]) {
            const now = Math.floor(Date.now() / 1000);
            const token = ployanToken(`${mid}+${eid}+${sv}+${now}`);
            const watch = `${PLOYAN}/watch/?v${sv}${eid}`;
            const body = await getText(`${PLOYAN}/get/${token}`, watch, "application/json");
            let data = null;
            try { data = JSON.parse(body); } catch (e) { }
            if (!data || data.code !== 200 || !data.info) {
                failedLinks.push({ server_name: `Server ${sv}`, url: `${PLOYAN}/get/…`, reason: (data && (data.msg || data.message)) || "ployan refused the token" });
                continue;
            }
            if (data.mode !== 'direct') {
                failedLinks.push({ server_name: `Server ${sv}`, url: watch, reason: `mode=${data.mode} (third-party embed)` });
                continue;
            }
            streams.push({
                title: `YesMovies Server ${sv} (HLS)`,
                streamUrl: `${PLOYAN}/hls/${data.info}/master.m3u8`,
                headers: { "Referer": `${PLOYAN}/`, "Origin": PLOYAN, "User-Agent": YM_UA }
            });
        }

        // Subtitle list for this movie/episode.
        try {
            const subId = subtitleId(mid, eid);
            const subs = JSON.parse(await getText(`${PLOYAN}/sub/${subId}/index.json`, `${PLOYAN}/`, "application/json"));
            for (const sub of (Array.isArray(subs) ? subs : [])) {
                if (!sub || !sub.file) continue;
                const subUrl = /^https?:/.test(sub.file) ? sub.file : `${PLOYAN}${sub.file}`;
                allSubtitles.push({ url: subUrl, label: sub.label || sub.lang || "Unknown", kind: "captions", headers: { "Referer": `${PLOYAN}/` } });
            }
        } catch (e) { }

        const english = allSubtitles.find(s => /english|^en$/i.test(s.label));
        const bestSubtitle = english ? english.url : (allSubtitles[0] ? allSubtitles[0].url : "");

        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("YesMovies", "PLAYER", {
            media_url: page,
            season_number: String((page.match(/season-(\d+)/i) || [])[1] || "1"),
            ep_number: eid,
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("YesMovies", "UNSUPPORTED_HOSTS", {
                media_url: page,
                season_number: String((page.match(/season-(\d+)/i) || [])[1] || "1"),
                ep_number: eid,
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: bestSubtitle,
            subtitlesHeaders: bestSubtitle ? { "Referer": `${PLOYAN}/` } : {},
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("YesMovies", "ERROR", { media_url: page, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
