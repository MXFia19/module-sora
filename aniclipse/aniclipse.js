// ==========================================
// ⚙️ SORA MODULE — ANICLIPSE
// ==========================================
// aniclipse.com is a catalogue that resolves its own players. Since November
// 2026 it no longer keys anything by AniList id: titles carry a house code
// ("one-piece-3nv1csft"), which every route takes as "mid".
//
//   GET /api/anime/search?q=<text>
//       -> {data:{Page:{media:[{id:<mid>, title, coverImage, description,
//           genres, averageScore, startDate, status, subDub, …}]}}}
//   GET /api/anime/episodes?mid=<mid>
//       -> {episodes:[{number, title, thumbnail, aired, description}], fillers?}
//   GET /api/watch/servers?mid=<mid>&episode=<n>
//       -> {sub:["kaze","hoshi"], dub:[…], embedsEnabled:false, …}
//   GET /api/watch/episode?mid=&title=&episode=&server=&type=<sub|dub>
//       -> {url, streams:[{url, type, quality}], subtitles:[{url, lang, label,
//           default}], referer, cookie, intro, outro}
//
// The streams come back as plain HLS (vidhawk-hls-edge.useapolloapp.workers.dev),
// playable as is: nothing to decrypt any more, and the old vidhawk ticket chain
// is not used by the site. "title" is required by /api/watch/episode, so it
// travels in the href along with the mid.

const AC_BASE = "https://aniclipse.com";

const AC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    // the caller did not set one (AniList and TMDB calls, notably).
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = AC_UA;
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
    const headers = { "User-Agent": AC_UA, "Accept": "application/json", "Referer": referer };
    const response = await soraFetch(url, { method: 'GET', headers: headers });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

