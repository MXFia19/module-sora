// ==========================================
// ⚙️ SORA MODULE — ANIMEPARADISE
// ==========================================
// animeparadise.moe is a Next.js site backed by an open JSON API and by its
// own HLS relay. Its catalogue has its own ids ("ASa7g4dGZREXdtzA") and slugs
// ("one-piece"), unrelated to AniList's.
//
//   1. Search    GET https://api.animeparadise.moe/search?q=<text>
//                -> {data:[{_id, title, link, posterImage, animeSeason}]}
//   2. Entry     GET https://api.animeparadise.moe/anime/<link>
//                -> {data:{_id, synopsys, genres, status, …}}
//   3. Episodes  GET https://api.animeparadise.moe/anime/<_id>/episode
//                -> {data:[{uid, number, title, origin}]}
//   4. Stream    The watch page reads the episode through a Next.js server
//                action, "getEpisode(uid, origin)":
//                  POST / with headers Next-Action: <action id>,
//                                      Accept: text/x-component
//                  body ["<uid>","<origin>"]
//                -> RSC text whose line "1:" is {episode:{streamLink,
//                   subData:[{src,label}]}, episodeList:[…]}
//                The player then opens
//                  https://stream.animeparadise.moe/m3u8?url=<streamLink>
//                an opaque, already-signed relay link (the variants and
//                segments it lists go through the same relay).
//
// The action id is a build hash: it is kept as a constant and, when the server
// answers "Server action not found", rediscovered from the watch page's own
// chunks (createServerReference("<id>", …, "getEpisode")).

const AP_SITE = "https://www.animeparadise.moe";
const AP_API = "https://api.animeparadise.moe";
const AP_STREAM = "https://stream.animeparadise.moe";

// Last known id of the "getEpisode" server action.
const AP_ACTION_ID = "604982bef023a1ddf0c1c8fc7cdcf473df59ddeb64";

const AP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    // the caller did not set one.
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = AP_UA;
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

async function apApi(path) {
    const headers = {
        "User-Agent": AP_UA,
        "Accept": "application/json",
        "Origin": AP_SITE,
        "Referer": `${AP_SITE}/`
    };
    const text = await readBody(await soraFetch(`${AP_API}${path}`, { method: 'GET', headers: headers }));
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
}

function cleanText(html) {
    if (!html) return "";
    return String(html)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 AnimeParadise — searching for "${keyword}"`);
    try {
        const data = await apApi(`/search?q=${encodeURIComponent(keyword)}`);
        const items = data && Array.isArray(data.data) ? data.data : [];

        const results = [];
        for (const item of items) {
            if (!item || !item.link) continue;
            const poster = item.posterImage || {};
            const year = item.animeSeason && item.animeSeason.year ? item.animeSeason.year : "";
            results.push({
                title: year ? `${item.title} (${year})` : item.title,
                image: poster.large || poster.medium || poster.original || "",
                href: `animeparadise://${item.link}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("AnimeParadise", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("AnimeParadise", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function linkFrom(url) {
    return String(url).replace('animeparadise://', '').split('/')[0];
}

