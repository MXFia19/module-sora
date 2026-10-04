// ==========================================
// ⚙️ SORA MODULE — LUFFYTV
// ==========================================
// luffytv.live (mirror luffytv.online) is a Next.js aggregator keyed by
// AniList id. Its server-side API scrapes several anime sources per episode
// and hands back links that already go through its own relay, so the module
// only talks to luffytv.live.
//
//   1. Search    GET /api/anime/search?q=<text>&page=1   -> {results:[AniList-like]}
//   2. Entry     GET /api/anime/info?id=<anilistId>       -> {anilistInfo:{…}}
//   3. Episodes  GET /api/anime/episodes?id=<anilistId>   -> {episodes:[{episodeIdNum}]}
//                (its episode titles are shifted, so only numbers are used)
//   4. Servers   GET /api/anime/<provider>-servers/<anilistId>/<ep>
//                provider = anikoto (?fast=1), anipm, aniwaves, xanime, kototv,
//                           shiro, anibd, animeparadise
//                -> {servers:[{name, type:"sub"|"dub", hardsub, isEmbed,
//                              streamUrl, megaplayFileId?, subtitleTracks}]}
//                streamUrl is "/p/<token>" (relative or absolute): the relay.
//   5. MegaPlay  The "anikoto" rows point at a MegaPlay embed plus a
//                megaplayFileId; the player resolves it with
//                GET /api/megaplay-sources?fileId=<id> -> {m3u8Url, tracks}
//                and wraps the m3u8 in the relay itself.
//
// Relay token (same scheme as the site's player, key in its bundle):
//   /p/<base64url(xor(utf8(url) 0x00 utf8(referer), KEY))>
// The relay then fetches the upstream with that referer and rewrites the
// playlist, so the player needs no special header.

const LT_BASE = "https://luffytv.live";
const LT_RELAY_KEY = "10b06cdc1ca48c9fb0b94af97cc040cf";

const LT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Providers queried per episode. The "slow" ones are resolved server side
// through long chains (animeparadise ~15 s, anibd up to 45 s on the site's own
// timer): they are only waited for when the fast ones found nothing, and are
// otherwise kept if they have already answered.
const LT_PROVIDERS = [
    { id: "anikoto", label: "AniKoto", query: "?fast=1" },
    { id: "anipm", label: "Ani.pm", query: "" },
    { id: "aniwaves", label: "AniWaves", query: "" },
    { id: "xanime", label: "Xanime", query: "" },
    { id: "kototv", label: "KotoTV", query: "" },
    { id: "shiro", label: "Shiro", query: "" },
    { id: "anibd", label: "AniBD", query: "", slow: true },
    { id: "animeparadise", label: "AnimeParadise", query: "", slow: true }
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
    // the caller did not set one.
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = LT_UA;
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

async function ltGetJson(path, referer) {
    const headers = {
        "User-Agent": LT_UA,
        "Accept": "application/json",
        "Referer": referer || `${LT_BASE}/`
    };
    const text = await readBody(await soraFetch(`${LT_BASE}${path}`, { method: 'GET', headers: headers }));
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
}

function absolute(url) {
    if (!url) return "";
    const s = String(url);
    if (s.charAt(0) === '/' && s.charAt(1) !== '/') return `${LT_BASE}${s}`;
    if (s.indexOf('//') === 0) return `https:${s}`;
    return s;
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
// 🔐 RELAY TOKEN (pure JS, no btoa)
// ==========================================

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(text) {
    const out = [];
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
        let code = s.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
            const low = s.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                i++;
            }
        }
        if (code < 0x80) out.push(code);
        else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
        else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return out;
}

function base64UrlFromBytes(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        const triple = (a << 16) | (b << 8) | c;
        out += B64_ALPHABET[(triple >> 18) & 63] + B64_ALPHABET[(triple >> 12) & 63];
        out += i + 1 < bytes.length ? B64_ALPHABET[(triple >> 6) & 63] : "";
        out += i + 2 < bytes.length ? B64_ALPHABET[triple & 63] : "";
    }
    return out.replace(/\+/g, '-').replace(/\//g, '_');
}

