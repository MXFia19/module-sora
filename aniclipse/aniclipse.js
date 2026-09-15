// ==========================================
// ⚙️ SORA MODULE — ANICLIPSE
// ==========================================
// aniclipse.com hosts no video at all: it is a catalogue, keyed by AniList id,
// that embeds third-party players.
//
//   GET /api/anime/search?q=<text>
//       -> {data:{Page:{pageInfo, media:[{id, title, coverImage, …}]}}}
//   GET /api/anime/episodes?anilistId=<id>
//       -> {episodes:[{number, title, thumbnail, aired, description}],
//           tvdbSeriesId, source, fillers}
//   GET /api/watch/servers?anilistId=<id>&episode=<n>
//       -> {sub:[…], dub:[…], fast:[…]}  — which players cover the episode
//   GET /api/watch/episode?anilistId=&episode=&server=&type=
//       -> {url:"https://vidhawk.buzz/embed/ani/…", type:"embed", streams:[]}
//
// "streams" is always empty: everything goes through an embed. So we resolve
// vidhawk ourselves — its internal chain is open (see this repository's vidhawk
// module):
//   /api/stream/race?…   -> {servers:[{id,label,ticket}]}
//   /api/play?t=<ticket> -> audio tracks + captions
//
// What aniclipse adds over vidhawk alone: the real episode titles, their
// thumbnails, their air dates and the filler list, none of which AniList gives.

const AC_BASE = "https://aniclipse.com";
const ANILIST_API = "https://graphql.anilist.co";
const VH_BASE = "https://vidhawk.buzz";

const AC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const AC_AUDIO_ORDER = ["sub", "dub", "jpn", "hin"];

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

