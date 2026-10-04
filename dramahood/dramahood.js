// ==========================================
// ⚙️ SORA MODULE — DRAMAHOOD (dramavideo.se backend)
// ==========================================
// dramahood.mom is a WordPress drama catalog whose episodes play from
// dramavideo.se, the same backend (same video ids) behind dramanice.boo and
// kisskh.dk: one module covers that backend, through Dramahood's catalog,
// which also adds a second, independent server (vidbasic.top).
//
// Catalog (HTML, theme "asianmozi"):
//   Search  : /?s=<q>                     -> <ul class="items"> cover + title
//   Drama   : /<slug>                     -> poster, plot, fields, "List Episode"
//   Episode : /<slug>-episode-<n>/        -> servers in data-video="…" and an iframe
//
// Server 1 — dramavideo.se/watch?v=<id>
//   The watch page lists providers: <li data-provider="v2|v8|…" data-video="<code>">.
//   Its player.js builds https://player.dramavideo.se/?id=<code>&sv=<provider>
//   (that host is base64 in player.js and is re-read from there if it moves).
//   The player page ships its real HTML encrypted, with the key beside it:
//     encData="<base64>", keyHex="<64 hex>", ivHex="<32 hex>"  -> AES-256-CBC
//   and the decrypted HTML holds `const sources = JSON.parse(`[{file,type,label}]`)`.
//   Files go through hls.dramavideo.se/media/<hex>: the hex is the origin URL
//   XORed with 0x89. Origins on vibuxer.com hand out TS segments wrapped in a
//   PNG header (TikTok CDN images); they are listed last.
//   Playlists answer 403 without Referer/Origin https://player.dramavideo.se.
//
// Server 2 — vidbasic.top/embed/<id>
//   The embed links /3rdplayer.html?key=<k>&id=…&sub=<s>; that player decrypts
//   both with AES-256-CBC, UTF-8 key "94588293375053432799222445521289" and IV
//   "5259228356829423" (constants in its obfuscated script): key -> the m3u8
//   on stream.vidbasic.top, sub -> a subtitle URL.
//
// AES is implemented below in pure JS (FIPS-197; checked against Node's crypto).

const DH_BASE = "https://dramahood.mom";
const DV_BASE = "https://dramavideo.se";
const DV_PLAYER_DEFAULT = "https://player.dramavideo.se";
const VB_KEY = "94588293375053432799222445521289";
const VB_IV = "5259228356829423";
const DH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = DH_UA;
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
        headers: { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": referer || `${DH_BASE}/` }
    });
    return await readBody(response);
}

// ==========================================
// 🔐 PURE-JS AES-CBC (128/192/256) + BYTE HELPERS
// ==========================================

const AES_SBOX = [], AES_INV_SBOX = [];
function initAesTables() {
    const rotl8 = (x, s) => ((x << s) | (x >> (8 - s))) & 0xff;
    let p = 1, q = 1;
    do {
        // p *= 3 and q /= 3 in GF(2^8): q walks the multiplicative inverses of p.
        p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
        if (q & 0x80) q ^= 0x09;
        const s = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
        AES_SBOX[p] = s;
        AES_INV_SBOX[s] = p;
    } while (p !== 1);
    AES_SBOX[0] = 0x63;
    AES_INV_SBOX[0x63] = 0;
}
initAesTables();

function aesMul(a, b) {
    let r = 0;
    while (b) {
        if (b & 1) r ^= a;
        a = (a << 1) ^ (a & 0x80 ? 0x11b : 0);
        b >>= 1;
    }
    return r & 0xff;
}

