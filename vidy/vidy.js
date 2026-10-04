// ==========================================
// ⚙️ SORA MODULE — VIDY
// ==========================================
// Vidy (www.vidy.st) is an embed player keyed by TMDB id that runs its own
// scraping backend. Several multi-server catalogues use it as one of their
// main servers: 1Shows / 1Flex / 1Tube ("Main 2"), Primeshows / Netshows,
// HydraHD, 7REELS, Meowly…
//
// The player does not hide the stream in the page: it asks its API, one
// "city" per upstream source, and decrypts the answer locally.
//
//   GET https://api.wecollege.net/seed?mediaId=<tmdbId>
//       -> {"seed":"59702127.Q-8JndslVaFIPx2cQFu-pD","ttlMs":30000}
//   GET https://api.wecollege.net/<city>/sources?title=&mediaType=&year=
//       &episodeId=&seasonId=&tmdbId=&imdbId=&enc=2&seed=<seed>
//       -> base64url ciphertext
//
// The cipher ("enc=2") is a home-made stream cipher, reproduced below in pure
// JS: a 61-word state is derived from FNV-1a(seed) and the TMDB id through a
// murmur3-style finaliser, every step of the keystream mixes the state with
// a counter, the bytes are XORed with the payload, and the plaintext must
// start with the magic "mvm1" followed by UTF-8 JSON:
//   {sources:[{quality,url}], subtitles:[{lang,language,url}], thumbnail}
// The obfuscated player also carries an RC4 branch, but its guard
// (n*(n+1) odd) can never be true, so only the main branch is kept.
//
// A seed is bound to the client's address and lives 30 s: the player fetches
// one and reuses it for every city, fetching a new one on 401
// STREAMCRYPTO_SEED_INVALID. Same here, with a few retries.
// The CDNs (moon.zenoak.top, sun.paleoak.top, …) answer 403 without the
// vidy.st Referer/Origin, which are therefore attached to every stream.

const VIDY_SITE = "https://www.vidy.st";
const VIDY_API = "https://api.wecollege.net";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const VIDY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// The player's server list, in its order. Left out because they hold every
// request up for nothing: Tampa/Orlando (ridomovies upstream, rate limited,
// 20-30 s), Austin/Delhi (laika upstream, 10-15 s then an error), Berlin
// (captcha solver, ~20 s), Dallas (~17 s then 401) and Houston (never had a
// stream in testing). fetchv2 has no timeout, so one slow city would stall
// the whole answer.
const VIDY_SERVERS = [
    { city: "miami", name: "Miami", lang: "Original audio" },
    { city: "boise", name: "Boise", lang: "Original audio" },
    { city: "phoenix", name: "Phoenix", lang: "Original audio" },
    { city: "atlanta", name: "Atlanta", lang: "Original audio" },
    { city: "portland", name: "Portland", lang: "Original audio" },
    { city: "vegas", name: "Vegas", lang: "Original audio" },
    { city: "munich", name: "Munich", lang: "German", extra: { language: "german" } },
    { city: "paris", name: "Paris", lang: "French" },
    { city: "cancun", name: "Cancun", lang: "Spanish" }
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
    if (!headers["User-Agent"]) headers["User-Agent"] = VIDY_UA;
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

function apiHeaders() {
    return {
        "User-Agent": VIDY_UA,
        "Accept": "application/json, text/plain, */*",
        "Origin": VIDY_SITE,
        "Referer": `${VIDY_SITE}/`
    };
}

function streamHeaders() {
    return { "Referer": `${VIDY_SITE}/`, "Origin": VIDY_SITE, "User-Agent": VIDY_UA };
}

// ==========================================
// 🔐 THE "enc=2" STREAM CIPHER (pure JS)
// ==========================================

const VIDY_K = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
    3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580];
const VIDY_MAGIC = [109, 118, 109, 49]; // "mvm1"
const VIDY_GOLDEN = 2654435769;         // 0x9E3779B9

