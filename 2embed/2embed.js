// ==========================================
// ⚙️ SORA MODULE — 2EMBED
// ==========================================
// 2Embed (www.2embed.cc) is a TMDB/IMDb-keyed embed. Its page is only a
// switcher between three player servers:
//   1. vidsrc.buzz/embed/...          ┐ the same backend, "VIDEM"
//   2. videm.xyz/embed/...            ┘ (videm.xyz, segments on relay*.videm.xyz)
//   3. streamsrcs.2embed.cc/vcr       → vidcore.io, a VidFast clone (not used here)
// This module drives the VIDEM backend. The server hosts are read from the
// 2Embed page when it answers, with the two known mirrors as a fallback.
//
// How a VIDEM player page works:
//   GET /embed/movie/<tmdb> | /embed/tv/<tmdb>/<s>/<e>
//     -> inline script `var Q = {type, id, s, e, t, ssr:{servers:[{ref, k, name, lang}]}}`
//        and `<base href="/pl/">` (vidsrc.buzz) or `<base href="/">` (videm.xyz).
//   GET <base>api.php?a=sources&type=&id=&s=&e=&t=   -> {status, more, servers:[…]}
//   GET <base>api.php?a=play&ref=<server ref>&t=<t>  -> {url:"/_stream?id=…", type:"hls"|"mp4"}
//   GET <base>api.php?a=subs&…                       -> {subs:[{label, lang, ref}]}
// "t" and every "ref" are signed tokens (base64url JSON + HMAC) whose "c" field
// is a hash of the client's IP and User-Agent: an API call made from another IP
// than the page load is refused with 403 {"error":"unavailable"}. A server that
// simply has nothing answers 502 with the same body. On a phone the IP is stable
// and every call passes first time; the few 403 retries below only matter when
// the egress IP changes between requests (carrier NAT pools, rotating proxies).
// The minted /_stream?id= URLs themselves are not IP-bound (the rarer
// /cap.php?…&t=… links carry a token of their own and need the page Referer).
//
// A subtitle "ref" carries the upstream file in its payload: {u: <url>, x: <kind>}.
// x = 0 is a plain .vtt (served as is), x = 3 a gzipped OpenSubtitles file that
// only the backend's api.php?a=sub proxy turns into WebVTT.

const TE_SITE = "https://www.2embed.cc";
const TE_HOSTS = ["https://vidsrc.buzz", "https://videm.xyz"];
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const TE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Servers that answer reliably are tried first; the others (VNE, XPM*, English)
// are still asked once each.
const TE_PREFERRED = /^(?:Server\s+)?(VEM|SWM)/i;

// 403 handling (token minted for another client IP): retries per call, number
// of fresh-token cycles, and a global budget of extra requests per playback.
const TE_RETRY_PER_CALL = 3;
const TE_MAX_ROUNDS = 3;
const TE_RETRY_BUDGET = 40;

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
    if (!headers["User-Agent"]) headers["User-Agent"] = TE_UA;
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

// ==========================================
// 🧰 HELPERS (no atob / URL in the runtime)
// ==========================================

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// base64 / base64url -> binary string (one char per byte).
function base64Decode(input) {
    const clean = String(input || "").replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    let output = "";
    let buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
        buffer = (buffer << 6) | B64_ALPHABET.indexOf(clean.charAt(i));
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return output;
}

function utf8Decode(binary) {
    let out = "";
    for (let i = 0; i < binary.length; i++) {
        const c = binary.charCodeAt(i);
        if (c < 0x80) { out += String.fromCharCode(c); continue; }
        if (c >= 0xc0 && c < 0xe0 && i + 1 < binary.length) {
            out += String.fromCharCode(((c & 0x1f) << 6) | (binary.charCodeAt(++i) & 0x3f));
        } else if (c >= 0xe0 && c < 0xf0 && i + 2 < binary.length) {
            out += String.fromCharCode(((c & 0x0f) << 12) | ((binary.charCodeAt(++i) & 0x3f) << 6) | (binary.charCodeAt(++i) & 0x3f));
        } else if (c >= 0xf0 && i + 3 < binary.length) {
            let cp = ((c & 0x07) << 18) | ((binary.charCodeAt(++i) & 0x3f) << 12) | ((binary.charCodeAt(++i) & 0x3f) << 6) | (binary.charCodeAt(++i) & 0x3f);
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        }
    }
    return out;
}

// Payload of a VIDEM token ("<base64url json>.<signature>").
function tokenPayload(token) {
    try {
        const part = String(token || "").split('.')[0];
        return JSON.parse(utf8Decode(base64Decode(part)));
    } catch (e) { return null; }
}

