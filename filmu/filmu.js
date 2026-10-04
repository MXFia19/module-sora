// ==========================================
// ⚙️ SORA MODULE — FILMU
// ==========================================
// FilmU (embed.filmu.in, "Free Video Embed API") is an embed player keyed by
// TMDB id with its own scraping backend. Multi-server catalogues use it as a
// server: Meowly (its first server), Flyflix, Snowstream, ZFlix, Zerostream…
//
// The player is a thin client: every server is a JSON call to FilmU's own
// API, which scrapes server-side and hands back ready-made playlists.
//   GET /api/proxy?path=/scrape/<Provider>/<movie|tv>/<imdb|tmdbID>?tmdbId=
//       &title=&year=&season=&episode=
//       -> {name, sources:[{name, url, quality, type:"m3u8"|"subtitle",
//           headers}]}
//   GET /api/singularity-movie?id=<tmdb>  |  /api/singularity-tv?tmdb=&s=&e=
//       -> {sources:[{url, quality, type}], m3u8_path, _base}
// No token, no signature, no encryption on this path.
//
// Servers kept (the ones that answered in testing, FilmU-specific):
//   - Bastion: multi-language (English / Hindi / Tamil) HLS, needs the
//     api.hlowb.com Referer the API returns with each source;
//   - Singularity: FilmU's "VIP" server (Movy-backed CDN), 1080p.
// Left out: Allmovieland ("Pulsar"), whose links are bound to FilmU's server
// address and only play through FilmU's segment relay (wormhole.filmu.in),
// which timed out (522 after 20 s) in testing; and the servers that merely
// re-wrap VidRock, Videasy, RiveStream or VaPlayer, left to the modules
// covering those players.

const FILMU_SITE = "https://embed.filmu.in";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const FILMU_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = FILMU_UA;
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

