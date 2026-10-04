// ==========================================
// ⚙️ SORA MODULE — SUBSL
// ==========================================
// subSL (subsl.top) is a Sri Lankan catalogue of movies and series with
// Sinhala subtitles. It re-hosts the videos on Facebook's CDN (fbcdn.net MP4
// links, refreshed by the site — see video_link_updated_at) and keeps the .srt
// files on files.subsl.top.
//
// The site is a Next.js app:
//   - movie / series pages (/movie/<id>, /tvshow/<id>) are server-rendered and
//     carry the whole record in the React Server Components payload
//     (self.__next_f.push(...)): {"movie":{title, movie_links:[{quality,url}],
//     subtitles, …}} or {"show":{…, seasons:[{season_number, episodes:[{
//     episode_number, title, video_link, subtitles}]}]}};
//   - search is client-side and calls the site's backend directly:
//       GET <api>/movies/search/?title=<q>   GET <api>/tvshows/search/?title=<q>
//     <api> is a Cloudflare quick-tunnel URL baked into the search page bundle
//     (it changes when they restart it), so it is read from the current bundle
//     at runtime instead of being hard-coded.

const SL_SITE = "https://subsl.top";
const SL_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Last API base seen in the bundle (refreshed whenever it stops answering).
let SL_API = "https://arrangement-devel-holiday-significant.trycloudflare.com";

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
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = SL_UA;
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

async function getText(url, accept) {
    const headers = { "Accept": accept || "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": `${SL_SITE}/` };
    return await readBody(await soraFetch(url, { method: 'GET', headers: headers }));
}

function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
}

// ==========================================
// 🧩 NEXT.JS PAYLOAD
// ==========================================

// Concatenates the RSC chunks of a server-rendered page into one string.
function rscPayload(html) {
    let out = "";
    const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        try { out += JSON.parse(`"${m[1]}"`); } catch (e) { }
    }
    return out;
}

// Returns the JSON object that follows `"key":` in the payload.
function objectAfter(text, key) {
    const start = text.indexOf(`"${key}":{`);
    if (start === -1) return null;
    let i = text.indexOf('{', start);
    const begin = i;
    let depth = 0, inString = false, escaped = false;
    for (; i < text.length; i++) {
        const c = text.charAt(i);
        if (inString) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') inString = true;
        else if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return parseJson(text.slice(begin, i + 1));
        }
    }
    return null;
}

function parseHref(url) {
    const m = String(url).match(/\/(movie|tvshow)\/([a-f0-9]+)/i);
    const hash = String(url).split('#')[1] || "";
    const s = (hash.match(/s=(\d+)/) || [])[1];
    const e = (hash.match(/e=(\d+)/) || [])[1];
    return { kind: m ? m[1].toLowerCase() : 'movie', id: m ? m[2] : "", season: s ? parseInt(s, 10) : null, episode: e ? parseInt(e, 10) : null };
}

async function loadRecord(ref) {
    const html = await getText(`${SL_SITE}/${ref.kind}/${ref.id}`);
    return objectAfter(rscPayload(html), ref.kind === 'tvshow' ? 'show' : 'movie');
}

// ==========================================
// 🔍 SEARCH
// ==========================================

