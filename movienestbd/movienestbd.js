// ==========================================
// ⚙️ SORA MODULE — MOVIENESTBD
// ==========================================
// MovieNestBD (movienestbd.best) is a Bangladeshi catalogue (Bollywood, Hindi
// dubs, Korean, anime…) with its own search and pages. Each page declares its
// files inline:
//   const rawLinks    = [{ name, link: "https://jiofiles.pics/<24 hex>", quality, language }]
//   let   rawEpisodes = [{ name: "E1", link: "https://embed.jiofiles.pics/<24 hex>" }]
// Series are one page per season (slug-s1, slug-s2…).
//
// embed.jiofiles.pics/<id> is the site's player page. Its first player is
//   https://indbd.pages.dev/embed/<sub>.seekplayer.vip/<video id>
// i.e. a Seekplayer (embedseek family) video. Seekplayer's own API is called
// directly rather than through the indbd proxy:
//   GET https://<sub>.seekplayer.vip/api/v1/video?id=<video id>&w=1680&h=1050&r=
//   -> hex blob = AES-128-CBC(JSON), key "kiemtienmua911ca", iv "1234567890oiuytr"
//      (static, from the player bundle; same scheme the movix module decodes)
//   -> { cfNative: master.m3u8 on the seekplayer host, subtitle: {en: "/…vtt#en"}, … }
// The second player (xcloud.autos) sits behind a Cloudflare challenge.

const MN_SITE = "https://movienestbd.best";
const MN_EMBED = "https://embed.jiofiles.pics";
const MN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SEEK_KEY = "kiemtienmua911ca";
const SEEK_IV = "1234567890oiuytr";

// A movie page may list several files (1080p/720p/480p…); open at most this many.
const MN_MAX_FILES = 3;

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
    if (!headers["User-Agent"]) headers["User-Agent"] = MN_UA;
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

