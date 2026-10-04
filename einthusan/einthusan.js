// ==========================================
// ⚙️ SORA MODULE — EINTHUSAN
// ==========================================
// einthusan.tv: South Asian feature films (Tamil, Hindi, Telugu, Malayalam,
// Kannada, Bengali, Marathi, Punjabi), free with ads, on its own CDN.
//
// Catalog: plain HTML, one catalog per language.
//   Search  : /movie/results/?lang=<lang>&query=<q>
//   A film  : /movie/watch/<id>/?lang=<lang>   (summary + the player section)
//
// Playback, as the site's own player does it:
//   1. The watch page carries <html data-pageid="…"> (a masked gorilla/csrf
//      token) and <section id="UIVideoPlayer" data-ejpingables="…">.
//   2. POST /ajax/movie/watch/<id>/?lang=<lang>
//        xEvent=UIVideoPlayer.PingOutcome
//        xJson={"EJOutcomes":"<data-ejpingables>","NativeHLS":false}
//        arcVersion=3, appVersion=59, gorilla.csrf.Token=<data-pageid>
//      with the "_gorilla_csrf" cookie the page token was minted from.
//   3. -> {"Data":{"EJLinks":"<obfuscated>"}}; EJLinks is base64 of
//      {"MP4Link","HLSLink","Datacenter"} once rearranged as
//      s[0:10] + s[last] + s[12:last] (two junk chars dropped).
// The csrf cookie is taken from /robots.txt, the one URL that sets it alone
// (pages also set sid/tid, and some clients keep a single Set-Cookie).
//
// The page's own data-mp4-link is signed the same way but points at a decoy
// IP; with the host swapped for cdnN.einthusan.io it plays too, so it is the
// fallback when the ping fails. The md5 signature does not cover the host:
// the same link works on cdn1, cdn2 and cdn3, offered as three servers.
// The HLS link answers 403 to free users, so it is only kept if it plays.

const EIN_BASE = "https://einthusan.tv";
const EIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EIN_LANGS = ["hindi", "tamil", "telugu", "malayalam", "kannada", "bengali", "marathi", "punjabi"];
const EIN_CDNS = ["cdn1", "cdn2", "cdn3"];

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
    if (!headers["User-Agent"]) headers["User-Agent"] = EIN_UA;
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

function pageHeaders(cookie) {
    const headers = { "User-Agent": EIN_UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": `${EIN_BASE}/` };
    if (cookie) headers["Cookie"] = cookie;
    return headers;
}

async function getPage(url, cookie) {
    return await readBody(await soraFetch(url, { method: 'GET', headers: pageHeaders(cookie) }));
}

// One cookie out of the Set-Cookie header(s), whichever way the client
// exposes them (a single value, several joined by ", ", or an array).
function cookieFrom(response, name) {
    const headers = (response && response.headers) || {};
    let raw = "";
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() !== 'set-cookie') continue;
        const value = headers[key];
        raw += (Array.isArray(value) ? value.join("\n") : String(value)) + "\n";
    }
    const m = raw.match(new RegExp(`(?:^|[\\s,;])${name}=([^;,\\s]+)`));
    return m ? m[1] : "";
}

// ==========================================
// 🧰 HELPERS
// ==========================================

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Decode(input) {
    const clean = String(input || "").replace(/[^A-Za-z0-9+/]/g, "");
    let output = "", buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
        buffer = (buffer << 6) | B64_CHARS.indexOf(clean.charAt(i));
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return utf8Decode(output);
}

// Bytes (as a binary string) -> text.
function utf8Decode(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        const c = bytes.charCodeAt(i);
        if (c < 0x80) { out += String.fromCharCode(c); continue; }
        if (c >= 0xc0 && c < 0xe0 && i + 1 < bytes.length) {
            out += String.fromCharCode(((c & 0x1f) << 6) | (bytes.charCodeAt(++i) & 0x3f));
        } else if (c >= 0xe0 && c < 0xf0 && i + 2 < bytes.length) {
            out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes.charCodeAt(++i) & 0x3f) << 6) | (bytes.charCodeAt(++i) & 0x3f));
        } else if (c >= 0xf0 && i + 3 < bytes.length) {
            const cp = ((c & 0x07) << 18) | ((bytes.charCodeAt(++i) & 0x3f) << 12) | ((bytes.charCodeAt(++i) & 0x3f) << 6) | (bytes.charCodeAt(++i) & 0x3f);
            const v = cp - 0x10000;
            out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
        } else {
            out += String.fromCharCode(c);
        }
    }
    return out;
}

// EJLinks / data-ejpingables: base64 with two junk characters at 10..11 and
// the real 11th character moved to the end.
function unscrambleEj(value) {
    const s = String(value || "");
    if (s.length < 13) return "";
    return base64Decode(s.slice(0, 10) + s.slice(-1) + s.slice(12, -1));
}

