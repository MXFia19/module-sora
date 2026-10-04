// ==========================================
// ⚙️ SORA MODULE — BCINE
// ==========================================
// bCine (bciney.to, which now lands on cineyz.com) is a TMDB-keyed catalogue.
// Its player used to be vidcorn.cfd, which went down (Cloudflare 502 on every
// path); cineyz.com now embeds vidstuck.xyz, a ZXCStream-family player. The
// catalogue still comes straight from TMDB; playback from vidstuck's backend:
//
//   POST /backend/fuckyou      {<P.tmdbId>, <P.type>, <P.server>, [<P.season>, <P.episode>]}
//     -> {ts, token}           (one token per server, obfuscated field names)
//   GET  /backend/servers/<server>?<P.*>=…   (+ title, year, release date, imdb id
//        from /backend/tmdb/details/<type>/<id>, as the player sends them)
//     -> {links:[{type:"hls"|"mp4"|"dash", link:<CryptoJS AES>}], subtitles, dubs}
//   link = CryptoJS.AES.decrypt(link, BC_LINK_KEY): OpenSSL "Salted__" format,
//   key/IV via EVP_BytesToKey (MD5), AES-256-CBC — done in pure JS below.
//   GET  /backend/subtitle?…   (same token dance, server "subtitle")
//     -> {captions:[{id, file:<.srt>, display}]}; /backend/subtitle/prox?url=
//        serves each one as WebVTT.
//
// Five servers: Orion and Centaurus answer DASH (.mpd) only, which AVPlayer
// cannot play, so they are not queried. Atlas and Ursa ("meow") give HLS whose
// segments are TS behind image/font content types. Andromeda gives MP4 for
// episodes (DASH for films), but its MP4 relay (api1.zxcstream.xyz) answers
// Cloudflare 522 only after ~20 s, and Sora has no timer to cut that wait
// short: it is left out until that relay comes back (add it to BC_PROVIDERS).
// Links are checked before being offered.

const BC_EMBED = "https://vidstuck.xyz";
const BC_SITE = "https://cineyz.com";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const BC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Passphrase the player hands to CryptoJS.AES.decrypt for every link.
const BC_LINK_KEY = "7f4c9e2a81d63b05c4f7a9e8126d3b50e1a8c7f23d9465ab0c6e9f1d4a7b832c";

// The player's obfuscated query/body field names.
const BC_P = {
    tmdbId: "a7f39c821d604e5b9c71f36e1547b",
    type: "c285f91ab306d28147a35632e816b",
    server: "6b491e7253ad84d392e7561a9384c",
    season: "d8427b59ce30684a2f957c3613e85b",
    episode: "91c6e4a728503d1f785c92346b713d",
    ts: "61d9a5274c8e3b29afd6384c291e6",
    token: "c492f7a183d6502b1e7436c538a716d",
    title: "5e28c9147a306d1e829f3674b392a1",
    year: "b731e6c94f08269d725f8341c306e",
    date: "e164932c50216a39e5814b3027",
    latestDate: "e16932c543416ad739e5814b3027",
    imdbId: "f35a8c19d674b3265e871c4933a725f"
};

// Servers that can return something AVPlayer plays (key -> display name).
const BC_PROVIDERS = [
    { key: "atlas", name: "Atlas" },
    { key: "meow", name: "Ursa" }
];

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
    // The host expects every request to carry a User-Agent; fill one in when
    // the caller did not set one (TMDB calls, notably).
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = BC_UA;
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

