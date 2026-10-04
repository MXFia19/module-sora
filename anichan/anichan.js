// ==========================================
// ⚙️ SORA MODULE — ANICHAN
// ==========================================
// anichan.to is a Next.js anime site keyed by AniList id with its own
// aggregator API. Every stream it returns already goes through its relay
// (c.toroplay.cymru, signed links), so no header is needed to play them.
//
//   1. Search    GET /search?q=<text>            (server-rendered cards)
//                <a class="card" href="/anime/<id>/<slug>"> … <div class="nm">
//   2. Entry     GET /api/catalog/anime/<id>     -> AniList-like record
//   3. Episodes  GET /api/watch/episodes?anilistId=<id> -> {episodes, dubAvailable}
//   4. Session   POST /api/watch/session {"token": ""}
//                -> Set-Cookie anichan_ws=…, body {n: "<base64 nonce>"}
//                The token is a Cloudflare Turnstile answer only when
//                /site-config publishes a turnstileSiteKey; it is null today,
//                so an empty token is accepted.
//   5. Servers   GET /api/watch/servers?anilistId=<id>&ep=<n>&category=<sub|dub>&tier=fast
//                headers X-Wk: <key id> + the session cookie
//                -> {v:1, i:<iv b64>, d:<AES-GCM ciphertext+tag b64>}
//                Without X-Wk the server answers an empty list.
//
// Decryption, all constants from the site's bundle:
//   key0   = base64(P) XOR base64(I)                (32 bytes)
//   aesKey = HMAC-SHA256(key0, n)                   (n = session nonce, as text)
//   plain  = AES-256-GCM(aesKey, iv).decrypt(d)     -> {servers:[{name, label,
//            type:"hls"|"embed", stream, subtitles:[{lang,url}], …}]}
// SHA-256, HMAC, AES and base64 are implemented below in pure JS (GCM is read
// as CTR from counter 2; the tag is not checked).
//
// The session cookie is bound to the client IP: create it and read the
// servers from the same address, and re-create it on a 401 (the site does the
// same).

const AC_BASE = "https://anichan.to";

// Constants of the site's watch module (chunk 7621).
const AC_WK = "a8c6e3d0";
const AC_KEY_P = "ICo+KyF5ANB1XEOjrMNcodrjnVH2OpV1CYKx1HPMlUc=";
const AC_KEY_I = "DWT7cCRlI2rx2AVa5vICiZsrxK3My5duU3Y2Oys7FqQ=";

// Session attempts per stream request (a fresh session after each 401).
const AC_SESSION_TRIES = 10;

const AC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    // the caller did not set one.
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = AC_UA;
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

function responseHeader(response, name) {
    if (!response || !response.headers) return "";
    const wanted = name.toLowerCase();
    const headers = response.headers;
    if (typeof headers.get === 'function') {
        try { return headers.get(name) || ""; } catch (e) { /* plain object below */ }
    }
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === wanted) {
            const value = headers[key];
            return Array.isArray(value) ? value.join(', ') : String(value || "");
        }
    }
    return "";
}

async function acGetJson(path, referer) {
    const headers = { "User-Agent": AC_UA, "Accept": "application/json", "Referer": referer || `${AC_BASE}/` };
    const text = await readBody(await soraFetch(`${AC_BASE}${path}`, { method: 'GET', headers: headers }));
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
}

