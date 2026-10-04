// ==========================================
// ⚙️ SORA MODULE — VIDZEE
// ==========================================
// VidZee (player.vidzee.wtf) is an embed host keyed by TMDB id, movies and TV
// alike, used by many bookmarked movie catalogues. Its player is a small Vite
// app whose strings are obfuscated, but the flow underneath is short:
//
//   GET core.vidzee.wtf/streams/languages/<movie/<id>|tv/<id>/<s>/<e>>
//       -> {"languages":["Hindi","English"]}
//   GET core.vidzee.wtf/streams/<movie/<id>|tv/<id>/<s>/<e>>?s=<server>&e=1
//       -> {"c":"<base64>"}  (or, rarely, the clear object below)
//   GET core.vidzee.wtf/subs/<same path>  -> [{label, file}]   (VTT files)
//
// The player's server list (in its order): dcloud, doppler, one "Acme" entry
// per language ("v4:<Language>"), tik, ipcloud, v6:Hindi, v6:English.
//
// "c" is decrypted by a tiny AssemblyScript WASM shipped base64 in the
// player's streams chunk. Disassembled, it is plain RC4: key schedule over a
// fixed 32-byte key, the first 2048 keystream bytes dropped, then XOR. The
// page hostname it receives is only checked against an allow-list, it is not
// key material. Reimplemented below in pure JS. The clear text is
//   {"language":"English","url":"https://…m3u8","headers":{"Referer":…}}
//
// Some links only answer when the request carries the player's Referer, some
// bring their own Referer in "headers", one server (doppler) hands out links
// signed for VidZee's own backend ("WRONG HASH!" for anyone else) and Acme
// signs its segments for the client IP. Each link is therefore walked like a
// player would (playlist, variant, first segment) before being offered, which
// also gives the best resolution of a master playlist for the stream title.

const VZ_PLAYER = "https://player.vidzee.wtf";
const VZ_CORE = "https://core.vidzee.wtf";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const VZ_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// RC4 key embedded in the player's WASM (data segment at offset 1056).
const VZ_RC4_KEY = [
    0xe4, 0xf9, 0xb2, 0x7d, 0x8c, 0x1a, 0x6e, 0xf5, 0x03, 0x7d, 0xb9, 0x8a, 0xc5, 0x4e, 0x21, 0xf0,
    0xb9, 0xd6, 0xc3, 0xa7, 0x81, 0xfe, 0x42, 0xad, 0x65, 0xc0, 0xe9, 0xb7, 0x3f, 0x14, 0x8a, 0x2d
];
const VZ_RC4_DROP = 2048;

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
    if (!headers["User-Agent"]) headers["User-Agent"] = VZ_UA;
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

// Headers the player's own requests carry (core.vidzee.wtf, rezesubs.com and
// several stream hosts check them).
function playerHeaders() {
    return { "User-Agent": VZ_UA, "Referer": `${VZ_PLAYER}/`, "Origin": VZ_PLAYER };
}

async function coreGetJson(path) {
    const headers = playerHeaders();
    headers["Accept"] = "application/json";
    const body = await readBody(await soraFetch(`${VZ_CORE}${path}`, { method: 'GET', headers: headers }));
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// ==========================================
// 🔐 DECRYPTION (pure JS: base64, RC4-drop2048, UTF-8)
// ==========================================

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToBytes(input) {
    const clean = String(input || "").replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    const out = [];
    let buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
        buffer = (buffer << 6) | B64_ALPHABET.indexOf(clean.charAt(i));
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >> bits) & 0xff);
        }
    }
    return out;
}