async function tmdbGet(path) {
    const glue = path.indexOf('?') === -1 ? '?' : '&';
    const url = `${TMDB_API}${path}${glue}api_key=${TMDB_API_KEY}`;
    const response = await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json" } });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// The embed page a browser would be on: the backend sees it as Referer.
function embedPage(ref) {
    return ref.kind === 'tv'
        ? `${BC_EMBED}/embed/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${BC_EMBED}/embed/movie/${ref.id}`;
}

function apiHeaders(ref, json) {
    const headers = {
        "User-Agent": BC_UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": embedPage(ref),
        "Origin": BC_EMBED
    };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
}

async function apiJson(url, options) {
    const body = await readBody(await soraFetch(url, options));
    if (!body || (body.charAt(0) !== '{' && body.charAt(0) !== '[')) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// Title / release date / imdb id, as the player sends them. Its own TMDB proxy
// (/backend/tmdb/details) answers the same values ("title" and "release_date"
// filled from name / first_air_date for shows), but it shares the backend's
// rate limit, so they are read from TMDB directly.
async function bcMeta(ref) {
    const data = await tmdbGet(`/${ref.kind}/${ref.id}?language=en-US&append_to_response=external_ids`);
    const meta = { title: "", date: "", latestDate: "", imdbId: "" };
    if (data) {
        meta.title = data.title || data.name || "";
        meta.date = data.release_date || data.first_air_date || "";
        meta.latestDate = data.last_air_date || "";
        meta.imdbId = data.imdb_id || (data.external_ids && data.external_ids.imdb_id) || "";
    }
    return meta;
}

// One signed request: a fresh token for <server>, then the GET it unlocks.
async function bcSigned(ref, meta, server, path) {
    const tokenBody = {};
    tokenBody[BC_P.tmdbId] = String(ref.id);
    tokenBody[BC_P.type] = ref.kind;
    tokenBody[BC_P.server] = server;
    if (ref.kind === 'tv') {
        tokenBody[BC_P.season] = parseInt(ref.season || "1", 10);
        tokenBody[BC_P.episode] = parseInt(ref.episode || "1", 10);
    }
    const token = await apiJson(`${BC_EMBED}/backend/fuckyou`,
        { method: 'POST', headers: apiHeaders(ref, true), body: JSON.stringify(tokenBody) });
    if (!token || !token.token) return null;

    const year = meta.date ? meta.date.slice(0, 4) : "";
    const params = [
        [BC_P.tmdbId, String(ref.id)],
        [BC_P.server, server],
        [BC_P.type, ref.kind],
        [BC_P.ts, String(token.ts)],
        [BC_P.token, String(token.token)],
        [BC_P.title, meta.title],
        [BC_P.year, year],
        [BC_P.date, String(meta.date || "undefined")]
    ];
    if (ref.kind === 'tv') {
        params.push([BC_P.season, String(ref.season || "1")]);
        params.push([BC_P.episode, String(ref.episode || "1")]);
        if (meta.latestDate) params.push([BC_P.latestDate, meta.latestDate]);
    }
    if (meta.imdbId) params.push([BC_P.imdbId, meta.imdbId]);
    const query = params.map(p => `${p[0]}=${formComponent(p[1])}`).join('&');
    return apiJson(`${BC_EMBED}${path}?${query}`, { method: 'GET', headers: apiHeaders(ref, false) });
}

// URLSearchParams-style encoding (spaces as "+"), as the player builds it.
function formComponent(value) {
    return encodeURIComponent(String(value)).replace(/%20/g, '+');
}

function absolute(url) {
    if (!url) return "";
    if (/^https?:\/\//.test(url)) return url;
    if (url.charAt(0) === '/') return `${BC_EMBED}${url}`;
    return "";
}

function streamHeaders() {
    return { "Referer": `${BC_EMBED}/`, "Origin": BC_EMBED, "User-Agent": BC_UA };
}

// ==========================================
// 🧮 PURE-JS CRYPTO (base64, UTF-8, MD5, AES-CBC) — no atob/crypto in Sora
// ==========================================
// base64/UTF-8/AES come from this repository's anichan module (checked
// against Node's crypto, AES-CBC 600/600 across 128/192/256-bit keys); MD5
// and the CryptoJS wrapper were checked the same way (MD5 600/600, CryptoJS
// AES 300/300).

// ---- byte helpers (no atob/btoa/TextEncoder in the runtime) ----
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToBytes(text) {
    const clean = String(text || "").replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let buffer = 0, bits = 0, n = 0;
    for (let i = 0; i < clean.length; i++) {
        buffer = (buffer << 6) | B64_CHARS.indexOf(clean.charAt(i));
        bits += 6;
        if (bits >= 8) { bits -= 8; out[n++] = (buffer >> bits) & 0xff; }
    }
    return out.subarray(0, n);
}

function bytesToBase64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        const triple = (a << 16) | (b << 8) | c;
        out += B64_CHARS[(triple >> 18) & 63] + B64_CHARS[(triple >> 12) & 63];
        out += i + 1 < bytes.length ? B64_CHARS[(triple >> 6) & 63] : "=";
        out += i + 2 < bytes.length ? B64_CHARS[triple & 63] : "=";
    }
    return out;
}

function utf8Encode(text) {
    const out = [];
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
        let code = s.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
            const low = s.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) { code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00); i++; }
        }
        if (code < 0x80) out.push(code);
        else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
        else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return new Uint8Array(out);
}