// Reads the backend URL from the search page bundle.
async function discoverApi() {
    try {
        const page = await getText(`${SL_SITE}/search`);
        const chunk = (page.match(/\/_next\/static\/chunks\/app\/search\/page-[^"']+\.js/) || [])[0];
        if (!chunk) return null;
        const js = await getText(`${SL_SITE}${chunk}`, "*/*");
        const tunnel = js.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (tunnel) return tunnel[0];
        // Any other absolute base used in front of "/movies/search".
        const base = js.match(/"(https:\/\/[^"]+)"[^;]{0,200}\/movies\/search/);
        return base ? base[1] : null;
    } catch (e) { return null; }
}

async function apiSearch(base, keyword) {
    const q = encodeURIComponent(keyword);
    const [movies, shows] = await Promise.all([
        getText(`${base}/movies/search/?title=${q}`, "application/json").then(parseJson).catch(() => null),
        getText(`${base}/tvshows/search/?title=${q}`, "application/json").then(parseJson).catch(() => null)
    ]);
    if (!movies && !shows) return null;
    return { movies: (movies && movies.movies) || [], shows: (shows && shows.tv_shows) || [] };
}

async function searchResults(keyword) {
    console.log(`[Search] 🔍 subSL — searching for "${keyword}"`);
    try {
        let found = await apiSearch(SL_API, keyword);
        if (!found) {
            const fresh = await discoverApi();
            if (fresh && fresh !== SL_API) {
                SL_API = fresh;
                found = await apiSearch(SL_API, keyword);
            }
        }

        const results = [];
        for (const show of (found ? found.shows : [])) {
            if (!show || !show.id) continue;
            results.push({ title: `${show.title}${show.year ? ` (${show.year})` : ''} · TV`, image: show.image_link || "", href: `${SL_SITE}/tvshow/${show.id}` });
        }
        for (const movie of (found ? found.movies : [])) {
            if (!movie || !movie.id) continue;
            results.push({ title: `${movie.title}${movie.year ? ` (${movie.year})` : ''} · Movie`, image: movie.image_link || "", href: `${SL_SITE}/movie/${movie.id}` });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("subSL", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("subSL", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 subSL — ${ref.kind} ${ref.id}`);
    sendSupabaseLog("subSL", "DETAILS", { media_url: `${SL_SITE}/${ref.kind}/${ref.id}` });

    try {
        const record = await loadRecord(ref);
        if (!record) return JSON.stringify([{ description: 'Entry not found.', aliases: '', airdate: '' }]);

        const aliases = [];
        if (record.rating) aliases.push(`Rating: ${Number(record.rating).toFixed(1)}/10`);
        if (Array.isArray(record.genre) && record.genre.length) aliases.push(record.genre.join(', '));
        if (record.total_seasons) aliases.push(`${record.total_seasons} season(s)`);
        aliases.push("Sinhala subtitles");

        return JSON.stringify([{
            description: (record.description || "").trim() || "No synopsis available.",
            aliases: aliases.join(' | '),
            airdate: record.year ? String(record.year) : ""
        }]);
    } catch (error) {
        sendSupabaseLog("subSL", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 subSL — ${ref.kind} ${ref.id}`);
    try {
        const base = `${SL_SITE}/${ref.kind}/${ref.id}`;
        if (ref.kind !== 'tvshow') return JSON.stringify([{ href: base, number: 1, season: 1, title: "Movie" }]);

        const record = await loadRecord(ref);
        const episodes = [];
        for (const season of ((record && record.seasons) || [])) {
            const s = parseInt(season.season_number, 10);
            if (!s || s < 1) continue;
            for (const ep of (season.episodes || [])) {
                const n = parseInt(ep.episode_number, 10);
                if (!n || !ep.video_link) continue;
                episodes.push({ href: `${base}#s=${s}&e=${n}`, number: n, season: s, title: ep.title || `Episode ${n}` });
            }
        }
        episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("subSL", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function subtitleEntry(link) {
    if (!link || typeof link !== 'string' || link === 'None' || !/^https?:/.test(link)) return null;
    return { url: link, label: "Sinhala", kind: "captions", headers: { "Referer": `${SL_SITE}/` } };
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = `${SL_SITE}/${ref.kind}/${ref.id}`;
    console.log(`[Player] 🎬 subSL — ${url}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    const headers = { "User-Agent": SL_UA };

    try {
        const record = await loadRecord(ref);
        if (!record) {
            failedLinks.push({ server_name: "subSL", url: mediaUrl, reason: "Record not found in the page" });
        } else if (ref.kind === 'tvshow') {
            const season = (record.seasons || []).find(s => parseInt(s.season_number, 10) === ref.season);
            const ep = season ? (season.episodes || []).find(e => parseInt(e.episode_number, 10) === ref.episode) : null;
            if (ep && ep.video_link) {
                streams.push({ title: `subSL S${ref.season}E${ref.episode} (Facebook CDN)`, streamUrl: ep.video_link, headers: headers });
                const sub = subtitleEntry(ep.subtitles) || subtitleEntry(season.subtitles);
                if (sub) allSubtitles.push(sub);
            } else {
                failedLinks.push({ server_name: "subSL", url: url, reason: "Episode has no video link" });
            }
        } else {
            for (const link of (record.movie_links || [])) {
                if (!link || !link.url || streams.some(s => s.streamUrl === link.url)) continue;
                streams.push({ title: `subSL ${link.quality || 'MP4'} (Facebook CDN)`, streamUrl: link.url, headers: headers });
            }
            const sub = subtitleEntry(record.subtitles);
            if (sub) allSubtitles.push(sub);
        }

        const bestSubtitle = allSubtitles[0] ? allSubtitles[0].url : "";

        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("subSL", "PLAYER", {
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
            sendSupabaseLog("subSL", "UNSUPPORTED_HOSTS", {
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
            subtitlesHeaders: bestSubtitle ? allSubtitles[0].headers : {},
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("subSL", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
