// ==========================================
// ⚙️ SORA MODULE — MOVIESAPI
// ==========================================
// MoviesAPI (moviesapi.to; moviesapi.club is its older address) is a
// TMDB-keyed embed used by many movie/TV aggregators. Its player now runs
// under the "VidSpark" name and resolves streams through a small JSON API on
// its own origin:
//   GET https://moviesapi.to/api/vidora/v1/movie/<tmdbId>
//   GET https://moviesapi.to/api/vidora/v1/tv/<tmdbId>/<season>/<episode>
//   header x-player-key: <static value baked into the public player bundle>
//   -> {result, title, sources:[{url, source:"vidora", tracks:[]}]}
// When that has nothing, the player falls back to an iframe of
// cdn.vidspark.to, whose own copy of the same API (with its own static key)
// answers from another scraper ("scrapify") and covers many more episodes.
// Both are asked here, in parallel. No encryption: links come in the clear.
//   - vidora:   HLS on netrocdn hosts, needs Referer moviesapi.to
//   - scrapify: HLS through p1.netocdn.site's proxy, needs Referer cdn.vidspark.to
// Subtitles: /api/vidora/v1/subtitles/<path> lists VTT files served (keyless)
// under /api/vidora/subs/….

const MA_SITE = "https://moviesapi.to";
const MA_FALLBACK = "https://cdn.vidspark.to";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const MA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Static player keys sent by every visitor's browser (public JS constants of
// the two player bundles, not account credentials).
const MA_PLAYER_KEY = "3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13";
const MA_FALLBACK_KEY = "f3b72e73c80c9a996574379798703796a1936efa3516a7105cb0e43048b46b5a";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = MA_UA;
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
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 MoviesAPI — searching for "${keyword}"`);
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
                href: `moviesapi://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("MoviesAPI", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("MoviesAPI", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = String(url).replace('moviesapi-play://', '').replace('moviesapi://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 MoviesAPI — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("MoviesAPI", "DETAILS", { media_url: `${MA_SITE}/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("MoviesAPI", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 MoviesAPI — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `moviesapi-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which MoviesAPI does not carry.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `moviesapi-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("MoviesAPI", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function apiPath(ref) {
    return ref.kind === 'tv' ? `tv/${ref.id}/${ref.season}/${ref.episode}` : `movie/${ref.id}`;
}

// One call to either copy of the vidora API.
async function vidoraGet(origin, key, path) {
    const headers = {
        "User-Agent": MA_UA,
        "Accept": "application/json",
        "Referer": `${origin}/`,
        "x-player-key": key
    };
    const body = await readBody(await soraFetch(`${origin}/api/vidora/v1/${path}`, { method: 'GET', headers: headers }));
    if (!body || body.charAt(0) !== '{') return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// Both copies of the API, in the order their streams are offered.
const MA_BACKENDS = [
    { name: "Vidora", origin: MA_SITE, key: MA_PLAYER_KEY },
    { name: "Scrapify", origin: MA_FALLBACK, key: MA_FALLBACK_KEY }
];

function streamHeaders(origin) {
    return { "Referer": `${origin}/`, "Origin": origin, "User-Agent": MA_UA };
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const path = apiPath(ref);
    const mediaUrl = `${MA_SITE}/${path}`;

    console.log(`[Player] 🎬 MoviesAPI — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const fetched = await Promise.all([
            Promise.all(MA_BACKENDS.map(b => vidoraGet(b.origin, b.key, path).catch(() => null))),
            vidoraGet(MA_SITE, MA_PLAYER_KEY, `subtitles/${path}`).catch(() => null)
        ]);
        const answers = fetched[0];
        const subtitleAnswer = fetched[1];

        for (let i = 0; i < MA_BACKENDS.length; i++) {
            const backend = MA_BACKENDS[i];
            const data = answers[i];
            const sources = data && data.result && Array.isArray(data.sources) ? data.sources : [];
            const usable = sources.filter(s => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url));

            if (!usable.length) {
                failedLinks.push({ server_name: backend.name, url: `${backend.origin}/api/vidora/v1/${path}`, reason: (data && data.message) || "No source for this title" });
                continue;
            }

            for (const source of usable) {
                const qualities = Array.isArray(source.qualities)
                    ? source.qualities.filter(q => q && q.url && q.height)
                    : [];
                if (qualities.length > 1) {
                    qualities.sort((a, b) => b.height - a.height);
                    for (const q of qualities) {
                        streams.push({ title: `MoviesAPI ${backend.name} · ${q.height}p`, streamUrl: q.url, headers: streamHeaders(backend.origin) });
                    }
                } else {
                    streams.push({ title: `MoviesAPI ${backend.name} · Auto`, streamUrl: source.url, headers: streamHeaders(backend.origin) });
                }

                // Tracks embedded in the source (absolute URLs).
                if (Array.isArray(source.tracks)) {
                    for (const track of source.tracks) {
                        if (!track || !track.file || allSubtitles.some(s => s.url === track.file)) continue;
                        allSubtitles.push({ url: track.file, label: track.label || "Subtitle", kind: "captions", headers: { "Referer": `${backend.origin}/` } });
                    }
                }
            }
        }

        // Subtitle list: relative "subs/…" paths served under /api/vidora/.
        const tracks = subtitleAnswer && Array.isArray(subtitleAnswer.tracks) ? subtitleAnswer.tracks : [];
        for (const track of tracks) {
            if (!track || !track.src) continue;
            const subUrl = /^https?:\/\//.test(track.src) ? track.src : `${MA_SITE}/api/vidora/${String(track.src).replace(/^\/+/, '')}`;
            if (allSubtitles.some(s => s.url === subUrl)) continue;
            allSubtitles.push({
                url: subUrl,
                label: track.label || track.languageName || track.language || "Subtitle",
                kind: "captions",
                headers: { "Referer": `${MA_SITE}/` }
            });
        }

        const english = allSubtitles.find(s => /^english\b|^en$/i.test(String(s.label).trim()));
        const chosen = english || allSubtitles[0];
        if (chosen) {
            bestSubtitle = chosen.url;
            bestSubtitleHeaders = chosen.headers;
        }

        for (const s of streams) console.log(`   -> ${s.title}: ${s.streamUrl.slice(0, 80)}…`);
        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("MoviesAPI", "PLAYER", {
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
            sendSupabaseLog("MoviesAPI", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("MoviesAPI", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