function utf8Decode(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length;) {
        const b = bytes[i];
        let code, extra;
        if (b < 0x80) { code = b; extra = 0; }
        else if (b >= 0xf0) { code = b & 0x07; extra = 3; }
        else if (b >= 0xe0) { code = b & 0x0f; extra = 2; }
        else if (b >= 0xc0) { code = b & 0x1f; extra = 1; }
        else { code = 0xfffd; extra = 0; }
        i++;
        for (let k = 0; k < extra && i < bytes.length; k++, i++) code = (code << 6) | (bytes[i] & 63);
        if (code > 0xffff) {
            code -= 0x10000;
            out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
        } else {
            out += String.fromCharCode(code);
        }
    }
    return out;
}
// ---- pure JS AES (128/192/256): block encrypt/decrypt, CTR (for GCM) and CBC ----
const AES_SBOX = new Uint8Array(256);
const AES_INV_SBOX = new Uint8Array(256);
function buildAesTables() {
    let p = 1, q = 1;
    do {
        p = (p ^ ((p << 1) & 0xff) ^ ((p & 0x80) ? 0x1b : 0)) & 0xff;
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
        if (q & 0x80) q ^= 0x09;
        const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
        AES_SBOX[p] = (x ^ 0x63) & 0xff;
    } while (p !== 1);
    AES_SBOX[0] = 0x63;
    for (let i = 0; i < 256; i++) AES_INV_SBOX[AES_SBOX[i]] = i;
}
buildAesTables();
function aesXtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; }
function aesMul(a, b) {
    let r = 0;
    while (b) { if (b & 1) r ^= a; a = aesXtime(a); b >>= 1; }
    return r;
}