// murmur3 32-bit finaliser
function vMix(e) {
    e >>>= 0;
    e ^= e >>> 16;
    e = Math.imul(e, 2246822507) >>> 0;
    e ^= e >>> 13;
    e = Math.imul(e, 3266489909) >>> 0;
    e ^= e >>> 16;
    return e >>> 0;
}

function vRotl(e, t) {
    e >>>= 0;
    t &= 31;
    if (t === 0) return e >>> 0;
    return ((e << t) | (e >>> (32 - t))) >>> 0;
}

function vFnv(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    return vMix(h);
}

// State: 61 sparse words (presence matters, see "has") and an accumulator.
function vInitState(seed, mediaId) {
    const S = new Array(61);
    const has = new Array(61);
    for (let i = 0; i < 61; i++) { S[i] = 0; has[i] = false; }

    let s = vMix(vFnv(seed) ^ vMix(((mediaId >>> 0) ^ VIDY_GOLDEN) >>> 0)) >>> 0;
    for (let e = 0; e < 8; e++) {
        const t = s % 61;
        s = vRotl((s + VIDY_GOLDEN) >>> 0, 7 + (7 & e));
        S[t] = (s ^ vMix(s)) >>> 0;
        has[t] = true;
        s = vMix((s + t) >>> 0);
    }
    return { S: S, has: has, acc: vMix((2779096485 ^ s) >>> 0) >>> 0 };
}

function vNextWord(st, counter) {
    let n = st.acc;
    const d = n % 61;
    const mask = st.has[d] ? -1 : 0;
    const i = st.S[d] >>> 0;
    const s = (i ^ (Math.imul(VIDY_GOLDEN, counter + 1) >>> 0)) >>> 0;
    let l = (((n ^ s) >>> 0) | ((n & s & mask) >>> 0)) >>> 0;
    l = (vRotl((l + n) >>> 0, 31 & d) ^ vRotl(n, 31 & Math.imul(d, 7))) >>> 0;
    n = vMix((l + VIDY_GOLDEN) >>> 0);
    st.S[d] = n >>> 0;
    st.has[d] = true;
    st.acc = n;
    return n >>> 0;
}

function vKeystream(seed, mediaId, length) {
    const st = vInitState(seed, mediaId);
    const out = new Array(length);
    let counter = 0;
    for (let e = 0; e < length;) {
        const w = vNextWord(st, counter++);
        out[e++] = w & 255;
        if (e < length) out[e++] = (w >>> 8) & 255;
        if (e < length) out[e++] = (w >>> 16) & 255;
        if (e < length) out[e++] = (w >>> 24) & 255;
    }
    return out;
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64UrlToBytes(input) {
    const clean = String(input).trim().replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
        const v = B64_ALPHABET.indexOf(clean.charAt(i));
        if (v < 0) continue;
        buffer = (buffer << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 255);
        }
    }
    return bytes;
}

