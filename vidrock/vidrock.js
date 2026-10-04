// ==========================================
// ⚙️ SORA MODULE — VIDROCK
// ==========================================
// VidRock (vidrock.net; vidrock.ru now only shows a "domain migration" page)
// is a TMDB-keyed embed used by many movie/TV aggregators.
//
// Its player (a Vite/React bundle) asks one endpoint for every server:
//   GET https://vidrock.net/api/movie/<tmdbId>
//   GET https://vidrock.net/api/tv/<tmdbId>/<season>/<episode>
//   -> {"Nova":{url,type,language,flag}, "Atlas":{…}, "Luna":{…}, "Orion":{…}, "Astra":{…}}
// A server with nothing for the title has url:null. Each "url" is
// base64url(iv[12] | AES-256-GCM ciphertext | tag[16]) under a key that sits
// in the bundle as hex. Decrypted here in pure JS: GCM's keystream is AES-CTR
// starting at counter iv|00000002, so we run CTR and skip the tag check.
//
// What the servers give:
//   - Orion: HLS on rotating "file" hosts, needs Referer vidrock.net (reliable)
//   - Atlas: HLS on cdn1.ngcorp.dad whose segments sit on a ByteDance image
//     CDN that sometimes answers "domain forbidden": probed before use
//   - Nova:  HLS whose TS segments are disguised as PNG images (TikTok CDN)
//   - Luna/Astra: rarely filled; a link that answers a JSON list of
//     {resolution,url} is expanded into one stream per quality, like the player.
// Subtitles come from sub.vdrk.site (VidRock's own subtitle service).

const VR_SITE = "https://vidrock.net";
const VR_SUBS = "https://sub.vdrk.site/v2";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const VR_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// AES-256 key of the player bundle (hex), used for every server url.
const VR_KEY_HEX = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";

// Servers in the order streams are offered.
const VR_ORDER = ["Orion", "Atlas", "Luna", "Astra", "Nova"];

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
    if (!headers["User-Agent"]) headers["User-Agent"] = VR_UA;
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

function vrHeaders() {
    return { "Referer": `${VR_SITE}/`, "Origin": VR_SITE, "User-Agent": VR_UA };
}

// ==========================================
// 🔓 DECRYPTION (pure JS)
// ==========================================

function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

// base64url -> bytes, without atob (not available in Sora).
function base64UrlToBytes(text) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = String(text).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    const out = [];
    let buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
        buffer = (buffer << 6) | chars.indexOf(clean.charAt(i));
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >> bits) & 0xff);
        }
    }
    return new Uint8Array(out);
}

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

