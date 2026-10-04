// ==========================================
// ⚙️ SORA MODULE — PRESSPLAY
// ==========================================
// PressPlay (pressplayz.to → pressplayx.to, formerly VidBinge) is a TMDB-keyed
// catalogue. Its server list (/api/player-servers) mixes third-party embeds
// (moviesapi.to, vidfast.pro) with two players the PressPlay team runs itself,
// both served by vidspark.to. Only those two are used here:
//
//   1. VidSpark (vidspark.to) — the "Vidora" self-hosted library:
//        GET https://vidspark.to/api/vidora/v1/movie/<id>
//        GET https://vidspark.to/api/vidora/v1/tv/<id>/<s>/<e>
//      header x-player-key: <static key from the player bundle>, Referer vidspark.to
//      -> {result, sources:[{file_code, url:<master.m3u8>, tracks}]}
//      Subtitles: GET /api/vidora/v1/subtitles/<path> -> {tracks:[{label, src}]}
//
//   2. CDNSpark (cdn.vidspark.to) — the same API shape, plus ?source=<relay>.
//      It relays several upstream libraries through PressPlay's own proxy
//      (p1.netocdn.site): scrapify ("Alpha"), vaplayer ("Beta"), oreon. The
//      proxy only answers with the cdn.vidspark.to Referer. Two relays are left
//      out: "lookmovie" links are signed for vidspark's own server IP (they
//      answer "WRONG HASH!" to anyone else) and "fsonic" re-serves vidrock
//      segments from a TikTok image CDN that now refuses them ("domain forbidden").
//
// The player keys are plain constants in the players' JS bundles. If one stops
// working (403 "Forbidden"), the module re-reads it from the current bundle.

const PP_SITE = "https://pressplayx.to";
const VS_HOST = "https://vidspark.to";
const CS_HOST = "https://cdn.vidspark.to";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const PP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Keys found in the players' bundles (vidspark.to/assets/index-*.js and
// cdn.vidspark.to/assets/main-*.js). Refreshed at runtime when rejected.
let VS_KEY = "3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13";
let CS_KEY = "f3b72e73c80c9a996574379798703796a1936efa3516a7105cb0e43048b46b5a";

// CDNSpark relays, in the player's own order, with the names it displays.
const CS_RELAYS = [
    { key: "scrapify", label: "Alpha" },
    { key: "vaplayer", label: "Beta" },
    { key: "oreon", label: "Oreon" }
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
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = PP_UA;
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

function parseJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
}

async function tmdbGet(path) {
    const glue = path.indexOf('?') === -1 ? '?' : '&';
    const url = `${TMDB_API}${path}${glue}api_key=${TMDB_API_KEY}`;
    const response = await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json" } });
    return parseJson(await readBody(response));
}

// ==========================================
// 🔑 PLAYER KEYS
// ==========================================

// Reads the x-player-key constant back from a player's current bundle: the
// page references /assets/<name>-<hash>.js and the key is the only 64-hex
// string assigned next to the "x-player-key" header.
async function refreshKey(host, samplePath) {
    try {
        const page = await readBody(await soraFetch(`${host}${samplePath}`, { headers: { "Referer": `${PP_SITE}/` } }));
        const scripts = [];
        const re = /src="(\/assets\/[^"]+\.js)"/g;
        let m;
        while ((m = re.exec(page)) !== null) scripts.push(m[1]);
        for (const src of scripts) {
            const js = await readBody(await soraFetch(`${host}${src}`, { headers: { "Referer": `${host}/` } }));
            if (!js || js.indexOf('x-player-key') === -1) continue;
            // let ez=`<64 hex>` ... {"x-player-key":ez}
            const call = js.match(/"x-player-key":\s*([A-Za-z_$][\w$]*)/);
            if (call) {
                const def = js.match(new RegExp(`[^\\w$]${call[1].replace(/\$/g, '\\$')}\\s*=\\s*[\`'"]([0-9a-f]{64})[\`'"]`));
                if (def) return def[1];
            }
            const any = js.match(/[`'"]([0-9a-f]{64})[`'"]/);
            if (any) return any[1];
        }
    } catch (e) {
        console.log(`[Keys] ⚠️ ${e.message}`);
    }
    return null;
}

async function vidoraGet(host, key, path, referer) {
    const headers = { "Accept": "application/json", "x-player-key": key, "Referer": referer };
    const response = await soraFetch(`${host}/api/vidora${path}`, { method: 'GET', headers: headers });
    const text = await readBody(response);
    return { text: text, json: parseJson(text) };
}

// Calls a vidspark API, refreshing the key once if the server rejects it.
async function vidspark(path) {
    let res = await vidoraGet(VS_HOST, VS_KEY, path, `${VS_HOST}/`);
    if (res.json && res.json.error === 'Forbidden') {
        const fresh = await refreshKey(VS_HOST, '/movie/27205');
        if (fresh && fresh !== VS_KEY) {
            VS_KEY = fresh;
            res = await vidoraGet(VS_HOST, VS_KEY, path, `${VS_HOST}/`);
        }
    }
    return res.json;
}

