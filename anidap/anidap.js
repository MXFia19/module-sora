// ==========================================
// ⚙️ SORA MODULE — ANIDAP
// ==========================================
// anidap.lol is a React Router front-end whose catalogue and playback both
// come from its own open services; nothing is encrypted on the way.
//
//   1. Catalogue  POST https://graphql.anidap.lol/graphql
//                 searchAnime(query) / anime(id) -> {id: "<slug>", anilistId, …}
//                 The slug ("one-piece-p8k27") is Anidap's own key: the
//                 playback API answers "anime not found" to a bare AniList id.
//   2. Episodes   GET https://chad.anidap.lol/rest/api/episodes?id=<slug>
//                 -> [{number, titles:{en}, hasSub, hasDub, isFiller}]
//   3. Servers    GET https://chad.anidap.lol/rest/api/servers?id=<slug>&epNum=<n>
//                 -> {subProviders:[{id,tip}], dubProviders:[{id,tip}]}
//                 (yuki = MegaPlay, zuna = Zoko, sora = KickAssAnime, …)
//   4. Sources    GET https://chad.anidap.lol/rest/api/sources?id=<slug>&epNum=<n>
//                                               &type=<sub|dub>&providerId=<id>
//                 -> {sources:[{url,quality}], tracks:[{url,label,kind}],
//                     headers:{Referer, Origin?, User-Agent?}, chapters}
//                 The upstream urls play directly as long as the headers the
//                 API names are sent with them, so they are returned as-is.
//
// The site's player can also wrap a link in its relay
//   https://cdnx.aniwatchtv.site/uwu/<base64url(xor(url \0 referer, KEY))>
// (repeating-key XOR, key in its bundle). It is offered as a backup stream
// for the links whose CDN insists on headers some players drop.

const AD_SITE = "https://anidap.lol";
const AD_GRAPHQL = "https://graphql.anidap.lol/graphql";
const AD_REST = "https://chad.anidap.lol/rest/api";
const AD_RELAY = "https://cdnx.aniwatchtv.site/uwu/";
const AD_RELAY_KEY = "10b06cdc1ca48c9fb0b94af97cc040cf";

const AD_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Display names for the provider ids the API hands out.
const AD_PROVIDER_NAMES = {
    yuki: "Yuki", zuna: "Zuna", sora: "Sora", shiro: "Shiro", vee: "Vee",
    uwu: "Uwu", kiwi: "Kiwi", miku: "Miku", neko: "Neko", mochi: "Mochi", beep: "Beep"
};

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
    if (!headers["User-Agent"]) headers["User-Agent"] = AD_UA;
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

async function adGraphql(query, variables) {
    const headers = {
        "User-Agent": AD_UA,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": AD_SITE,
        "Referer": `${AD_SITE}/`
    };
    const body = JSON.stringify({ query: query, variables: variables || {} });
    const text = await readBody(await soraFetch(AD_GRAPHQL, { method: 'POST', headers: headers, body: body }));
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && parsed.data ? parsed.data : null;
    } catch (e) { return null; }
}