function aesExpandKey(key) {
    const nk = key.length / 4, nr = nk + 6, total = 4 * (nr + 1);
    const w = [];
    for (let i = 0; i < nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    let rcon = 1;
    for (let i = nk; i < total; i++) {
        let t = w[i - 1].slice();
        if (i % nk === 0) {
            t = [AES_SBOX[t[1]] ^ rcon, AES_SBOX[t[2]], AES_SBOX[t[3]], AES_SBOX[t[0]]];
            rcon = aesMul(rcon, 2);
        } else if (nk > 6 && i % nk === 4) {
            t = t.map(b => AES_SBOX[b]);
        }
        w.push(w[i - nk].map((b, j) => b ^ t[j]));
    }
    return { w: w, nr: nr };
}

function aesDecryptBlock(block, ks) {
    const s = new Array(16);
    for (let i = 0; i < 16; i++) s[i] = block[i];
    const addRound = (round) => {
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[c * 4 + r] ^= ks.w[round * 4 + c][r];
    };
    const invShiftSub = () => {
        const t = s.slice();
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[c * 4 + r] = AES_INV_SBOX[t[((c - r + 4) % 4) * 4 + r]];
    };
    const invMix = () => {
        for (let c = 0; c < 4; c++) {
            const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
            s[c * 4] = aesMul(a0, 14) ^ aesMul(a1, 11) ^ aesMul(a2, 13) ^ aesMul(a3, 9);
            s[c * 4 + 1] = aesMul(a0, 9) ^ aesMul(a1, 14) ^ aesMul(a2, 11) ^ aesMul(a3, 13);
            s[c * 4 + 2] = aesMul(a0, 13) ^ aesMul(a1, 9) ^ aesMul(a2, 14) ^ aesMul(a3, 11);
            s[c * 4 + 3] = aesMul(a0, 11) ^ aesMul(a1, 13) ^ aesMul(a2, 9) ^ aesMul(a3, 14);
        }
    };
    addRound(ks.nr);
    for (let round = ks.nr - 1; round >= 1; round--) {
        invShiftSub();
        addRound(round);
        invMix();
    }
    invShiftSub();
    addRound(0);
    return s;
}

function aesCbcDecrypt(cipher, key, iv) {
    const ks = aesExpandKey(key);
    const out = [];
    let prev = iv;
    for (let off = 0; off + 16 <= cipher.length; off += 16) {
        const block = cipher.slice(off, off + 16);
        const plain = aesDecryptBlock(block, ks);
        for (let i = 0; i < 16; i++) out.push(plain[i] ^ prev[i]);
        prev = block;
    }
    const pad = out.length ? out[out.length - 1] : 0;
    return pad > 0 && pad <= 16 ? out.slice(0, out.length - pad) : out;
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToBytes(input) {
    const clean = String(input || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
    const out = [];
    let buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
        buffer = ((buffer << 6) | B64_CHARS.indexOf(clean.charAt(i))) & 0xffffff;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >> bits) & 0xff);
        }
    }
    return out;
}

function hexToBytes(hex) {
    const out = [];
    for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
    return out;
}

function textToBytes(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0xff);
    return out;
}

function utf8Decode(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i];
        if (c < 0x80) { out += String.fromCharCode(c); continue; }
        if (c >= 0xc0 && c < 0xe0 && i + 1 < bytes.length) {
            out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[++i] & 0x3f));
        } else if (c >= 0xe0 && c < 0xf0 && i + 2 < bytes.length) {
            out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
        } else if (c >= 0xf0 && i + 3 < bytes.length) {
            const cp = ((c & 0x07) << 18) | ((bytes[++i] & 0x3f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f);
            const v = cp - 0x10000;
            out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
        } else {
            out += String.fromCharCode(c);
        }
    }
    return out;
}