async function cdnspark(path) {
    let res = await vidoraGet(CS_HOST, CS_KEY, path, `${CS_HOST}/`);
    if (res.json && res.json.error === 'Forbidden') {
        const fresh = await refreshKey(CS_HOST, '/movie/27205');
        if (fresh && fresh !== CS_KEY) {
            CS_KEY = fresh;
            res = await vidoraGet(CS_HOST, CS_KEY, path, `${CS_HOST}/`);
        }
    }
    return res.json;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 PressPlay — searching for "${keyword}"`);
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
                href: `pressplay://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("PressPlay", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("PressPlay", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('pressplay://', '').replace('pressplay-play://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 PressPlay — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("PressPlay", "DETAILS", { media_url: `${PP_SITE}/watch/${ref.kind}/${ref.id}` });

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

        return JSON.stringify([{
            description: description,
            aliases: aliasParts.join(' | '),
            airdate: data.release_date || data.first_air_date || ""
        }]);
    } catch (error) {
        sendSupabaseLog("PressPlay", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 PressPlay — ${ref.kind} ${ref.id}`);

    try {
        if (ref.kind === 'movie') {
            return JSON.stringify([{ href: `pressplay-play://movie/${ref.id}`, number: 1, season: 1, title: "Movie" }]);
        }

        const show = await tmdbGet(`/tv/${ref.id}?language=en-US`);
        const seasons = show && Array.isArray(show.seasons) ? show.seasons : [];

        const episodes = [];
        for (const season of seasons) {
            const seasonNumber = season.season_number;
            // Season 0 collects the specials, which these players do not carry.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `pressplay-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("PressPlay", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function apiPath(ref) {
    return ref.kind === 'tv' ? `/v1/tv/${ref.id}/${ref.season}/${ref.episode}` : `/v1/movie/${ref.id}`;
}

// Turns a relative or protocol-less link into an absolute one.
function absolute(link, host) {
    if (!link) return "";
    if (/^https?:\/\//i.test(link)) return link;
    if (link.indexOf('//') === 0) return `https:${link}`;
    return `${host}${link.charAt(0) === '/' ? '' : '/'}${link}`;
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const path = apiPath(ref);
    const mediaUrl = ref.kind === 'tv'
        ? `${PP_SITE}/watch/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${PP_SITE}/watch/movie/${ref.id}`;

    console.log(`[Player] 🎬 PressPlay — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";

    const vsHeaders = { "Referer": `${VS_HOST}/`, "Origin": VS_HOST, "User-Agent": PP_UA };
    const csHeaders = { "Referer": `${CS_HOST}/`, "Origin": CS_HOST, "User-Agent": PP_UA };

    try {
        // 1. VidSpark — PressPlay's own "Vidora" library.
        const vs = await vidspark(path);
        if (vs && vs.result && Array.isArray(vs.sources) && vs.sources.length) {
            vs.sources.forEach((source, i) => {
                const link = absolute(source.url, VS_HOST);
                if (!link) return;
                streams.push({
                    title: vs.sources.length > 1 ? `VidSpark ${i + 1} (Vidora)` : "VidSpark (Vidora)",
                    streamUrl: link,
                    headers: vsHeaders
                });
                for (const track of (source.tracks || [])) {
                    if (!track || !track.file) continue;
                    allSubtitles.push({ url: absolute(track.file, VS_HOST), label: track.label || "Unknown", kind: "captions", headers: vsHeaders });
                }
            });
            console.log(`   -> VidSpark: ${vs.sources.length} source(s)`);
        } else {
            failedLinks.push({ server_name: "VidSpark", url: `${VS_HOST}/api/vidora${path}`, reason: (vs && vs.message) || "No Vidora link" });
        }

        // 2. CDNSpark relays, through PressPlay's proxy (asked in parallel).
        const relayAnswers = await Promise.all(CS_RELAYS.map(relay =>
            cdnspark(`${path}?source=${relay.key}`).catch(() => null)));
        for (let r = 0; r < CS_RELAYS.length; r++) {
            const relay = CS_RELAYS[r];
            const data = relayAnswers[r];
            const sources = data && data.result && Array.isArray(data.sources) ? data.sources : [];
            let added = 0;
            for (const source of sources) {
                const link = absolute(source.url, CS_HOST);
                if (!link || streams.some(s => s.streamUrl === link)) continue;
                streams.push({ title: `CDNSpark ${relay.label} (${source.source || relay.key})`, streamUrl: link, headers: csHeaders });
                added++;
                for (const track of (source.tracks || [])) {
                    if (!track || !track.file) continue;
                    allSubtitles.push({ url: absolute(track.file, CS_HOST), label: track.label || relay.label, kind: "captions", headers: csHeaders });
                }
            }
            if (added) console.log(`   -> CDNSpark ${relay.label}: ${added}`);
            else failedLinks.push({ server_name: `CDNSpark ${relay.label}`, url: `${CS_HOST}/api/vidora${path}?source=${relay.key}`, reason: "No stream returned" });
        }

        // Subtitles collected by VidSpark (served under /api/vidora/subs/…).
        const subs = await vidspark(`/v1/subtitles/${path.replace('/v1/', '')}`);
        if (subs && Array.isArray(subs.tracks)) {
            for (const track of subs.tracks) {
                if (!track || !track.src) continue;
                const subUrl = absolute(`/api/vidora/${track.src}`, VS_HOST);
                if (allSubtitles.some(s => s.url === subUrl)) continue;
                allSubtitles.push({ url: subUrl, label: track.label || track.languageName || track.language || "Unknown", kind: "captions", headers: vsHeaders });
                if (!bestSubtitle && String(track.language || '').toLowerCase() === 'en') bestSubtitle = subUrl;
            }
        }
        if (!bestSubtitle) {
            const english = allSubtitles.find(s => /english/i.test(s.label));
            bestSubtitle = english ? english.url : (allSubtitles[0] ? allSubtitles[0].url : "");
        }

        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("PressPlay", "PLAYER", {
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
            sendSupabaseLog("PressPlay", "UNSUPPORTED_HOSTS", {
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
            subtitlesHeaders: bestSubtitle ? vsHeaders : {},
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("PressPlay", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
