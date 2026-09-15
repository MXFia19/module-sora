// ==========================================
// ⚙️ SORA MODULE — VIDHAWK
// ==========================================
// VidHawk (vidhawk.buzz) indexes its anime by AniList id. The catalogue
// therefore comes straight from AniList's public API, and playback from
// VidHawk's own internal chain:
//   1. /api/stream/race?...   -> {winner, ticket, servers:[{id,label,ticket}]}
//   2. /api/play?t=<ticket>   -> audio tracks (sub/dub/jpn/hin), captions, intro/outro
// No signed token, no encryption: the tickets are opaque but are simply
// relayed as they come.

const VH_BASE = "https://vidhawk.buzz";
const ANILIST_API = "https://graphql.anilist.co";

// Servers the site's player advertises. "race" queries them all at once;
// "resolve" is the per-server fallback.
const VH_SERVERS = ["flow", "zuri"];

// Display order for the audio tracks.
const VH_AUDIO_ORDER = ["sub", "dub", "jpn", "hin"];

const VH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
        } else {
            return await fetch(url, options);
        }
    } catch (e) {
        try { return await fetch(url, options); } catch (error) { return null; }
    }
}

async function readBody(response) {
    if (!response) return "";
    if (typeof response.text === 'function') return await response.text();
    if (typeof response.data === 'string') return response.data;
    return "";
}

async function vhGetJson(path, referer) {
    const headers = {
        "User-Agent": VH_UA,
        "Accept": "application/json",
        "Referer": referer || `${VH_BASE}/`
    };
    const response = await soraFetch(`${VH_BASE}${path}`, { method: 'GET', headers: headers });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

async function anilistQuery(query, variables) {
    const headers = { "Content-Type": "application/json", "Accept": "application/json" };
    const body = JSON.stringify({ query: query, variables: variables });
    const response = await soraFetch(ANILIST_API, { method: 'POST', headers: headers, body: body });
    const text = await readBody(response);
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && parsed.data ? parsed.data : null;
    } catch (e) { return null; }
}

