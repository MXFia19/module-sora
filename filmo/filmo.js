// ==========================================
// ⚙️ SORA MODULE — FILMO
// ==========================================
// Filmo (filmo.to) is a movie-only catalogue (Laravel) with its own search and
// detail pages. Each movie page lists "provider chips" grouped by language
// (English, Deutsch, …), every chip carrying an opaque, server-encrypted
// data-p blob. Opening a chip is a two-step mint:
//   POST /n  {"p": <data-p>}   (X-CSRF-TOKEN from <meta name=csrf-token> and
//                               the filmo-session cookie of the same page)
//     -> {"x": <one-time token>}
//   GET  /n/<x>  -> 302 to the host embed (voe.sx/e/<id>…)
// Filmo only uses two hosts, VOE and Byse. VOE is decoded locally:
//   voe.sx/e/<id> -> JS redirect to a rotating mirror -> /access/<token> page
//   whose <script type="application/json"> holds the obfuscated player config:
//   ROT13 -> strip junk markers -> base64 -> char-3 shift -> reverse -> base64
//   -> {source: master.m3u8, direct_access_url: mp4, …}
// Byse needs a WebCrypto attestation + proof-of-work captcha and is skipped.

const FILMO = "https://filmo.to";
const FM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
// Filmo defaults to German; English titles and synopses come with this header.
const FM_LANG = "en-US,en;q=0.9";

// At most this many VOE chips are opened per movie (each costs ~4 requests).
const FM_MAX_CHIPS = 4;

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
    if (!headers["User-Agent"]) headers["User-Agent"] = FM_UA;
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

async function getPage(url, extra) {
    const headers = { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": FM_LANG, ...(extra || {}) };
    const response = await soraFetch(url, { method: 'GET', headers: headers });
    return { response: response, html: await readBody(response) };
}

// Collects every Set-Cookie value a response exposes (header names differ in
// case between clients, and several cookies may be folded into one string).
function cookieValue(response, name) {
    if (!response || !response.headers) return "";
    const h = response.headers;
    const values = [];
    try {
        if (typeof h.forEach === 'function' && typeof h.get === 'function') {
            h.forEach((v, k) => { if (String(k).toLowerCase() === 'set-cookie') values.push(String(v)); });
        } else {
            for (const k in h) if (String(k).toLowerCase() === 'set-cookie') values.push(Array.isArray(h[k]) ? h[k].join(', ') : String(h[k]));
        }
    } catch (e) { }
    const re = new RegExp(`(?:^|[\\s,;])${name.replace(/[-]/g, '\\-')}=([^;,\\s]+)`);
    for (const v of values) {
        const m = (' ' + v).match(re);
        if (m) return m[1];
    }
    return "";
}

function decodeEntities(s) {
    return String(s || "")
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&amp;/g, '&');
}