async function getJson(url, referer) {
    const headers = { "User-Agent": AC_UA, "Accept": "application/json", "Referer": referer };
    const response = await soraFetch(url, { method: 'GET', headers: headers });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

async function acGet(path) {
    return await getJson(`${AC_BASE}${path}`, `${AC_BASE}/`);
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

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Aniclipse — searching for "${keyword}"`);
    try {
        const data = await acGet(`/api/anime/search?q=${encodeURIComponent(keyword)}`);
        const media = data && data.data && data.data.Page && Array.isArray(data.data.Page.media)
            ? data.data.Page.media
            : [];

        const results = [];
        for (const item of media) {
            if (!item || !item.id) continue;
            if (item.isAdult === true) continue;

            const title = (item.title && (item.title.english || item.title.romaji || item.title.native)) || `AniList ${item.id}`;
            const cover = item.coverImage || {};
            const image = cover.extraLarge || cover.large || cover.medium || "";

            results.push({
                title: item.seasonYear ? `${title} (${item.seasonYear})` : title,
                image: image,
                href: `aniclipse://${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Aniclipse", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Aniclipse", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

// Aniclipse exposes no per-id entry: its /api/anime/search only takes text. So
// the entry is read from AniList, the very source whose shape aniclipse copies.
const DETAILS_QUERY = `query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    description
    status
    seasonYear
    averageScore
    genres
    synonyms
    startDate { year month day }
  }
}`;

async function extractDetails(url) {
    const anilistId = url.replace('aniclipse://', '');
    console.log(`[Details] 📖 Aniclipse — AniList ${anilistId}`);
    sendSupabaseLog("Aniclipse", "DETAILS", { media_url: `${AC_BASE}/watch/${anilistId}` });

    try {
        const data = await anilistQuery(DETAILS_QUERY, { id: parseInt(anilistId, 10) });
        const media = data && data.Media ? data.Media : null;
        if (!media) {
            return JSON.stringify([{ description: 'Entry not found.', aliases: '', airdate: '' }]);
        }

        const aliasParts = [];
        if (media.averageScore) aliasParts.push(`Score: ${media.averageScore}/100`);
        if (Array.isArray(media.genres) && media.genres.length) aliasParts.push(media.genres.join(', '));
        if (Array.isArray(media.synonyms) && media.synonyms.length) aliasParts.push(media.synonyms.slice(0, 3).join(' · '));

        let airdate = media.seasonYear ? `Year: ${media.seasonYear}` : "";
        const start = media.startDate;
        if (start && start.year && start.month && start.day) {
            airdate = `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
        }
        if (media.status) airdate = airdate ? `${airdate} · ${media.status}` : media.status;

        return JSON.stringify([{
            description: cleanText(media.description) || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("Aniclipse", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const anilistId = url.replace('aniclipse://', '');
    console.log(`[Episodes] 📂 Aniclipse — episodes of ${anilistId}`);

    try {
        const data = await acGet(`/api/anime/episodes?anilistId=${encodeURIComponent(anilistId)}`);
        const list = data && Array.isArray(data.episodes) ? data.episodes : [];

        // "fillers" lists the filler episode numbers; flag them rather than
        // remove them — the choice belongs to the viewer.
        const fillers = new Set();
        if (Array.isArray(data && data.fillers)) {
            for (const f of data.fillers) {
                const n = typeof f === 'number' ? f : (f && f.number);
                if (typeof n === 'number') fillers.add(n);
            }
        }

        const episodes = [];
        const seen = new Set();
        for (const item of list) {
            const n = item && item.number;
            if (typeof n !== 'number' || seen.has(n)) continue;
            seen.add(n);

            let title = item.title || `Episode ${n}`;
            if (fillers.has(n)) title = `${title} (filler)`;

            episodes.push({
                href: `aniclipse-play://${anilistId}/${n}`,
                number: n,
                season: 1,
                title: title
            });
        }

        episodes.sort((a, b) => a.number - b.number);
        console.log(`[Episodes] ✅ ${episodes.length} episode(s) (source: ${(data && data.source) || 'unknown'})`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Aniclipse", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK — resolving vidhawk
// ==========================================

// Without "stream=1", /api/stream/race answers in one block:
//   {winner, ticket, servers:[{id,label,ticket,ok,ms}], …}
// With it, it holds the connection open and drips NDJSON, which Sora cannot
// consume. Query the block variant, while tolerating NDJSON.
function parseRaceRows(body) {
    const rows = [];
    if (!body) return rows;

    try {
        const whole = JSON.parse(body);
        if (whole && Array.isArray(whole.servers)) {
            for (const server of whole.servers) {
                if (server && server.ticket) rows.push(server);
            }
            if (rows.length === 0 && whole.ticket) {
                rows.push({ id: whole.winner || 'flow', label: whole.winner || 'VidHawk', ticket: whole.ticket });
            }
            return rows;
        }
    } catch (e) { /* try NDJSON */ }

    for (const line of String(body).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) !== '{') continue;
        let event;
        try { event = JSON.parse(trimmed); } catch (e2) { continue; }
        if (event && event.type === 'row' && event.row && event.row.ticket) rows.push(event.row);
    }
    return rows;
}

async function vidhawkTickets(anilistId, epNumber, referer) {
    const query = `episode=${encodeURIComponent(epNumber)}&audio=sub&server=flow&anilistId=${encodeURIComponent(anilistId)}`;
    const headers = { "User-Agent": AC_UA, "Accept": "application/json", "Referer": referer };
    const response = await soraFetch(`${VH_BASE}/api/stream/race?${query}`, { method: 'GET', headers: headers });
    return parseRaceRows(await readBody(response));
}

async function vidhawkPlay(ticket, referer) {
    return await getJson(`${VH_BASE}/api/play?t=${encodeURIComponent(ticket)}`, referer);
}

function audioRank(id) {
    const index = AC_AUDIO_ORDER.indexOf(String(id || '').toLowerCase());
    return index === -1 ? AC_AUDIO_ORDER.length : index;
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const parts = url.replace('aniclipse-play://', '').split('/');
    const anilistId = parts[0];
    const epNumber = parts.length > 1 ? parts[1] : '1';
    const mediaUrl = `${AC_BASE}/watch/${anilistId}?ep=${epNumber}`;
    const vhReferer = `${VH_BASE}/embed/ani/${anilistId}/${epNumber}/sub`;

    console.log(`[Player] 🎬 Aniclipse — AniList ${anilistId}, episode ${epNumber}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        // Which players does aniclipse advertise for this episode?
        const servers = await acGet(`/api/watch/servers?anilistId=${encodeURIComponent(anilistId)}&episode=${encodeURIComponent(epNumber)}`);
        const subList = servers && Array.isArray(servers.sub) ? servers.sub : [];
        const dubList = servers && Array.isArray(servers.dub) ? servers.dub : [];
        const advertised = Array.from(new Set(subList.concat(dubList)));
        console.log(`[Player] 🗺️ Players advertised: ${advertised.join(', ') || 'none'}`);

        if (advertised.length && advertised.indexOf('vidhawk') === -1) {
            // The other players (anilink, vidbolt, kari) protect their
            // resolution: anilink with a challenge signed inside an obfuscated
            // bundle, vidbolt with an IP-bound token. Do not pretend they are
            // supported.
            console.log(`[Player] ⚠️ vidhawk absent; the other players are not resolved by this module.`);
            failedLinks.push({
                server_name: advertised.join('/'),
                url: mediaUrl,
                reason: "Players not resolved (signed challenge or IP-bound token)"
            });
        }

        const rows = await vidhawkTickets(anilistId, epNumber, vhReferer);
        console.log(`[Player] 🏁 vidhawk: ${rows.length} server(s)`);

        const seenTickets = new Set();
        const seenStreams = new Set();

        for (const row of rows) {
            if (!row.ticket || seenTickets.has(row.ticket)) continue;
            seenTickets.add(row.ticket);

            const serverLabel = row.label || row.id || "VidHawk";
            const payload = await vidhawkPlay(row.ticket, vhReferer);

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
                    headers: { "Referer": `${VH_BASE}/`, "User-Agent": AC_UA }
                });
                console.log(`   -> ${serverLabel} / ${audioLabel}`);
            }

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

        sendSupabaseLog("Aniclipse", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: epNumber,
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("Aniclipse", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl,
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
        sendSupabaseLog("Aniclipse", "ERROR", { media_url: mediaUrl, season_number: "1", error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