function decodeEntities(text) {
    return String(text || "")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function capitalize(text) {
    return String(text || "").charAt(0).toUpperCase() + String(text || "").slice(1);
}

function absolute(url) {
    if (!url) return "";
    if (url.indexOf("//") === 0) return `https:${url}`;
    if (url.charAt(0) === '/') return `${EIN_BASE}${url}`;
    return url;
}

// The summary block shared by the result list and the watch page.
function parseSummaries(html) {
    const items = [];
    const re = /<div class="block1"><a[^>]*href="\/movie\/watch\/([^/]+)\/\?lang=([a-z]*)"[^>]*><img src="([^"]+)"><\/a><\/div><div class="block2"><a class="title"[^>]*><h3>([^<]+)<\/h3>[\s\S]*?<div class="info"><p>(\d{4})?<span>([^<]*)<\/span>/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        items.push({ id: m[1], lang: m[2], image: absolute(m[3]), title: decodeEntities(m[4]).trim(), year: m[5] || "", language: m[6] || "" });
    }
    return items;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchLanguage(lang, keyword) {
    const html = await getPage(`${EIN_BASE}/movie/results/?lang=${lang}&query=${encodeURIComponent(keyword)}`);
    return parseSummaries(html).map(item => ({ ...item, lang: item.lang || lang }));
}

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Einthusan — searching for "${keyword}"`);
    try {
        const query = String(keyword || "").trim();
        if (!query) return JSON.stringify([]);

        // Each language is its own catalog: query them four at a time.
        const found = [];
        for (let i = 0; i < EIN_LANGS.length; i += 4) {
            const batch = await Promise.all(EIN_LANGS.slice(i, i + 4).map(lang => searchLanguage(lang, query).catch(() => [])));
            for (const list of batch) found.push(...list);
        }

        const results = [];
        for (const item of found) {
            const href = `einthusan://movie/${item.lang}/${item.id}`;
            if (results.some(r => r.href === href)) continue;
            const language = item.language || capitalize(item.lang);
            results.push({
                title: item.year ? `${item.title} (${item.year}) · ${language}` : `${item.title} · ${language}`,
                image: item.image,
                href: href
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Einthusan", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Einthusan", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const m = String(url).match(/^einthusan(?:-play)?:\/\/movie\/([a-z]+)\/([^/?#]+)/);
    if (m) return { lang: m[1], id: m[2] };
    const web = String(url).match(/\/movie\/watch\/([^/]+)\/\?lang=([a-z]+)/);
    return web ? { lang: web[2], id: web[1] } : { lang: "hindi", id: String(url) };
}

function watchUrl(ref) {
    return `${EIN_BASE}/movie/watch/${ref.id}/?lang=${ref.lang}`;
}

async function extractDetails(url) {
    const ref = parseHref(url);
    const mediaUrl = watchUrl(ref);
    console.log(`[Details] 📖 Einthusan — ${mediaUrl}`);
    sendSupabaseLog("Einthusan", "DETAILS", { media_url: mediaUrl });

    try {
        const html = await getPage(mediaUrl);
        const summary = (html.match(/<section id="UIMovieSummary">([\s\S]*?)<\/section>/) || [])[1] || html;

        const synopsis = decodeEntities(((summary.match(/<p class="synopsis">([\s\S]*?)<\/p>/) || [])[1] || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
        const year = (summary.match(/<div class="info"><p>(\d{4})/) || [])[1] || "";
        const language = (summary.match(/<div class="info"><p>\d{0,4}<span>([^<]+)<\/span>/) || [])[1] || capitalize(ref.lang);

        const people = [];
        const re = /<div class="prof"><p>([^<]+)<\/p><label>([^<]+)<\/label>/g;
        let m;
        while ((m = re.exec(summary)) !== null) people.push(`${decodeEntities(m[1])} (${decodeEntities(m[2])})`);
        const genre = (html.match(/data-genre="([^"]+)"/) || [])[1] || "";

        const aliasParts = [language];
        if (genre) aliasParts.push(capitalize(genre));
        if (people.length) aliasParts.push(people.join(', '));

        return JSON.stringify([{
            description: synopsis || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: year
        }]);
    } catch (error) {
        sendSupabaseLog("Einthusan", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 Einthusan — ${ref.lang}/${ref.id}`);
    try {
        // A film: a single entry, Sora still expects a list.
        return JSON.stringify([{
            href: `einthusan-play://movie/${ref.lang}/${ref.id}`,
            number: 1,
            season: 1,
            title: "Movie"
        }]);
    } catch (error) {
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// The official ping: returns {MP4Link, HLSLink, Datacenter} or null.
async function pingLinks(ref, html, csrfCookie) {
    const pageId = decodeEntities((html.match(/<html[^>]+data-pageid="([^"]+)"/) || [])[1] || "");
    const pingables = decodeEntities((html.match(/data-ejpingables="([^"]+)"/) || [])[1] || "");
    if (!pageId || !pingables || !csrfCookie) return null;

    const body = [
        `xEvent=UIVideoPlayer.PingOutcome`,
        `xJson=${encodeURIComponent(JSON.stringify({ EJOutcomes: pingables, NativeHLS: false }))}`,
        `arcVersion=3`,
        `appVersion=59`,
        `gorilla.csrf.Token=${encodeURIComponent(pageId)}`
    ].join('&');

    const response = await soraFetch(`${EIN_BASE}/ajax/movie/watch/${ref.id}/?lang=${ref.lang}`, {
        method: 'POST',
        headers: {
            "User-Agent": EIN_UA,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttp" + "Request",
            "Origin": EIN_BASE,
            "Referer": watchUrl(ref),
            "Cookie": `_gorilla_csrf=${csrfCookie}`
        },
        body: body
    });
    const text = await readBody(response);
    let data;
    try { data = JSON.parse(text); } catch (e) { console.log(`   -> Ping refused: ${String(text).slice(0, 80)}`); return null; }
    const payload = data && data.Data;
    if (!payload || typeof payload === 'string') { console.log(`   -> Ping answer: ${payload}`); return null; }
    try { return JSON.parse(unscrambleEj(payload.EJLinks)); } catch (e) { return null; }
}

async function linkIsAlive(url) {
    try {
        const response = await soraFetch(url, { method: 'GET', headers: { "User-Agent": EIN_UA, "Range": "bytes=0-1", "Referer": `${EIN_BASE}/` } });
        if (!response) return false;
        if (typeof response.status === 'number' && (response.status === 0 || response.status >= 400)) return false;
        return true;
    } catch (e) { return false; }
}

async function playlistIsAlive(url) {
    try {
        const response = await soraFetch(url, { method: 'GET', headers: { "User-Agent": EIN_UA, "Referer": `${EIN_BASE}/` } });
        if (typeof response.status === 'number' && response.status >= 400) return false;
        return (await readBody(response)).trim().indexOf('#EXTM3U') === 0;
    } catch (e) { return false; }
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = watchUrl(ref);
    console.log(`[Player] 🎬 Einthusan — ${mediaUrl}`);

    const streams = [];
    const failedLinks = [];

    try {
        // 1. The csrf cookie, minted alone by /robots.txt.
        const robots = await soraFetch(`${EIN_BASE}/robots.txt`, { method: 'GET', headers: { "User-Agent": EIN_UA } });
        const csrfCookie = cookieFrom(robots, "_gorilla_csrf");

        // 2. The watch page, read with that cookie so its token matches.
        const html = await getPage(mediaUrl, csrfCookie ? `_gorilla_csrf=${csrfCookie}` : "");
        if (!html || html.indexOf('UIVideoPlayer') === -1) {
            failedLinks.push({ server_name: "Einthusan", url: mediaUrl, reason: "Watch page without player" });
        }

        // 3. The official links, else the page's own signed link.
        let mp4 = "", hls = "", datacenter = "";
        const links = await pingLinks(ref, html || "", csrfCookie);
        if (links && links.MP4Link) {
            mp4 = links.MP4Link;
            hls = links.HLSLink || "";
            datacenter = links.Datacenter || "";
        } else {
            failedLinks.push({ server_name: "Einthusan ping", url: mediaUrl, reason: csrfCookie ? "Ping refused" : "No csrf cookie" });
            mp4 = decodeEntities((html.match(/data-mp4-link="([^"]+)"/) || [])[1] || "");
        }

        if (mp4) {
            // Same signed path on each CDN node; the ping's node first.
            const path = mp4.replace(/^https?:\/\/[^/]+/, "");
            const firstHost = (mp4.match(/^https?:\/\/(cdn\d+)\.einthusan\.io/) || [])[1] || "";
            const hosts = firstHost ? [firstHost].concat(EIN_CDNS.filter(h => h !== firstHost)) : EIN_CDNS;
            const checks = await Promise.all(hosts.map(h => linkIsAlive(`https://${h}.einthusan.io${path}`)));
            hosts.forEach((host, i) => {
                const streamUrl = `https://${host}.einthusan.io${path}`;
                if (!checks[i]) {
                    failedLinks.push({ server_name: `Einthusan ${host}`, url: streamUrl, reason: "CDN node refused the link" });
                    return;
                }
                const where = host === firstHost && datacenter ? ` (${datacenter})` : "";
                streams.push({
                    title: `Einthusan ${host.toUpperCase()}${where} · MP4 · ${capitalize(ref.lang)}`,
                    streamUrl: streamUrl,
                    headers: { "User-Agent": EIN_UA, "Referer": `${EIN_BASE}/`, "Origin": EIN_BASE }
                });
            });
        }

        if (hls && await playlistIsAlive(hls)) {
            streams.push({
                title: `Einthusan HLS · ${capitalize(ref.lang)}`,
                streamUrl: hls,
                headers: { "User-Agent": EIN_UA, "Referer": `${EIN_BASE}/`, "Origin": EIN_BASE }
            });
        } else if (hls) {
            failedLinks.push({ server_name: "Einthusan HLS", url: hls, reason: "HLS refused (premium only)" });
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s).`);

        sendSupabaseLog("Einthusan", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: "1",
            streams_found: streams.length,
            subtitles_found: false,
            allSubtitles_count: 0,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("Einthusan", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: "1", ep_number: "1",
                failed_count: failedLinks.length, failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: "",
            subtitlesHeaders: {},
            allSubtitles: []
        });
    } catch (error) {
        sendSupabaseLog("Einthusan", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
