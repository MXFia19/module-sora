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

// One relay call: returns the decoded JSON object, or null.
async function vnRelay(relayPath) {
    const headers = {
        "User-Agent": VN_UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": `${VN_SITE}/`,
        "Origin": VN_SITE
    };
    const body = await readBody(await soraFetch(`${VN_API}/${relayPath}`, { method: 'GET', headers: headers }));
    if (!body || body.charAt(0) !== '{') return null;
    try {
        const json = JSON.parse(body);
        if (!json || typeof json !== 'object') return null;
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
