// ==========================================
// ⚙️ SORA MODULE — XPASS
// ==========================================
// XPass (play.xpass.top) is an embed player keyed by TMDB id that many
// multi-server catalogues list among their servers: TVids (Server 1),
// HydraHD, WatchSeries, StreameX ("Surge"), ZFlix, Vidbox, Youflex/ZetMoon,
// Zerostream ("XPass", its first source), Moviepire/Phland… IceFY's own
// "streams.icefy.top" backend is nothing but a server-side XPass scraper.
//
// How the player gets its servers:
//   GET /e/movie/<id>  |  /e/tv/<id>/<s>/<e>
//       -> var dataUrl="/data/movie/<id>?autostart=true&token=<b64>.<hmac>"
//          var suburl="https://sub.1x2.space/api/movie/<id>"
//   GET <dataUrl>  -> base64url( iv[12] | AES-256-GCM ciphertext | tag[16] )
//       key = SHA-256("spv3-data-response|" + BUILD + "|" + <dataUrl path>
//                     + "|" + <token>)
//       plaintext = [{id, name:"LUL 1", url:"/mdata/<id>/0/playlist.json"}, …]
//   GET /mdata/…/playlist.json -> {playlist:[{sources:[{file, type, label}]}]}
//
// BUILD ("spv3-build-<ts>-<hash>") changes with every deployment. It sits
// in the obfuscated player script, whose randomised name itself sits in the
// obfuscated loader (static/mainmini.js). Both are obfuscator.io string
// arrays (custom base64), which are decoded here without running any of
// their code: every array entry is decoded and the two values are matched
// by shape. The last known BUILD is kept as a fallback.
// SHA-256 and AES-256-GCM (CTR keystream, tag not checked) are pure JS.
//
// Only some server families give a stream a native player can use: the
// "TIK"/"FIL" ones serve TS segments disguised as PNG images that the site's
// service worker unwraps, and several others were dead in testing. The
// families kept below were the ones that answered; every candidate master
// playlist is still probed before being offered.

const XP_BASE = "https://play.xpass.top";
const XP_SUBS = "https://sub.1x2.space";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const XP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Last BUILD seen (2026-10); used when the live one cannot be read.
const XP_BUILD_FALLBACK = "spv3-build-1787821613-50e5fc97c9dce367";

// Server families worth asking (prefix of "name").
const XP_FAMILIES = ["LUL", "VIP", "MOL", "WIS", "BOX", "ARA"];

// Hosts whose segments are PNG-wrapped TS (service-worker only).
const XP_DISGUISED_HOST = /^(tik|gle)\d*\.1x2\.space$/i;

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
    if (!headers["User-Agent"]) headers["User-Agent"] = XP_UA;
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

async function xpGet(path, referer) {
    const headers = {
        "User-Agent": XP_UA,
        "Accept": "*/*",
        "Referer": referer || `${XP_BASE}/`
    };
    const url = /^https?:/.test(path) ? path : `${XP_BASE}${path}`;
    return await readBody(await soraFetch(url, { method: 'GET', headers: headers }));
}

function streamHeaders() {
    return { "Referer": `${XP_BASE}/`, "Origin": XP_BASE, "User-Agent": XP_UA };
}

// ==========================================
// 🔤 BYTES
// ==========================================

const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64UrlToBytes(input) {
    const clean = String(input).trim().replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
    const bytes = [];
    let buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
        const v = B64_STD.indexOf(clean.charAt(i));
        if (v < 0) continue;
        buffer = ((buffer << 6) | v) & 0xffffff;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 255);
        }
    }
    return bytes;
}

function utf8Encode(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
            const d = str.charCodeAt(i + 1);
            if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
        }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
}

function utf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
        const c = bytes[i++];
        if (c < 0x80) {
            out += String.fromCharCode(c);
        } else if (c >= 0xc0 && c < 0xe0) {
            out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
        } else if (c >= 0xe0 && c < 0xf0) {
            out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
        } else if (c >= 0xf0) {
            let cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        }
    }
    return out;
}

// ==========================================
// 🔐 SHA-256 + AES-256-GCM (pure JS)
// ==========================================

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

