// ==========================================
// ⚙️ SORA MODULE — MOVIEPIRE (PHLAND)
// ==========================================
// Moviepire (phland.org) is a TMDB-keyed catalogue whose first server,
// "Phland", is its own player (/embed/movie/<id>, /embed/tv/<id>/<s>/<e>),
// built on the "Vyla" engine: the page races dozens of scrapers that run on
// Phland's server, each one behind a plain JSON route.
//
//   GET /api/source/<key>/movie?id=<tmdb>
//   GET /api/source/<key>/tv?id=<tmdb>&season=<s>&episode=<e>
//       -> {source, label, ok, results:[{label, url, proxyUrl, rawUrl,
//           type:"hls"|"mp4", quality}]}
//   GET /api/meta/<movie/<id> | tv/<id>/<s>/<e>>  -> {meta, subtitles:[{label, file}]}
//
// "proxyUrl" is Phland's own relay (/api?url=<upstream>&h=<headers JSON>):
// it adds the Referer/Origin the upstream wants and rewrites the playlist
// so that segments go through it as well. Some upstreams (LookMovie,
// lmscript) only work that way, so the relay link is what is offered.
// No token and no encryption on any of these routes.
//
// Only the scrapers no other module covers are asked here (VidAPI,
// LookMovie, lmscript, FSOnline, FlaxMovies, MovieBox "Blaze", KissKH,
// CF-Storage/Drive mirrors, 4KHDHub, Films365, CineSu); the ones wrapping
// VidZee, Videasy, VidFast, VidNest, VidRock, VidUp, VixSrc, MoviesAPI,
// RiveStream, Movy, Bcine, Cinejoy, Hexa or PurStream are left to the
// modules covering those players.