function utf8Decode(bytes, start) {
    let out = "";
    let i = start || 0;
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

// Returns the decrypted JSON text, or null when the seed did not match.
function vidyDecrypt(cipherText, seed, mediaId) {
    const data = base64UrlToBytes(cipherText);
    if (data.length <= VIDY_MAGIC.length) return null;
    const ks = vKeystream(seed, mediaId, data.length);
    for (let i = 0; i < data.length; i++) data[i] = (data[i] ^ ks[i]) & 255;
    for (let i = 0; i < VIDY_MAGIC.length; i++) if (data[i] !== VIDY_MAGIC[i]) return null;
    return utf8Decode(data, VIDY_MAGIC.length);
}

// ==========================================
// 🛰️ VIDY API
// ==========================================

// Query-string encoding of the player's fetch helper (ofetch/ufo): encodeURI,
// then a handful of characters swapped. The title is passed through
// encodeURIComponent first, exactly as the player does (so it ends up
// encoded twice on the wire).
function ufoEncodeValue(value) {
    return encodeURI(String(value))
        .replace(/%7c/gi, "|")
        .replace(/\+/g, "%2B")
        .replace(/%20/gi, "+")
        .replace(/#/g, "%23")
        .replace(/&/g, "%26")
        .replace(/%60/gi, "`")
        .replace(/%5e/gi, "^")
        .replace(/\//g, "%2F");
}

function buildQuery(params) {
    const parts = [];
    for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === undefined || value === null || value === "") continue;
        parts.push(`${ufoEncodeValue(key).replace(/=/g, "%3D")}=${ufoEncodeValue(value)}`);
    }
    return parts.join("&");
}

async function vidySeed(mediaId) {
    const response = await soraFetch(`${VIDY_API}/seed?mediaId=${encodeURIComponent(mediaId)}`, { method: 'GET', headers: apiHeaders() });
    const body = await readBody(response);
    try {
        const json = JSON.parse(body);
        return json && json.seed ? String(json.seed) : null;
    } catch (e) { return null; }
}

// One city: request with the shared seed, decrypt; when the seed is refused,
// start again with a fresh one (a few times: the seed is tied to the client
// address, and a client behind rotating egress addresses needs several tries).
async function vidyCity(server, media, sharedSeed) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const seed = attempt === 0 && sharedSeed ? sharedSeed : await vidySeed(media.tmdbId);
        if (!seed) return { error: "no seed" };

        const params = {
            title: encodeURIComponent(media.title),
            mediaType: media.kind === 'tv' ? 'tv' : 'movie',
            year: media.year,
            episodeId: media.episode,
            seasonId: media.season,
            tmdbId: media.tmdbId,
            imdbId: media.imdbId
        };
        if (server.extra) for (const k of Object.keys(server.extra)) params[k] = server.extra[k];
        params.enc = "2";
        params.seed = seed;

        const url = `${VIDY_API}/${server.city}/sources?${buildQuery(params)}`;
        const response = await soraFetch(url, { method: 'GET', headers: apiHeaders() });
        const body = (await readBody(response)) || "";
        const status = response && typeof response.status === 'number' ? response.status : 0;

        if (body.indexOf("STREAMCRYPTO_SEED_INVALID") !== -1) continue;
        if (status >= 400 || body.charAt(0) === '{') {
            let reason = `HTTP ${status}`;
            try { const j = JSON.parse(body); if (j && j.message) reason = String(j.message).slice(0, 120); } catch (e) { }
            return { error: reason };
        }

        const plain = vidyDecrypt(body, seed, media.tmdbId);
        if (!plain) return { error: "decrypt failed" };
        try { return { data: JSON.parse(plain) }; } catch (e) { return { error: "bad JSON" }; }
    }
    return { error: "seed refused" };
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Vidy — searching for "${keyword}"`);
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
                href: `vidy://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Vidy", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Vidy", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('vidy-play://', '').replace('vidy://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 Vidy — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("Vidy", "DETAILS", { media_url: `${VIDY_SITE}/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("Vidy", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 Vidy — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `vidy-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which the player drops too.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `vidy-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Vidy", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// What the player sends: the English title (the original one when the film
// is English-language), the release year and the IMDb id.
async function loadMedia(ref) {
    const data = await tmdbGet(`/${ref.kind}/${ref.id}?language=en-US&append_to_response=external_ids,translations`);
    if (!data || !data.id) return null;

    const translations = data.translations && Array.isArray(data.translations.translations) ? data.translations.translations : [];
    const english = translations.find(t => t && t.iso_639_1 === 'en' && t.data && (t.data.title || t.data.name));

    let title;
    if (ref.kind === 'tv') {
        title = data.original_language === 'en' ? data.original_name : ((english && english.data.name) || data.name);
    } else {
        title = data.original_language === 'en' ? data.original_title : ((english && english.data.title) || data.title);
    }
    title = title || data.title || data.name || "";

    const date = ref.kind === 'tv' ? data.first_air_date : data.release_date;
    const year = date ? Number(String(date).slice(0, 4)) : undefined;
    const imdbId = ref.kind === 'tv'
        ? (data.external_ids && data.external_ids.imdb_id) || ""
        : data.imdb_id || (data.external_ids && data.external_ids.imdb_id) || "";

    return {
        kind: ref.kind,
        tmdbId: Number(ref.id),
        title: title,
        year: year && !isNaN(year) ? year : undefined,
        imdbId: imdbId,
        season: Number(ref.season || 1) || 1,
        episode: Number(ref.episode || 1) || 1
    };
}