function decodeEntities(text) {
    return String(text || "")
        .replace(/&quot;/g, '"').replace(/&#x27;|&#0?39;/g, "'").replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function cleanText(html) {
    if (!html) return "";
    return decodeEntities(String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 AniChan — searching for "${keyword}"`);
    try {
        const headers = { "User-Agent": AC_UA, "Accept": "text/html", "Referer": `${AC_BASE}/` };
        const html = await readBody(await soraFetch(`${AC_BASE}/search?q=${encodeURIComponent(keyword)}`, { method: 'GET', headers: headers }));

        const results = [];
        const cardRe = /<a class="card" href="\/anime\/(\d+)\/[^"]*">([\s\S]*?)<\/a>/g;
        let m;
        while ((m = cardRe.exec(html)) !== null) {
            const id = m[1];
            if (results.some(r => r.href === `anichan://${id}`)) continue;
            const body = m[2];
            const name = (body.match(/<div class="nm">([^<]*)<\/div>/) || [])[1] || (body.match(/alt="([^"]*)"/) || [])[1] || `AniList ${id}`;
            const meta = (body.match(/<div class="meta2">([^<]*)<\/div>/) || [])[1] || "";
            let image = (body.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
            image = image.replace('/cover/small/', '/cover/large/');
            const cleanMeta = decodeEntities(meta).replace(/\s+/g, ' ').trim();
            results.push({
                title: cleanMeta ? `${decodeEntities(name)} (${cleanMeta})` : decodeEntities(name),
                image: image,
                href: `anichan://${id}`
            });
        }

        // The page is server-rendered; if its markup ever changes, fall back
        // on the suggestion endpoint.
        if (results.length === 0) {
            const data = await acGetJson(`/api/suggest?q=${encodeURIComponent(keyword)}`);
            for (const item of (data && Array.isArray(data.results) ? data.results : [])) {
                if (!item || !item.id) continue;
                results.push({ title: item.title || item.titleRomaji || `AniList ${item.id}`, image: item.poster || "", href: `anichan://${item.id}` });
            }
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("AniChan", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("AniChan", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function idFrom(url) {
    return String(url).replace('anichan://', '').replace('anichan-play://', '').split('/')[0];
}

async function extractDetails(url) {
    const anilistId = idFrom(url);
    console.log(`[Details] 📖 AniChan — AniList ${anilistId}`);
    sendSupabaseLog("AniChan", "DETAILS", { media_url: `${AC_BASE}/anime/${anilistId}` });

    try {
        const anime = await acGetJson(`/api/catalog/anime/${encodeURIComponent(anilistId)}`);
        if (!anime || (!anime.description && !anime.title)) {
            return JSON.stringify([{ description: 'Entry not found on AniChan.', aliases: '', airdate: '' }]);
        }

        const aliasParts = [];
        if (anime.score) aliasParts.push(`Score: ${anime.score}/100`);
        if (Array.isArray(anime.genres) && anime.genres.length) aliasParts.push(anime.genres.join(', '));
        if (Array.isArray(anime.synonyms) && anime.synonyms.length) aliasParts.push(anime.synonyms.slice(0, 3).join(' · '));
        if (Array.isArray(anime.studios) && anime.studios.length) aliasParts.push(anime.studios.join(', '));

        let airdate = anime.season ? `${anime.season}` : "";
        const start = anime.startDate;
        if (start && start.year && start.month && start.day) {
            airdate = `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
        }
        if (anime.status) airdate = airdate ? `${airdate} · ${anime.status}` : anime.status;

        return JSON.stringify([{
            description: cleanText(anime.description) || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("AniChan", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const anilistId = idFrom(url);
    console.log(`[Episodes] 📂 AniChan — AniList ${anilistId}`);

    try {
        const data = await acGetJson(`/api/watch/episodes?anilistId=${encodeURIComponent(anilistId)}`);
        let total = data && typeof data.episodes === 'number' ? data.episodes : 0;

        if (total <= 0) {
            const anime = await acGetJson(`/api/catalog/anime/${encodeURIComponent(anilistId)}`);
            if (anime && typeof anime.episodes === 'number' && anime.episodes > 0) total = anime.episodes;
            else if (anime && anime.nextAiring && anime.nextAiring.episode > 1) total = anime.nextAiring.episode - 1;
        }
        if (total <= 0) total = 1;

        const episodes = [];
        for (let n = 1; n <= total; n++) {
            episodes.push({ href: `anichan-play://${anilistId}/${n}`, number: n, season: 1, title: `Episode ${n}` });
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("AniChan", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🔐 SESSION + DECRYPTION
// ==========================================

async function openSession(referer) {
    const headers = {
        "User-Agent": AC_UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": AC_BASE,
        "Referer": referer
    };
    const response = await soraFetch(`${AC_BASE}/api/watch/session`, { method: 'POST', headers: headers, body: JSON.stringify({ token: "" }) });
    const text = await readBody(response);
    let body = null;
    try { body = JSON.parse(text); } catch (e) { body = null; }
    if (!body || !body.ok || !body.n) return null;
    const setCookie = responseHeader(response, 'set-cookie');
    const cookie = (setCookie.match(/anichan_ws=([^;,\s]+)/) || [])[1] || "";
    return { nonce: String(body.n), cookie: cookie };
}

function decryptServers(payload, nonce) {
    try {
        const p = base64ToBytes(AC_KEY_P), i = base64ToBytes(AC_KEY_I);
        const key0 = new Uint8Array(p.length);
        for (let k = 0; k < p.length; k++) key0[k] = p[k] ^ i[k];
        const aesKey = hmacSha256(key0, utf8Encode(nonce));
        const plain = aesGcmDecrypt(aesKey, base64ToBytes(payload.i), base64ToBytes(payload.d));
        return JSON.parse(utf8Decode(plain));
    } catch (e) {
        console.log(`[Player] ⚠️ Decryption failed: ${e.message}`);
        return null;
    }
}

async function fetchServers(session, anilistId, epNumber, category, tier, referer) {
    const headers = { "User-Agent": AC_UA, "Accept": "application/json", "X-Wk": AC_WK, "Referer": referer };
    if (session.cookie) headers["Cookie"] = `anichan_ws=${session.cookie}`;
    const path = `/api/watch/servers?anilistId=${encodeURIComponent(anilistId)}&ep=${encodeURIComponent(epNumber)}&category=${category}&tier=${tier}`;
    const text = await readBody(await soraFetch(`${AC_BASE}${path}`, { method: 'GET', headers: headers }));
    let body = null;
    try { body = JSON.parse(text); } catch (e) { return { status: 'error', servers: [] }; }
    if (body && body.detail === 'session') return { status: 'session', servers: [] };
    if (body && body.v === 1) {
        const plain = decryptServers(body, session.nonce);
        return { status: plain ? 'ok' : 'decrypt', servers: plain && Array.isArray(plain.servers) ? plain.servers : [] };
    }
    return { status: 'ok', servers: body && Array.isArray(body.servers) ? body.servers : [] };
}

// One category: open a session and read the servers from the same client,
// re-opening the session when the server forgets it.
async function serversFor(state, anilistId, epNumber, category, referer) {
    for (let attempt = 0; attempt < AC_SESSION_TRIES; attempt++) {
        if (!state.session) state.session = await openSession(referer);
        if (!state.session) return [];
        let answer = await fetchServers(state.session, anilistId, epNumber, category, 'fast', referer);
        if (answer.status === 'session') { state.session = null; continue; }
        let servers = answer.servers;
        // "fast" usually carries everything; "rest" completes it when it does not.
        if (servers.filter(s => s && s.type === 'hls').length < 2) {
            const rest = await fetchServers(state.session, anilistId, epNumber, category, 'rest', referer);
            if (rest.status === 'ok') {
                for (const extra of rest.servers) {
                    if (extra && !servers.some(s => s.name === extra.name)) servers = servers.concat([extra]);
                }
            }
        }
        return servers;
    }
    return [];
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function absolute(url) {
    if (!url) return "";
    const s = String(url);
    return s.charAt(0) === '/' && s.charAt(1) !== '/' ? `${AC_BASE}${s}` : s;
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const parts = String(url).replace('anichan-play://', '').split('/');
    const anilistId = parts[0];
    const epNumber = parts.length > 1 ? parts[1] : '1';
    const referer = `${AC_BASE}/anime/${anilistId}/watch/${epNumber}`;
    const mediaUrl = referer;

    console.log(`[Player] 🎬 AniChan — AniList ${anilistId}, episode ${epNumber}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};
    const playHeaders = { "Referer": `${AC_BASE}/`, "Origin": AC_BASE, "User-Agent": AC_UA };

    try {
        const availability = await acGetJson(`/api/watch/episodes?anilistId=${encodeURIComponent(anilistId)}`);
        const categories = ['sub'];
        if (!availability || availability.dubAvailable !== false) categories.push('dub');

        const state = { session: null };
        for (const category of categories) {
            const servers = await serversFor(state, anilistId, epNumber, category, referer);
            const tag = category === 'dub' ? 'Dub' : 'Sub';
            if (!servers.length) {
                failedLinks.push({ server_name: `AniChan ${tag}`, url: `${AC_BASE}/api/watch/servers`, reason: state.session ? "No server returned" : "No watch session" });
                continue;
            }

            for (const server of servers) {
                if (!server) continue;
                const label = server.label || server.name || "AniChan";
                // Embeds (third-party iframes) are not playable natively.
                if (server.type !== 'hls' || !server.stream) {
                    if (server.type === 'embed') failedLinks.push({ server_name: label, url: server.embed || server.stream || "", reason: "iframe embed" });
                    continue;
                }
                const streamUrl = absolute(server.stream);
                if (streams.some(s => s.streamUrl === streamUrl)) continue;
                const hard = server.subType === 'hard' || /_hard$/.test(server.name || '') ? ' (hardsub)' : '';
                streams.push({ title: `AniChan ${label} · ${tag}${hard}`, streamUrl: streamUrl, headers: playHeaders });
                console.log(`   -> ${label} ${tag}: ${streamUrl.slice(0, 80)}…`);

                for (const caption of (server.subtitles || [])) {
                    const subUrl = absolute(caption && caption.url);
                    if (!subUrl || allSubtitles.some(s => s.url === subUrl)) continue;
                    allSubtitles.push({ url: subUrl, label: caption.lang || caption.label || "Unknown", kind: "captions", headers: playHeaders });
                }
            }
        }

        const english = allSubtitles.find(s => /english/i.test(s.label)) || allSubtitles[0];
        if (english) {
            bestSubtitle = english.url;
            bestSubtitleHeaders = english.headers;
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("AniChan", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: String(epNumber),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("AniChan", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl,
                season_number: "1",
                ep_number: String(epNumber),
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
        sendSupabaseLog("AniChan", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}

// ==========================================
// 🧮 PURE-JS CRYPTO (base64, UTF-8, SHA-256, HMAC, AES)
// ==========================================
// Checked against Node's crypto on random inputs (SHA-256/HMAC 300/300,
// AES-GCM and AES-CBC 600/600 across 128/192/256-bit keys).

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

// ---- pure JS SHA-256 / HMAC-SHA256 over byte arrays ----
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

function sha256Bytes(bytes) {
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const msg = new Uint8Array(total);
    for (let i = 0; i < len; i++) msg[i] = bytes[i];
    msg[len] = 0x80;
    const bitLenHi = Math.floor(len / 0x20000000), bitLenLo = (len << 3) >>> 0;
    msg[total - 8] = (bitLenHi >>> 24) & 255; msg[total - 7] = (bitLenHi >>> 16) & 255;
    msg[total - 6] = (bitLenHi >>> 8) & 255; msg[total - 5] = bitLenHi & 255;
    msg[total - 4] = (bitLenLo >>> 24) & 255; msg[total - 3] = (bitLenLo >>> 16) & 255;
    msg[total - 2] = (bitLenLo >>> 8) & 255; msg[total - 1] = bitLenLo & 255;
    const w = new Array(64);
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) {
            const j = off + i * 4;
            w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
        }
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15], y = w[i - 2];
            const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (k + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + k) >>> 0;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
        out[i * 4] = (h[i] >>> 24) & 255; out[i * 4 + 1] = (h[i] >>> 16) & 255;
        out[i * 4 + 2] = (h[i] >>> 8) & 255; out[i * 4 + 3] = h[i] & 255;
    }
    return out;
}

function hmacSha256(keyBytes, dataBytes) {
    let key = keyBytes;
    if (key.length > 64) key = sha256Bytes(key);
    const ipad = new Uint8Array(64 + dataBytes.length);
    const opad = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) {
        const b = i < key.length ? key[i] : 0;
        ipad[i] = b ^ 0x36;
        opad[i] = b ^ 0x5c;
    }
    ipad.set(dataBytes, 64);
    opad.set(sha256Bytes(ipad), 64);
    return sha256Bytes(opad);
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

function aesEncryptBlock(ks, input) {
    const s = new Uint8Array(16), w = ks.w, rounds = ks.rounds;
    for (let i = 0; i < 16; i++) s[i] = input[i] ^ w[i];
    const t = new Uint8Array(16);
    for (let round = 1; round <= rounds; round++) {
        // SubBytes + ShiftRows
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[c * 4 + r] = AES_SBOX[s[((c + r) % 4) * 4 + r]];
        if (round !== rounds) {
            for (let c = 0; c < 4; c++) {
                const a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3];
                const all = a0 ^ a1 ^ a2 ^ a3;
                s[c * 4] = a0 ^ all ^ aesXtime(a0 ^ a1);
                s[c * 4 + 1] = a1 ^ all ^ aesXtime(a1 ^ a2);
                s[c * 4 + 2] = a2 ^ all ^ aesXtime(a2 ^ a3);
                s[c * 4 + 3] = a3 ^ all ^ aesXtime(a3 ^ a0);
            }
        } else {
            s.set(t);
        }
        const off = round * 16;
        for (let i = 0; i < 16; i++) s[i] ^= w[off + i];
    }
    return s;
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

// AES-GCM decryption without tag check: GCM's keystream is CTR mode started
// at counter 2 for a 96-bit IV (counter 1 encrypts the tag).
function aesGcmDecrypt(key, iv, payloadWithTag) {
    const ks = aesExpandKey(key);
    const ct = payloadWithTag.subarray(0, payloadWithTag.length - 16);
    const counter = new Uint8Array(16);
    counter.set(iv.subarray(0, 12), 0);
    counter[15] = 1;
    const out = new Uint8Array(ct.length);
    for (let off = 0; off < ct.length; off += 16) {
        for (let i = 15; i >= 12; i--) { counter[i] = (counter[i] + 1) & 0xff; if (counter[i]) break; }
        const stream = aesEncryptBlock(ks, counter);
        for (let i = 0; i < 16 && off + i < ct.length; i++) out[off + i] = ct[off + i] ^ stream[i];
    }
    return out;
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