// SHA-256 of a byte array, returned as 32 bytes.
function sha256(bytes) {
    const msg = bytes.slice();
    const bitLen = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    msg.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
    msg.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let off = 0; off < msg.length; off += 64) {
        for (let t = 0; t < 16; t++) {
            const j = off + t * 4;
            w[t] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) | 0;
        }
        for (let t = 16; t < 64; t++) {
            const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let t = 0; t < 64; t++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + SHA256_K[t] + w[t]) | 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    const out = [];
    for (const v of [h0, h1, h2, h3, h4, h5, h6, h7]) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    return out;
}

// AES-256 block encryption + GCM decryption through its CTR keystream (the
// authentication tag is not checked). Same construction as this repository's
// voir-anime module.
const AES_SBOX = (function () {
    const sbox = new Array(256);
    let p = 1, q = 1;
    const rotl8 = (x, s) => ((x << s) | (x >> (8 - s))) & 0xff;
    do {
        p = (p ^ (p << 1) ^ ((p & 0x80) ? 0x11b : 0)) & 0xff;
        q &= 0xff; q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09; q &= 0xff;
        sbox[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
    } while (p !== 1);
    sbox[0] = 0x63;
    return sbox;
})();
const AES_RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

function aesExpandKey256(key) {
    const Nk = 8, words = 60, w = new Array(words);
    for (let i = 0; i < Nk; i++) w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
    for (let i = Nk; i < words; i++) {
        let t = w[i - 1].slice();
        if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => AES_SBOX[b]); t[0] ^= AES_RCON[i / Nk - 1]; }
        else if (i % Nk === 4) { t = t.map(b => AES_SBOX[b]); }
        w[i] = w[i - Nk].map((b, j) => (b ^ t[j]) & 0xff);
    }
    return w;
}

function aesGmul(a, b) {
    let r = 0;
    for (let i = 0; i < 8; i++) {
        if (b & 1) r ^= a;
        const hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
    }
    return r & 0xff;
}

function aesEncryptBlock(input, w) {
    const s = input.slice();
    const addRoundKey = (round) => { for (let c = 0; c < 16; c++) s[c] ^= w[round * 4 + (c >> 2)][c & 3]; };
    const subBytes = () => { for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]]; };
    const shiftRows = () => { const t = s.slice(); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s[r + 4 * c] = t[r + 4 * ((c + r) % 4)]; };
    const mixColumns = () => {
        for (let c = 0; c < 4; c++) {
            const i = 4 * c, a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
            s[i] = aesGmul(a0, 2) ^ aesGmul(a1, 3) ^ a2 ^ a3;
            s[i + 1] = a0 ^ aesGmul(a1, 2) ^ aesGmul(a2, 3) ^ a3;
            s[i + 2] = a0 ^ a1 ^ aesGmul(a2, 2) ^ aesGmul(a3, 3);
            s[i + 3] = aesGmul(a0, 3) ^ a1 ^ a2 ^ aesGmul(a3, 2);
        }
    };
    addRoundKey(0);
    for (let round = 1; round < 14; round++) { subBytes(); shiftRows(); mixColumns(); addRoundKey(round); }
    subBytes(); shiftRows(); addRoundKey(14);
    return s;
}

// payload = ciphertext | tag(16)
function aesGcmDecrypt(key, iv, payload) {
    const w = aesExpandKey256(key);
    const ct = payload.slice(0, payload.length - 16);
    const counter = new Array(16).fill(0);
    for (let i = 0; i < 12; i++) counter[i] = iv[i];
    counter[15] = 1;
    const inc = () => { for (let i = 15; i >= 12; i--) { counter[i] = (counter[i] + 1) & 0xff; if (counter[i]) break; } };
    const out = new Array(ct.length);
    for (let off = 0; off < ct.length; off += 16) {
        inc();
        const ks = aesEncryptBlock(counter, w);
        for (let i = 0; i < 16 && off + i < ct.length; i++) out[off + i] = ct[off + i] ^ ks[i];
    }
    return out;
}

// ==========================================
// 🧩 OBFUSCATED STRING ARRAYS
// ==========================================

// obfuscator.io "base64" strings: lower-case-first alphabet, then UTF-8
// percent-decoding.
const OBF_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";

function obfDecode(str) {
    const bytes = [];
    let bc = 0, bs = 0;
    for (let i = 0; i < str.length; i++) {
        const v = OBF_ALPHABET.indexOf(str.charAt(i));
        if (v < 0 || v === 64) continue;
        bs = bc % 4 ? bs * 64 + v : v;
        if (bc++ % 4) bytes.push(255 & (bs >> ((-2 * bc) & 6)));
    }
    return utf8Decode(bytes);
}