function languageLabel(code, fallback) {
    const map = { eng: "English", en: "English", spa: "Spanish", es: "Spanish", fre: "French", fra: "French", fr: "French", ger: "German", deu: "German", de: "German", ita: "Italian", it: "Italian", por: "Portuguese", pt: "Portuguese", ara: "Arabic", ar: "Arabic", hin: "Hindi", hi: "Hindi" };
    const key = String(code || "").toLowerCase();
    return map[key] || fallback || code || "Unknown";
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = ref.kind === 'tv'
        ? `${VIDY_SITE}/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${VIDY_SITE}/movie/${ref.id}`;

    console.log(`[Player] 🎬 Vidy — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const media = await loadMedia(ref);
        if (!media || !media.title) {
            console.log(`[Player] ⚠️ TMDB entry not found.`);
            return JSON.stringify({ type: "none" });
        }
        console.log(`[Player] 🧩 "${media.title}" (${media.year || '?'}) imdb=${media.imdbId || '-'}`);

        // Every city is independent: ask them all at once, with one seed
        // shared like the player does (it caches it for its 30 s lifetime).
        const sharedSeed = await vidySeed(media.tmdbId);
        const answers = await Promise.all(VIDY_SERVERS.map(async server => {
            try { return { server: server, result: await vidyCity(server, media, sharedSeed) }; }
            catch (e) { return { server: server, result: { error: String(e) } }; }
        }));

        for (const answer of answers) {
            const server = answer.server;
            const result = answer.result || {};
            const data = result.data;
            const sources = (data && Array.isArray(data.sources) ? data.sources.slice() : [])
                .sort((a, b) => (parseInt(b && b.quality, 10) || 0) - (parseInt(a && a.quality, 10) || 0));

            if (!sources.length) {
                failedLinks.push({ server_name: server.name, url: `${VIDY_API}/${server.city}/sources`, reason: result.error || "No source" });
                console.log(`   -> ${server.name}: ${result.error || "no source"}`);
                continue;
            }

            for (const source of sources) {
                const streamUrl = source && (source.url || source.file);
                if (!streamUrl || streams.some(s => s.streamUrl === streamUrl)) continue;
                const quality = source.quality ? ` ${source.quality}` : "";
                streams.push({
                    title: `Vidy ${server.name}${quality} · ${server.lang}`,
                    streamUrl: streamUrl,
                    headers: streamHeaders()
                });
            }
            console.log(`   -> ${server.name}: ${sources.length} source(s)`);

            const subtitles = Array.isArray(data.subtitles) ? data.subtitles : [];
            for (const caption of subtitles) {
                const subUrl = caption && (caption.url || caption.file);
                if (!subUrl || allSubtitles.some(s => s.url === subUrl)) continue;
                const code = caption.lang || caption.language || "";
                allSubtitles.push({
                    url: subUrl,
                    label: languageLabel(code, caption.label),
                    kind: "captions",
                    headers: streamHeaders()
                });
                if (!bestSubtitle && /^(en|eng|english)$/i.test(String(code))) {
                    bestSubtitle = subUrl;
                    bestSubtitleHeaders = streamHeaders();
                }
            }
        }

        if (!bestSubtitle && allSubtitles.length) {
            bestSubtitle = allSubtitles[0].url;
            bestSubtitleHeaders = allSubtitles[0].headers;
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("Vidy", "PLAYER", {
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
            sendSupabaseLog("Vidy", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("Vidy", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