// Round keys as a flat byte array (16 * (rounds + 1)).
function aesExpandKey(key) {
    const nk = key.length / 4, rounds = nk + 6, total = 4 * (rounds + 1);
    const w = new Uint8Array(total * 4);
    w.set(key, 0);
    let rcon = 1;
    for (let i = nk; i < total; i++) {
        let t0 = w[(i - 1) * 4], t1 = w[(i - 1) * 4 + 1], t2 = w[(i - 1) * 4 + 2], t3 = w[(i - 1) * 4 + 3];
        if (i % nk === 0) {
            const tmp = t0;
            t0 = AES_SBOX[t1] ^ rcon; t1 = AES_SBOX[t2]; t2 = AES_SBOX[t3]; t3 = AES_SBOX[tmp];
            rcon = aesXtime(rcon);
        } else if (nk > 6 && i % nk === 4) {
            t0 = AES_SBOX[t0]; t1 = AES_SBOX[t1]; t2 = AES_SBOX[t2]; t3 = AES_SBOX[t3];
        }
        w[i * 4] = w[(i - nk) * 4] ^ t0; w[i * 4 + 1] = w[(i - nk) * 4 + 1] ^ t1;
        w[i * 4 + 2] = w[(i - nk) * 4 + 2] ^ t2; w[i * 4 + 3] = w[(i - nk) * 4 + 3] ^ t3;
    }
    return { w: w, rounds: rounds };
}
function aesDecryptBlock(ks, input) {
    const s = new Uint8Array(16), w = ks.w, rounds = ks.rounds;
    const last = rounds * 16;
    for (let i = 0; i < 16; i++) s[i] = input[i] ^ w[last + i];
    const t = new Uint8Array(16);
    for (let round = rounds - 1; round >= 0; round--) {
        // InvShiftRows + InvSubBytes
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[((c + r) % 4) * 4 + r] = AES_INV_SBOX[s[c * 4 + r]];
        const off = round * 16;
        for (let i = 0; i < 16; i++) t[i] ^= w[off + i];
        if (round !== 0) {
            for (let c = 0; c < 4; c++) {
                const a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3];
                s[c * 4] = aesMul(a0, 14) ^ aesMul(a1, 11) ^ aesMul(a2, 13) ^ aesMul(a3, 9);
                s[c * 4 + 1] = aesMul(a0, 9) ^ aesMul(a1, 14) ^ aesMul(a2, 11) ^ aesMul(a3, 13);
                s[c * 4 + 2] = aesMul(a0, 13) ^ aesMul(a1, 9) ^ aesMul(a2, 14) ^ aesMul(a3, 11);
                s[c * 4 + 3] = aesMul(a0, 11) ^ aesMul(a1, 13) ^ aesMul(a2, 9) ^ aesMul(a3, 14);
            }
        } else {
            s.set(t);
        }
    }
    return s;
}
// AES-CBC decryption with PKCS#7 padding removal.
function aesCbcDecrypt(key, iv, data) {
    const ks = aesExpandKey(key);
    const out = new Uint8Array(data.length);
    let prev = iv;
    for (let off = 0; off + 16 <= data.length; off += 16) {
        const block = data.subarray(off, off + 16);
        const plain = aesDecryptBlock(ks, block);
        for (let i = 0; i < 16; i++) out[off + i] = plain[i] ^ prev[i];
        prev = block;
    }
    const pad = out[out.length - 1];
    return pad > 0 && pad <= 16 ? out.subarray(0, out.length - pad) : out;
}
// ---- pure JS MD5 over byte arrays (for CryptoJS's OpenSSL key derivation) ----
const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = [];
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

function md5Bytes(bytes) {
    const len = bytes.length;
    const total = (((len + 8) >> 6) + 1) * 64;
    const msg = new Uint8Array(total);
    msg.set(bytes, 0);
    msg[len] = 0x80;
    const bitLen = len * 8;
    for (let i = 0; i < 4; i++) msg[total - 8 + i] = (bitLen >>> (8 * i)) & 0xff;
    msg[total - 4] = Math.floor(len / 0x20000000) & 0xff;

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const m = new Array(16);
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) {
            const p = off + i * 4;
            m[i] = (msg[p] | (msg[p + 1] << 8) | (msg[p + 2] << 16) | (msg[p + 3] << 24)) >>> 0;
        }
        let a = a0, b = b0, c = c0, d = d0;
        for (let i = 0; i < 64; i++) {
            let f, g;
            if (i < 16) { f = (b & c) | (~b & d); g = i; }
            else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
            else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
            else { f = c ^ (b | ~d); g = (7 * i) % 16; }
            const tmp = d;
            d = c;
            c = b;
            const x = (a + f + MD5_K[i] + m[g]) >>> 0;
            b = (b + ((x << MD5_S[i]) | (x >>> (32 - MD5_S[i])))) >>> 0;
            a = tmp;
        }
        a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    const out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach((v, k) => { for (let i = 0; i < 4; i++) out[k * 4 + i] = (v >>> (8 * i)) & 0xff; });
    return out;
}