const PH_BASE = "https://phland.org";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const PH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Scraper keys, roughly from the most to the least reliable in testing.
const PH_KEYS = [
    { key: "vidapi", name: "VidAPI" },
    { key: "lookmovie", name: "LookMovie" },
    { key: "lmscript", name: "LMScript" },
    { key: "fsonline", name: "FSOnline" },
    { key: "flaxmovies", name: "FlaxMovies" },
    { key: "blaze", name: "Blaze" },
    { key: "drive", name: "Drive" },
    { key: "mod", name: "Mod" },
    { key: "kisskh", name: "KissKH" },
    { key: "4khdhub", name: "4KHDHub" },
    { key: "films365", name: "Films365" },
    { key: "cinesu", name: "CineSu" }
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
    if (!headers["User-Agent"]) headers["User-Agent"] = PH_UA;
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

async function phJson(path, embedUrl) {
    const headers = {
        "User-Agent": PH_UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": embedUrl || `${PH_BASE}/`
    };
    const body = await readBody(await soraFetch(`${PH_BASE}${path}`, { method: 'GET', headers: headers }));
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// Headers carried by a relay link (…&h=<url-encoded JSON>).
function relayHeaders(proxyUrl) {
    const match = String(proxyUrl || "").match(/[?&]h=([^&]+)/);
    if (!match) return {};
    try {
        const parsed = JSON.parse(decodeURIComponent(match[1]));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
}

// First bytes of a link: a playlist must start with #EXTM3U, a file must not
// be an HTML error page. Range keeps it to 1 KB for files.
async function phAlive(url, headers) {
    try {
        const response = await soraFetch(url, { method: 'GET', headers: { ...headers, "Range": "bytes=0-1023" } });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = (await readBody(response)) || "";
        if (body.indexOf("#EXTM3U") !== -1) return true;
        return body.length > 0 && !/^\s*</.test(body) && !/^\s*\{\s*"error/.test(body);
    } catch (e) { return false; }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Moviepire — searching for "${keyword}"`);
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
                href: `moviepire://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Moviepire", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Moviepire", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('moviepire-play://', '').replace('moviepire://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 Moviepire — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("Moviepire", "DETAILS", { media_url: `${PH_BASE}/embed/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("Moviepire", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 Moviepire — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `moviepire-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which the player does not take.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `moviepire-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Moviepire", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// One Vyla result -> one stream (or null when a native player cannot use it).
function toStream(result, server) {
    if (!result || typeof result !== 'object') return null;
    const raw = String(result.rawUrl || result.url || "");
    const url = String(result.url || "");
    const proxy = String(result.proxyUrl || "");

    // Matroska files and the xpass "TIK" relays (TS hidden in PNG images)
    // do not play natively.
    if (/\.mkv(\?|$)/i.test(raw)) return null;
    if (/tik\d*\.1x2\.space/i.test(decodeURIComponent(raw))) return null;

    let streamUrl, headers;
    if (url.indexOf(PH_BASE) === 0) {
        streamUrl = url;
        headers = { "User-Agent": PH_UA, "Referer": `${PH_BASE}/` };
    } else if (proxy.indexOf(PH_BASE) === 0) {
        streamUrl = proxy;
        headers = { "User-Agent": PH_UA, "Referer": `${PH_BASE}/` };
    } else if (/^https?:\/\//.test(url)) {
        streamUrl = url;
        headers = { "User-Agent": PH_UA, ...relayHeaders(proxy) };
    } else {
        return null;
    }

    // Labels such as "Server 23 #2" or "FlaxMovies - Xpass-VIP 1" repeat the
    // scraper name: keep only what tells the links apart.
    let label = String(result.label || "").replace(/\s+/g, " ").trim()
        .replace(new RegExp(`^${server.name}\\s*-\\s*`, "i"), "")
        .replace(/^Server \d+( #\d+)?$/i, "");
    if (label.toLowerCase() === server.name.toLowerCase()) label = "";
    const quality = result.quality && !/^auto$/i.test(String(result.quality)) && String(result.quality) !== label
        ? String(result.quality) : "";
    const extra = [label, quality].filter(Boolean).join(" · ");
    return {
        title: `Moviepire ${server.name}${extra ? ` — ${extra}` : ""}`,
        streamUrl: streamUrl,
        headers: headers
    };
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const embedUrl = ref.kind === 'tv'
        ? `${PH_BASE}/embed/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${PH_BASE}/embed/movie/${ref.id}`;
    const query = ref.kind === 'tv'
        ? `tv?id=${encodeURIComponent(ref.id)}&season=${encodeURIComponent(ref.season)}&episode=${encodeURIComponent(ref.episode)}`
        : `movie?id=${encodeURIComponent(ref.id)}`;
    const metaPath = ref.kind === 'tv'
        ? `/api/meta/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `/api/meta/movie/${ref.id}`;

    console.log(`[Player] 🎬 Moviepire — ${embedUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        // Every scraper is an independent route: ask them all at once.
        const [answers, meta] = await Promise.all([
            Promise.all(PH_KEYS.map(async server => {
                try { return { server: server, data: await phJson(`/api/source/${server.key}/${query}`, embedUrl) }; }
                catch (e) { return { server: server, data: null, error: String(e) }; }
            })),
            phJson(metaPath, embedUrl).catch(() => null)
        ]);

        // Candidates in server order, then a quick probe of each (scrapers
        // regularly hand out links that are already dead).
        const candidates = [];
        for (const answer of answers) {
            const results = answer.data && Array.isArray(answer.data.results) ? answer.data.results : [];
            const mine = [];
            for (const result of results) {
                const stream = toStream(result, answer.server);
                if (!stream || candidates.some(c => c.stream.streamUrl === stream.streamUrl)) continue;
                mine.push(stream);
            }
            if (mine.length > 1) mine.forEach((stream, i) => { stream.title = `${stream.title} #${i + 1}`; });
            for (const stream of mine) candidates.push({ server: answer.server, stream: stream });
            if (!mine.length) {
                failedLinks.push({ server_name: answer.server.name, url: `${PH_BASE}/api/source/${answer.server.key}`, reason: answer.error || (results.length ? "unplayable formats" : "no result") });
            }
        }

        const alive = await Promise.all(candidates.map(c => phAlive(c.stream.streamUrl, c.stream.headers)));
        candidates.forEach((candidate, i) => {
            if (alive[i]) streams.push(candidate.stream);
            else failedLinks.push({ server_name: candidate.server.name, url: candidate.stream.streamUrl, reason: "dead link" });
        });
        console.log(`   -> ${streams.length}/${candidates.length} candidate link(s) alive`);

        // Subtitles: [{label, file:"https://phland.org/api/sub?url=…&type=vtt"}]
        const subtitles = meta && Array.isArray(meta.subtitles) ? meta.subtitles : [];
        for (const sub of subtitles) {
            const file = sub && (sub.file || sub.url);
            if (!file || allSubtitles.some(s => s.url === file)) continue;
            const label = String(sub.label || sub.language || "Subtitle");
            allSubtitles.push({ url: file, label: label, kind: "captions", headers: { "Referer": `${PH_BASE}/` } });
            if (!bestSubtitle && /^(english|eng|en)\b/i.test(label)) {
                bestSubtitle = file;
                bestSubtitleHeaders = { "Referer": `${PH_BASE}/` };
            }
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("Moviepire", "PLAYER", {
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
            sendSupabaseLog("Moviepire", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("Moviepire", "ERROR", { media_url: embedUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
