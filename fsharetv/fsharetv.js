// ==========================================
// ⚙️ SORA MODULE — FSHARETV
// ==========================================
// FshareTV (fsharetv.co) hosts its own movie files (movies only). Everything is
// first-party:
//   search : GET /api/movie/autocomplete-search?query=<q>
//            -> {data:{movies:[{title, year, imdb_id, poster, uri}]}}
//   page   : GET /movie/<slug>-episode-1-<imdb>  (synopsis, genre, and the
//            file id in Movie.setSource('<file id>', <quality>, "movie"))
//   files  : GET /api/file/<file id>/source
//            -> {data:{file:{sources:[{src:"/api/media/<hex>?hash=…", label,
//               storage}], alternatives:[[…]]}}}
// /api/media/<hex> answers 302 to the storage CDN (pwmail.cloud, v*cdn.sbs, …),
// which only serves the MP4 with the fsharetv.co Referer. The "__backup"
// storage currently answers 500 from its worker, so it is only offered when
// nothing else is.
// Note: the page passes ?trailer=<youtube id>&type=movie, which makes the API
// answer with the YouTube trailer only — the bare call returns the real files.

const FS_SITE = "https://fsharetv.co";
const FS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = FS_UA;
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

async function getJson(url, referer) {
    const headers = { "Accept": "application/json", "X-Requested-With": "XMLHttp" + "Request", "Referer": referer || `${FS_SITE}/` };
    const body = await readBody(await soraFetch(url, { method: 'GET', headers: headers }));
    try { return JSON.parse(body); } catch (e) { return null; }
}

function decodeEntities(s) {
    return String(s || "")
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&amp;/g, '&');
}

function stripTags(s) {
    return decodeEntities(String(s || "").replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function absolute(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return `${FS_SITE}${path.charAt(0) === '/' ? '' : '/'}${path}`;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 FshareTV — searching for "${keyword}"`);
    try {
        const data = await getJson(`${FS_SITE}/api/movie/autocomplete-search?query=${encodeURIComponent(keyword)}`);
        const movies = data && data.data && Array.isArray(data.data.movies) ? data.data.movies : [];

        const results = [];
        for (const movie of movies) {
            if (!movie || !movie.uri || !movie.title) continue;
            results.push({
                title: movie.year ? `${movie.title} (${movie.year})` : movie.title,
                image: movie.poster && movie.poster !== 'N/A' ? movie.poster : "",
                href: absolute(movie.uri)
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("FshareTV", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("FshareTV", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function cell(html, label) {
    const m = html.match(new RegExp(`<strong>${label}:?<\\/strong>\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
    return m ? stripTags(m[1]) : "";
}

async function extractDetails(url) {
    console.log(`[Details] 📖 FshareTV — ${url}`);
    sendSupabaseLog("FshareTV", "DETAILS", { media_url: url });

    try {
        const html = await readBody(await soraFetch(url, { method: 'GET', headers: { "Referer": `${FS_SITE}/` } }));
        let description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
        description = decodeEntities(description).replace(/^Watch [^|]*\|\s*/, '').trim();

        const aliasParts = [];
        const genre = cell(html, 'Genre');
        if (genre) aliasParts.push(genre);
        const country = cell(html, 'Country');
        if (country) aliasParts.push(country);
        const year = (html.match(/id="movie-title">[^<]*<\/span>\s*((?:19|20)\d{2})/) || [])[1] || "";

        return JSON.stringify([{
            description: description || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: year
        }]);
    } catch (error) {
        sendSupabaseLog("FshareTV", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    // Movies only: one entry, the movie page itself.
    return JSON.stringify([{ href: url, number: 1, season: 1, title: "Movie" }]);
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    console.log(`[Player] 🎬 FshareTV — ${url}`);

    const streams = [];
    const failedLinks = [];

    try {
        const html = await readBody(await soraFetch(url, { method: 'GET', headers: { "Referer": `${FS_SITE}/` } }));
        const fileIds = [];
        const re = /Movie\.setSource\(\s*'([^']+)'/g;
        let m;
        while ((m = re.exec(html)) !== null) if (fileIds.indexOf(m[1]) === -1) fileIds.push(m[1]);

        if (fileIds.length === 0) {
            failedLinks.push({ server_name: "FshareTV", url: url, reason: "No file id on the page" });
        }

        const headers = { "Referer": `${FS_SITE}/`, "User-Agent": FS_UA };
        const primary = [];
        const backups = [];

        for (const fileId of fileIds.slice(0, 2)) {
            const data = await getJson(`${FS_SITE}/api/file/${fileId}/source`, url);
            const file = data && data.data && data.data.file ? data.data.file : null;
            if (!file) {
                failedLinks.push({ server_name: "FshareTV", url: `${FS_SITE}/api/file/${fileId}/source`, reason: "Empty source list" });
                continue;
            }
            const all = [].concat(file.sources || [], ...((file.alternatives || []).filter(Array.isArray)));
            for (const source of all) {
                if (!source || !source.src || /youtube/i.test(source.type || '') || /youtube\.com/.test(source.src)) continue;
                const link = absolute(source.src);
                if (primary.some(s => s.streamUrl === link) || backups.some(s => s.streamUrl === link)) continue;
                const quality = source.label || (source.quality ? `${source.quality}p` : 'MP4');
                const entry = { title: `FshareTV ${quality} (${source.storage || 'storage'})`, streamUrl: link, headers: headers, q: parseInt(source.quality || quality, 10) || 0 };
                if (source.storage === '__backup') backups.push(entry); else primary.push(entry);
            }
        }

        const byQuality = (a, b) => b.q - a.q;
        primary.sort(byQuality);
        backups.sort(byQuality);
        for (const s of (primary.length ? primary : backups)) streams.push({ title: s.title, streamUrl: s.streamUrl, headers: s.headers });
        if (primary.length && backups.length) {
            failedLinks.push({ server_name: "FshareTV __backup", url: url, reason: `${backups.length} backup link(s) left out (storage worker answers 500)` });
        }

        console.log(`[Player] 📊 Summary: ${streams.length} link(s).`);

        sendSupabaseLog("FshareTV", "PLAYER", {
            media_url: url,
            season_number: "1",
            ep_number: "1",
            streams_found: streams.length,
            subtitles_found: false,
            allSubtitles_count: 0,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("FshareTV", "UNSUPPORTED_HOSTS", {
                media_url: url,
                season_number: "1",
                ep_number: "1",
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: "",
            subtitlesHeaders: {},
            allSubtitles: []
        });
    } catch (error) {
        sendSupabaseLog("FshareTV", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