async function getPage(url, referer) {
    const headers = { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": referer || `${MN_SITE}/` };
    return await readBody(await soraFetch(url, { method: 'GET', headers: headers }));
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

// ==========================================
// 🔐 AES-128-CBC (pure JS, decryption only)
// ==========================================

const AES128 = (function () {
    const sbox = new Uint8Array(256), inv = new Uint8Array(256);
    (function init() {
        const log = new Uint8Array(256), alog = new Uint8Array(256);
        let a = 1;
        for (let i = 0; i < 255; i++) {
            alog[i] = a; log[a] = i;
            a ^= (a << 1) ^ ((a & 0x80) ? 0x11b : 0); a &= 0xff;
        }
        const ginv = (g) => g === 0 ? 0 : alog[(255 - log[g]) % 255];
        for (let i = 0; i < 256; i++) {
            let s = ginv(i), x = s;
            for (let k = 0; k < 4; k++) { x = ((x << 1) | (x >> 7)) & 0xff; s ^= x; }
            s ^= 0x63;
            sbox[i] = s; inv[s] = i;
        }
    })();
    const rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

    function expandKey(key) {
        const w = [];
        for (let i = 0; i < 4; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
        for (let i = 4; i < 44; i++) {
            let t = w[i - 1].slice();
            if (i % 4 === 0) { t = [sbox[t[1]], sbox[t[2]], sbox[t[3]], sbox[t[0]]]; t[0] ^= rcon[i / 4 - 1]; }
            w.push(w[i - 4].map((b, j) => b ^ t[j]));
        }
        return w;
    }
    function mul(a, b) {
        let r = 0;
        for (let i = 0; i < 8; i++) {
            if (b & 1) r ^= a;
            const hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b;
            b >>= 1;
        }
        return r;
    }
    function decryptBlock(input, w) {
        const s = [[], [], [], []];
        for (let i = 0; i < 16; i++) s[i % 4][(i / 4) | 0] = input[i];
        const addRound = (r) => { for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) s[row][c] ^= w[r * 4 + c][row]; };
        const invSub = () => { for (let row = 0; row < 4; row++) for (let c = 0; c < 4; c++) s[row][c] = inv[s[row][c]]; };
        const invShift = () => { for (let row = 1; row < 4; row++) { const t = s[row].slice(); for (let c = 0; c < 4; c++) s[row][c] = t[(c - row + 4) % 4]; } };
        const invMix = () => {
            for (let c = 0; c < 4; c++) {
                const a0 = s[0][c], a1 = s[1][c], a2 = s[2][c], a3 = s[3][c];
                s[0][c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
                s[1][c] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
                s[2][c] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
                s[3][c] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
            }
        };
        addRound(10);
        for (let r = 9; r >= 1; r--) { invShift(); invSub(); addRound(r); invMix(); }
        invShift(); invSub(); addRound(0);
        const out = new Uint8Array(16);
        for (let i = 0; i < 16; i++) out[i] = s[i % 4][(i / 4) | 0];
        return out;
    }
    function cbcDecrypt(cipher, key, iv) {
        const w = expandKey(key);
        const out = new Uint8Array(cipher.length);
        let prev = iv;
        for (let off = 0; off + 16 <= cipher.length; off += 16) {
            const block = cipher.subarray(off, off + 16);
            const dec = decryptBlock(block, w);
            for (let i = 0; i < 16; i++) out[off + i] = dec[i] ^ prev[i];
            prev = block;
        }
        const pad = out[out.length - 1];
        return (pad > 0 && pad <= 16) ? out.subarray(0, out.length - pad) : out;
    }
    return { cbcDecrypt: cbcDecrypt };
})();

function asciiBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
}

function hexBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

function utf8Decode(bytes) {
    let out = "", i = 0;
    while (i < bytes.length) {
        const c = bytes[i++];
        if (c < 0x80) out += String.fromCharCode(c);
        else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
        else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
        else {
            const cp = (((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)) - 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        }
    }
    return out;
}

function seekDecrypt(hex) {
    const plain = AES128.cbcDecrypt(hexBytes(hex), asciiBytes(SEEK_KEY), asciiBytes(SEEK_IV));
    return JSON.parse(utf8Decode(plain));
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 MovieNestBD — searching for "${keyword}"`);
    try {
        const html = await getPage(`${MN_SITE}/search?q=${encodeURIComponent(keyword)}`);
        const results = [];
        const seen = {};
        const cardRe = /<a href="(\/[^"#?]+)" class="movie-card[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = cardRe.exec(html)) !== null) {
            const href = `${MN_SITE}${m[1]}`;
            if (seen[href]) continue;
            seen[href] = true;
            const img = m[2].match(/<img[^>]+src="([^"]+)"/);
            const title = m[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
            results.push({
                title: title ? stripTags(title[1]) : m[1].slice(1).replace(/-/g, ' '),
                image: img && !/^data:/.test(img[1]) ? decodeEntities(img[1]) : "",
                href: href
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("MovieNestBD", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("MovieNestBD", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function pageUrlOf(url) {
    return String(url).split('#')[0];
}

async function extractDetails(url) {
    const pageUrl = pageUrlOf(url);
    console.log(`[Details] 📖 MovieNestBD — ${pageUrl}`);
    sendSupabaseLog("MovieNestBD", "DETAILS", { media_url: pageUrl });

    try {
        const html = await getPage(pageUrl);
        // The synopsis is the italic quote under the title; the meta tag is often empty.
        const quote = html.match(/<p class="[^"]*leading-relaxed italic[^"]*">([\s\S]*?)<\/p>/);
        const description = (quote ? stripTags(quote[1]).replace(/^"|"$/g, '').trim() : "")
            || decodeEntities((html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || "")
            || decodeEntities((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "")
            || "No synopsis available.";
        const ogTitle = decodeEntities((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || "");
        const year = (ogTitle.match(/\((\d{4})\)/) || [])[1] || "";
        const rating = (html.match(/IMDb Rating:\s*<strong[^>]*>([^<]+)</) || [])[1] || "";
        const genres = [];
        const genreRe = /href="\/genre\/[^"]+"[^>]*>([^<]+)</g;
        let g;
        while ((g = genreRe.exec(html)) !== null && genres.length < 4) {
            const name = stripTags(g[1]);
            if (name && genres.indexOf(name) === -1) genres.push(name);
        }

        const aliases = [];
        if (rating) aliases.push(`IMDb ${stripTags(rating)}`);
        if (genres.length) aliases.push(genres.join(', '));
        const lang = ogTitle.match(/\[([^\]]+)\]/);
        if (lang) aliases.push(lang[1]);

        return JSON.stringify([{ description: description, aliases: aliases.join(' | '), airdate: year }]);
    } catch (error) {
        sendSupabaseLog("MovieNestBD", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

// Reads the inline rawLinks / rawEpisodes arrays and the isSeries flag.
function parsePageData(html) {
    const unescape = (s) => String(s || "").replace(/\\\//g, '/');
    const block = (name) => {
        const start = html.indexOf(name);
        if (start === -1) return "";
        const open = html.indexOf('[', start);
        const close = html.indexOf('];', open);
        return open !== -1 && close !== -1 ? html.slice(open, close) : "";
    };
    const links = [];
    const linkRe = /name:\s*"([^"]*)",\s*link:\s*"([^"]*)",\s*quality:\s*"([^"]*)",\s*language:\s*"([^"]*)"/g;
    let m;
    const linksBlock = block('const rawLinks');
    while ((m = linkRe.exec(linksBlock)) !== null) links.push({ name: m[1].trim(), link: unescape(m[2]), quality: m[3], language: m[4] });

    const episodes = [];
    const epRe = /name:\s*"([^"]*)",\s*link:\s*"([^"]*)"/g;
    const epsBlock = block('let rawEpisodes');
    while ((m = epRe.exec(epsBlock)) !== null) episodes.push({ name: m[1].trim(), link: unescape(m[2]) });

    const isSeries = /const isSeries\s*=\s*true/.test(html);
    const defaultEmbed = unescape((html.match(/formatJioEmbed\("(https:[^"]+)"\)/) || [])[1] || "");
    return { links: links, episodes: episodes, isSeries: isSeries, defaultEmbed: defaultEmbed };
}

function isArchive(name) {
    const n = String(name || '').toLowerCase();
    return !n || n === 'none' || n === 'download_links' || n.indexOf('zip') !== -1 || n.indexOf('rar') !== -1 || n.indexOf('season') !== -1;
}

function fileId(link) {
    const m = String(link || "").match(/\/([a-f0-9]{24})(?:$|[/?#])/i);
    return m ? m[1] : "";
}

function episodeNumber(name, fallback) {
    const lower = String(name || '').toLowerCase();
    const m = lower.match(/s\d+\s*-?\s*e(?:p(?:isode)?)?\s*-?\s*(\d+)/) || lower.match(/e(?:p(?:isode)?)?\s*-?\s*(\d+)/) || lower.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : fallback;
}

async function extractEpisodes(url) {
    const pageUrl = pageUrlOf(url);
    console.log(`[Episodes] 📂 MovieNestBD — ${pageUrl}`);
    try {
        const html = await getPage(pageUrl);
        const data = parsePageData(html);

        if (!data.isSeries) {
            return JSON.stringify([{ href: `${pageUrl}#movie`, number: 1, season: 1, title: "Movie" }]);
        }

        let list = data.episodes.slice();
        if (list.length === 0) list = data.links.filter(l => !isArchive(l.name)).map(l => ({ name: l.name, link: l.link }));

        const season = parseInt((pageUrl.match(/-s(\d+)(?:-|$)/) || [])[1] || "1", 10);
        const episodes = [];
        const seen = {};
        list.forEach((ep, i) => {
            const id = fileId(ep.link);
            if (!id || seen[id]) return;
            seen[id] = true;
            episodes.push({
                href: `${pageUrl}#ep=${id}`,
                number: episodeNumber(ep.name, i + 1),
                season: season,
                title: ep.name || `Episode ${i + 1}`
            });
        });
        episodes.sort((a, b) => a.number - b.number);

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("MovieNestBD", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// jiofiles id -> { streamUrl, headers, subtitles[] } through Seekplayer.
async function resolveFile(id) {
    const embed = await getPage(`${MN_EMBED}/${id}`, `${MN_SITE}/`);
    const seek = embed.match(/https?:\/\/[^'"\s]*\/embed\/([a-z0-9-]+\.seekplayer\.[a-z]+)\/([a-z0-9]+)/i)
        || embed.match(/https?:\/\/([a-z0-9-]+\.seekplayer\.[a-z]+)\/?#([a-z0-9]+)/i);
    if (!seek) return { error: /not found|deleted|removed/i.test(embed) ? "File removed" : "No Seekplayer on the embed page" };

    const host = `https://${seek[1]}`;
    const api = `${host}/api/v1/video?id=${seek[2]}&w=1680&h=1050&r=`;
    // Seekplayer answers 400 "Request is invalid" when an Origin/Referer is sent.
    const hex = (await readBody(await soraFetch(api, { method: 'GET', headers: { "Accept": "*/*" } }))).trim();
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 32 !== 0) return { error: `Seekplayer API refused (${hex.slice(0, 60)})` };

    const data = seekDecrypt(hex);
    const streamUrl = data.cfNative || (data.hlsVideoTiktok ? `${host}${data.hlsVideoTiktok}` : "");
    if (!streamUrl) return { error: "Seekplayer returned no playable source" };

    const headers = { "Referer": `${host}/`, "Origin": host, "User-Agent": MN_UA };
    const subtitles = [];
    if (data.subtitle && typeof data.subtitle === 'object') {
        for (const lang of Object.keys(data.subtitle)) {
            const path = String(data.subtitle[lang] || "").split('#')[0];
            if (!path) continue;
            subtitles.push({ url: /^https?:/.test(path) ? path : `${host}${path}`, label: lang.toUpperCase(), kind: "captions", headers: { "Referer": `${host}/` } });
        }
    }
    return { streamUrl: streamUrl, headers: headers, subtitles: subtitles };
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const pageUrl = pageUrlOf(url);
    const hash = (String(url).split('#')[1] || "movie");
    console.log(`[Player] 🎬 MovieNestBD — ${url}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];

    try {
        // What to open: one episode file, or the movie's files (best first).
        const targets = [];
        const html = await getPage(pageUrl);
        const data = parsePageData(html);

        if (hash.indexOf('ep=') === 0) {
            const id = hash.slice(3);
            const info = data.links.find(l => fileId(l.link) === id);
            targets.push({ id: id, label: info ? [info.quality, info.language].filter(Boolean).join(' · ') : "Episode" });
        } else {
            // Movie pages list one file per quality; archives are skipped.
            const playable = data.links.filter(l => !/zip|rar/i.test(l.name));
            for (const file of playable) {
                const id = fileId(file.link);
                if (!id || targets.some(t => t.id === id)) continue;
                targets.push({ id: id, label: [file.quality, file.language, !isArchive(file.name) ? file.name : ""].filter(Boolean).join(' · ') || "File" });
            }
            const def = fileId(data.defaultEmbed);
            if (def && !targets.some(t => t.id === def)) targets.unshift({ id: def, label: "Default" });
        }

        for (const target of targets.slice(0, MN_MAX_FILES)) {
            try {
                const res = await resolveFile(target.id);
                if (res.error) {
                    failedLinks.push({ server_name: `Seekplayer ${target.label}`, url: `${MN_EMBED}/${target.id}`, reason: res.error });
                    continue;
                }
                if (streams.some(s => s.streamUrl === res.streamUrl)) continue;
                streams.push({ title: `Seekplayer ${target.label}`, streamUrl: res.streamUrl, headers: res.headers });
                for (const sub of res.subtitles) if (!allSubtitles.some(s => s.url === sub.url)) allSubtitles.push(sub);
                console.log(`   -> ${target.label}: ${res.streamUrl.slice(0, 80)}…`);
            } catch (e) {
                failedLinks.push({ server_name: `Seekplayer ${target.label}`, url: `${MN_EMBED}/${target.id}`, reason: String(e) });
            }
        }

        const english = allSubtitles.find(s => /^EN/i.test(s.label));
        const bestSubtitle = english ? english.url : (allSubtitles[0] ? allSubtitles[0].url : "");

        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("MovieNestBD", "PLAYER", {
            media_url: url,
            season_number: "1",
            ep_number: hash.indexOf('ep=') === 0 ? hash.slice(3) : "1",
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("MovieNestBD", "UNSUPPORTED_HOSTS", {
                media_url: url,
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
            subtitles: bestSubtitle,
            subtitlesHeaders: english ? english.headers : (allSubtitles[0] ? allSubtitles[0].headers : {}),
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("MovieNestBD", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
