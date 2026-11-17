// ==========================================
// ⚙️ SORA MODULE — VIDNEST
// ==========================================
// VidNest (vidnest.fun) is a TMDB-keyed embed used by many movie/TV
// aggregators. Its player (a Next.js app) asks its own backend,
// new.vidnest.fun, for one relay at a time:
//   GET https://new.vidnest.fun/<relay>/movie/<tmdbId>
//   GET https://new.vidnest.fun/<relay>/tv/<tmdbId>/<season>/<episode>
//
// Every answer is {"encrypted":true,"data":"…"}. The "encryption" is plain
// base64 over a shuffled alphabet, decoded here in pure JS:
//   RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=
// The decoded JSON carries direct links in the clear, with the headers the
// CDN expects. Relay names in the player -> backend path:
//   Beta=superstream  Zeta=nextgencloudfabric  Prime=rpmvid  Sigma=hollymoviehd
//   Gama=vidzee  Catflix=yflix  Filxer=rogflix  Ophim=klikxxi
//   Lamda/Delta=allmovies (English / Hindi)  Hexa=vidlink  Alfa=videasy
// Alfa is skipped: it re-proxies Zeta's CDN through a segment proxy that
// refuses native clients. Relays whose CDN comes and goes (Filxer, Ophim)
// are probed before being offered.
//
// Subtitles: Beta returns its own list; sub.vdrk.site (the keyless fallback
// VidNest itself uses) fills in the rest.

const VN_SITE = "https://vidnest.fun";
const VN_API = "https://new.vidnest.fun";
const VN_SUBS = "https://sub.vdrk.site/v2";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const VN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Shuffled base64 alphabet of the backend's "cipher" (64 symbols + padding).
// Constant the player mixes into the v2 answer key (see vnDecryptV2).
const VN_NONCE_SALT = "K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2";
const VN_ALPHABET = "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=";

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
    // The hosts expect every request to carry a User-Agent; fill one in when
    // the caller did not set one (TMDB calls, notably).
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = VN_UA;
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

// ==========================================
// 🔓 DECODING THE BACKEND ANSWERS
// ==========================================

// Bytes -> string, UTF-8 (TextDecoder is not available in Sora).
function utf8Decode(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length;) {
        const b = bytes[i++];
        if (b < 0x80) { out += String.fromCharCode(b); continue; }
        let cp;
        if (b >= 0xf0) { cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f); }
        else if (b >= 0xe0) { cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f); }
        else { cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f); }
        if (cp > 0xffff) { cp -= 0x10000; out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); }
        else out += String.fromCharCode(cp);
    }
    return out;
}

// Base64 over VidNest's shuffled alphabet, as the player decodes it: a symbol
// outside the alphabet (or the padding) counts as 64.
function vnDecodeData(text) {
    const index = {};
    for (let i = 0; i < VN_ALPHABET.length; i++) index[VN_ALPHABET.charAt(i)] = i;
    const bytes = [];
    for (let t = 0; t < text.length; t += 4) {
        let chunk = text.slice(t, t + 4);
        while (chunk.length < 4) chunk += "=";
        const v = [];
        for (let k = 0; k < 4; k++) {
            const n = index[chunk.charAt(k)];
            v.push(n === undefined ? 64 : n);
        }
        bytes.push(((v[0] << 2) | (v[1] >> 4)) & 0xff);
        if (v[2] !== 64) bytes.push((((v[1] & 15) << 4) | (v[2] >> 2)) & 0xff);
        if (v[3] !== 64) bytes.push((((v[2] & 3) << 6) | v[3]) & 0xff);
    }
    return utf8Decode(bytes);
}

// --- v2 answers: AES-256-GCM, key = SHA-256("<n>|<VN_NONCE_SALT>") ---------
// Sora has no WebCrypto, so SHA-256 and the AES block cipher are written out
// here. GCM decryption is AES-CTR from counter 2; the 16-byte tag at the end is
// dropped, not checked (a corrupted answer simply fails to parse as JSON).