function utf8Decode(bytes) {
    let out = "", i = 0;
    while (i < bytes.length) {
        const b0 = bytes[i++];
        if (b0 < 0x80) { out += String.fromCharCode(b0); continue; }
        let code;
        if (b0 >= 0xf0) {
            code = ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else if (b0 >= 0xe0) {
            code = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else {
            code = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
        }
        if (code > 0xffff) {
            code -= 0x10000;
            out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
        } else {
            out += String.fromCharCode(code);
        }
    }
    return out;
}

// Same steps as the WASM "decrypt" export: KSA, drop 2048, XOR.
function vzDecrypt(cipherB64) {
    const data = base64ToBytes(cipherB64);
    const S = new Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + S[i] + VZ_RC4_KEY[i % VZ_RC4_KEY.length]) & 255;
        const t = S[i]; S[i] = S[j]; S[j] = t;
    }
    let a = 0, b = 0;
    for (let n = 0; n < VZ_RC4_DROP; n++) {
        a = (a + 1) & 255; b = (b + S[a]) & 255;
        const t = S[a]; S[a] = S[b]; S[b] = t;
    }
    const out = new Array(data.length);
    for (let n = 0; n < data.length; n++) {
        a = (a + 1) & 255; b = (b + S[a]) & 255;
        const t = S[a]; S[a] = S[b]; S[b] = t;
        out[n] = data[n] ^ S[(S[a] + S[b]) & 255];
    }
    return utf8Decode(out);
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 VidZee — searching for "${keyword}"`);
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
                href: `vidzee://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("VidZee", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("VidZee", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = String(url).replace('vidzee-play://', '').replace('vidzee://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 VidZee — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("VidZee", "DETAILS", { media_url: `${VZ_PLAYER}/embed/${ref.kind}/${ref.id}` });

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
        sendSupabaseLog("VidZee", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 VidZee — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `vidzee-play://movie/${ref.id}`,
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
            // Season 0 collects the specials, which the embed does not serve.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `vidzee-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("VidZee", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// The path shared by /streams, /streams/languages and /subs.
function mediaPath(ref) {
    return ref.kind === 'tv'
        ? `tv/${encodeURIComponent(ref.id)}/${encodeURIComponent(ref.season)}/${encodeURIComponent(ref.episode)}`
        : `movie/${encodeURIComponent(ref.id)}`;
}

// The player's servers (see the header), most dependable first: Acme serves
// up to 1080p but signs its segments for the client IP, V6 is a single 480p/
// 720p rendition, IPcloud's segment CDN refuses some regions, doppler and tik
// were broken when this module was written but are kept in case they return.
function serverList(languages) {
    const list = [{ id: "dcloud", label: "Dcloud" }];
    for (const language of languages) list.push({ id: `v4:${language}`, label: "Acme" });
    list.push({ id: "v6:English", label: "V6" });
    list.push({ id: "v6:Hindi", label: "V6" });
    list.push({ id: "ipcloud", label: "IPcloud" });
    list.push({ id: "doppler", label: "Doppler" });
    list.push({ id: "tik", label: "TCloud" });
    return list;
}

// Headers a native player needs for one stream: the stream's own when the API
// gives some, the player's otherwise.
function streamHeaders(apiHeaders) {
    const headers = { "User-Agent": VZ_UA };
    const given = apiHeaders && typeof apiHeaders === 'object' ? apiHeaders : {};
    const keys = Object.keys(given);
    if (keys.length === 0) {
        headers["Referer"] = `${VZ_PLAYER}/`;
        headers["Origin"] = VZ_PLAYER;
        return headers;
    }
    for (const key of keys) {
        if (typeof given[key] === 'string' && given[key]) headers[key] = given[key];
    }
    return headers;
}

async function resolveServer(ref, server) {
    const data = await coreGetJson(`/streams/${mediaPath(ref)}?s=${encodeURIComponent(server.id)}&e=1`);
    if (!data) return { error: "No answer" };
    if (data.error) return { error: String(data.error) };

    let clear = data;
    if (typeof data.c === 'string' && !data.url) {
        try { clear = JSON.parse(vzDecrypt(data.c)); } catch (e) { return { error: "Decryption failed" }; }
    }
    if (!clear || typeof clear.url !== 'string' || !/^https?:\/\//.test(clear.url)) return { error: "No stream URL" };

    return {
        url: clear.url,
        language: clear.language || "Auto",
        headers: streamHeaders(clear.headers)
    };
}

// Resolves a playlist entry against the playlist's URL (no URL class here).
function resolveUrl(base, rel) {
    if (/^https?:\/\//i.test(rel)) return rel;
    const proto = (base.match(/^(https?:)/i) || [])[1] || "https:";
    if (rel.indexOf('//') === 0) return `${proto}${rel}`;
    const origin = (base.match(/^(https?:\/\/[^/]+)/i) || [])[1] || "";
    if (rel.charAt(0) === '/') return `${origin}${rel}`;
    const dir = base.split('?')[0].replace(/[^/]*$/, '');
    const parts = (dir.slice(origin.length) + rel).split('/');
    const out = [];
    for (const part of parts) {
        if (part === '..') out.pop();
        else if (part !== '.') out.push(part);
    }
    return `${origin}${out.join('/')}`;
}

function firstUri(playlist) {
    const lines = playlist.split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        if (line && line.charAt(0) !== '#') return line;
    }
    return "";
}

async function fetchText(url, headers) {
    const response = await soraFetch(url, { method: 'GET', headers: { ...headers } });
    if (!response) return { status: 0, body: "", url: url };
    const status = typeof response.status === 'number' ? response.status : 200;
    const body = await readBody(response);
    return { status: status, body: body || "", url: (typeof response.url === 'string' && response.url) ? response.url : url };
}

// Walks the link like a player would (playlist -> variant -> first segment,
// with the stream's headers) so that dead links ("WRONG HASH!", 403, a CDN
// refusing the region) are not offered; a master playlist also gives the best
// resolution for the title.
async function probeStream(url, headers) {
    try {
        const top = await fetchText(url, headers);
        if (top.status >= 400) return { alive: false, reason: `HTTP ${top.status}` };
        if (top.body.indexOf('#EXTM3U') === -1) {
            return { alive: false, reason: `Not a playlist (${top.body.slice(0, 40).replace(/\s+/g, ' ')})` };
        }

        let best = 0;
        const re = /RESOLUTION=\d+x(\d+)/g;
        let m;
        while ((m = re.exec(top.body)) !== null) best = Math.max(best, Number(m[1]));
        // A single-rendition playlist often names its height in the path
        // (".../720/index.m3u8").
        if (!best) {
            const fromPath = url.split('?')[0].match(/\/(240|360|480|540|720|1080|1440|2160)p?\//);
            if (fromPath) best = Number(fromPath[1]);
        }
        const quality = best ? `${best}p` : "";

        let media = top;
        if (top.body.indexOf('#EXT-X-STREAM-INF') !== -1) {
            const variant = firstUri(top.body);
            if (!variant) return { alive: false, reason: "Master playlist without variant" };
            media = await fetchText(resolveUrl(top.url, variant), headers);
            if (media.status >= 400 || media.body.indexOf('#EXTM3U') === -1) return { alive: false, reason: `Variant HTTP ${media.status}` };
        }

        const segment = firstUri(media.body);
        if (!segment) return { alive: false, reason: "Playlist without segments" };
        const segHeaders = { ...headers, "Range": "bytes=0-1023" };
        const seg = await fetchText(resolveUrl(media.url, segment), segHeaders);
        if (seg.status >= 400) return { alive: false, reason: `Segment HTTP ${seg.status}` };
        // Error pages come back as JSON or HTML; media (even AES-encrypted or
        // disguised as an image) does not start like that.
        const head = seg.body.replace(/^\s+/, '').charAt(0);
        if (media.body.indexOf('#EXT-X-KEY:METHOD=AES') === -1 && (head === '{' || head === '<')) {
            return { alive: false, reason: `Segment refused (${seg.body.slice(0, 50).replace(/\s+/g, ' ')})` };
        }
        return { alive: true, quality: quality };
    } catch (e) {
        return { alive: false, reason: String(e) };
    }
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const path = mediaPath(ref);
    const mediaUrl = ref.kind === 'tv'
        ? `${VZ_PLAYER}/embed/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `${VZ_PLAYER}/embed/movie/${ref.id}`;

    console.log(`[Player] 🎬 VidZee — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        // Languages (for the "Acme" server) and subtitles, in parallel.
        const [langData, subData] = await Promise.all([
            coreGetJson(`/streams/languages/${path}`),
            coreGetJson(`/subs/${path}`)
        ]);
        let languages = langData && Array.isArray(langData.languages) ? langData.languages : (Array.isArray(langData) ? langData : []);
        languages = languages.filter(l => typeof l === 'string' && l.trim());

        const servers = serverList(languages);
        console.log(`[Player] 🧩 ${servers.length} server(s), languages: ${languages.join(', ') || 'none'}`);

        // Resolve every server, then probe every link, all in parallel.
        const resolved = await Promise.all(servers.map(server => resolveServer(ref, server)));
        const probes = await Promise.all(resolved.map(r => r && r.url ? probeStream(r.url, r.headers) : Promise.resolve(null)));

        for (let i = 0; i < servers.length; i++) {
            const server = servers[i];
            const result = resolved[i];
            if (!result || !result.url) {
                failedLinks.push({ server_name: server.id, url: `${VZ_CORE}/streams/${path}?s=${server.id}`, reason: (result && result.error) || "Unknown" });
                continue;
            }
            const probe = probes[i];
            if (!probe || !probe.alive) {
                console.log(`   -> ${server.id}: dead link (${probe ? probe.reason : 'no probe'})`);
                failedLinks.push({ server_name: server.id, url: result.url, reason: probe ? probe.reason : "Probe failed" });
                continue;
            }
            if (streams.some(s => s.streamUrl === result.url)) continue;

            const quality = probe.quality ? ` ${probe.quality}` : "";
            streams.push({
                title: `VidZee ${server.label}${quality} · ${result.language}`,
                streamUrl: result.url,
                headers: result.headers
            });
            console.log(`   -> ${server.id}: ${result.url.slice(0, 80)}…`);
        }

        // Subtitles: rezesubs.com checks the player's Referer.
        const subList = Array.isArray(subData) ? subData : [];
        const seen = {};
        for (const caption of subList) {
            const subUrl = caption && (caption.file || caption.url) || "";
            if (!subUrl) continue;
            const base = caption.label || caption.lang || "Unknown";
            seen[base] = (seen[base] || 0) + 1;
            const label = seen[base] > 1 ? `${base} ${seen[base]}` : base;
            const subHeaders = { "Referer": `${VZ_PLAYER}/`, "Origin": VZ_PLAYER, "User-Agent": VZ_UA };

            allSubtitles.push({ url: subUrl, label: label, kind: "captions", headers: subHeaders });
            if (bestSubtitle === "" && /^english/i.test(base)) {
                bestSubtitle = subUrl;
                bestSubtitleHeaders = subHeaders;
            }
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("VidZee", "PLAYER", {
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
            sendSupabaseLog("VidZee", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("VidZee", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
