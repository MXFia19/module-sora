// ==========================================
// ⚙️ SORA MODULE — BCINE
// ==========================================
// bCine (bciney.to, which now lands on cineyz.com) is a TMDB-keyed catalogue
// whose player is its own embed, vidcorn.cfd. The catalogue therefore comes
// straight from TMDB; playback from the embed's backend, plain JSON:
//
//   GET  https://vidcorn.cfd/api/token
//     -> {"token":"v5.<hex>.<unix>.<hex>","expiresAt":…,"ttl":300}
//   POST https://vidcorn.cfd/api/sources?provider=<necro|look|abyss|south|acme>
//        x-bcine-key: <token>
//        {"type":"movie"|"tv","id":"<tmdb>","provider":…,["season":n,"episode":n],["dubId":…]}
//     -> {servers:[{name,quality,type,url:"/api/v?d=…&sig=…&headers=…"}],
//         tracks:[{lan,lanName,url}], dubs:[{id,language}], currentDubId}
//
// Every stream comes back already wrapped in the embed's own relay
// (/api/v?d=…), which carries the upstream headers itself: nothing to decrypt
// or sign on our side. The five servers are the ones the player lists:
// Necro (main), Look (LookMovie), Abyss (Soap2Day), South, Acme (Hindi and
// English audio, one "dub" per request).