function cleanText(html) {
    if (!html) return "";
    return String(html)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ==========================================
// 🔍 SEARCH
// ==========================================

const SEARCH_QUERY = `query ($q: String) {
  Page(page: 1, perPage: 30) {
    media(search: $q, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
      id
      title { romaji english native }
      coverImage { large medium }
      format
      seasonYear
    }
  }
}`;

async function searchResults(keyword) {
    console.log(`[Search] 🔍 VidHawk — searching for "${keyword}"`);
    try {
        const data = await anilistQuery(SEARCH_QUERY, { q: keyword });
        const media = data && data.Page && Array.isArray(data.Page.media) ? data.Page.media : [];

        const results = [];
        for (const item of media) {
            if (!item || !item.id) continue;
            const title = (item.title && (item.title.english || item.title.romaji || item.title.native)) || `AniList ${item.id}`;
            const image = (item.coverImage && (item.coverImage.large || item.coverImage.medium)) || "";
            results.push({
                title: item.seasonYear ? `${title} (${item.seasonYear})` : title,
                image: image,
                href: `vidhawk://${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("VidHawk", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("VidHawk", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

const DETAILS_QUERY = `query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    description
    episodes
    status
    seasonYear
    averageScore
    genres
    synonyms
    startDate { year month day }
    nextAiringEpisode { episode }
  }
}`;

async function extractDetails(url) {
    const anilistId = url.replace('vidhawk://', '');
    console.log(`[Details] 📖 VidHawk — AniList entry ${anilistId}`);
    sendSupabaseLog("VidHawk", "DETAILS", { media_url: `${VH_BASE}/embed/ani/${anilistId}/1/sub` });

    try {
        const data = await anilistQuery(DETAILS_QUERY, { id: parseInt(anilistId, 10) });
        const media = data && data.Media ? data.Media : null;
        if (!media) {
            return JSON.stringify([{ description: 'Entry not found on AniList.', aliases: '', airdate: '' }]);
        }

        const description = cleanText(media.description) || "No synopsis available.";

        const aliasParts = [];
        if (media.averageScore) aliasParts.push(`Score: ${media.averageScore}/100`);
        if (Array.isArray(media.genres) && media.genres.length) aliasParts.push(media.genres.join(', '));
        if (Array.isArray(media.synonyms) && media.synonyms.length) aliasParts.push(media.synonyms.slice(0, 3).join(' · '));

        let airdate = media.seasonYear ? `Year: ${media.seasonYear}` : "";
        const start = media.startDate;
        if (start && start.year && start.month && start.day) {
            const mm = String(start.month).padStart(2, '0');
            const dd = String(start.day).padStart(2, '0');
            airdate = `${start.year}-${mm}-${dd}`;
        }
        if (media.status) airdate = airdate ? `${airdate} · ${media.status}` : media.status;

        return JSON.stringify([{
            description: description,
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("VidHawk", "ERROR", { media_url: `vidhawk://${anilistId}`, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const anilistId = url.replace('vidhawk://', '');
    console.log(`[Episodes] 📂 VidHawk — episodes of ${anilistId}`);

    try {
        const data = await anilistQuery(DETAILS_QUERY, { id: parseInt(anilistId, 10) });
        const media = data && data.Media ? data.Media : null;
        if (!media) return JSON.stringify([]);

        // An ongoing series does not advertise its episode count; fall back to
        // the next scheduled episode, minus one.
        let total = 0;
        if (typeof media.episodes === 'number' && media.episodes > 0) {
            total = media.episodes;
        } else if (media.nextAiringEpisode && media.nextAiringEpisode.episode > 1) {
            total = media.nextAiringEpisode.episode - 1;
        }
        if (total <= 0) total = 1;

        const episodes = [];
        for (let n = 1; n <= total; n++) {
            episodes.push({
                href: `vidhawk-play://${anilistId}/${n}`,
                number: n,
                season: 1,
                title: `Episode ${n}`
            });
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("VidHawk", "ERROR", { media_url: `vidhawk://${anilistId}`, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// Without "stream=1", /api/stream/race answers in one block in ~1 s:
//   {winner, ticket, servers:[{id,label,ticket,ok,ms}], anilistId, malId, episode}
// With "stream=1" it holds the connection open and drips NDJSON
// ({"type":"row","row":{…}}) — unusable from Sora, which waits for the end of
// the body. So we query the block variant, while still tolerating NDJSON in
// case the server reverts to it.
function parseRaceRows(body) {
    const rows = [];
    if (!body) return rows;

    // Block variant: a single JSON object with a "servers" array.
    try {
        const whole = JSON.parse(body);
        if (whole && Array.isArray(whole.servers)) {
            for (const server of whole.servers) {
                if (server && server.ticket) rows.push(server);
            }
            if (rows.length === 0 && whole.ticket) {
                rows.push({ id: whole.winner || 'flow', label: whole.winner || 'VidHawk', ticket: whole.ticket, ok: true });
            }
            return rows;
        }
    } catch (e) { /* not a single object: try NDJSON */ }

    for (const line of String(body).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) !== '{') continue;
        let event;
        try { event = JSON.parse(trimmed); } catch (e2) { continue; }
        if (event && event.type === 'row' && event.row && event.row.ticket) {
            rows.push(event.row);
        }
    }
    return rows;
}

async function raceTickets(anilistId, epNumber, referer) {
    const query = `episode=${encodeURIComponent(epNumber)}&audio=sub&server=flow&anilistId=${encodeURIComponent(anilistId)}`;
    const headers = { "User-Agent": VH_UA, "Accept": "application/json", "Referer": referer };
    const response = await soraFetch(`${VH_BASE}/api/stream/race?${query}`, { method: 'GET', headers: headers });
    const body = await readBody(response);

    const rows = parseRaceRows(body);

    // 403 + {"blocked":true} = the parent host is not allowed to embed VidHawk.
    if (rows.length === 0 && body && body.indexOf('"blocked"') !== -1) {
        console.log(`[Player] 🚫 VidHawk refuses to be embedded from this host.`);
    }
    return rows;
}

async function resolveTicket(anilistId, epNumber, server, referer) {
    const query = `episode=${encodeURIComponent(epNumber)}&server=${encodeURIComponent(server)}&audio=sub&fast=1&anilistId=${encodeURIComponent(anilistId)}`;
    const data = await vhGetJson(`/api/stream/resolve?${query}`, referer);
    if (!data || !data.ticket) return null;
    return { id: data.server || server, label: data.serverLabel || server, ticket: data.ticket, ok: true };
}

async function playTicket(ticket, referer) {
    return await vhGetJson(`/api/play?t=${encodeURIComponent(ticket)}`, referer);
}

function audioRank(id) {
    const index = VH_AUDIO_ORDER.indexOf(String(id || '').toLowerCase());
    return index === -1 ? VH_AUDIO_ORDER.length : index;
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const parts = url.replace('vidhawk-play://', '').split('/');
    const anilistId = parts[0];
    const epNumber = parts.length > 1 ? parts[1] : '1';
    const referer = `${VH_BASE}/embed/ani/${anilistId}/${epNumber}/sub`;

    console.log(`[Player] 🎬 VidHawk — AniList ${anilistId}, episode ${epNumber}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const rows = await raceTickets(anilistId, epNumber, referer);
        console.log(`[Player] 🏁 race: ${rows.length} server(s)`);

        // Per-server fallback if the race came back empty.
        if (rows.length === 0) {
            for (const server of VH_SERVERS) {
                const row = await resolveTicket(anilistId, epNumber, server, referer);
                if (row) rows.push(row);
                else failedLinks.push({ server_name: server, url: `${VH_BASE}/api/stream/resolve`, reason: "No ticket returned" });
            }
            console.log(`[Player] 🔁 resolve: ${rows.length} server(s)`);
        }

        const seenTickets = new Set();
        const seenStreams = new Set();

        for (const row of rows) {
            if (!row.ticket || seenTickets.has(row.ticket)) continue;
            seenTickets.add(row.ticket);

            const serverLabel = row.label || row.id || "VidHawk";

            let payload;
            try {
                payload = await playTicket(row.ticket, referer);
            } catch (e) {
                failedLinks.push({ server_name: serverLabel, url: `${VH_BASE}/api/play`, reason: e.message });
                continue;
            }

            if (!payload || !Array.isArray(payload.tracks) || payload.tracks.length === 0) {
                failedLinks.push({ server_name: serverLabel, url: `${VH_BASE}/api/play`, reason: "No track in the response" });
                continue;
            }

            const tracks = payload.tracks.slice().sort((a, b) => audioRank(a.id) - audioRank(b.id));

            for (const track of tracks) {
                const src = track.src || track.url || "";
                if (!src || seenStreams.has(src)) continue;
                seenStreams.add(src);

                const audioLabel = (track.label || track.id || "Audio").toUpperCase();
                streams.push({
                    title: `VidHawk ${serverLabel} [${audioLabel}]`,
                    streamUrl: src,
                    headers: { "Referer": `${VH_BASE}/`, "User-Agent": VH_UA }
                });
                console.log(`   -> ${serverLabel} / ${audioLabel}: ${src.slice(0, 80)}…`);
            }

            // Captions are grouped per audio track under "captions".
            const captions = payload.captions || {};
            for (const audioKey of Object.keys(captions)) {
                const list = captions[audioKey];
                if (!Array.isArray(list)) continue;
                for (const caption of list) {
                    const subUrl = caption.src || caption.url || caption.file || "";
                    if (!subUrl) continue;
                    if (allSubtitles.some(s => s.url === subUrl)) continue;

                    const label = caption.label || caption.language || caption.lang || "Unknown";
                    allSubtitles.push({
                        url: subUrl,
                        label: label,
                        kind: caption.kind || "captions",
                        headers: { "Referer": `${VH_BASE}/` }
                    });

                    const lower = String(label).toLowerCase();
                    const isEnglish = lower.indexOf('eng') !== -1;
                    const isForced = lower.indexOf('forced') !== -1;
                    if (bestSubtitle === "" || (isEnglish && !isForced)) {
                        bestSubtitle = subUrl;
                        bestSubtitleHeaders = { "Referer": `${VH_BASE}/` };
                    }
                }
            }
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("VidHawk", "PLAYER", {
            media_url: referer,
            season_number: "1",
            ep_number: epNumber,
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("VidHawk", "UNSUPPORTED_HOSTS", {
                media_url: referer,
                season_number: "1",
                ep_number: epNumber,
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
        sendSupabaseLog("VidHawk", "ERROR", { media_url: referer, season_number: "1", error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
