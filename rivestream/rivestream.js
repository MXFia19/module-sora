// ==========================================
// ⚙️ SORA MODULE — RIVESTREAM
// ==========================================
// Rive (www.rivestream.app, mirrors rivestream.ru and rivestream.win) is a
// Next.js front-end keyed by TMDB id, movies and TV alike. The catalogue
// therefore comes straight from TMDB; playback from Rive's own backend:
//
//   GET /api/backendfetch?requestID=VideoProviderServices&secretKey=rive
//     -> {"data":["apogee","vanguard","zephyr",…]}          (server list)
//   GET /api/backendfetch?requestID=movieVideoProvider&id=<tmdb>&service=<s>
//                        &secretKey=<key>&proxyMode=noProxy
//   GET /api/backendfetch?requestID=tvVideoProvider&id=<tmdb>&season=<s>
//                        &episode=<e>&service=<s>&secretKey=<key>&proxyMode=noProxy
//     -> {"data":{"sources":[{quality,url,source,format}],"captions":[{label,file}]}}
//
// "secretKey" is not a secret: the site computes it in the browser from the
// TMDB id alone (see riveSecretKey below, a faithful port of its _app chunk):
// a salt picked from a fixed word list is spliced into the id, the result is
// run through two 32-bit hash rounds, and the 8-hex-digit digest is base64'd.
//
// Most sources come back already wrapped in Rive's HLS relay
// (proxy.valhallastream.com/m3u8-proxy?url=…&headers=…), which only answers
// requests carrying a rivestream Referer/Origin. The others (PrimeVids,
// Citadel) are direct CDN links that accept the same headers.

const RIVE_HOSTS = ["https://www.rivestream.app", "https://rivestream.ru", "https://rivestream.win"];
const RIVE_REFERER = "https://www.rivestream.app/";
const RIVE_ORIGIN = "https://www.rivestream.app";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const RIVE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Server list as published by the site, used when the live list is unreachable.
const RIVE_DEFAULT_SERVICES = ["apogee", "vanguard", "zephyr", "velocity", "ignite", "tampa", "meridian",
    "savannah", "prometheus", "quasar", "solstice", "primevids", "citadel", "apollo", "asiacloud"];

// Salt word list of the secretKey function (copied verbatim from the site).
const RIVE_SALTS = ["4Z7lUo", "gwIVSMD", "PLmz2elE2v", "Z4OFV0", "SZ6RZq6Zc", "zhJEFYxrz8", "FOm7b0", "axHS3q4KDq",
    "o9zuXQ", "4Aebt", "wgjjWwKKx", "rY4VIxqSN", "kfjbnSo", "2DyrFA1M", "YUixDM9B", "JQvgEj0", "mcuFx6JIek",
    "eoTKe26gL", "qaI9EVO1rB", "0xl33btZL", "1fszuAU", "a7jnHzst6P", "wQuJkX", "cBNhTJlEOf", "KNcFWhDvgT",
    "XipDGjST", "PCZJlbHoyt", "2AYnMZkqd", "HIpJh", "KH0C3iztrG", "W81hjts92", "rJhAT", "NON7LKoMQ", "NMdY3nsKzI",
    "t4En5v", "Qq5cOQ9H", "Y9nwrp", "VX5FYVfsf", "cE5SJG", "x1vj1", "HegbLe", "zJ3nmt4OA", "gt7rxW57dq", "clIE9b",
    "jyJ9g", "B5jXjMCSx", "cOzZBZTV", "FTXGy", "Dfh1q1", "ny9jqZ2POI", "X2NnMn", "MBtoyD", "qz4Ilys7wB", "68lbOMye",
    "3YUJnmxp", "1fv5Imona", "PlfvvXD7mA", "ZarKfHCaPR", "owORnX", "dQP1YU", "dVdkx", "qgiK0E", "cx9wQ", "5F9bGa",
    "7UjkKrp", "Yvhrj", "wYXez5Dg3", "pG4GMU", "MwMAu", "rFRD5wlM"];

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
    if (!headers["User-Agent"]) headers["User-Agent"] = RIVE_UA;
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
// 🔐 SECRET KEY (port of the site's own function)
// ==========================================