function stripTags(s) {
    return decodeEntities(String(s || "").replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Pure-JS base64 → binary string (atob is not guaranteed in the runtime).
function b64decode(input) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const str = String(input).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    let out = '', buffer = 0, bits = 0;
    for (let i = 0; i < str.length; i++) {
        buffer = (buffer << 6) | chars.indexOf(str.charAt(i));
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return out;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

function slugFromUrl(url) {
    const m = String(url).match(/\/movies\/([^/?#]+)/);
    return m ? m[1] : String(url).replace(/^filmo:\/\/(play\/)?/, '');
}

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Filmo — searching for "${keyword}"`);
    try {
        const { html } = await getPage(`${FILMO}/search?q=${encodeURIComponent(keyword)}`);
        const results = [];
        const seen = {};
        const cardRe = /<article[^>]*>([\s\S]*?)<\/article>/g;
        let m;
        while ((m = cardRe.exec(html)) !== null) {
            const card = m[1];
            const link = card.match(/href="(https:\/\/filmo\.to\/movies\/[^"]+)"/);
            if (!link || seen[link[1]]) continue;
            const title = card.match(/__title[^"]*">([^<]+)</);
            const img = card.match(/<img[^>]+src="([^"]+)"/);
            seen[link[1]] = true;
            results.push({
                title: title ? decodeEntities(title[1]).trim() : slugFromUrl(link[1]).replace(/-/g, ' '),
                image: img ? decodeEntities(img[1]) : "",
                href: link[1]
            });
        }

        // The JSON suggester as a fallback (titles only).
        if (results.length === 0) {
            const response = await soraFetch(`${FILMO}/search/suggest?q=${encodeURIComponent(keyword)}`, {
                headers: { "Accept": "application/json", "X-Requested-With": "XMLHttp" + "Request", "Accept-Language": FM_LANG }
            });
            let data = null;
            try { data = JSON.parse(await readBody(response)); } catch (e) { }
            for (const movie of (data && data.movies) || []) {
                if (!movie || !movie.url || seen[movie.url]) continue;
                seen[movie.url] = true;
                results.push({ title: movie.title, image: "", href: movie.url });
            }
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Filmo", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Filmo", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function moviePageUrl(url) {
    return `${FILMO}/movies/${slugFromUrl(url)}`;
}

async function extractDetails(url) {
    const pageUrl = moviePageUrl(url);
    console.log(`[Details] 📖 Filmo — ${pageUrl}`);
    sendSupabaseLog("Filmo", "DETAILS", { media_url: pageUrl });

    try {
        const { html } = await getPage(pageUrl);
        const synopsis = html.match(/<p[^>]*movie-detail-synopsis[^>]*>([\s\S]*?)<\/p>/);
        const meta = html.match(/<meta name="description" content="([^"]*)"/);
        const description = synopsis ? stripTags(synopsis[1]) : (meta ? decodeEntities(meta[1]) : "No synopsis available.");

        const year = (html.match(/ft-meta-label[^>]*>\s*((?:19|20)\d{2})\s*</) || [])[1] || "";
        const genres = [];
        const genreRe = /href="https:\/\/filmo\.to\/genres\/[^"]+"[^>]*>([^<]+)</g;
        let g;
        while ((g = genreRe.exec(html)) !== null && genres.length < 4) {
            const name = decodeEntities(g[1]).trim();
            if (name && genres.indexOf(name) === -1) genres.push(name);
        }

        return JSON.stringify([{
            description: description || "No synopsis available.",
            aliases: genres.join(', '),
            airdate: year
        }]);
    } catch (error) {
        sendSupabaseLog("Filmo", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    // Movies only: a single entry pointing back at the movie page.
    return JSON.stringify([{ href: moviePageUrl(url), number: 1, season: 1, title: "Movie" }]);
}

// ==========================================
// 🎞️ HOST: VOE
// ==========================================

function voeDecode(html) {
    try {
        const json = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (!json) return null;
        const data = JSON.parse(json[1].trim());
        const packed = Array.isArray(data) ? data[0] : data;
        if (typeof packed !== 'string') return null;

        const rot13 = packed.replace(/[a-zA-Z]/g, c => {
            const base = c <= 'Z' ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });
        let cleaned = rot13;
        ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(p => { cleaned = cleaned.split(p).join(""); });
        const shifted = b64decode(cleaned).split("").map(c => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
        const result = JSON.parse(b64decode(shifted.split("").reverse().join("")));
        return result && typeof result === 'object' ? result : null;
    } catch (e) {
        return null;
    }
}

// Follows VOE's landing page (a JS redirect to whatever mirror is current) to
// the player page, then decodes it.
async function voeResolve(landingHtml) {
    let html = landingHtml || "";
    let pageUrl = "";
    for (let hop = 0; hop < 2 && html && html.indexOf('application/json') === -1; hop++) {
        const next = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (!next) break;
        pageUrl = next[1];
        html = (await getPage(pageUrl, { "Referer": `${FILMO}/` })).html;
    }
    const config = voeDecode(html);
    if (!config) return null;
    const origin = (pageUrl.match(/^https?:\/\/[^/]+/) || [""])[0];
    return { config: config, origin: origin };
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// Provider rows: [{ language, chips: [{ name, tags, p }] }]
function parseProviders(html) {
    const rows = [];
    const blocks = html.split(/<div class="provider-row">/).slice(1);
    for (const block of blocks) {
        const lang = (block.match(/provider-row__lang">([^<]+)</) || [])[1] || "";
        const chips = [];
        const chipRe = /<div[^>]*data-provider-chip[^>]*data-p="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*data-provider-chip|<\/div>)/g;
        let c;
        while ((c = chipRe.exec(block)) !== null) {
            const tags = [];
            const tagRe = /provider-chip__metadata-tag">([^<]+)</g;
            let t;
            while ((t = tagRe.exec(c[3])) !== null) tags.push(decodeEntities(t[1]).trim());
            chips.push({ p: c[1], name: decodeEntities(c[2]).trim(), tags: tags });
        }
        rows.push({ language: decodeEntities(lang).trim(), chips: chips });
    }
    return rows;
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const pageUrl = moviePageUrl(url);
    console.log(`[Player] 🎬 Filmo — ${pageUrl}`);

    const streams = [];
    const failedLinks = [];

    try {
        const { response, html } = await getPage(pageUrl);
        const csrf = (html.match(/<meta name="csrf-token" content="([^"]+)"/) || [])[1] || "";
        const session = cookieValue(response, 'filmo-session');
        const xsrf = cookieValue(response, 'XSRF-TOKEN');
        let cookie = [session ? `filmo-session=${session}` : "", xsrf ? `XSRF-TOKEN=${xsrf}` : ""].filter(Boolean).join('; ');

        const rows = parseProviders(html);
        // English first, then the other languages; VOE only (Byse is skipped).
        rows.sort((a, b) => (/english/i.test(b.language) ? 1 : 0) - (/english/i.test(a.language) ? 1 : 0));

        const picks = [];
        for (const row of rows) {
            for (const chip of row.chips) {
                if (/^voe$/i.test(chip.name)) picks.push({ language: row.language, chip: chip });
                else failedLinks.push({ server_name: chip.name, url: pageUrl, reason: `${chip.name} (${row.language}) not supported` });
            }
        }

        for (const pick of picks.slice(0, FM_MAX_CHIPS)) {
            let label = `VOE · ${pick.language || 'Unknown'}${pick.chip.tags.length ? ` (${pick.chip.tags.join(' ')})` : ''}`;
            try {
                const headers = {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttp" + "Request",
                    "X-CSRF-TOKEN": csrf,
                    "Referer": pageUrl,
                    "Origin": FILMO,
                    "Accept-Language": FM_LANG
                };
                if (cookie) headers["Cookie"] = cookie;
                const minted = await soraFetch(`${FILMO}/n`, { method: 'POST', headers: headers, body: JSON.stringify({ p: pick.chip.p }) });
                let token = "";
                try { token = (JSON.parse(await readBody(minted)) || {}).x || ""; } catch (e) { }
                if (!token) {
                    failedLinks.push({ server_name: label, url: pageUrl, reason: "Mint refused (CSRF/session)" });
                    continue;
                }
                // The token is only valid for the session that minted it (the
                // session cookie may have been rotated by the POST).
                const rotated = cookieValue(minted, 'filmo-session');
                if (rotated) cookie = `filmo-session=${rotated}${xsrf ? `; XSRF-TOKEN=${xsrf}` : ''}`;

                // /n/<x> answers 302 to voe.sx/e/<id>; the client follows it.
                const landing = await getPage(`${FILMO}/n/${encodeURIComponent(token)}`, cookie ? { "Referer": pageUrl, "Cookie": cookie } : { "Referer": pageUrl });
                const voe = await voeResolve(landing.html);
                if (!voe) {
                    const dead = /not found|deleted|no longer/i.test(landing.html);
                    failedLinks.push({ server_name: label, url: `${FILMO}/n/${token}`, reason: dead ? "File deleted on VOE" : "VOE page undecodable" });
                    continue;
                }

                const origin = voe.origin || "https://voe.sx";
                const streamHeaders = { "Referer": `${origin}/`, "Origin": origin, "User-Agent": FM_UA };
                // Multi-audio uploads carry every dub in one file; say which.
                const audio = Array.isArray(voe.config.audio_languages) ? voe.config.audio_languages : [];
                if (audio.length > 1) label += ` · audio ${audio.map(a => String(a.countryCode || a.language || '').toUpperCase()).join('/')}`;
                const hls = voe.config.source;
                if (hls && !streams.some(s => s.streamUrl === hls)) {
                    streams.push({ title: `${label} HLS`, streamUrl: hls, headers: streamHeaders });
                }
                const mp4 = voe.config.direct_access_url;
                if (mp4 && !streams.some(s => s.streamUrl === mp4)) {
                    streams.push({ title: `${label} MP4`, streamUrl: mp4, headers: streamHeaders });
                }
                console.log(`   -> ${label}: ${hls ? 'HLS' : ''} ${mp4 ? 'MP4' : ''}`);
            } catch (e) {
                failedLinks.push({ server_name: label, url: pageUrl, reason: String(e) });
            }
        }

        console.log(`[Player] 📊 Summary: ${streams.length} link(s).`);

        sendSupabaseLog("Filmo", "PLAYER", {
            media_url: pageUrl,
            season_number: "1",
            ep_number: "1",
            streams_found: streams.length,
            subtitles_found: false,
            allSubtitles_count: 0,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("Filmo", "UNSUPPORTED_HOSTS", {
                media_url: pageUrl,
                season_number: "1",
                ep_number: "1",
                failed_count: failedLinks.length,
                failed_links: failedLinks
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
        sendSupabaseLog("Filmo", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