// Cuts the JSON object literal that starts at `start` (string-aware brace match).
function sliceJsonObject(text, start) {
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text.charAt(i);
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

function statusOf(response) {
    return response && typeof response.status === 'number' ? response.status : 0;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 2Embed — searching for "${keyword}"`);
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
                href: `twoembed://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("2Embed", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("2Embed", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

// URL schemes cannot start with a digit, hence "twoembed://" for the hrefs.
function parseHref(url) {
    const rest = String(url).replace('twoembed-play://', '').replace('twoembed://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 2Embed — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("2Embed", "DETAILS", {
        media_url: ref.kind === 'tv' ? `${TE_SITE}/embedtv/${ref.id}` : `${TE_SITE}/embed/${ref.id}`
    });

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
        sendSupabaseLog("2Embed", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 2Embed — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `twoembed-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which 2Embed does not index.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `twoembed-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("2Embed", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🧩 VIDEM BACKEND
// ==========================================

function embedPath(ref) {
    return ref.kind === 'tv'
        ? `/embed/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `/embed/movie/${ref.id}`;
}

// The 2Embed page names its current server hosts in go('…') buttons; keep the
// ones that point at a VIDEM-style /embed/ path, then add the known mirrors.
async function playerHosts(ref) {
    const hosts = [];
    try {
        const pageUrl = ref.kind === 'tv'
            ? `${TE_SITE}/embedtv/${ref.id}&s=${ref.season}&e=${ref.episode}`
            : `${TE_SITE}/embed/${ref.id}`;
        const html = await readBody(await soraFetch(pageUrl, {
            method: 'GET',
            headers: { "User-Agent": TE_UA, "Accept": "text/html,*/*;q=0.8", "Referer": `${TE_SITE}/` }
        }));
        const re = /go\('(https?:\/\/[^'\/]+)\/embed\/(?:movie|tv)\//g;
        let m;
        while ((m = re.exec(html || "")) !== null) {
            if (hosts.indexOf(m[1]) === -1) hosts.push(m[1]);
        }
    } catch (e) { /* the fallback list below is enough */ }
    for (const host of TE_HOSTS) if (hosts.indexOf(host) === -1) hosts.push(host);
    return hosts;
}

async function loadPlayer(host, path) {
    const html = await readBody(await soraFetch(`${host}${path}`, {
        method: 'GET',
        headers: { "User-Agent": TE_UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": `${TE_SITE}/` }
    }));
    if (!html) return null;
    const at = html.search(/var\s+Q\s*=\s*\{/);
    if (at === -1) return null;
    const literal = sliceJsonObject(html, html.indexOf('{', at));
    if (!literal) return null;
    let Q;
    try { Q = JSON.parse(literal); } catch (e) { return null; }
    const baseMatch = html.match(/<base\s+href="([^"]*)"/i);
    let base = baseMatch ? baseMatch[1] : "/";
    if (base.charAt(0) !== '/') base = `/${base}`;
    if (base.charAt(base.length - 1) !== '/') base += '/';
    return { Q: Q, base: base, host: host, referer: `${host}${path}` };
}

// One api.php call. Retries only on an explicit 403, i.e. a token minted for
// another client IP; `budget` is shared by the whole playback request.
async function apiCall(player, query, budget, maxTries) {
    const url = `${player.host}${player.base}api.php?${query}`;
    const headers = { "User-Agent": TE_UA, "Accept": "*/*", "Referer": player.referer };
    const tries = Math.max(1, maxTries || 1);
    let last = { status: 0, json: null };
    for (let i = 0; i < tries; i++) {
        const response = await soraFetch(url, { method: 'GET', headers: headers });
        const status = statusOf(response);
        const body = await readBody(response);
        let json = null;
        try { json = JSON.parse(body); } catch (e) { json = null; }
        last = { status: status, json: json };
        if (status !== 403 || budget.left <= 0) break;
        budget.left--;
    }
    return last;
}

// Reads the master playlist once: drops dead links and finds the best height.
async function probeStream(url, referer) {
    try {
        const response = await soraFetch(url, {
            method: 'GET',
            headers: { "User-Agent": TE_UA, "Referer": referer, "Accept": "*/*" }
        });
        if (statusOf(response) >= 400) return null;
        const body = await readBody(response);
        if (!body || body.indexOf('#EXTM3U') === -1) return null;
        // Widescreen masters (1920x800…) are classed by width as well.
        let best = 0;
        const re = /RESOLUTION=(\d+)x(\d+)/g;
        let m;
        while ((m = re.exec(body)) !== null) {
            const w = parseInt(m[1], 10), h = parseInt(m[2], 10);
            best = Math.max(best, h, Math.round(w * 9 / 16));
        }
        return { height: best };
    } catch (e) { return null; }
}

function qualityLabel(height) {
    if (!height) return "Auto";
    if (height >= 2000) return "4K";
    if (height >= 1400) return "1440p";
    if (height >= 1000) return "1080p";
    if (height >= 700) return "720p";
    if (height >= 460) return "480p";
    return `${height}p`;
}

function serverName(server) {
    return String((server && server.name) || "Server").replace(/^Server\s+/i, '');
}

function isPreferred(server) {
    return TE_PREFERRED.test((server && server.name) || "");
}

function sourcesQuery(Q) {
    return `type=${encodeURIComponent(Q.type)}&id=${encodeURIComponent(Q.id)}&s=${Q.s}&e=${Q.e}&t=${encodeURIComponent(Q.t)}`;
}

// The page's server list, completed by a sources call (servers found by the
// backend's late scrapers only show up there; tries = 0 skips it). `refused`
// tells whether that call was turned down with 403.
async function listServers(player, budget, tries) {
    const servers = [];
    const seen = {};
    const add = (list) => {
        for (const s of (list || [])) {
            if (!s || !s.ref || seen[serverName(s)]) continue;
            seen[serverName(s)] = true;
            servers.push(s);
        }
    };
    const Q = player.Q;
    if (Q.ssr && Array.isArray(Q.ssr.servers)) add(Q.ssr.servers);
    let refused = false;
    if (tries > 0) {
        const sources = await apiCall(player, `a=sources&${sourcesQuery(Q)}`, budget, tries);
        if (sources.json && Array.isArray(sources.json.servers)) add(sources.json.servers);
        refused = sources.status === 403;
    }
    servers.sort((a, b) => (isPreferred(a) ? 0 : 1) - (isPreferred(b) ? 0 : 1));
    return { servers: servers, refused: refused };
}

// Mints one server's stream. Returns "ok", "refused" (403: the token belongs to
// another client IP) or "dead" (the server has nothing for this title).
async function mintServer(player, server, state, tries) {
    const name = serverName(server);
    const play = await apiCall(player, `a=play&ref=${encodeURIComponent(server.ref)}&t=${encodeURIComponent(player.Q.t)}`, state.budget, tries);
    const link = play.json && play.json.url ? String(play.json.url) : "";
    if (!link) return play.status === 403 ? "refused" : "dead";

    const host = player.host;
    const streamUrl = /^https?:\/\//i.test(link) ? link : `${host}${link.charAt(0) === '/' ? '' : player.base}${link}`;
    if (state.streams.some(s => s.streamUrl === streamUrl)) return "ok";

    // Links come in two shapes: /_stream?id=… (open) and /cap.php?…&t=…&k=…
    // (an on-demand capture that refuses requests without the page Referer),
    // so the player page is sent as Referer, like the browser does.
    const type = String(play.json.type || 'hls').toLowerCase();
    let quality = type === 'mp4' ? "MP4" : "Auto";
    if (type !== 'mp4') {
        const probe = await probeStream(streamUrl, player.referer);
        if (!probe) {
            state.failed.push({ server_name: name, url: streamUrl, reason: "Playlist did not load" });
            return "dead";
        }
        quality = qualityLabel(probe.height);
    }

    const lang = server.lang ? ` · ${server.lang}` : "";
    state.streams.push({
        title: `2Embed ${name} ${quality}${lang}`,
        streamUrl: streamUrl,
        headers: { "Referer": player.referer, "Origin": host, "User-Agent": TE_UA }
    });
    console.log(`   -> ${name}: ${streamUrl}`);
    return "ok";
}

// Turns one mirror's servers into streams.
// First pass: one page load, the server list, one play call per server.
// If a known-good server was refused with 403, the client IP changed between
// requests: build a small pool of page tokens, keep the one whose client hash
// ("c") recurs (an address this client exits from often) and retry that server
// with it. With a stable IP (the normal case on a phone) that part never runs.
async function resolveOnHost(host, path, state) {
    const first = await loadPlayer(host, path);
    if (!first || !first.Q || !first.Q.t) {
        state.failed.push({ server_name: host, url: `${host}${path}`, reason: "No player config (Q) on the page" });
        return null;
    }
    if (first.Q.ssr && first.Q.ssr.status === 'none') {
        state.failed.push({ server_name: host, url: `${host}${path}`, reason: "Title not indexed" });
        return null;
    }

    const listed = await listServers(first, state.budget, 1);
    console.log(`[Player] 🧩 ${host}: ${listed.servers.map(s => s.name).join(', ') || 'no server'}`);

    const refused = [];
    for (const server of listed.servers) {
        const verdict = await mintServer(first, server, state, 1);
        if (verdict === "refused" && isPreferred(server)) refused.push(serverName(server));
        else if (verdict === "dead") state.failed.push({ server_name: serverName(server), url: `${host}${first.base}api.php?a=play`, reason: "Server unavailable" });
    }

    let lastPlayer = first;
    for (let cycle = 0; cycle < TE_MAX_ROUNDS && state.streams.length === 0 && refused.length > 0 && state.budget.left > 0; cycle++) {
        console.log(`[Player] 🔁 token refused (client IP changed), gathering a fresh token`);
        // Token pool keyed by client hash: stop at the first hash seen twice.
        const pool = {};
        let best = null;
        for (let i = 0; i < 6 && state.budget.left > 0; i++) {
            const player = await loadPlayer(host, path);
            state.budget.left--;
            if (!player || !player.Q || !player.Q.t) break;
            const payload = tokenPayload(player.Q.t) || {};
            const key = String(payload.c || i);
            pool[key] = pool[key] || { count: 0, player: null };
            pool[key].count++;
            pool[key].player = player;
            if (!best || pool[key].count >= best.count) best = pool[key];
            if (best.count >= 2) break;
        }
        if (!best) break;
        lastPlayer = best.player;

        // Server refs are bound to the token, so the list is read again; the
        // sources call is only needed when the page does not list the server.
        const inPage = ((best.player.Q.ssr && best.player.Q.ssr.servers) || []).map(serverName);
        const needSources = refused.some(n => inPage.indexOf(n) === -1);
        const relisted = await listServers(best.player, state.budget, needSources ? TE_RETRY_PER_CALL * 2 : 0);
        let answered = false;
        for (const server of relisted.servers) {
            if (refused.indexOf(serverName(server)) === -1) continue;
            const verdict = await mintServer(best.player, server, state, state.streams.length === 0 ? TE_RETRY_PER_CALL * 4 : 1);
            if (verdict !== "refused") answered = true;
        }
        // The token was accepted but the servers had nothing: stop there.
        if (answered && state.streams.length === 0) break;
    }
    if (state.streams.length === 0) {
        state.failed.push({ server_name: host, url: `${host}${path}`, reason: "No server returned a stream" });
    }
    return lastPlayer;
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const path = embedPath(ref);
    const mediaUrl = ref.kind === 'tv'
        ? `${TE_SITE}/embedtv/${ref.id}&s=${ref.season}&e=${ref.episode}`
        : `${TE_SITE}/embed/${ref.id}`;

    console.log(`[Player] 🎬 2Embed — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};
    const budget = { left: TE_RETRY_BUDGET };

    try {
        const hosts = await playerHosts(ref);

        for (const host of hosts) {
            // The mirrors share one backend: stop at the first one that plays.
            if (streams.length > 0) break;

            const player = await resolveOnHost(host, path, { streams: streams, failed: failedLinks, budget: budget });
            if (!player || streams.length === 0) continue;
            // Subtitles: plain .vtt files are linked directly, gzipped
            // OpenSubtitles files go through the backend's converting proxy.
            const subs = await apiCall(player, `a=subs&${sourcesQuery(player.Q)}`, budget, 2);
            const subList = subs.json && Array.isArray(subs.json.subs) ? subs.json.subs : [];
            for (const sub of subList) {
                const payload = tokenPayload(sub.ref);
                let subUrl = "";
                if (sub.url) subUrl = String(sub.url);
                else if (payload && payload.x === 0 && payload.u) subUrl = String(payload.u);
                else if (sub.ref) subUrl = `${host}${player.base}api.php?a=sub&ref=${encodeURIComponent(sub.ref)}`;
                if (!subUrl || allSubtitles.some(s => s.url === subUrl)) continue;

                allSubtitles.push({
                    url: subUrl,
                    label: sub.label || sub.lang || "Unknown",
                    kind: "captions",
                    headers: { "Referer": `${host}/`, "User-Agent": TE_UA }
                });
            }

            // Default track: a direct English .vtt, else any English, else the first.
            const isEnglish = (s) => /english/i.test(s.label);
            const isDirect = (s) => s.url.indexOf('api.php') === -1;
            const pick = allSubtitles.find(s => isEnglish(s) && isDirect(s))
                || allSubtitles.find(isEnglish)
                || allSubtitles[0];
            if (pick) {
                bestSubtitle = pick.url;
                bestSubtitleHeaders = pick.headers;
            }
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("2Embed", "PLAYER", {
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
            sendSupabaseLog("2Embed", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("2Embed", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