function vnRandomNonce() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let out = "";
    for (let i = 0; i < 22; i++) out += alphabet.charAt(Math.floor(Math.random() * 64));
    return out;
}

function vnB64urlBytes(text) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const s = String(text).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const bytes = [];
    let buffer = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
        const v = alphabet.indexOf(s.charAt(i));
        if (v < 0) continue;
        buffer = (buffer << 6) | v;
        bits += 6;
        if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xff); }
    }
    return bytes;
}

function vnUtf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
            c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
        }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
}

function vnSha256(bytes) {
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const msg = bytes.slice();
    const bitLen = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (let i = 7; i >= 0; i--) msg.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    const W = new Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < msg.length; off += 64) {
        for (let i = 0; i < 16; i++) {
            W[i] = (msg[off + 4 * i] << 24) | (msg[off + 4 * i + 1] << 16) | (msg[off + 4 * i + 2] << 8) | msg[off + 4 * i + 3];
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
            const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
            W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    const out = [];
    for (const v of H) out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return out;
}

// AES forward cipher only (CTR mode never needs the inverse).
const VN_AES_SBOX = (function () {
    const sbox = new Array(256);
    let p = 1, q = 1;
    do {
        p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
        if (q & 0x80) q ^= 0x09;
        const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
        sbox[p] = (x ^ 0x63) & 0xff;
    } while (p !== 1);
    sbox[0] = 0x63;
    return sbox;
})();

function vnAesExpandKey(key) {
    const Nk = key.length / 4, Nr = Nk + 6;
    const w = [];
    for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    let rcon = 1;
    for (let i = Nk; i < 4 * (Nr + 1); i++) {
        let t = w[i - 1].slice();
        if (i % Nk === 0) {
            t = [VN_AES_SBOX[t[1]] ^ rcon, VN_AES_SBOX[t[2]], VN_AES_SBOX[t[3]], VN_AES_SBOX[t[0]]];
            rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff;
        } else if (Nk > 6 && i % Nk === 4) {
            t = t.map(b => VN_AES_SBOX[b]);
        }
        w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]);
    }
    return { w: w, rounds: Nr };
}

function vnAesEncryptBlock(ks, input) {
    const xt = b => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
    let s = input.slice();
    const addRoundKey = r => { for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) s[4 * c + k] ^= ks.w[4 * r + c][k]; };
    addRoundKey(0);
    for (let r = 1; r <= ks.rounds; r++) {
        for (let i = 0; i < 16; i++) s[i] = VN_AES_SBOX[s[i]];
        const t = s.slice();
        for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) s[4 * c + k] = t[4 * ((c + k) % 4) + k];
        if (r !== ks.rounds) {
            for (let c = 0; c < 4; c++) {
                const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
                const all = a0 ^ a1 ^ a2 ^ a3;
                s[4 * c] = a0 ^ all ^ xt(a0 ^ a1);
                s[4 * c + 1] = a1 ^ all ^ xt(a1 ^ a2);
                s[4 * c + 2] = a2 ^ all ^ xt(a2 ^ a3);
                s[4 * c + 3] = a3 ^ all ^ xt(a3 ^ a0);
            }
        }
        addRoundKey(r);
    }
    return s;
}

function vnAesGcmDecrypt(keyBytes, data) {
    const iv = data.slice(0, 12);
    const cipher = data.slice(12, data.length - 16);
    const ks = vnAesExpandKey(keyBytes);
    const out = new Array(cipher.length);
    let counter = 2;
    for (let off = 0; off < cipher.length; off += 16) {
        const block = iv.concat([(counter >>> 24) & 0xff, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff]);
        const stream = vnAesEncryptBlock(ks, block);
        for (let i = 0; i < 16 && off + i < cipher.length; i++) out[off + i] = cipher[off + i] ^ stream[i];
        counter++;
    }
    return out;
}