// Pure-JS base64 of an ASCII string (btoa is not guaranteed on device).
function asciiToBase64(text) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < text.length; i += 3) {
        const a = text.charCodeAt(i) & 255;
        const b = i + 1 < text.length ? text.charCodeAt(i + 1) & 255 : NaN;
        const c = i + 2 < text.length ? text.charCodeAt(i + 2) & 255 : NaN;
        out += alphabet.charAt(a >> 2);
        out += alphabet.charAt(((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4));
        out += isNaN(b) ? "=" : alphabet.charAt(((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6));
        out += isNaN(c) ? "=" : alphabet.charAt(c & 63);
    }
    return out;
}

// First round: a rotating shift-add hash over the salted id.
function riveInnerHash(input) {
    const e = String(input);
    let t = 0;
    for (let n = 0; n < e.length; n++) {
        const r = e.charCodeAt(n);
        t = r + (t << 6) + (t << 16) - t >>> 0;
        const i = (t << n % 5 | t >>> 32 - n % 5) >>> 0;
        t ^= (i ^ (r << n % 7 | r >>> 8 - n % 7)) >>> 0;
        t = t + (t >>> 11 ^ t << 3) >>> 0;
    }
    t ^= t >>> 15;
    t = (65535 & t) * 49842 + (((t >>> 16) * 49842 & 65535) << 16) >>> 0;
    t ^= t >>> 13;
    t = (65535 & t) * 40503 + (((t >>> 16) * 40503 & 65535) << 16) >>> 0;
    t ^= t >>> 16;
    return t.toString(16).padStart(8, "0");
}

// Second round: a murmur-like mix over the first digest.
function riveOuterHash(input) {
    const t = String(input);
    let n = 3735928559 ^ t.length;
    for (let e = 0; e < t.length; e++) {
        let r = t.charCodeAt(e);
        r ^= (131 * e + 89 ^ r << e % 5) & 255;
        n = (n << 7 | n >>> 25) >>> 0 ^ r;
        const lo = (65535 & n) * 60205;
        const hi = (n >>> 16) * 60205 << 16;
        n = lo + hi >>> 0;
        n ^= n >>> 11;
    }
    n ^= n >>> 15;
    n = (65535 & n) * 49842 + ((n >>> 16) * 49842 << 16) >>> 0;
    n ^= n >>> 13;
    n = (65535 & n) * 40503 + ((n >>> 16) * 40503 << 16) >>> 0;
    n ^= n >>> 16;
    n = (65535 & n) * 10196 + ((n >>> 16) * 10196 << 16) >>> 0;
    n ^= n >>> 15;
    return n.toString(16).padStart(8, "0");
}

function riveSecretKey(id) {
    if (id === undefined || id === null || id === "") return "rive";
    try {
        const text = String(id);
        let salt, cut;
        if (isNaN(Number(id))) {
            const sum = text.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
            salt = RIVE_SALTS[sum % RIVE_SALTS.length] || asciiToBase64(text);
            cut = Math.floor(sum % text.length / 2);
        } else {
            const num = Number(id);
            salt = RIVE_SALTS[num % RIVE_SALTS.length] || asciiToBase64(text);
            cut = Math.floor(num % text.length / 2);
        }
        const salted = text.slice(0, cut) + salt + text.slice(cut);
        return asciiToBase64(riveOuterHash(riveInnerHash(salted)));
    } catch (e) {
        return "topSecret";
    }
}

// GET /api/backendfetch on the first mirror that answers with JSON.
async function riveBackend(query) {
    const headers = { "User-Agent": RIVE_UA, "Accept": "application/json", "Referer": RIVE_REFERER };
    for (const host of RIVE_HOSTS) {
        try {
            const body = await readBody(await soraFetch(`${host}/api/backendfetch?${query}`, { method: 'GET', headers: headers }));
            if (!body || body.charAt(0) !== '{') continue;
            return JSON.parse(body);
        } catch (e) { /* next mirror */ }
    }
    return null;
}

async function riveServices() {
    const data = await riveBackend("requestID=VideoProviderServices&secretKey=rive&proxyMode=undefined");
    const list = data && Array.isArray(data.data) ? data.data.filter(s => typeof s === 'string' && s) : [];
    return list.length ? list : RIVE_DEFAULT_SERVICES;
}

function riveProviderQuery(ref, service) {
    // The site adds a 50-minute cache buster for these two servers.
    const cb = (service === "primevids" || service === "citadel") ? `&cb=${Math.floor(Date.now() / 3e6)}` : "";
    const key = encodeURIComponent(riveSecretKey(ref.id));
    if (ref.kind === 'tv') {
        return `requestID=tvVideoProvider&id=${ref.id}&season=${ref.season}&episode=${ref.episode}&service=${service}${cb}&secretKey=${key}&proxyMode=noProxy`;
    }
    return `requestID=movieVideoProvider&id=${ref.id}&service=${service}${cb}&secretKey=${key}&proxyMode=noProxy`;
}

function streamHeaders() {
    return { "Referer": RIVE_REFERER, "Origin": RIVE_ORIGIN, "User-Agent": RIVE_UA };
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Rivestream — searching for "${keyword}"`);
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
                href: `rivestream://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Rivestream", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Rivestream", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('rivestream-play://', '').replace('rivestream://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 Rivestream — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("Rivestream", "DETAILS", { media_url: `${RIVE_HOSTS[0]}/detail?type=${ref.kind}&id=${ref.id}` });

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
        sendSupabaseLog("Rivestream", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 Rivestream — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `rivestream-play://movie/${ref.id}`,
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
                    href: `rivestream-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Rivestream", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = ref.kind === 'tv'
        ? `${RIVE_HOSTS[0]}/watch?type=tv&id=${ref.id}&season=${ref.season}&episode=${ref.episode}`
        : `${RIVE_HOSTS[0]}/watch?type=movie&id=${ref.id}`;

    console.log(`[Player] 🎬 Rivestream — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const services = await riveServices();
        console.log(`[Player] 🧩 ${services.length} server(s): ${services.join(', ')}`);

        // The servers are independent: ask them all at once, then keep the
        // site's order for the result.
        const answers = await Promise.all(services.map(service =>
            riveBackend(riveProviderQuery(ref, service)).catch(() => null)
        ));

        services.forEach((service, index) => {
            const data = answers[index] && answers[index].data;
            const sources = data && Array.isArray(data.sources) ? data.sources : [];
            if (sources.length === 0) {
                failedLinks.push({ server_name: service, url: `${RIVE_HOSTS[0]}/api/backendfetch?service=${service}`, reason: "No source returned" });
                return;
            }

            for (const source of sources) {
                const streamUrl = source && source.url ? String(source.url) : "";
                if (!/^https?:\/\//.test(streamUrl)) continue;
                if (streams.some(s => s.streamUrl === streamUrl)) continue;
                const label = source.source || (service.charAt(0).toUpperCase() + service.slice(1));
                const quality = source.quality ? ` ${source.quality}` : "";
                streams.push({
                    title: `Rive ${label}${quality}`,
                    streamUrl: streamUrl,
                    headers: streamHeaders()
                });
                console.log(`   -> ${label}${quality}`);
            }

            const captions = Array.isArray(data.captions) ? data.captions : [];
            for (const caption of captions) {
                const subUrl = caption && (caption.file || caption.url || caption.src) || "";
                if (!/^https?:\/\//.test(subUrl)) continue;
                if (allSubtitles.some(s => s.url === subUrl)) continue;
                const label = caption.label || caption.language || service;
                allSubtitles.push({ url: subUrl, label: label, kind: "captions", headers: { "Referer": RIVE_REFERER } });
                if (bestSubtitle === "" && /^english/i.test(String(caption.label || caption.language || ""))) {
                    bestSubtitle = subUrl;
                    bestSubtitleHeaders = { "Referer": RIVE_REFERER };
                }
            }
        });

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("Rivestream", "PLAYER", {
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
            sendSupabaseLog("Rivestream", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("Rivestream", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