async function extractDetails(url) {
    const link = linkFrom(url);
    console.log(`[Details] 📖 AnimeParadise — ${link}`);
    sendSupabaseLog("AnimeParadise", "DETAILS", { media_url: `${AP_SITE}/anime/${link}` });

    try {
        const data = await apApi(`/anime/${encodeURIComponent(link)}`);
        const anime = data && data.data ? data.data : null;
        if (!anime) {
            return JSON.stringify([{ description: 'Entry not found on AnimeParadise.', aliases: '', airdate: '' }]);
        }

        const aliasParts = [];
        const alt = anime.alternativeTitle || {};
        const altNames = [alt.english, alt.romaji].filter(n => n && n !== anime.title);
        if (altNames.length) aliasParts.push(altNames.join(' · '));
        if (anime.rate) aliasParts.push(`Score: ${anime.rate}`);
        if (Array.isArray(anime.genres) && anime.genres.length) aliasParts.push(anime.genres.join(', '));
        if (anime.type) aliasParts.push(anime.type);

        const season = anime.animeSeason ? [anime.animeSeason.season, anime.animeSeason.year].filter(Boolean).join(' ') : "";
        const airdate = [anime.startDate || season, anime.status].filter(Boolean).join(' · ');

        return JSON.stringify([{
            description: cleanText(anime.synopsys || anime.synopsis) || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("AnimeParadise", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const link = linkFrom(url);
    console.log(`[Episodes] 📂 AnimeParadise — ${link}`);

    try {
        const info = await apApi(`/anime/${encodeURIComponent(link)}`);
        const animeId = info && info.data && info.data._id ? info.data._id : null;
        if (!animeId) return JSON.stringify([]);

        const data = await apApi(`/anime/${encodeURIComponent(animeId)}/episode`);
        const list = data && Array.isArray(data.data) ? data.data : [];

        const episodes = [];
        for (const row of list) {
            if (!row || !row.uid) continue;
            const number = parseFloat(row.number);
            if (!isFinite(number)) continue;
            episodes.push({
                href: `animeparadise-play://${row.uid}/${row.origin || animeId}/${row.number}`,
                number: number,
                season: 1,
                title: row.title || `Episode ${row.number}`
            });
        }
        episodes.sort((a, b) => a.number - b.number);

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("AnimeParadise", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function callGetEpisode(actionId, uid, origin) {
    const headers = {
        "User-Agent": AP_UA,
        "Accept": "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": actionId,
        "Origin": AP_SITE,
        "Referer": `${AP_SITE}/watch/${uid}?origin=${origin}`
    };
    const body = JSON.stringify([uid, origin]);
    return await readBody(await soraFetch(`${AP_SITE}/`, { method: 'POST', headers: headers, body: body }));
}

// The action's value is the RSC row "1:{…}". Rows are newline separated; the
// value itself is a single line of JSON.
function parseActionResult(text) {
    if (!text) return null;
    const lines = String(text).split('\n');
    for (const line of lines) {
        const match = line.match(/^([0-9a-f]+):(\{[\s\S]*\})\s*$/);
        if (!match) continue;
        if (line.indexOf('"episode"') === -1 && line.indexOf('"streamLink"') === -1) continue;
        try {
            const value = JSON.parse(match[2]);
            if (value && (value.episode || value.episodeList)) return value;
        } catch (e) { /* try the next row */ }
    }
    return null;
}

// Rediscover the action id from the watch page: the RSC payload names the
// chunks of the "WatchProvider" component, and one of them declares
// createServerReference("<id>", …, "getEpisode").
async function discoverActionId(uid, origin) {
    try {
        const pageUrl = `${AP_SITE}/watch/${uid}?origin=${origin}`;
        const html = await readBody(await soraFetch(pageUrl, { method: 'GET', headers: { "User-Agent": AP_UA, "Accept": "text/html" } }));
        if (!html) return null;
        const chunks = [];
        const re = /\/_next\/static\/chunks\/[A-Za-z0-9_~.\-]+\.js/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            if (chunks.indexOf(m[0]) === -1) chunks.push(m[0]);
        }
        // Page-specific chunks come last; read them first.
        chunks.reverse();
        for (const chunk of chunks.slice(0, 25)) {
            const js = await readBody(await soraFetch(`${AP_SITE}${chunk}`, { method: 'GET', headers: { "User-Agent": AP_UA, "Referer": pageUrl } }));
            if (!js || js.indexOf('getEpisode') === -1) continue;
            const found = js.match(/createServerReference\)\("([0-9a-f]{32,64})"[^)]*?"getEpisode"\)/);
            if (found) return found[1];
        }
    } catch (e) {
        console.log(`[Player] ⚠️ Action id discovery failed: ${e.message}`);
    }
    return null;
}

function parseSubData(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw) return [];
    try { return JSON.parse(raw); } catch (e) { /* python-style repr */ }
    try { return JSON.parse(raw.replace(/'/g, '"')); } catch (e2) { return []; }
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const parts = String(url).replace('animeparadise-play://', '').split('/');
    const uid = parts[0];
    const origin = parts[1] || "";
    const epNumber = parts[2] || "1";
    const mediaUrl = `${AP_SITE}/watch/${uid}?origin=${origin}`;

    console.log(`[Player] 🎬 AnimeParadise — episode ${epNumber} (${uid})`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        let text = await callGetEpisode(AP_ACTION_ID, uid, origin);
        let result = parseActionResult(text);

        if (!result) {
            console.log(`[Player] 🔁 Stored action id rejected (${String(text).slice(0, 40)}), rediscovering…`);
            const freshId = await discoverActionId(uid, origin);
            if (freshId && freshId !== AP_ACTION_ID) {
                text = await callGetEpisode(freshId, uid, origin);
                result = parseActionResult(text);
            }
        }

        let episode = result && result.episode ? result.episode : null;
        // Fall back on the copy of the episode inside episodeList.
        if ((!episode || !episode.streamLink) && result && Array.isArray(result.episodeList)) {
            episode = result.episodeList.find(e => e && e.uid === uid) || episode;
        }

        if (!episode || !episode.streamLink) {
            failedLinks.push({ server_name: "AnimeParadise", url: mediaUrl, reason: "getEpisode returned no streamLink" });
            sendSupabaseLog("AnimeParadise", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: "1", ep_number: String(epNumber),
                failed_count: failedLinks.length, failed_links: failedLinks
            });
            return JSON.stringify({ type: "none" });
        }

        const headers = { "Referer": `${AP_SITE}/`, "Origin": AP_SITE, "User-Agent": AP_UA };
        streams.push({
            title: "AnimeParadise · Sub",
            streamUrl: `${AP_STREAM}/m3u8?url=${episode.streamLink}`,
            headers: headers
        });

        for (const caption of parseSubData(episode.subData)) {
            const subUrl = caption && (caption.src || caption.url);
            if (!subUrl || allSubtitles.some(s => s.url === subUrl)) continue;
            const label = caption.label || caption.lang || "English";
            allSubtitles.push({ url: subUrl, label: label, kind: "captions", headers: headers });
        }
        // English by default, else the first track.
        const preferred = allSubtitles.find(s => /english/i.test(s.label)) || allSubtitles[0];
        if (preferred) {
            bestSubtitle = preferred.url;
            bestSubtitleHeaders = preferred.headers;
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("AnimeParadise", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: String(epNumber),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: bestSubtitle,
            subtitlesHeaders: bestSubtitleHeaders,
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("AnimeParadise", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