function unescapeJsString(s) {
    return s.replace(/\\x([0-9a-fA-F]{2})/g, (a, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\u([0-9a-fA-F]{4})/g, (a, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\(.)/g, "$1");
}

// Every decoded entry of the script's string array(s), plus the plain literals.
function obfStrings(source) {
    const out = [];
    if (!source) return out;
    const arrayRe = /(?:const|var|let) [\w$]+=\[((?:'(?:[^'\\]|\\.)*',?){8,})\]/g;
    let m;
    while ((m = arrayRe.exec(source)) !== null) {
        const itemRe = /'((?:[^'\\]|\\.)*)'/g;
        let it;
        while ((it = itemRe.exec(m[1])) !== null) {
            const raw = unescapeJsString(it[1]);
            out.push(raw);
            try { out.push(obfDecode(raw)); } catch (e) { }
        }
    }
    return out;
}

async function xpBuild(embedHtml, embedUrl) {
    try {
        const loader = (embedHtml.match(/src="(\/static\/mainmini\.js[^"]*)"/) || [])[1] || "/static/mainmini.js";
        const loaderJs = await xpGet(loader, embedUrl);
        const scriptPath = obfStrings(loaderJs).find(s => /^\/static\/[A-Za-z0-9_-]+\.js(\?|$)/.test(s) && s.indexOf("mainmini") === -1 && s.indexOf("sdbmini") === -1);
        if (!scriptPath) return XP_BUILD_FALLBACK;
        const playerJs = await xpGet(scriptPath, embedUrl);
        const plain = (playerJs.match(/spv3-build-[A-Za-z0-9-]+/) || [])[0];
        if (plain) return plain;
        const build = obfStrings(playerJs).find(s => /^spv3-build-[A-Za-z0-9-]+$/.test(s));
        return build || XP_BUILD_FALLBACK;
    } catch (e) {
        return XP_BUILD_FALLBACK;
    }
}

function xpDecryptData(body, build, dataPath, token) {
    const raw = base64UrlToBytes(body);
    if (raw.length <= 28) return null;
    const key = sha256(utf8Encode(`spv3-data-response|${build}|${dataPath}|${token}`));
    const plain = aesGcmDecrypt(key, raw.slice(0, 12), raw.slice(12));
    try { return JSON.parse(utf8Decode(plain)); } catch (e) { return null; }
}