function latin1Decode(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
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

function textOf(html) {
    return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function queryParam(url, name) {
    const m = String(url).match(new RegExp(`[?&]${name}=([^&#]*)`));
    if (!m) return "";
    try { return decodeURIComponent(m[1].replace(/\+/g, "%2B")); } catch (e) { return m[1]; }
}

function field(html, label) {
    const m = String(html || "").match(new RegExp(`<strong>${label}:<\\/strong>\\s*<span>([\\s\\S]*?)<\\/span>`, "i"));
    return m ? textOf(m[1]) : "";
}

// ==========================================
// 🔌 SERVER 1 — DRAMAVIDEO.SE
// ==========================================

let dvPlayerHost = "";

// The player host is base64 in dramavideo.se/player.js ("parts" array).
async function dramavideoPlayerHost() {
    if (dvPlayerHost) return dvPlayerHost;
    try {
        const js = await getPage(`${DV_BASE}/player.js`, `${DV_BASE}/`);
        const active = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        const m = active.match(/const\s+parts\s*=\s*\[([^\]]+)\]/);
        if (m) {
            const joined = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join("");
            const host = latin1Decode(base64ToBytes(joined)).trim().replace(/\/+$/, "");
            if (/^https?:\/\/[a-z0-9.-]+$/i.test(host)) dvPlayerHost = host;
        }
    } catch (e) { /* keep the default */ }
    return dvPlayerHost || DV_PLAYER_DEFAULT;
}

// hls.dramavideo.se/media/<hex>: the origin URL XOR 0x89.
function dramavideoOrigin(fileUrl) {
    const hex = (String(fileUrl).match(/\/media\/([0-9a-f]+)/i) || [])[1];
    if (!hex) return "";
    return latin1Decode(hexToBytes(hex).map(b => b ^ 0x89));
}

function decryptPlayerHtml(html) {
    const enc = (html.match(/encData\s*=\s*"([^"]+)"/) || [])[1];
    const key = (html.match(/keyHex\s*=\s*"([0-9a-f]+)"/i) || [])[1];
    const iv = (html.match(/ivHex\s*=\s*"([0-9a-f]+)"/i) || [])[1];
    if (!enc || !key || !iv) return "";
    return utf8Decode(aesCbcDecrypt(base64ToBytes(enc), hexToBytes(key), hexToBytes(iv)));
}

function jsonArrayAfter(html, name) {
    const m = String(html || "").match(new RegExp(`const\\s+${name}\\s*=\\s*JSON\\.parse\\(\`([\\s\\S]*?)\`\\)`));
    if (!m) return [];
    try { const list = JSON.parse(m[1]); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}

async function dramavideoStreams(watchUrl, streams, subtitles, failedLinks) {
    const watchHtml = await getPage(watchUrl, `${DH_BASE}/`);
    const providers = [];
    const re = /<li[^>]*data-provider="([^"]+)"[^>]*data-video="([^"]+)"[^>]*>([^<]*)/g;
    let m;
    while ((m = re.exec(watchHtml)) !== null) providers.push({ sv: m[1], code: m[2], name: m[3].trim() || m[1] });
    if (providers.length === 0) {
        failedLinks.push({ server_name: "DramaVideo", url: watchUrl, reason: "No provider on the watch page" });
        return;
    }

    const host = await dramavideoPlayerHost();
    const headers = { "User-Agent": DH_UA, "Referer": `${host}/`, "Origin": host };

    const pages = await Promise.all(providers.map(p =>
        getPage(`${host}/?id=${encodeURIComponent(p.code)}&sv=${encodeURIComponent(p.sv)}`, watchUrl).catch(() => "")));

    const wrapped = [];
    providers.forEach((provider, i) => {
        const html = decryptPlayerHtml(pages[i] || "");
        const sources = jsonArrayAfter(html, "sources");
        if (sources.length === 0) {
            failedLinks.push({ server_name: `DramaVideo ${provider.name}`, url: watchUrl, reason: html ? "Provider returned no source" : "Player page unreadable" });
            return;
        }
        for (const source of sources) {
            const file = source && source.file;
            if (!file || streams.some(s => s.streamUrl === file) || wrapped.some(s => s.streamUrl === file)) continue;
            const origin = dramavideoOrigin(file);
            const kind = String(source.type || (/\.mp4/i.test(file) ? "mp4" : "hls")).toUpperCase();
            const entry = { title: `DramaVideo ${provider.name} · ${kind} · Sub`, streamUrl: file, headers: headers };
            if (/vibuxer\./i.test(origin)) {
                entry.title = `DramaVideo ${provider.name} · ${kind} (image-wrapped segments) · Sub`;
                wrapped.push(entry);
            } else {
                streams.push(entry);
            }
        }
        for (const track of jsonArrayAfter(html, "tracks")) {
            if (!track || !track.file || subtitles.some(s => s.url === track.file)) continue;
            subtitles.push({ url: track.file, label: track.label || "Subtitle", kind: "captions", headers: headers });
        }
    });
    // Image-wrapped TS last: not every native player strips the PNG header.
    for (const entry of wrapped) streams.push(entry);
}

// ==========================================
// 🔌 SERVER 2 — VIDBASIC.TOP
// ==========================================

function vidbasicDecrypt(value) {
    if (!value) return "";
    try {
        return utf8Decode(aesCbcDecrypt(base64ToBytes(value), textToBytes(VB_KEY), textToBytes(VB_IV))).trim();
    } catch (e) { return ""; }
}

async function vidbasicStreams(embedUrl, streams, subtitles, failedLinks) {
    const html = await getPage(embedUrl, `${DH_BASE}/`);
    const player = decodeEntities((html.match(/["'](\/3rdplayer\.html\?[^"']+)["']/) || [])[1] || "");
    if (!player) {
        failedLinks.push({ server_name: "VidBasic", url: embedUrl, reason: "No player link in the embed" });
        return;
    }
    const file = vidbasicDecrypt(queryParam(player, "key"));
    if (!/^https?:\/\//.test(file)) {
        failedLinks.push({ server_name: "VidBasic", url: embedUrl, reason: "Key did not decrypt to a URL" });
        return;
    }
    const origin = (embedUrl.match(/^https?:\/\/[^/]+/) || ["https://vidbasic.top"])[0];
    const headers = { "User-Agent": DH_UA, "Referer": `${origin}/`, "Origin": origin };
    if (!streams.some(s => s.streamUrl === file)) {
        streams.unshift({ title: `VidBasic · ${/\.m3u8/i.test(file) ? "HLS" : "MP4"} · Sub`, streamUrl: file, headers: headers });
    }
    const sub = vidbasicDecrypt(queryParam(player, "sub"));
    if (/^https?:\/\//.test(sub) && !subtitles.some(s => s.url === sub)) {
        subtitles.push({ url: sub, label: "English", kind: "captions", headers: headers });
    }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Dramahood — searching for "${keyword}"`);
    try {
        const q = encodeURIComponent(String(keyword || "").trim());
        let html = await getPage(`${DH_BASE}/?s=${q}`);
        // Ten dramas per page: read a second page when there is one.
        if (html.indexOf(`/page/2/?s=`) !== -1) html += await getPage(`${DH_BASE}/page/2/?s=${q}`);
        const block = (html.match(/<ul class="items">[\s\S]*?<\/ul>/g) || []).join("\n");

        const results = [];
        // The anchor's title attribute embeds raw HTML (with ">"), so key on
        // the href that directly precedes the cover.
        const re = /href="([^"]+)"\s*>\s*<div class="cover">[\s\S]*?<img src="([^"]+)" alt="([^"]*)"/g;
        let m;
        while ((m = re.exec(block)) !== null) {
            const slug = m[1].replace(/^https?:\/\/[^/]+\//, "").replace(/\/+$/, "");
            if (!slug || results.some(r => r.href === `dramahood://drama/${slug}`)) continue;
            results.push({ title: decodeEntities(m[3]).trim() || slug, image: m[2], href: `dramahood://drama/${slug}` });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Dramahood", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Dramahood", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function dramaUrl(url) {
    const slug = (String(url).match(/^dramahood:\/\/drama\/([^?#]+)/) || [])[1];
    if (slug) return `${DH_BASE}/${slug.replace(/\/+$/, "")}/`;
    return String(url);
}

async function extractDetails(url) {
    const pageUrl = dramaUrl(url);
    console.log(`[Details] 📖 Dramahood — ${pageUrl}`);
    sendSupabaseLog("Dramahood", "DETAILS", { media_url: pageUrl });

    try {
        const html = await getPage(pageUrl);
        const plot = textOf((html.match(/<h3><i class="t1"><\/i>Plot<\/h3>\s*<div class="info">([\s\S]*?)<\/div>/) || [])[1] || "");
        const aliasParts = [];
        for (const label of ["Original name", "Country", "Status"]) {
            const value = field(html, label);
            if (value) aliasParts.push(value);
        }
        return JSON.stringify([{
            description: plot || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: field(html, "Release year")
        }]);
    } catch (error) {
        sendSupabaseLog("Dramahood", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const pageUrl = dramaUrl(url);
    console.log(`[Episodes] 📂 Dramahood — ${pageUrl}`);

    try {
        const html = await getPage(pageUrl);
        const block = (html.match(/<ul class="list-episode">([\s\S]*?)<\/ul>/) || [])[1] || "";

        const episodes = [];
        const re = /<li>\s*(?:<img[^>]*src="([^"]*)"[^>]*>)?\s*<h2><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a><\/h2>/g;
        let m;
        while ((m = re.exec(block)) !== null) {
            const path = m[2].replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "");
            const href = `dramahood-play://${path}`;
            if (episodes.some(e => e.href === href)) continue;
            const title = decodeEntities(m[3]).trim();
            const numMatch = title.match(/\bEP(?:isode)?\s*(\d+(?:\.\d+)?)/i) || path.match(/episode-(\d+)/i);
            episodes.push({
                href: href,
                number: numMatch ? parseFloat(numMatch[1]) : 0,
                season: 1,
                title: `${/RAW\.png/i.test(m[1] || "") ? "RAW · " : ""}${title}`
            });
        }

        // Newest first on the page.
        episodes.reverse();
        episodes.forEach((e, i) => { if (!e.number) e.number = i + 1; });

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Dramahood", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const path = String(url).replace(/^dramahood-play:\/\//, "").replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "");
    const mediaUrl = `${DH_BASE}/${path}`;
    const epNumber = String((path.match(/episode-(\d+)/i) || [])[1] || "1");
    console.log(`[Player] 🎬 Dramahood — ${mediaUrl}`);

    const streams = [];
    const subtitles = [];
    const failedLinks = [];

    try {
        const html = await getPage(mediaUrl);

        // Servers: every data-video, plus the iframe already loaded.
        const servers = [];
        const re = /(?:data-video|<iframe[^>]+src)="(https?:\/\/[^"]+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const link = decodeEntities(m[1]);
            if (/vidbasic\.|dramavideo\.se\/watch/i.test(link) && servers.indexOf(link) === -1) servers.push(link);
        }
        if (servers.length === 0) failedLinks.push({ server_name: "Dramahood", url: mediaUrl, reason: "No known server on the page" });

        for (const server of servers) {
            try {
                if (/vidbasic\./i.test(server)) await vidbasicStreams(server, streams, subtitles, failedLinks);
                else await dramavideoStreams(server, streams, subtitles, failedLinks);
            } catch (e) {
                failedLinks.push({ server_name: server, url: server, reason: String(e) });
            }
        }

        const best = subtitles.find(s => /english/i.test(s.label)) || subtitles[0];

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${subtitles.length} subtitle track(s).`);

        sendSupabaseLog("Dramahood", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: epNumber,
            streams_found: streams.length,
            subtitles_found: !!best,
            allSubtitles_count: subtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("Dramahood", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: "1", ep_number: epNumber,
                failed_count: failedLinks.length, failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: best ? best.url : "",
            subtitlesHeaders: best ? best.headers : {},
            allSubtitles: subtitles
        });
    } catch (error) {
        sendSupabaseLog("Dramahood", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