// CryptoJS.AES.decrypt(text, passphrase): base64 "Salted__" + 8-byte salt + ciphertext,
// key/IV from OpenSSL's EVP_BytesToKey (MD5, one round), AES-256-CBC, PKCS#7.
function cryptoJsAesDecrypt(b64, passphrase) {
    const raw = base64ToBytes(b64);
    if (raw.length < 32 || utf8Decode(raw.subarray(0, 8)) !== "Salted__") return "";
    const salt = raw.subarray(8, 16);
    const pass = utf8Encode(passphrase);
    let derived = new Uint8Array(0), prev = new Uint8Array(0);
    while (derived.length < 48) {
        const input = new Uint8Array(prev.length + pass.length + salt.length);
        input.set(prev, 0); input.set(pass, prev.length); input.set(salt, prev.length + pass.length);
        prev = md5Bytes(input);
        const next = new Uint8Array(derived.length + 16);
        next.set(derived, 0); next.set(prev, derived.length);
        derived = next;
    }
    const plain = aesCbcDecrypt(derived.subarray(0, 32), derived.subarray(32, 48), raw.subarray(16));
    return utf8Decode(plain);
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 bCine — searching for "${keyword}"`);
    try {
        const data = await tmdbGet(`/search/multi?query=${encodeURIComponent(keyword)}&include_adult=false&language=en-US`);
        const items = data && Array.isArray(data.results) ? data.results : [];

        const results = [];
        for (const item of items) {
            if (!item || !item.id) continue;
            const kind = item.media_type === 'tv' ? 'tv' : (item.media_type === 'movie' ? 'movie' : null);
            if (!kind) continue;

            const name = item.title || item.name || item.original_title || item.original_name;
            if (!name) continue;

            const date = item.release_date || item.first_air_date || "";
            const year = date ? date.slice(0, 4) : "";
            const badge = kind === 'tv' ? 'TV' : 'Movie';

            results.push({
                title: year ? `${name} (${year}) · ${badge}` : `${name} · ${badge}`,
                image: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : "",
                href: `bcine://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("bCine", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("bCine", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('bcine-play://', '').replace('bcine://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 bCine — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("bCine", "DETAILS", { media_url: `${BC_SITE}/${ref.kind}/${ref.id}` });

    try {
        const data = await tmdbGet(`/${ref.kind}/${ref.id}?language=en-US`);
        if (!data || !data.id) {
            return JSON.stringify([{ description: 'Entry not found on TMDB.', aliases: '', airdate: '' }]);
        }

        const description = (data.overview || "").trim() || "No synopsis available.";

        const aliasParts = [];
        if (data.vote_average) aliasParts.push(`Rating: ${Number(data.vote_average).toFixed(1)}/10`);
        if (Array.isArray(data.genres) && data.genres.length) aliasParts.push(data.genres.map(g => g.name).join(', '));
        if (data.runtime) aliasParts.push(`${data.runtime} min`);
        if (data.number_of_seasons) aliasParts.push(`${data.number_of_seasons} season(s)`);

        const airdate = data.release_date || data.first_air_date || "";

        return JSON.stringify([{
            description: description,
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("bCine", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 bCine — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `bcine-play://movie/${ref.id}`,
                number: 1,
                season: 1,
                title: "Movie"
            }]);
        }

        const show = await tmdbGet(`/tv/${ref.id}?language=en-US`);
        const seasons = show && Array.isArray(show.seasons) ? show.seasons : [];

        const episodes = [];
        for (const season of seasons) {
            const seasonNumber = season.season_number;
            // Season 0 collects the specials, which the servers do not index.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `bcine-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("bCine", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// Servers sometimes sign a link whose origin is gone (Cloudflare 52x) or
// rate-limited (429): request it once and keep only what really answers.
async function streamIsAlive(stream) {
    try {
        const headers = Object.assign({}, stream.headers);
        if (stream.kind === 'mp4') headers["Range"] = "bytes=0-1023";
        const response = await soraFetch(stream.streamUrl, { method: 'GET', headers: headers });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = await readBody(response);
        if (stream.kind === 'hls') return body.indexOf('#EXTM3U') !== -1;
        return !/^\s*</.test(body.slice(0, 64));
    } catch (e) { return false; }
}

// One server: token, links, decryption. Returns the playable streams.
async function bcServer(ref, meta, provider) {
    const data = await bcSigned(ref, meta, provider.key, `/backend/servers/${provider.key}`);
    const links = data && Array.isArray(data.links) ? data.links : [];
    const streams = [];
    links.forEach((entry, index) => {
        const kind = String(entry && entry.type || "").toLowerCase();
        if (kind !== 'hls' && kind !== 'mp4') return;          // DASH: not playable on iOS
        const link = absolute(cryptoJsAesDecrypt(String(entry.link || ""), BC_LINK_KEY));
        if (!link) return;
        const label = entry.resolution ? ` ${entry.resolution}p` : (links.length > 1 ? ` #${index + 1}` : "");
        streams.push({
            title: `bCine ${provider.name}${label} · ${kind === 'mp4' ? 'MP4' : 'HLS'}`,
            streamUrl: link,
            headers: streamHeaders(),
            kind: kind
        });
    });
    return streams;
}

async function bcSubtitles(ref, meta) {
    const data = await bcSigned(ref, meta, "subtitle", "/backend/subtitle");
    const captions = data && Array.isArray(data.captions) ? data.captions : [];
    const tracks = [];
    for (const caption of captions) {
        if (!caption || !caption.file) continue;
        tracks.push({
            // The proxy converts the .srt to WebVTT.
            url: `${BC_EMBED}/backend/subtitle/prox?url=${encodeURIComponent(caption.file)}`,
            label: String(caption.display || caption.language || "Subtitle"),
            kind: "captions",
            headers: { "Referer": `${BC_EMBED}/`, "User-Agent": BC_UA }
        });
    }
    return tracks;
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = embedPage(ref);

    console.log(`[Player] 🎬 bCine — ${mediaUrl}`);

    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const meta = await bcMeta(ref);
        if (!meta.title) console.log(`[Player] ⚠️ No TMDB details, trying anyway`);

        // Servers and subtitles are independent: ask everything at once.
        const results = await Promise.all([
            bcSubtitles(ref, meta).catch(() => []),
            ...BC_PROVIDERS.map(p => bcServer(ref, meta, p).catch(() => []))
        ]);
        const allSubtitles = results[0];

        let streams = [];
        BC_PROVIDERS.forEach((provider, i) => {
            const found = results[i + 1];
            if (found.length === 0) {
                failedLinks.push({ server_name: provider.name, url: `${BC_EMBED}/backend/servers/${provider.key}`, reason: "No playable link" });
            } else {
                console.log(`   -> ${provider.name}: ${found.length} link(s)`);
                for (const s of found) if (!streams.some(x => x.streamUrl === s.streamUrl)) streams.push(s);
            }
        });

        // Drop the links that do not answer (checked in parallel).
        const alive = await Promise.all(streams.map(s => streamIsAlive(s)));
        streams = streams.filter((s, i) => {
            if (!alive[i]) failedLinks.push({ server_name: s.title, url: s.streamUrl, reason: "Stream unreachable" });
            return alive[i];
        });
        for (const s of streams) delete s.kind;

        // English first for the default subtitle.
        const english = allSubtitles.find(s => /^english/i.test(s.label));
        if (english) {
            bestSubtitle = english.url;
            bestSubtitleHeaders = english.headers;
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("bCine", "PLAYER", {
            media_url: mediaUrl,
            season_number: String(ref.season || "1"),
            ep_number: String(ref.episode || "1"),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("bCine", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl,
                season_number: String(ref.season || "1"),
                ep_number: String(ref.episode || "1"),
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: bestSubtitle,
            subtitlesHeaders: bestSubtitleHeaders,
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("bCine", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