function vnDecryptV2(d, n) {
    const key = vnSha256(vnUtf8Bytes(`${n}|${VN_NONCE_SALT}`));
    return utf8Decode(vnAesGcmDecrypt(key, vnB64urlBytes(d)));
}

// One relay call: returns the decoded JSON object, or null.
async function vnRelay(relayPath) {
    const headers = {
        "User-Agent": VN_UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": `${VN_SITE}/`,
        "Origin": VN_SITE
    };
    const body = await readBody(await soraFetch(`${VN_API}/${relayPath}${relayPath.indexOf("?") === -1 ? "?" : "&"}_n=${vnRandomNonce()}`, { method: 'GET', headers: headers }));
    if (!body || body.charAt(0) !== '{') return null;
    try {
        const json = JSON.parse(body);
        if (!json || typeof json !== 'object') return null;
        if (json.v === 2 && typeof json.d === "string") return JSON.parse(vnDecryptV2(json.d, json.n));
        if (!json.encrypted) return json;
        if (typeof json.data !== 'string') return null;
        return JSON.parse(vnDecodeData(json.data));
    } catch (e) { return null; }
}

// Header maps from the backend carry hop-by-hop noise and stray spaces. When
// a relay sends none, present ourselves as the VidNest player.
function cleanHeaders(raw) {
    const out = {};
    if (raw && typeof raw === 'object') {
        for (const key of Object.keys(raw)) {
            const name = String(key).trim();
            if (!name || /^(connection|accept|host|content-length)$/i.test(name)) continue;
            out[name] = String(raw[key]).trim();
        }
    }
    if (!out["Referer"] && !out["referer"]) {
        out["Referer"] = `${VN_SITE}/`;
        out["Origin"] = VN_SITE;
    }
    if (!out["User-Agent"]) out["User-Agent"] = VN_UA;
    return out;
}

