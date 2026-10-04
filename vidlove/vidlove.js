// ==========================================
// ⚙️ SORA MODULE — VIDLOVE
// ==========================================
// VidLove (player.vidlove.cc) is the backend 111movies.net now redirects to,
// and the default player of 67Movies (67movies.st) and its twin PhantomFlix
// (phantomflix.net). It is keyed by TMDB id, so the catalogue comes straight
// from TMDB; playback from VidLove's JSON API, one call per server, nothing to
// sign or decrypt:
//
//   GET https://api.vidlove.cc/movie?id=<tmdb>&mode=json&sources=<server>
//   GET https://api.vidlove.cc/tv?id=<tmdb>&season=<s>&episode=<e>&mode=json&sources=<server>
//     -> {meta:{…TMDB…}, subtitles:[{label,file,type}],
//         source:{source,label,url,manifest} | null}
//
// "url" is an HLS master already wrapped in PhantomFlix's relay
// ({a2,c,d}.phantomflix.net/api?d=<opaque>), which needs no header. The
// player appends "&hevc=1" to the Barbarian King (moviebox2) / Mega Knight
// servers when the browser can play HEVC: without it those servers answer
// null, with it they serve hvc1 renditions (fine for AVPlayer and recent
// Android decoders). A throttled server can hand back a 20-second filler MP4
// instead of a playlist, so every link is checked for "#EXTM3U".

const VL_API = "https://api.vidlove.cc";
const VL_PLAYER = "https://player.vidlove.cc";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const VL_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Servers in the player's order (its own display names): key, name, and
// whether the player asks it for HEVC.
const VL_SERVERS = [
    { key: "megaknight", name: "Mega Knight", hevc: true },
    { key: "moviebox2", name: "Barbarian King", hevc: true },
    { key: "warden", name: "Grand Warden", hevc: false },
    { key: "cinefreak", name: "P.E.K.K.A", hevc: false },
    { key: "vidapi", name: "Archer Queen", hevc: false },
    { key: "ipcloud", name: "Royal Champion", hevc: false },
    { key: "tcloud", name: "Ice Wizard", hevc: false }
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
    if (!headers["User-Agent"]) headers["User-Agent"] = VL_UA;
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

function serverUrl(ref, server) {
    const base = ref.kind === 'tv'
        ? `${VL_API}/tv?id=${ref.id}&season=${ref.season}&episode=${ref.episode}&mode=json`
        : `${VL_API}/movie?id=${ref.id}&mode=json`;
    return `${base}&sources=${server.key}${server.hevc ? "&hevc=1" : ""}`;
}

async function vlServer(ref, server) {
    const headers = { "User-Agent": VL_UA, "Accept": "application/json", "Referer": `${VL_PLAYER}/`, "Origin": VL_PLAYER };
    const body = await readBody(await soraFetch(serverUrl(ref, server), { method: 'GET', headers: headers }));
    if (!body || body.charAt(0) !== '{') return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

function streamHeaders() {
    return { "Referer": `${VL_PLAYER}/`, "User-Agent": VL_UA };
}

// Only a real playlist counts: a throttled server answers with a short filler
// MP4 that would otherwise play as a 20-second clip.
async function playlistIsAlive(url) {
    try {
        const response = await soraFetch(url, { method: 'GET', headers: streamHeaders() });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = await readBody(response);
        return body.slice(0, 64).indexOf('#EXTM3U') !== -1;
    } catch (e) { return false; }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 VidLove — searching for "${keyword}"`);
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
                href: `vidlove://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("VidLove", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("VidLove", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('vidlove-play://', '').replace('vidlove://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 VidLove — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("VidLove", "DETAILS", { media_url: `${VL_PLAYER}/embed/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("VidLove", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 VidLove — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `vidlove-play://movie/${ref.id}`,
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
                    href: `vidlove-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("VidLove", "ERROR", { media_url: url, error_message: String(error) });
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
        ? `${VL_PLAYER}/embed/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${VL_PLAYER}/embed/movie/${ref.id}`;

    console.log(`[Player] 🎬 VidLove — ${mediaUrl}`);

    const candidates = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        // The servers are independent: ask them all at once.
        const answers = await Promise.all(VL_SERVERS.map(server => vlServer(ref, server).catch(() => null)));

        VL_SERVERS.forEach((server, index) => {
            const data = answers[index];
            const source = data && data.source;
            const streamUrl = source && source.url ? String(source.url) : "";
            if (!/^https?:\/\//.test(streamUrl)) {
                failedLinks.push({ server_name: server.name, url: serverUrl(ref, server), reason: "source: null" });
            } else if (!candidates.some(s => s.streamUrl === streamUrl)) {
                // e.g. "VidLove Barbarian King · Auto HEVC (MovieBox HLS)"
                const label = source.label ? ` (${source.label})` : "";
                const codec = server.hevc ? " HEVC" : "";
                candidates.push({ title: `VidLove ${server.name} · Auto${codec}${label}`, streamUrl: streamUrl, headers: streamHeaders() });
            }

            // Every answer repeats the same subtitle catalogue; keep one copy.
            const subtitles = data && Array.isArray(data.subtitles) ? data.subtitles : [];
            for (const caption of subtitles) {
                const subUrl = caption && (caption.file || caption.url) || "";
                if (!/^https?:\/\//.test(subUrl)) continue;
                if (allSubtitles.some(s => s.url === subUrl)) continue;
                const label = caption.label || caption.language || "Unknown";
                allSubtitles.push({ url: subUrl, label: label, kind: "captions", headers: { "Referer": `${VL_PLAYER}/` } });
                if (bestSubtitle === "" && /^english/i.test(String(label))) {
                    bestSubtitle = subUrl;
                    bestSubtitleHeaders = { "Referer": `${VL_PLAYER}/` };
                }
            }
        });

        // Keep the links that really answer with a playlist (in parallel).
        const alive = await Promise.all(candidates.map(s => playlistIsAlive(s.streamUrl)));
        const streams = candidates.filter((s, i) => {
            if (!alive[i]) failedLinks.push({ server_name: s.title, url: s.streamUrl, reason: "No playlist (filler or dead link)" });
            return alive[i];
        });
        streams.forEach(s => console.log(`   -> ${s.title}`));

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("VidLove", "PLAYER", {
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
            sendSupabaseLog("VidLove", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("VidLove", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