// A master playlist that answers: GET it and look for #EXTM3U.
async function xpAlive(url) {
    try {
        const response = await soraFetch(url, { method: 'GET', headers: streamHeaders() });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = await readBody(response);
        return !!body && body.indexOf("#EXTM3U") !== -1;
    } catch (e) { return false; }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 XPass — searching for "${keyword}"`);
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
                href: `xpass://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("XPass", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("XPass", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('xpass-play://', '').replace('xpass://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 XPass — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("XPass", "DETAILS", { media_url: `${XP_BASE}/e/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("XPass", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 XPass — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `xpass-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which XPass does not index.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `xpass-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("XPass", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const embedPath = ref.kind === 'tv'
        ? `/e/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `/e/movie/${ref.id}`;
    const embedUrl = `${XP_BASE}${embedPath}?autostart=true`;

    console.log(`[Player] 🎬 XPass — ${embedUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const html = await xpGet(embedUrl, `${XP_BASE}/`);
        const dataUrl = (html.match(/var\s+dataUrl\s*=\s*"([^"]+)"/) || [])[1];
        if (!dataUrl) {
            console.log(`[Player] ⚠️ No dataUrl in the embed page.`);
            sendSupabaseLog("XPass", "UNSUPPORTED_HOSTS", {
                media_url: embedUrl, season_number: String(ref.season || "1"), ep_number: String(ref.episode || "1"),
                failed_count: 1, failed_links: [{ server_name: "XPass", url: embedUrl, reason: "No dataUrl" }]
            });
            return JSON.stringify({ type: "none" });
        }
        const subUrl = (html.match(/var\s+suburl\s*=\s*"([^"]+)"/) || [])[1] || "";

        const dataPath = dataUrl.split('?')[0];
        const tokenMatch = dataUrl.match(/[?&]token=([^&]+)/);
        const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : "";

        const [build, body, subsBody] = await Promise.all([
            xpBuild(html, embedUrl),
            xpGet(dataUrl, embedUrl),
            subUrl ? xpGet(subUrl, `${XP_BASE}/`) : Promise.resolve("")
        ]);

        let list = xpDecryptData(body, build, dataPath, token);
        if (!Array.isArray(list) && build !== XP_BUILD_FALLBACK) list = xpDecryptData(body, XP_BUILD_FALLBACK, dataPath, token);
        if (!Array.isArray(list)) {
            console.log(`[Player] ⚠️ Server list could not be decrypted (build ${build}).`);
            sendSupabaseLog("XPass", "UNSUPPORTED_HOSTS", {
                media_url: embedUrl, season_number: String(ref.season || "1"), ep_number: String(ref.episode || "1"),
                failed_count: 1, failed_links: [{ server_name: "XPass", url: dataPath, reason: `decrypt failed (${build})` }]
            });
            return JSON.stringify({ type: "none" });
        }
        console.log(`[Player] 🧩 ${list.length} server(s) listed, build ${build}`);

        const wanted = list.filter(entry => entry && entry.url && XP_FAMILIES.indexOf(String(entry.name || "").split(" ")[0]) !== -1);
        for (const entry of list) {
            if (entry && wanted.indexOf(entry) === -1) failedLinks.push({ server_name: entry.name, url: entry.url, reason: "family skipped" });
        }

        // Each server: playlist.json, then a probe of the playlist it points to.
        const results = await Promise.all(wanted.map(async entry => {
            try {
                const text = await xpGet(entry.url, embedUrl);
                const json = JSON.parse(text);
                const items = json && Array.isArray(json.playlist) ? json.playlist : [];
                const found = [];
                for (const item of items) {
                    for (const source of (item && Array.isArray(item.sources) ? item.sources : [])) {
                        const file = source && source.file;
                        if (!file || !/^https?:\/\//.test(file)) continue;
                        const host = (file.match(/^https?:\/\/([^/]+)/) || [])[1] || "";
                        if (XP_DISGUISED_HOST.test(host) || /\.mycdn\.com$/i.test(host)) continue;
                        found.push(file);
                    }
                }
                const alive = [];
                for (const file of found) if (await xpAlive(file)) alive.push(file);
                return { entry: entry, files: alive, total: found.length };
            } catch (e) {
                return { entry: entry, files: [], total: 0, error: String(e) };
            }
        }));

        for (const result of results) {
            if (!result.files.length) {
                failedLinks.push({ server_name: result.entry.name, url: result.entry.url, reason: result.error || (result.total ? "dead playlist" : "no usable source") });
                continue;
            }
            result.files.forEach((file, i) => {
                if (streams.some(s => s.streamUrl === file)) return;
                streams.push({
                    title: `XPass ${result.entry.name}${result.files.length > 1 ? ` #${i + 1}` : ""}`,
                    streamUrl: file,
                    headers: streamHeaders()
                });
            });
            console.log(`   -> ${result.entry.name}: ${result.files.length} stream(s)`);
        }

        // Subtitles: [{label, language, url:"/subtitle/movie/<id>/English.vtt"}]
        try {
            const subs = subsBody ? JSON.parse(subsBody) : [];
            for (const sub of (Array.isArray(subs) ? subs : [])) {
                if (!sub || !sub.url) continue;
                const full = /^https?:/.test(sub.url) ? sub.url : `${XP_SUBS}${sub.url}`;
                if (allSubtitles.some(s => s.url === full)) continue;
                allSubtitles.push({ url: full, label: sub.label || sub.language || "Unknown", kind: "captions", headers: { "Referer": `${XP_BASE}/` } });
                if (!bestSubtitle && /^english$/i.test(String(sub.language || sub.label || ""))) {
                    bestSubtitle = full;
                    bestSubtitleHeaders = { "Referer": `${XP_BASE}/` };
                }
            }
        } catch (e) { }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("XPass", "PLAYER", {
            media_url: embedUrl,
            season_number: String(ref.season || "1"),
            ep_number: String(ref.episode || "1"),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("XPass", "UNSUPPORTED_HOSTS", {
                media_url: embedUrl,
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
        sendSupabaseLog("XPass", "ERROR", { media_url: embedUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