// Some relays hand back a link whose CDN may be gone (Cloudflare-blocked
// zone, embed page instead of a playlist): ask for it before offering it.
async function isPlaylist(url, headers) {
    try {
        const response = await soraFetch(url, { method: 'GET', headers: { ...headers } });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = await readBody(response);
        return !!body && body.trimStart().indexOf('#EXTM3U') === 0;
    } catch (e) { return false; }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 VidNest — searching for "${keyword}"`);
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
                href: `vidnest://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("VidNest", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("VidNest", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = String(url).replace('vidnest-play://', '').replace('vidnest://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 VidNest — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("VidNest", "DETAILS", { media_url: `${VN_SITE}/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("VidNest", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 VidNest — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `vidnest-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which the relays do not carry.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `vidnest-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("VidNest", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// "movie/<id>" or "tv/<id>/<s>/<e>", the tail every relay path ends with.
function mediaPath(ref) {
    return ref.kind === 'tv' ? `tv/${ref.id}/${ref.season}/${ref.episode}` : `movie/${ref.id}`;
}

// Each relay turns its decoded answer into [{title, streamUrl, headers}].
// Listed in the order streams are offered (most reliable first).
const VN_RELAYS = [
    {
        name: "Beta", path: (ref) => `superstream/${mediaPath(ref)}`,
        read: (data) => (Array.isArray(data.streams) ? data.streams : [])
            .filter(s => s && s.url)
            .map(s => ({
                title: `VidNest Beta · ${s.quality || s.language || 'Auto'}`,
                streamUrl: s.url,
                headers: { "Referer": `${VN_SITE}/`, "Origin": VN_SITE, "User-Agent": VN_UA }
            }))
    },
    {
        name: "Zeta", path: (ref) => `nextgencloudfabric/${mediaPath(ref)}`,
        read: (data) => data.url ? [{
            title: "VidNest Zeta · Auto",
            streamUrl: data.url,
            headers: cleanHeaders(data.headers)
        }] : []
    },
    {
        name: "Prime", path: (ref) => `rpmvid/${mediaPath(ref)}`,
        read: (data) => (Array.isArray(data.streams) ? data.streams : [])
            .filter(s => s && s.url)
            .map(s => ({
                title: `VidNest Prime · ${s.quality && s.quality !== 'auto' ? s.quality : (s.language || 'Auto')}`,
                streamUrl: s.url,
                headers: cleanHeaders(s.headers)
            }))
    },
    {
        name: "Sigma", path: (ref) => `hollymoviehd/${mediaPath(ref)}`,
        read: (data) => (Array.isArray(data.streams) ? data.streams : [])
            .filter(s => s && s.url && s.type === 'hls')
            .map(s => ({
                title: `VidNest Sigma · ${s.language || 'Auto'}`,
                streamUrl: s.url,
                headers: cleanHeaders(s.headers)
            }))
    },
    {
        name: "Lamda/Delta", path: (ref) => `allmovies/${mediaPath(ref)}`,
        read: (data) => (Array.isArray(data.streams) ? data.streams : [])
            .filter(s => s && s.url)
            .map(s => ({
                title: `VidNest ${String(s.language || '').toLowerCase() === 'hindi' ? 'Delta' : 'Lamda'} · ${s.language || 'Auto'}`,
                streamUrl: s.url,
                headers: cleanHeaders(s.headers)
            }))
    },
    {
        name: "Hexa", path: (ref) => `vidlink/${mediaPath(ref)}`,
        read: (data) => {
            const stream = data && data.data && data.data.stream;
            if (!stream || !stream.playlist) return [];
            return [{
                title: "VidNest Hexa · Auto",
                streamUrl: String(stream.playlist).trim().replace(/\s+/g, ''),
                headers: cleanHeaders(data.headers)
            }];
        }
    },
    {
        // Direct files (often .mkv): fine for external players, not for every
        // built-in one, hence offered after the HLS relays.
        name: "Gama", path: (ref) => `vidzee/${mediaPath(ref)}`,
        read: (data) => (Array.isArray(data.streams) ? data.streams : [])
            .filter(s => s && s.url)
            .map(s => {
                const ext = (String(s.url).split('?')[0].match(/\.([a-z0-9]{2,4})$/i) || [])[1];
                return {
                    title: `VidNest Gama · ${s.language || s.quality || 'Auto'}${ext ? ` (${ext.toUpperCase()})` : ''}`,
                    streamUrl: s.url,
                    headers: cleanHeaders(s.headers)
                };
            })
    },
    {
        // TS segments disguised as images on a TikTok CDN (120-byte PNG header).
        name: "Catflix", path: (ref) => `yflix/${mediaPath(ref)}`,
        read: (data) => data.url ? [{
            title: "VidNest Catflix · Auto",
            streamUrl: data.url,
            headers: cleanHeaders(data.headers)
        }] : []
    },
    {
        name: "Filxer", path: (ref) => `rogflix/${mediaPath(ref)}`, probe: true,
        read: (data) => data.url ? [{
            title: "VidNest Filxer · Auto",
            streamUrl: data.url,
            headers: { "Referer": `${VN_SITE}/`, "Origin": VN_SITE, "User-Agent": VN_UA }
        }] : []
    },
    {
        name: "Ophim", path: (ref) => `klikxxi/${mediaPath(ref)}`, probe: true,
        read: (data) => (Array.isArray(data.sources) ? data.sources : [])
            .filter(s => s && s.url && s.type === 'hls')
            .map(s => ({
                title: `VidNest Ophim · ${s.quality || 'Auto'}`,
                streamUrl: s.url,
                headers: { "Referer": `${VN_SITE}/`, "Origin": VN_SITE, "User-Agent": VN_UA }
            }))
    }
];

async function vnSubtitles(ref) {
    const url = ref.kind === 'tv'
        ? `${VN_SUBS}/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${VN_SUBS}/movie/${ref.id}`;
    const body = await readBody(await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json", "Referer": `${VN_SITE}/` } }));
    if (!body) return [];
    try {
        const list = JSON.parse(body);
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = ref.kind === 'tv'
        ? `${VN_SITE}/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${VN_SITE}/movie/${ref.id}`;

    console.log(`[Player] 🎬 VidNest — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        // All relays (and the subtitle list) in parallel: each answers on its
        // own, some take several seconds.
        const results = await Promise.all([
            Promise.all(VN_RELAYS.map(relay => vnRelay(relay.path(ref)).catch(() => null))),
            vnSubtitles(ref).catch(() => [])
        ]);
        const answers = results[0];
        const subtitleList = results[1];

        // Candidates from the relays that need a liveness check.
        const probes = [];

        for (let i = 0; i < VN_RELAYS.length; i++) {
            const relay = VN_RELAYS[i];
            const data = answers[i];
            let found = [];
            try { found = data ? relay.read(data) : []; } catch (e) { found = []; }

            if (!found.length) {
                failedLinks.push({ server_name: relay.name, url: `${VN_API}/${relay.path(ref)}`, reason: data ? "No stream in answer" : "No answer" });
                continue;
            }

            for (const stream of found) {
                if (!stream.streamUrl || !/^https?:\/\//.test(stream.streamUrl)) continue;
                if (relay.probe) probes.push({ relay: relay.name, stream: stream });
                else streams.push(stream);
            }

            // Beta (superstream) carries its own subtitle list.
            if (Array.isArray(data.subtitles)) {
                for (const caption of data.subtitles) {
                    const subUrl = caption && (caption.url || caption.file);
                    if (!subUrl || allSubtitles.some(s => s.url === subUrl)) continue;
                    allSubtitles.push({
                        url: subUrl,
                        label: caption.lang || caption.label || caption.language || relay.name,
                        kind: "captions",
                        headers: { "Referer": `${VN_SITE}/` }
                    });
                }
            }
        }

        if (probes.length) {
            const alive = await Promise.all(probes.map(p => isPlaylist(p.stream.streamUrl, p.stream.headers)));
            for (let i = 0; i < probes.length; i++) {
                if (alive[i]) streams.push(probes[i].stream);
                else failedLinks.push({ server_name: probes[i].relay, url: probes[i].stream.streamUrl, reason: "Link returned no playlist" });
            }
        }

        // De-duplicate by URL, keep the first title.
        const unique = [];
        for (const stream of streams) {
            if (!unique.some(s => s.streamUrl === stream.streamUrl)) unique.push(stream);
        }

        for (const caption of subtitleList) {
            const subUrl = caption && (caption.file || caption.url);
            if (!subUrl || allSubtitles.some(s => s.url === subUrl)) continue;
            allSubtitles.push({
                url: subUrl,
                label: caption.label || "Unknown",
                kind: "captions",
                headers: { "Referer": `${VN_SITE}/` }
            });
        }

        // Prefer an English track as the default one.
        const english = allSubtitles.find(s => /^english\b|^en$/i.test(String(s.label).trim()));
        const chosen = english || allSubtitles[0];
        if (chosen) {
            bestSubtitle = chosen.url;
            bestSubtitleHeaders = chosen.headers;
        }

        for (const s of unique) console.log(`   -> ${s.title}: ${s.streamUrl.slice(0, 80)}…`);
        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${unique.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("VidNest", "PLAYER", {
            media_url: mediaUrl,
            season_number: String(ref.season || "1"),
            ep_number: String(ref.episode || "1"),
            streams_found: unique.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: unique.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("VidNest", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl,
                season_number: String(ref.season || "1"),
                ep_number: String(ref.episode || "1"),
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }

        if (unique.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: unique,
            subtitles: bestSubtitle,
            subtitlesHeaders: bestSubtitleHeaders,
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("VidNest", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