// The REST service checks the Origin (it answers with a CORS header bound to
// anidap.lol), so the requests present themselves as the site.
async function adRest(path) {
    const headers = {
        "User-Agent": AD_UA,
        "Accept": "application/json",
        "Origin": AD_SITE,
        "Referer": `${AD_SITE}/`
    };
    const text = await readBody(await soraFetch(`${AD_REST}${path}`, { method: 'GET', headers: headers }));
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
// 🔐 RELAY LINK (pure JS, no btoa)
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

// Same packing as the site's player: utf8(url) 0x00 utf8(referer), XORed
// byte by byte with the repeating key, then base64url without padding.
function relayUrl(url, referer) {
    const bytes = utf8Bytes(url).concat([0], utf8Bytes(referer || ""));
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= AD_RELAY_KEY.charCodeAt(i % AD_RELAY_KEY.length);
    return AD_RELAY + base64UrlFromBytes(bytes);
}

// ==========================================
// 🔍 SEARCH
// ==========================================

const SEARCH_QUERY = `query ($q: String, $limit: Int) {
  searchAnime(query: $q, limit: $limit, includeAdult: false) {
    items { id anilistId titleEnglish titleRomaji coverImage seasonYear format episodeCount }
  }
}`;

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Anidap — searching for "${keyword}"`);
    try {
        const data = await adGraphql(SEARCH_QUERY, { q: keyword, limit: 30 });
        const items = data && data.searchAnime && Array.isArray(data.searchAnime.items) ? data.searchAnime.items : [];

        const results = [];
        for (const item of items) {
            if (!item || !item.id) continue;
            const name = item.titleEnglish || item.titleRomaji || item.id;
            const cover = item.coverImage || {};
            const badge = [item.format, item.seasonYear].filter(Boolean).join(' · ');
            results.push({
                title: badge ? `${name} (${badge})` : name,
                image: cover.extraLarge || cover.large || cover.medium || "",
                href: `anidap://${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Anidap", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Anidap", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

const DETAILS_QUERY = `query ($id: String) {
  anime(id: $id) {
    id anilistId malId titleEnglish titleRomaji description status format
    episodeCount seasonYear season genres averageScore
  }
}`;

function slugFrom(url) {
    return String(url).replace('anidap://', '').replace('anidap-play://', '').split('/')[0];
}

async function extractDetails(url) {
    const slug = slugFrom(url);
    console.log(`[Details] 📖 Anidap — ${slug}`);
    sendSupabaseLog("Anidap", "DETAILS", { media_url: `${AD_SITE}/info/${slug}` });

    try {
        const data = await adGraphql(DETAILS_QUERY, { id: slug });
        const anime = data && data.anime ? data.anime : null;
        if (!anime) {
            return JSON.stringify([{ description: 'Entry not found on Anidap.', aliases: '', airdate: '' }]);
        }

        const aliasParts = [];
        if (anime.titleRomaji && anime.titleRomaji !== anime.titleEnglish) aliasParts.push(anime.titleRomaji);
        if (anime.averageScore) aliasParts.push(`Score: ${anime.averageScore}/100`);
        if (Array.isArray(anime.genres) && anime.genres.length) aliasParts.push(anime.genres.join(', '));
        if (anime.episodeCount) aliasParts.push(`${anime.episodeCount} episode(s)`);

        const season = [anime.season, anime.seasonYear].filter(Boolean).join(' ');
        const airdate = [season, anime.status].filter(Boolean).join(' · ');

        return JSON.stringify([{
            description: cleanText(anime.description) || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("Anidap", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const slug = slugFrom(url);
    console.log(`[Episodes] 📂 Anidap — ${slug}`);

    try {
        const data = await adRest(`/episodes?id=${encodeURIComponent(slug)}`);
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);

        const episodes = [];
        for (const row of list) {
            if (!row || typeof row.number !== 'number') continue;
            // The player hides the rows that have neither track.
            if (row.hasSub === false && row.hasDub === false) continue;
            const title = row.titles && (row.titles.en || row.titles['x-jat']) ? (row.titles.en || row.titles['x-jat']) : `Episode ${row.number}`;
            episodes.push({
                href: `anidap-play://${slug}/${row.number}`,
                number: row.number,
                season: 1,
                title: title
            });
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Anidap", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function providerName(id) {
    const key = String(id || '').toLowerCase();
    return AD_PROVIDER_NAMES[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Anidap");
}

// Headers the API asks for, plus a User-Agent when it names none.
function streamHeaders(apiHeaders) {
    const headers = {};
    const source = apiHeaders && typeof apiHeaders === 'object' ? apiHeaders : {};
    for (const key of Object.keys(source)) {
        const lower = key.toLowerCase();
        if (lower === 'referer') headers["Referer"] = source[key];
        else if (lower === 'origin') headers["Origin"] = source[key];
        else if (lower === 'user-agent') headers["User-Agent"] = source[key];
    }
    if (!headers["User-Agent"]) headers["User-Agent"] = AD_UA;
    return headers;
}

// Subtitle urls sometimes come with a doubled slash after the scheme
// ("https:///subbl…"); normalise them.
function fixUrl(url) {
    if (!url) return "";
    return String(url).replace(/^(https?:)\/{3,}/i, '$1//').replace(/^http:\/\//i, 'https://');
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const parts = String(url).replace('anidap-play://', '').split('/');
    const slug = parts[0];
    const epNumber = parts.length > 1 ? parts[1] : '1';
    const mediaUrl = `${AD_SITE}/watch?id=${slug}&ep=${epNumber}`;

    console.log(`[Player] 🎬 Anidap — ${slug}, episode ${epNumber}`);

    const streams = [];
    const backups = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const servers = await adRest(`/servers?id=${encodeURIComponent(slug)}&epNum=${encodeURIComponent(epNumber)}`);
        const tracks = [];
        const addProviders = (list, type) => {
            if (!Array.isArray(list)) return;
            for (const entry of list) {
                const id = typeof entry === 'string' ? entry : (entry && entry.id);
                if (id) tracks.push({ id: id, type: type });
            }
        };
        if (servers) {
            addProviders(servers.subProviders, 'sub');
            addProviders(servers.dubProviders, 'dub');
        }
        // The servers endpoint can come back empty for a moment; the default
        // provider still answers in that case.
        if (tracks.length === 0) tracks.push({ id: 'yuki', type: 'sub' }, { id: 'yuki', type: 'dub' });

        console.log(`[Player] 🧩 ${tracks.length} provider/track pair(s)`);

        for (const track of tracks) {
            const path = `/sources?id=${encodeURIComponent(slug)}&epNum=${encodeURIComponent(epNumber)}&type=${track.type}&providerId=${encodeURIComponent(track.id)}`;
            const raw = await adRest(path);
            const data = raw && raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw;
            const label = `${providerName(track.id)} · ${track.type === 'dub' ? 'Dub' : 'Sub'}`;

            if (!data || !Array.isArray(data.sources) || data.sources.length === 0) {
                failedLinks.push({ server_name: label, url: `${AD_REST}${path}`, reason: (raw && raw.error) || "No source returned" });
                continue;
            }

            const headers = streamHeaders(data.headers);
            for (const source of data.sources) {
                const streamUrl = fixUrl(source && source.url);
                if (!streamUrl || streams.some(s => s.streamUrl === streamUrl)) continue;
                const quality = source.quality && source.quality !== 'auto' ? ` ${source.quality}` : "";
                streams.push({ title: `Anidap ${label}${quality}`, streamUrl: streamUrl, headers: headers });
                console.log(`   -> ${label}: ${streamUrl.slice(0, 80)}…`);

                // Relay copy: needs no header at all, the relay sends the referer.
                if (/\.m3u8|mpegurl/i.test(streamUrl + ' ' + (source.type || ''))) {
                    backups.push({
                        title: `Anidap ${label}${quality} (relay)`,
                        streamUrl: relayUrl(streamUrl, headers["Referer"] || `${AD_SITE}/`),
                        headers: { "User-Agent": AD_UA, "Referer": `${AD_SITE}/`, "Origin": AD_SITE }
                    });
                }
            }

            const subtitleList = Array.isArray(data.tracks) ? data.tracks : (Array.isArray(data.subtitles) ? data.subtitles : []);
            for (const caption of subtitleList) {
                const subUrl = fixUrl(caption && (caption.url || caption.file));
                if (!subUrl) continue;
                const kind = String(caption.kind || 'captions').toLowerCase();
                const lang = String(caption.label || caption.lang || '').toLowerCase();
                if (kind === 'thumbnails' || lang === 'thumbnails') continue;
                if (allSubtitles.some(s => s.url === subUrl)) continue;
                const subHeaders = { "Referer": headers["Referer"] || `${AD_SITE}/`, "User-Agent": AD_UA };
                allSubtitles.push({
                    url: subUrl,
                    label: caption.label || caption.lang || "Unknown",
                    kind: "captions",
                    headers: subHeaders
                });
                if (bestSubtitle === "" && (lang.indexOf('english') !== -1 || lang === 'en' || caption.default)) {
                    bestSubtitle = subUrl;
                    bestSubtitleHeaders = subHeaders;
                }
            }
        }

        if (bestSubtitle === "" && allSubtitles.length > 0) {
            bestSubtitle = allSubtitles[0].url;
            bestSubtitleHeaders = allSubtitles[0].headers;
        }

        // Direct links first, relayed copies after them.
        for (const backup of backups) {
            if (!streams.some(s => s.streamUrl === backup.streamUrl)) streams.push(backup);
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("Anidap", "PLAYER", {
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
            sendSupabaseLog("Anidap", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("Anidap", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