async function filmuJson(path, embedUrl) {
    const headers = {
        "User-Agent": FILMU_UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": embedUrl || `${FILMU_SITE}/`
    };
    const body = await readBody(await soraFetch(`${FILMU_SITE}${path}`, { method: 'GET', headers: headers }));
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// URLSearchParams-style encoding (spaces as "+"), as the player builds it.
function formEncode(params) {
    const parts = [];
    for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === undefined || value === null || value === "") continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value)).replace(/%20/g, "+")}`);
    }
    return parts.join("&");
}

// /scrape/<Provider>/<movie|tv>/<id>?… wrapped in the site's /api/proxy.
async function filmuScrape(provider, media, embedUrl) {
    const id = media.imdbId || `tmdb${media.tmdbId}`;
    const query = formEncode({
        tmdbId: media.tmdbId,
        title: media.title,
        year: media.year,
        season: media.kind === 'tv' ? media.season : undefined,
        episode: media.kind === 'tv' ? media.episode : undefined
    });
    const path = `/scrape/${provider}/${media.kind === 'tv' ? 'tv' : 'movie'}/${id}?${query}`;
    return await filmuJson(`/api/proxy?path=${encodeURIComponent(path)}`, embedUrl);
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 FilmU — searching for "${keyword}"`);
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
                href: `filmu://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("FilmU", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("FilmU", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('filmu-play://', '').replace('filmu://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 FilmU — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("FilmU", "DETAILS", { media_url: `${FILMU_SITE}/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("FilmU", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 FilmU — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `filmu-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which FilmU does not index.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `filmu-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("FilmU", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// What the player sends: the TMDB title, the release year and the IMDb id
// (which also names the scrape path; "tmdb<id>" when there is none).
async function loadMedia(ref) {
    const data = await tmdbGet(`/${ref.kind}/${ref.id}?language=en-US&append_to_response=external_ids`);
    if (!data || !data.id) return null;
    const date = ref.kind === 'tv' ? data.first_air_date : data.release_date;
    const year = date ? Number(String(date).slice(0, 4)) : undefined;
    return {
        kind: ref.kind,
        tmdbId: Number(ref.id),
        title: data.title || data.name || data.original_title || data.original_name || "",
        year: year && !isNaN(year) ? year : undefined,
        imdbId: (ref.kind === 'tv' ? null : data.imdb_id) || (data.external_ids && data.external_ids.imdb_id) || "",
        season: Number(ref.season || 1) || 1,
        episode: Number(ref.episode || 1) || 1
    };
}

function cleanLabel(name, fallback) {
    const text = String(name || "").replace(/\s+/g, " ").trim();
    return text || fallback;
}

async function serverBastion(media, embedUrl) {
    const data = await filmuScrape("Bastion", media, embedUrl);
    const sources = data && Array.isArray(data.sources) ? data.sources : [];
    const streams = [], subtitles = [];
    for (const source of sources) {
        if (!source || !source.url) continue;
        if (source.type === "subtitle" || /\.(vtt|srt)(\?|$)/i.test(source.url)) {
            const lang = (String(source.name || "").match(/\[([^\]]+)]/) || [])[1] || source.lang || "en";
            subtitles.push({ url: source.url, label: /^en/i.test(lang) ? "English" : lang, lang: lang, headers: source.headers || {} });
            continue;
        }
        if (source.type !== "m3u8" && source.url.indexOf(".m3u8") === -1) continue;
        streams.push({
            title: `FilmU ${cleanLabel(source.name, "Bastion")}`,
            streamUrl: source.url,
            headers: { ...(source.headers || {}), "User-Agent": FILMU_UA }
        });
    }
    return { streams: streams, subtitles: subtitles, error: streams.length ? null : "no Bastion source" };
}

async function serverSingularity(media, embedUrl) {
    const path = media.kind === 'tv'
        ? `/api/singularity-tv?tmdb=${media.tmdbId}&s=${media.season}&e=${media.episode}`
        : `/api/singularity-movie?id=${media.tmdbId}`;
    const data = await filmuJson(path, embedUrl);
    if (!data) return { streams: [], subtitles: [], error: "no answer" };

    const base = String(data.i || data._base || "").replace(/\/$/, "");
    const files = [];
    if (data.url) files.push({ url: data.multilingual && data.multilingual_url ? data.multilingual_url : data.url, quality: data.quality || "1080p" });
    for (const source of (Array.isArray(data.sources) ? data.sources : [])) if (source && source.url) files.push(source);
    if (!files.length && data.m3u8_path && base) files.push({ url: `${base}/${String(data.m3u8_path).replace("downloads/", "")}`, quality: "1080p" });

    const streams = [];
    files.forEach((file, i) => {
        let link = String(file.url);
        if (!/^https?:/.test(link) && base) link = `${base}/${link.replace(/^\//, "").replace("downloads/", "")}`;
        if (!/^https?:/.test(link) || streams.some(s => s.streamUrl === link)) return;
        streams.push({
            title: `FilmU Singularity ${file.quality || "1080p"}${files.length > 1 ? ` #${i + 1}` : ""}`,
            streamUrl: link,
            headers: { "User-Agent": FILMU_UA, "Referer": `${FILMU_SITE}/` }
        });
    });

    const subtitles = [];
    for (const sub of (Array.isArray(data.subtitles) ? data.subtitles : [])) {
        if (sub && sub.url) subtitles.push({ url: sub.url, label: sub.label || sub.lang || "Unknown", lang: sub.lang || "", headers: {} });
    }
    return { streams: streams, subtitles: subtitles, error: streams.length ? null : "no Singularity source" };
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const embedUrl = ref.kind === 'tv'
        ? `${FILMU_SITE}/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${FILMU_SITE}/movie/${ref.id}`;

    console.log(`[Player] 🎬 FilmU — ${embedUrl}`);

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

        const servers = [
            { name: "Bastion", run: serverBastion },
            { name: "Singularity", run: serverSingularity }
        ];
        const results = await Promise.all(servers.map(async server => {
            try { return { server: server, result: await server.run(media, embedUrl) }; }
            catch (e) { return { server: server, result: { streams: [], subtitles: [], error: String(e) } }; }
        }));

        for (const entry of results) {
            const result = entry.result || {};
            const found = Array.isArray(result.streams) ? result.streams : [];
            if (!found.length) {
                failedLinks.push({ server_name: entry.server.name, url: embedUrl, reason: result.error || "No source" });
                console.log(`   -> ${entry.server.name}: ${result.error || "no source"}`);
            } else {
                for (const stream of found) if (!streams.some(s => s.streamUrl === stream.streamUrl)) streams.push(stream);
                console.log(`   -> ${entry.server.name}: ${found.length} stream(s)`);
            }
            for (const sub of (Array.isArray(result.subtitles) ? result.subtitles : [])) {
                if (allSubtitles.some(s => s.url === sub.url)) continue;
                allSubtitles.push({ url: sub.url, label: sub.label, kind: "captions", headers: sub.headers || {} });
                if (!bestSubtitle && /^en/i.test(String(sub.lang || sub.label))) {
                    bestSubtitle = sub.url;
                    bestSubtitleHeaders = sub.headers || {};
                }
            }
        }
        if (!bestSubtitle && allSubtitles.length) {
            bestSubtitle = allSubtitles[0].url;
            bestSubtitleHeaders = allSubtitles[0].headers;
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("FilmU", "PLAYER", {
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
            sendSupabaseLog("FilmU", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("FilmU", "ERROR", { media_url: embedUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