function relayUrl(url, referer) {
    const bytes = utf8Bytes(url).concat([0], utf8Bytes(referer || ""));
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= LT_RELAY_KEY.charCodeAt(i % LT_RELAY_KEY.length);
    return `${LT_BASE}/p/${base64UrlFromBytes(bytes)}`;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 LuffyTV — searching for "${keyword}"`);
    try {
        const data = await ltGetJson(`/api/anime/search?q=${encodeURIComponent(keyword)}&page=1`);
        const items = data && Array.isArray(data.results) ? data.results : [];

        const results = [];
        for (const item of items) {
            if (!item || !item.id) continue;
            const t = item.title || {};
            const name = t.english || t.romaji || t.native || `AniList ${item.id}`;
            const cover = item.coverImage || {};
            const badge = [item.format, item.seasonYear].filter(Boolean).join(' · ');
            results.push({
                title: badge ? `${name} (${badge})` : name,
                image: absolute(cover.extraLarge || cover.large || cover.medium || ""),
                href: `luffytv://${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("LuffyTV", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("LuffyTV", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function idFrom(url) {
    return String(url).replace('luffytv://', '').replace('luffytv-play://', '').split('/')[0];
}

async function extractDetails(url) {
    const anilistId = idFrom(url);
    console.log(`[Details] 📖 LuffyTV — AniList ${anilistId}`);
    sendSupabaseLog("LuffyTV", "DETAILS", { media_url: `${LT_BASE}/anime/${anilistId}` });

    try {
        const data = await ltGetJson(`/api/anime/info?id=${encodeURIComponent(anilistId)}`);
        const info = data && (data.anilistInfo || data.anime) ? (data.anilistInfo || data.anime) : null;
        if (!info) {
            return JSON.stringify([{ description: 'Entry not found on LuffyTV.', aliases: '', airdate: '' }]);
        }

        const t = info.title || {};
        const aliasParts = [];
        const alt = [t.romaji, t.native].filter(n => n && n !== t.english);
        if (alt.length) aliasParts.push(alt.join(' · '));
        if (info.averageScore) aliasParts.push(`Score: ${info.averageScore}/100`);
        if (Array.isArray(info.genres) && info.genres.length) aliasParts.push(info.genres.join(', '));

        let airdate = info.seasonYear ? `${info.season || ''} ${info.seasonYear}`.trim() : "";
        const start = info.startDate;
        if (start && start.year && start.month && start.day) {
            airdate = `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
        }
        if (info.status) airdate = airdate ? `${airdate} · ${info.status}` : info.status;

        return JSON.stringify([{
            description: cleanText(info.description) || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("LuffyTV", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const anilistId = idFrom(url);
    console.log(`[Episodes] 📂 LuffyTV — AniList ${anilistId}`);

    try {
        const numbers = [];
        const data = await ltGetJson(`/api/anime/episodes?id=${encodeURIComponent(anilistId)}`);
        const list = data && Array.isArray(data.episodes) ? data.episodes : [];
        for (const row of list) {
            const n = Number(row && (row.episodeIdNum != null ? row.episodeIdNum : row.number));
            if (isFinite(n) && n > 0 && numbers.indexOf(n) === -1) numbers.push(n);
        }

        // No list (fresh or obscure entry): fall back on AniList's count.
        if (numbers.length === 0) {
            const info = await ltGetJson(`/api/anime/info?id=${encodeURIComponent(anilistId)}`);
            const media = info && info.anilistInfo ? info.anilistInfo : null;
            let total = 0;
            if (media && typeof media.episodes === 'number' && media.episodes > 0) total = media.episodes;
            else if (media && media.nextAiringEpisode && media.nextAiringEpisode.episode > 1) total = media.nextAiringEpisode.episode - 1;
            if (total <= 0) total = 1;
            for (let n = 1; n <= total; n++) numbers.push(n);
        }

        numbers.sort((a, b) => a - b);
        const episodes = numbers.map(n => ({
            href: `luffytv-play://${anilistId}/${n}`,
            number: n,
            season: 1,
            title: `Episode ${n}`
        }));

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("LuffyTV", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function fetchProvider(provider, anilistId, epNumber, referer) {
    try {
        const data = await ltGetJson(`/api/anime/${provider.id}-servers/${anilistId}/${epNumber}${provider.query}`, referer);
        return { provider: provider, servers: data && Array.isArray(data.servers) ? data.servers : [] };
    } catch (e) {
        return { provider: provider, servers: [] };
    }
}

async function resolveMegaplay(fileId, referer) {
    const data = await ltGetJson(`/api/megaplay-sources?fileId=${encodeURIComponent(fileId)}`, referer);
    if (!data || !data.m3u8Url) return null;
    return data;
}

function trackLabel(server) {
    const type = String(server.type || 'sub').toLowerCase() === 'dub' ? 'Dub' : 'Sub';
    return server.hardsub ? `${type} (hardsub)` : type;
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const parts = String(url).replace('luffytv-play://', '').split('/');
    const anilistId = parts[0];
    const epNumber = parts.length > 1 ? parts[1] : '1';
    const referer = `${LT_BASE}/watch/${anilistId}?ep=${epNumber}`;
    const mediaUrl = referer;

    console.log(`[Player] 🎬 LuffyTV — AniList ${anilistId}, episode ${epNumber}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};
    const relayHeaders = { "Referer": `${LT_BASE}/`, "Origin": LT_BASE, "User-Agent": LT_UA };

    const addSubtitle = (rawUrl, label) => {
        const subUrl = absolute(rawUrl);
        if (!subUrl || allSubtitles.some(s => s.url === subUrl)) return;
        allSubtitles.push({ url: subUrl, label: label || "Unknown", kind: "captions", headers: relayHeaders });
    };

    try {
        // All providers at once: each one is an independent scrape. There is
        // no timer in the runtime, so the slow ones are tracked by a flag set
        // when they settle instead of by a timeout.
        const pending = LT_PROVIDERS.map(p => {
            const entry = { provider: p, done: false, value: null };
            entry.promise = fetchProvider(p, anilistId, epNumber, referer).then(v => { entry.done = true; entry.value = v; return v; });
            return entry;
        });
        const fast = pending.filter(e => !e.provider.slow);
        const slow = pending.filter(e => e.provider.slow);
        await Promise.all(fast.map(e => e.promise));
        const fastFound = fast.some(e => e.value && e.value.servers.some(s => s && !s.isEmbed));
        if (!fastFound) await Promise.all(slow.map(e => e.promise));

        const answers = [];
        for (const entry of pending) {
            if (entry.done) answers.push(entry.value);
            else failedLinks.push({ server_name: entry.provider.label, url: `${LT_BASE}/api/anime/${entry.provider.id}-servers/${anilistId}/${epNumber}`, reason: "Still resolving, skipped" });
        }

        for (const answer of answers) {
            const provider = answer.provider;
            if (!answer.servers.length) {
                failedLinks.push({ server_name: provider.label, url: `${LT_BASE}/api/anime/${provider.id}-servers/${anilistId}/${epNumber}`, reason: "No server returned" });
                continue;
            }

            for (const server of answer.servers) {
                if (!server || server.isEmbed) continue;
                const label = `${provider.label} · ${trackLabel(server)}`;
                let streamUrl = "";

                if (server.megaplayFileId) {
                    const mega = await resolveMegaplay(server.megaplayFileId, referer);
                    if (mega) {
                        streamUrl = relayUrl(mega.m3u8Url, "https://megaplay.buzz/");
                        for (const track of (mega.tracks || [])) {
                            const kind = String(track.kind || 'captions').toLowerCase();
                            if (!track.file || kind === 'thumbnails') continue;
                            addSubtitle(`/api/stream?url=${encodeURIComponent(track.file)}&referer=${encodeURIComponent("https://megaplay.buzz/")}`, track.label);
                        }
                    } else {
                        failedLinks.push({ server_name: label, url: `${LT_BASE}/api/megaplay-sources?fileId=${server.megaplayFileId}`, reason: "MegaPlay file not resolved" });
                        continue;
                    }
                } else {
                    streamUrl = absolute(server.streamUrl);
                    // A raw upstream link: hand it to the relay like the site does.
                    if (streamUrl && streamUrl.indexOf(`${LT_BASE}/`) !== 0) {
                        streamUrl = relayUrl(streamUrl, `${LT_BASE}/`);
                    }
                }

                if (!streamUrl || streams.some(s => s.streamUrl === streamUrl)) continue;
                const quality = server.quality ? ` ${server.quality}` : "";
                streams.push({ title: `LuffyTV ${label}${quality}`, streamUrl: streamUrl, headers: relayHeaders });
                console.log(`   -> ${label}: ${streamUrl.slice(0, 80)}…`);

                for (const track of (server.subtitleTracks || [])) {
                    if (track && track.url) addSubtitle(track.url, track.label || track.lang);
                }
            }
        }

        const english = allSubtitles.find(s => /english|^en$/i.test(s.label)) || allSubtitles[0];
        if (english) {
            bestSubtitle = english.url;
            bestSubtitleHeaders = english.headers;
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("LuffyTV", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: String(epNumber),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("LuffyTV", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl,
                season_number: "1",
                ep_number: String(epNumber),
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
        sendSupabaseLog("LuffyTV", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