const BC_EMBED = "https://vidcorn.cfd";
const BC_SITE = "https://cineyz.com";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const BC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Servers in the player's own order (key -> display name).
const BC_PROVIDERS = [
    { key: "necro", name: "Necro" },
    { key: "look", name: "Look" },
    { key: "abyss", name: "Abyss" },
    { key: "south", name: "South" },
    { key: "acme", name: "Acme" }
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
    if (!headers["User-Agent"]) headers["User-Agent"] = BC_UA;
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

// The embed page a browser would be on: the API checks it as Referer.
function embedPage(ref) {
    return ref.kind === 'tv'
        ? `${BC_EMBED}/embed/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${BC_EMBED}/embed/movie/${ref.id}`;
}

async function bcToken(ref) {
    const headers = { "User-Agent": BC_UA, "Accept": "application/json", "Referer": embedPage(ref) };
    const body = await readBody(await soraFetch(`${BC_EMBED}/api/token`, { method: 'GET', headers: headers }));
    try {
        const data = JSON.parse(body);
        return data && data.token ? String(data.token) : "";
    } catch (e) { return ""; }
}

async function bcSources(ref, token, provider, dubId) {
    const payload = { type: ref.kind, id: String(ref.id), provider: provider };
    if (dubId) payload.dubId = dubId;
    if (ref.kind === 'tv') {
        payload.season = parseInt(ref.season || "1", 10);
        payload.episode = parseInt(ref.episode || "1", 10);
    }
    const headers = {
        "User-Agent": BC_UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "x-bcine-key": token,
        "Referer": embedPage(ref),
        "Origin": BC_EMBED
    };
    const url = `${BC_EMBED}/api/sources?provider=${encodeURIComponent(provider)}`;
    const body = await readBody(await soraFetch(url, { method: 'POST', headers: headers, body: JSON.stringify(payload) }));
    if (!body || body.charAt(0) !== '{') return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

function absolute(url) {
    if (!url) return "";
    if (/^https?:\/\//.test(url)) return url;
    if (url.charAt(0) === '/') return `${BC_EMBED}${url}`;
    return "";
}

function streamHeaders() {
    return { "Referer": `${BC_EMBED}/`, "User-Agent": BC_UA };
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 bCine — searching for "${keyword}"`);
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
                href: `bcine://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("bCine", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("bCine", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('bcine-play://', '').replace('bcine://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 bCine — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("bCine", "DETAILS", { media_url: `${BC_SITE}/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("bCine", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 bCine — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `bcine-play://movie/${ref.id}`,
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
                    href: `bcine-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("bCine", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// The relays sometimes sign a link whose upstream is gone (404/502) or
// rate-limited: ask for the playlist once and keep only the live ones.
async function playlistIsAlive(url) {
    try {
        const response = await soraFetch(url, { method: 'GET', headers: streamHeaders() });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = await readBody(response);
        return body.indexOf('#EXTM3U') !== -1;
    } catch (e) { return false; }
}

// Turns one /api/sources answer into streams + subtitle tracks.
function collect(data, providerName, dubLabel, streams, allSubtitles) {
    const servers = data && Array.isArray(data.servers) ? data.servers : [];
    for (const server of servers) {
        const streamUrl = absolute(server && server.url);
        if (!streamUrl) continue;
        if (streams.some(s => s.streamUrl === streamUrl)) continue;
        const name = String(server.name || server.title || providerName);
        // "quality" is sometimes a real resolution, sometimes "Necro (Auto)".
        const q = String(server.quality || "");
        const quality = /^\d{3,4}p$|^4K/i.test(q) && name.indexOf(q) === -1 ? ` ${q}` : "";
        const dub = dubLabel && name.indexOf(dubLabel) === -1 ? ` · ${dubLabel}` : "";
        streams.push({ title: `bCine ${name}${quality}${dub}`, streamUrl: streamUrl, headers: streamHeaders() });
    }

    const tracks = data && Array.isArray(data.tracks) ? data.tracks : [];
    for (const track of tracks) {
        const subUrl = absolute(track && track.url);
        if (!subUrl) continue;
        if (allSubtitles.some(s => s.url === subUrl)) continue;
        allSubtitles.push({
            url: subUrl,
            label: track.lanName || track.lan || providerName,
            kind: "captions",
            headers: { "Referer": `${BC_EMBED}/` },
            lang: String(track.lan || "").toLowerCase()
        });
    }
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = embedPage(ref);

    console.log(`[Player] 🎬 bCine — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const token = await bcToken(ref);
        if (!token) {
            console.log(`[Player] ⚠️ No token from ${BC_EMBED}/api/token`);
            sendSupabaseLog("bCine", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: String(ref.season || "1"), ep_number: String(ref.episode || "1"),
                failed_count: 1, failed_links: [{ server_name: "bCine", url: `${BC_EMBED}/api/token`, reason: "No token" }]
            });
            return JSON.stringify({ type: "none" });
        }

        // The five servers are independent: ask them all at once.
        const answers = await Promise.all(BC_PROVIDERS.map(p => bcSources(ref, token, p.key, null).catch(() => null)));

        for (let i = 0; i < BC_PROVIDERS.length; i++) {
            const provider = BC_PROVIDERS[i];
            const data = answers[i];
            const before = streams.length;

            // Acme answers in one audio language per call (Hindi first); the
            // other languages are fetched with their dubId.
            const dubs = data && Array.isArray(data.dubs) ? data.dubs : [];
            const current = dubs.find(d => d && d.id === data.currentDubId);
            collect(data, provider.name, current ? (current.language || current.name) : "", streams, allSubtitles);

            for (const dub of dubs) {
                if (!dub || !dub.id || dub.id === data.currentDubId) continue;
                const other = await bcSources(ref, token, provider.key, dub.id).catch(() => null);
                collect(other, provider.name, dub.language || dub.name || "", streams, allSubtitles);
            }

            if (streams.length === before) {
                failedLinks.push({ server_name: provider.name, url: `${BC_EMBED}/api/sources?provider=${provider.key}`, reason: "No server returned" });
            } else {
                console.log(`   -> ${provider.name}: ${streams.length - before} stream(s)`);
            }
        }

        // Drop the links whose playlist does not answer (checked in parallel).
        const alive = await Promise.all(streams.map(s => playlistIsAlive(s.streamUrl)));
        for (let i = streams.length - 1; i >= 0; i--) {
            if (alive[i]) continue;
            failedLinks.push({ server_name: streams[i].title, url: streams[i].streamUrl, reason: "Playlist unreachable" });
            streams.splice(i, 1);
        }

        // English first for the default subtitle.
        const english = allSubtitles.find(s => s.lang === 'en' || /^english/i.test(s.label));
        if (english) {
            bestSubtitle = english.url;
            bestSubtitleHeaders = english.headers;
        }
        for (const sub of allSubtitles) delete sub.lang;

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("bCine", "PLAYER", {
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
            sendSupabaseLog("bCine", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("bCine", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
