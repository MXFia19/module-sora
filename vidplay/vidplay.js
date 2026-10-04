// ==========================================
// ⚙️ SORA MODULE — VIDPLAY
// ==========================================
// VidPlay (vidplay.to) is a TMDB-keyed catalogue whose default player is its
// own embed, stream.vidplay.to (served under stream.torrentio.to too). That
// player is a front for a self-hosted CinePro server ("OMSS" spec) at
// s.torrentio.to, which runs ~30 scrapers server-side and hands back links
// already wrapped in its own proxy. No token, no encryption:
//
//   GET https://s.torrentio.to/v1/sources/stream?type=movie&id=<tmdb>
//   GET https://s.torrentio.to/v1/sources/stream?type=tv&id=<tmdb>&s=<s>&e=<e>
//     -> text/event-stream, one "event: partial" per scraper:
//        data: {"provider":{id,name},"sources":[{url,type,quality,audioTracks}],"subtitles":[]}
//        and a final "event: done" once every scraper has answered (~10 s).
//   GET https://s.torrentio.to/v1/subtitles?type=…&id=…[&s=…&e=…]
//     -> {"subtitles":[{url,label,format}]}
//
// The plain /v1/movies/<id> endpoint exists as well but skips most scrapers,
// so the stream endpoint (read in one go once it closes) is the one used.
// The proxy links (s.torrentio.to/server/stream?session=…) only answer with
// the player's Referer.

const VP_API = "https://s.torrentio.to";
const VP_PLAYER = "https://stream.vidplay.to";
const VP_SITE = "https://vidplay.to";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const VP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = VP_UA;
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

function apiHeaders(accept) {
    return { "User-Agent": VP_UA, "Accept": accept, "Referer": `${VP_PLAYER}/`, "Origin": VP_PLAYER };
}

function mediaQuery(ref) {
    return ref.kind === 'tv'
        ? `type=tv&id=${ref.id}&s=${ref.season}&e=${ref.episode}`
        : `type=movie&id=${ref.id}`;
}

// Reads the whole event stream and returns the "data:" payloads, parsed.
async function vpSourceEvents(ref) {
    const url = `${VP_API}/v1/sources/stream?${mediaQuery(ref)}`;
    const body = await readBody(await soraFetch(url, { method: 'GET', headers: apiHeaders("text/event-stream") }));
    const events = [];
    for (const line of String(body || "").split(/\r?\n/)) {
        if (line.indexOf('data:') !== 0) continue;
        try { events.push(JSON.parse(line.slice(5).trim())); } catch (e) { /* partial line */ }
    }
    return events;
}

async function vpSubtitles(ref) {
    const url = `${VP_API}/v1/subtitles?${mediaQuery(ref)}`;
    const body = await readBody(await soraFetch(url, { method: 'GET', headers: apiHeaders("application/json") }));
    try {
        const data = JSON.parse(body);
        return data && Array.isArray(data.subtitles) ? data.subtitles : [];
    } catch (e) { return []; }
}

function streamHeaders() {
    return { "Referer": `${VP_PLAYER}/`, "Origin": VP_PLAYER, "User-Agent": VP_UA };
}

// "1080P" -> 1080, "4K" -> 2160, anything else -> 0 (kept last).
function qualityRank(quality) {
    const q = String(quality || "");
    if (/4k|2160/i.test(q)) return 2160;
    const m = q.match(/(\d{3,4})/);
    return m ? parseInt(m[1], 10) : 0;
}

// A scraper can return a link whose upstream is already gone: ask for the
// playlist once and keep only the ones that answer with HLS (or a video).
async function linkIsAlive(url) {
    try {
        const headers = streamHeaders();
        headers["Range"] = "bytes=0-2047";
        const response = await soraFetch(url, { method: 'GET', headers: headers });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = await readBody(response);
        if (!body) return false;
        if (body.indexOf('#EXTM3U') !== -1) return true;
        // An mp4 / ts answer (binary) rather than a JSON or HTML error page.
        const head = body.slice(0, 64);
        return head.indexOf('ftyp') !== -1 || head.charCodeAt(0) === 0x47;
    } catch (e) { return false; }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 VidPlay — searching for "${keyword}"`);
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
                href: `vidplay://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("VidPlay", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("VidPlay", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('vidplay-play://', '').replace('vidplay://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 VidPlay — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("VidPlay", "DETAILS", { media_url: `${VP_PLAYER}/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("VidPlay", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 VidPlay — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `vidplay-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which the scrapers do not index.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `vidplay-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("VidPlay", "ERROR", { media_url: url, error_message: String(error) });
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
        ? `${VP_PLAYER}/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${VP_PLAYER}/movie/${ref.id}`;

    console.log(`[Player] 🎬 VidPlay — ${mediaUrl}`);

    const candidates = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const [events, subtitles] = await Promise.all([vpSourceEvents(ref), vpSubtitles(ref).catch(() => [])]);
        console.log(`[Player] 🧩 ${events.length} scraper answer(s)`);

        for (const event of events) {
            const sources = event && Array.isArray(event.sources) ? event.sources : [];
            const providerName = event && event.provider && event.provider.name ? String(event.provider.name).trim() : "";
            // Within one scraper, best quality first.
            const sorted = sources.slice().sort((a, b) => qualityRank(b && b.quality) - qualityRank(a && a.quality));
            for (const source of sorted) {
                const streamUrl = source && source.url ? String(source.url) : "";
                if (!/^https?:\/\//.test(streamUrl)) continue;
                if (candidates.some(s => s.streamUrl === streamUrl)) continue;
                const name = providerName || (source.provider && source.provider.name) || "Server";
                const quality = source.quality && !/unknown|auto/i.test(source.quality) ? ` ${source.quality}` : "";
                candidates.push({ title: `VidPlay ${name}${quality}`, streamUrl: streamUrl, headers: streamHeaders() });
            }

            const eventSubs = event && Array.isArray(event.subtitles) ? event.subtitles : [];
            for (const sub of eventSubs) subtitles.push(sub);
        }

        // Keep the links that answer (checked in parallel).
        const alive = await Promise.all(candidates.map(s => linkIsAlive(s.streamUrl)));
        const streams = candidates.filter((s, i) => {
            if (!alive[i]) failedLinks.push({ server_name: s.title, url: s.streamUrl, reason: "Link does not answer" });
            return alive[i];
        });
        streams.forEach(s => console.log(`   -> ${s.title}`));

        for (const caption of subtitles) {
            const subUrl = caption && (caption.url || caption.file) || "";
            if (!/^https?:\/\//.test(subUrl)) continue;
            if (allSubtitles.some(s => s.url === subUrl)) continue;
            const label = caption.label || caption.language || "Unknown";
            allSubtitles.push({ url: subUrl, label: label, kind: "captions", headers: { "Referer": `${VP_PLAYER}/` } });
            if (bestSubtitle === "" && /^english/i.test(String(label))) {
                bestSubtitle = subUrl;
                bestSubtitleHeaders = { "Referer": `${VP_PLAYER}/` };
            }
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("VidPlay", "PLAYER", {
            media_url: mediaUrl,
            season_number: String(ref.season || "1"),
            ep_number: String(ref.episode || "1"),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0 || streams.length === 0) {
            sendSupabaseLog("VidPlay", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl,
                season_number: String(ref.season || "1"),
                ep_number: String(ref.episode || "1"),
                failed_count: failedLinks.length,
                failed_links: failedLinks.length ? failedLinks : [{ server_name: "CinePro", url: `${VP_API}/v1/sources/stream?${mediaQuery(ref)}`, reason: "No source returned" }]
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
        sendSupabaseLog("VidPlay", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