// AES-256 block encryption + GCM decryption through CTR (tag not verified),
// adapted from this repository's voir-anime module, checked against Node's
// crypto on VidRock's own answers.
const aesGcmDecrypt = (function () {
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
        const s = inp.slice();
        const addRK = (round) => { for (let c = 0; c < 16; c++) s[c] ^= w[round * 4 + (c >> 2)][c & 3]; };
        const subBytes = () => { for (let i = 0; i < 16; i++) s[i] = sbox[s[i]]; };
        const shiftRows = () => { const t = s.slice(); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s[r + 4 * c] = t[r + 4 * ((c + r) % 4)]; };
        const mixCols = () => { for (let c = 0; c < 4; c++) { const i = 4 * c, a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3]; s[i] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3; s[i + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3; s[i + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3); s[i + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2); } };
        addRK(0);
        for (let round = 1; round < 14; round++) { subBytes(); shiftRows(); mixCols(); addRK(round); }
        subBytes(); shiftRows(); addRK(14);
        return s;
    }
    // payload = ciphertext | tag(16)
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

const VR_KEY = hexToBytes(VR_KEY_HEX);

function decryptServerUrl(encoded) {
    try {
        const bytes = base64UrlToBytes(encoded);
        if (bytes.length < 28) return "";
        const plain = utf8Decode(aesGcmDecrypt(VR_KEY, bytes.subarray(0, 12), bytes.subarray(12)));
        return /^https?:\/\//.test(plain) ? plain.trim() : "";
    } catch (e) { return ""; }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 VidRock — searching for "${keyword}"`);
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
                href: `vidrock://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("VidRock", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("VidRock", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = String(url).replace('vidrock-play://', '').replace('vidrock://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 VidRock — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("VidRock", "DETAILS", { media_url: `${VR_SITE}/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("VidRock", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 VidRock — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `vidrock-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which VidRock does not carry.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `vidrock-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("VidRock", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function absolutize(link, base) {
    if (/^https?:\/\//.test(link)) return link;
    const origin = (base.match(/^https?:\/\/[^/]+/) || [""])[0];
    if (link.charAt(0) === '/') return origin + link;
    return base.replace(/[^/]*(\?.*)?$/, '') + link;
}

// Atlas: the playlists answer but the segments' CDN sometimes refuses
// everyone ("domain forbidden"). Walk master -> variant -> first segment.
async function segmentsAnswer(url, headers) {
    try {
        let playlistUrl = url;
        let body = await readBody(await soraFetch(playlistUrl, { method: 'GET', headers: { ...headers } }));
        if (!body || body.indexOf('#EXTM3U') === -1) return false;
        const firstUri = (text) => text.split('\n').map(l => l.trim()).find(l => l && l.charAt(0) !== '#');
        if (body.indexOf('#EXT-X-STREAM-INF') !== -1) {
            const variant = firstUri(body);
            if (!variant) return false;
            playlistUrl = absolutize(variant, playlistUrl);
            body = await readBody(await soraFetch(playlistUrl, { method: 'GET', headers: { ...headers } }));
            if (!body || body.indexOf('#EXTM3U') === -1) return false;
        }
        const segment = firstUri(body);
        if (!segment) return false;
        const response = await soraFetch(absolutize(segment, playlistUrl), { method: 'GET', headers: { ...headers, "Range": "bytes=0-1" } });
        if (!response) return false;
        if (typeof response.status === 'number') return response.status < 400;
        const text = await readBody(response);
        return !!text && text.indexOf('"error"') === -1;
    } catch (e) { return false; }
}

// Luna/Astra-style links may answer a JSON list of qualities instead of a
// playlist; the player expands those, so do we.
async function jsonQualities(url, headers) {
    try {
        const body = await readBody(await soraFetch(url, { method: 'GET', headers: { ...headers } }));
        if (!body || body.charAt(0) !== '[') return null;
        const list = JSON.parse(body);
        if (!Array.isArray(list) || !list.length || !list[0].url || !list[0].resolution) return null;
        return list.filter(q => q && q.url).sort((a, b) => b.resolution - a.resolution);
    } catch (e) { return null; }
}

async function vrSubtitles(ref) {
    const url = ref.kind === 'tv'
        ? `${VR_SUBS}/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${VR_SUBS}/movie/${ref.id}`;
    const body = await readBody(await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json", "Referer": `${VR_SITE}/` } }));
    if (!body) return [];
    try {
        const list = JSON.parse(body);
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const apiPath = ref.kind === 'tv' ? `tv/${ref.id}/${ref.season}/${ref.episode}` : `movie/${ref.id}`;
    const mediaUrl = `${VR_SITE}/${apiPath}`;

    console.log(`[Player] 🎬 VidRock — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const fetched = await Promise.all([
            soraFetch(`${VR_SITE}/api/${apiPath}`, {
                method: 'GET',
                headers: { "User-Agent": VR_UA, "Accept": "application/json", "Referer": `${mediaUrl}` }
            }).then(readBody).catch(() => ""),
            vrSubtitles(ref).catch(() => [])
        ]);

        let servers = null;
        try { servers = JSON.parse(fetched[0]); } catch (e) { servers = null; }
        if (!servers || typeof servers !== 'object') {
            console.log(`[Player] ⚠️ VidRock API gave no server list.`);
            sendSupabaseLog("VidRock", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: String(ref.season || "1"), ep_number: String(ref.episode || "1"),
                failed_count: 1, failed_links: [{ server_name: "VidRock API", url: `${VR_SITE}/api/${apiPath}`, reason: "No JSON answer" }]
            });
            return JSON.stringify({ type: "none" });
        }

        // Known servers first in our order, then anything new the API adds.
        const names = VR_ORDER.filter(n => servers[n]).concat(Object.keys(servers).filter(n => VR_ORDER.indexOf(n) === -1));
        const headers = vrHeaders();

        const candidates = [];
        for (const name of names) {
            const entry = servers[name];
            if (!entry || typeof entry !== 'object' || !entry.url) continue;
            const link = decryptServerUrl(entry.url);
            if (!link) {
                failedLinks.push({ server_name: name, url: mediaUrl, reason: "Could not decrypt the server url" });
                continue;
            }
            candidates.push({ name: name, link: link, type: entry.type, language: entry.language || "Original" });
        }

        // Checks run in parallel: Atlas segment probe, JSON quality lists.
        const checked = await Promise.all(candidates.map(async (c) => {
            if (c.name === 'Atlas') return { ok: await segmentsAnswer(c.link, headers) };
            const isHls = c.type === 'hls' || /\.m3u8(\?|$)/i.test(c.link);
            if (isHls) return { ok: true };
            const qualities = await jsonQualities(c.link, headers);
            return { ok: true, qualities: qualities };
        }));

        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            const check = checked[i];
            if (!check.ok) {
                console.log(`   -> ${c.name}: segments refused, discarded.`);
                failedLinks.push({ server_name: c.name, url: c.link, reason: "Segment CDN refused the request" });
                continue;
            }
            if (check.qualities && check.qualities.length) {
                for (const q of check.qualities) {
                    streams.push({ title: `VidRock ${c.name} ${q.resolution}p · ${c.language}`, streamUrl: q.url, headers: vrHeaders() });
                }
                continue;
            }
            streams.push({ title: `VidRock ${c.name} · ${c.language}`, streamUrl: c.link, headers: vrHeaders() });
        }

        for (const caption of fetched[1]) {
            const subUrl = caption && (caption.file || caption.url);
            if (!subUrl || allSubtitles.some(s => s.url === subUrl)) continue;
            allSubtitles.push({
                url: subUrl,
                label: caption.label || caption.language || "Unknown",
                kind: "captions",
                headers: { "Referer": `${VR_SITE}/` }
            });
        }
        const english = allSubtitles.find(s => /^english\b/i.test(String(s.label).trim()));
        const chosen = english || allSubtitles[0];
        if (chosen) {
            bestSubtitle = chosen.url;
            bestSubtitleHeaders = chosen.headers;
        }

        for (const s of streams) console.log(`   -> ${s.title}: ${s.streamUrl.slice(0, 80)}…`);
        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("VidRock", "PLAYER", {
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
            sendSupabaseLog("VidRock", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("VidRock", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