async function acGet(path) {
    return await getJson(`${AC_BASE}${path}`, `${AC_BASE}/`);
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

// href : aniclipse://<mid>?t=<titre>  /  aniclipse-play://<mid>/<épisode>?t=<titre>
function makeHref(scheme, mid, title, episode) {
    const t = encodeURIComponent(title || "");
    return episode == null ? `${scheme}://${mid}?t=${t}` : `${scheme}://${mid}/${episode}?t=${t}`;
}

function parseHref(url) {
    const rest = String(url).replace(/^aniclipse(-play)?:\/\//, '');
    const q = rest.indexOf('?');
    const path = q === -1 ? rest : rest.slice(0, q);
    const query = q === -1 ? '' : rest.slice(q + 1);
    const parts = path.split('/');
    let title = '';
    const m = query.match(/(?:^|&)t=([^&]*)/);
    if (m) { try { title = decodeURIComponent(m[1]); } catch (e) { title = m[1]; } }
    return { mid: parts[0], episode: parts[1] || '1', title: title };
}

function mainTitle(item) {
    const t = (item && item.title) || {};
    return t.english || t.romaji || t.native || '';
}

async function searchMedia(keyword) {
    const data = await acGet(`/api/anime/search?q=${encodeURIComponent(keyword)}`);
    return data && data.data && data.data.Page && Array.isArray(data.data.Page.media) ? data.data.Page.media : [];
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Aniclipse — searching for "${keyword}"`);
    try {
        const media = await searchMedia(keyword);
        const results = [];
        for (const item of media) {
            if (!item || !item.id) continue;
            if (item.isAdult === true) continue;

            const title = mainTitle(item) || String(item.id);
            const cover = item.coverImage || {};
            const year = item.seasonYear || (item.startDate && item.startDate.year);
            results.push({
                title: year ? `${title} (${year})` : title,
                image: cover.extraLarge || cover.large || cover.medium || "",
                href: makeHref('aniclipse', item.id, title)
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

// Pas de route « une fiche par id » : on relance la recherche sur le titre et
// on prend l'entrée qui porte le même mid — elle a tout (synopsis, genres…).
async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 Aniclipse — ${ref.mid}`);
    sendSupabaseLog("Aniclipse", "DETAILS", { media_url: `${AC_BASE}/title/${ref.mid}` });

    try {
        const media = ref.title ? await searchMedia(ref.title) : [];
        const item = media.find(m => m && m.id === ref.mid);
        if (!item) {
            return JSON.stringify([{ description: 'No synopsis available.', aliases: '', airdate: '' }]);
        }

        const aliasParts = [];
        if (item.averageScore) aliasParts.push(`Score: ${item.averageScore}/100`);
        if (Array.isArray(item.genres) && item.genres.length) aliasParts.push(item.genres.join(', '));
        if (item.subDub && (item.subDub.sub || item.subDub.dub)) {
            aliasParts.push(`SUB ${item.subDub.sub || 0} · DUB ${item.subDub.dub || 0}`);
        }

        let airdate = item.seasonYear ? `Year: ${item.seasonYear}` : "";
        const start = item.startDate;
        if (start && start.year && start.month && start.day) {
            airdate = `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
        }
        if (item.status) airdate = airdate ? `${airdate} · ${item.status}` : item.status;

        return JSON.stringify([{
            description: cleanText(item.description) || "No synopsis available.",
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
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 Aniclipse — episodes of ${ref.mid}`);

    try {
        const data = await acGet(`/api/anime/episodes?mid=${encodeURIComponent(ref.mid)}`);
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
                href: makeHref('aniclipse-play', ref.mid, ref.title, n),
                number: n,
                season: 1,
                title: title
            });
        }

        episodes.sort((a, b) => a.number - b.number);
        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Aniclipse", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = `${AC_BASE}/title/${ref.mid}`;

    console.log(`[Player] 🎬 Aniclipse — ${ref.mid}, episode ${ref.episode}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        // Quels serveurs le site annonce pour cet épisode, en VO et en VF/doublage.
        const servers = await acGet(`/api/watch/servers?mid=${encodeURIComponent(ref.mid)}&episode=${encodeURIComponent(ref.episode)}`);
        const combos = [];
        for (const type of ["sub", "dub"]) {
            const list = servers && Array.isArray(servers[type]) ? servers[type] : [];
            for (const server of list) combos.push({ server: String(server), type: type });
        }
        if (combos.length === 0) combos.push({ server: "kaze", type: "sub" }, { server: "kaze", type: "dub" });
        console.log(`[Player] 🗺️ ${combos.map(c => `${c.server}/${c.type}`).join(', ')}`);

        // Indépendants : on les interroge tous à la fois.
        const answers = await Promise.all(combos.map(c => acGet(
            `/api/watch/episode?mid=${encodeURIComponent(ref.mid)}&title=${encodeURIComponent(ref.title)}`
            + `&episode=${encodeURIComponent(ref.episode)}&server=${encodeURIComponent(c.server)}&type=${c.type}`
        ).catch(() => null)));

        const seen = new Set();
        answers.forEach((data, i) => {
            const combo = combos[i];
            const label = `${combo.server.charAt(0).toUpperCase()}${combo.server.slice(1)} [${combo.type.toUpperCase()}]`;
            if (!data || data.error) {
                failedLinks.push({ server_name: label, url: mediaUrl, reason: (data && data.error) || "No answer" });
                return;
            }

            const headers = { "User-Agent": AC_UA };
            if (data.referer) headers["Referer"] = data.referer;
            if (data.cookie) headers["Cookie"] = data.cookie;

            const list = Array.isArray(data.streams) && data.streams.length
                ? data.streams
                : (data.url ? [{ url: data.url, quality: data.quality }] : []);
            for (const s of list) {
                if (!s || !s.url || seen.has(s.url)) continue;
                seen.add(s.url);
                const quality = s.quality && s.quality !== 'auto' ? ` ${s.quality}` : '';
                streams.push({ title: `Aniclipse ${label}${quality}`, streamUrl: s.url, headers: headers });
                console.log(`   -> ${label}${quality}`);
            }

            for (const sub of Array.isArray(data.subtitles) ? data.subtitles : []) {
                if (!sub || !sub.url || allSubtitles.some(x => x.url === sub.url)) continue;
                const subLabel = sub.label || sub.lang || "Unknown";
                allSubtitles.push({ url: sub.url, label: subLabel, kind: "captions", headers: {} });
                const lower = `${subLabel} ${sub.lang || ''}`.toLowerCase();
                if (bestSubtitle === "" || (/eng|\ben\b/.test(lower) && !/forced/.test(lower))) {
                    bestSubtitle = sub.url;
                    bestSubtitleHeaders = {};
                }
            }
        });

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("Aniclipse", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: ref.episode,
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
                ep_number: ref.episode,
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
