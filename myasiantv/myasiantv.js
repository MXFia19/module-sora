// ==========================================
// ⚙️ SORA MODULE — MYASIANTV
// ==========================================
// myasiantv.com.bz: a WordPress catalog of Asian dramas, films and shows.
//
// Catalog:
//   GET /wp-json/wp/v2/series?search=<q>&_embed=wp:featuredmedia  -> series + poster
//   /series/<slug>/  -> poster, plot, year, and "List Episode" (newest first).
//   A film is a series with one episode ("Full … Movie").
//
// Playback: an episode page embeds an iframe on kisskh.space (no relation to
// KissKH) whose <li data-video="…" data-server="…"> list names public file
// hosts. Each is resolved here, in pure JS:
//   - Vidmoly    : the embed declares `sources: [{ file: '<master.m3u8>' }]`.
//   - Streamtape : the real link is assembled by a one-liner,
//                  robotlink.innerHTML = '//streamtape.com/ge' + ('xcdt_video?id=…&token=…').substring(2).substring(1)
//                  (earlier copies on the page carry a decoy token: the last one wins).
//   - MixDrop    : a p.a.c.k.e.r. script sets MDCore.wurl = "//<node>.mxcontent.net/…mp4?s=…&e=…".
// StreamHG (hglink) now loads through an obfuscated JS loader and is skipped.

const MAT_BASE = "https://myasiantv.com.bz";
const MAT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = MAT_UA;
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
    const response = await soraFetch(url, {
        method: 'GET',
        headers: { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": referer || `${MAT_BASE}/` }
    });
    return await readBody(response);
}

async function getJson(url) {
    const response = await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json" } });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// ==========================================
// 🧰 HELPERS
// ==========================================

function decodeEntities(text) {
    return String(text || "")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function textOf(html) {
    return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function hostOf(url) {
    return (String(url).match(/^https?:\/\/([^/]+)/) || [])[1] || "";
}

// Dean Edwards' p.a.c.k.e.r., unpacked without eval.
function unpackPacker(html) {
    const out = [];
    const re = /eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        let p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
        const a = parseInt(m[2], 10);
        let c = parseInt(m[3], 10);
        const k = m[4].split('|');
        const encode = (n) => (n < a ? "" : encode(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
        while (c--) {
            if (k[c]) p = p.replace(new RegExp(`\\b${encode(c)}\\b`, 'g'), k[c]);
        }
        out.push(p);
    }
    return out.join("\n");
}

function isDeleted(html) {
    const h = String(html || "").toLowerCase();
    return h.indexOf("file was deleted") !== -1 || h.indexOf("file not found") !== -1 ||
        h.indexOf("video not found") !== -1 || h.indexOf("has been removed") !== -1;
}

// ==========================================
// 🔌 HOSTS
// ==========================================

async function vidmolyExtract(embedUrl, referer) {
    const url = embedUrl.replace(/vidmoly\.(?:to|me|net|ru|is)\//i, "vidmoly.biz/");
    const html = await getPage(url, referer);
    if (!html || isDeleted(html)) return null;
    const m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/) ||
        html.match(/file\s*:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/);
    if (!m) return null;
    const origin = `https://${hostOf(url)}`;
    return { title: "Vidmoly · HLS", streamUrl: m[1], headers: { "User-Agent": MAT_UA, "Referer": `${origin}/`, "Origin": origin } };
}

async function streamtapeExtract(embedUrl, referer) {
    const html = await getPage(embedUrl, referer);
    if (!html || isDeleted(html)) return null;
    // Keep the last robotlink assignment: the earlier ones carry decoy tokens.
    const re = /getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*['"]([^'"]*)['"]\s*\+\s*\(?\s*['"]([^'"]*)['"]\s*\)?((?:\.substring\(\d+\))*)/g;
    let m, link = "";
    while ((m = re.exec(html)) !== null) {
        let tail = m[2];
        const subs = m[3].match(/\d+/g) || [];
        for (const n of subs) tail = tail.substring(parseInt(n, 10));
        link = m[1] + tail;
    }
    if (!link) return null;
    const streamUrl = `${link.indexOf("//") === 0 ? "https:" : ""}${link}&stream=1`;
    return { title: "Streamtape · MP4", streamUrl: streamUrl, headers: { "User-Agent": MAT_UA, "Referer": "https://streamtape.com/" } };
}

async function mixdropExtract(embedUrl, referer) {
    const html = await getPage(embedUrl, referer);
    if (!html || isDeleted(html)) return null;
    const code = unpackPacker(html) + "\n" + html;
    const m = code.match(/MDCore\.wurl\s*=\s*"([^"]+)"/);
    if (!m) return null;
    const streamUrl = m[1].indexOf("//") === 0 ? `https:${m[1]}` : m[1];
    const origin = `https://${hostOf(embedUrl)}`;
    return { title: "MixDrop · MP4", streamUrl: streamUrl, headers: { "User-Agent": MAT_UA, "Referer": `${origin}/` } };
}

async function resolveHost(embedUrl, referer) {
    const host = hostOf(embedUrl).toLowerCase();
    if (host.indexOf("vidmoly") !== -1) return await vidmolyExtract(embedUrl, referer);
    if (host.indexOf("streamtape") !== -1 || host.indexOf("strtape") !== -1) return await streamtapeExtract(embedUrl, referer);
    if (host.indexOf("mixdrop") !== -1 || host.indexOf("mxdrop") !== -1 || host.indexOf("mixdrp") !== -1) return await mixdropExtract(embedUrl, referer);
    return undefined; // unsupported
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 MyAsianTV — searching for "${keyword}"`);
    try {
        const q = encodeURIComponent(String(keyword || "").trim());
        const list = await getJson(`${MAT_BASE}/wp-json/wp/v2/series?search=${q}&per_page=40&_embed=wp:featuredmedia&_fields=id,link,title,_links,_embedded`);

        const results = [];
        for (const item of (Array.isArray(list) ? list : [])) {
            const slug = (String(item && item.link).match(/\/series\/([^/]+)/) || [])[1];
            if (!slug) continue;
            let image = "";
            try { image = item._embedded["wp:featuredmedia"][0].source_url || ""; } catch (e) { image = ""; }
            results.push({
                title: decodeEntities(item.title && item.title.rendered) || slug,
                image: image,
                href: `myasiantv://series/${slug}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("MyAsianTV", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("MyAsianTV", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function seriesUrl(url) {
    const slug = (String(url).match(/^myasiantv:\/\/series\/([^/?#]+)/) || String(url).match(/\/series\/([^/?#]+)/) || [])[1];
    return slug ? `${MAT_BASE}/series/${slug}/` : String(url);
}

function field(html, label) {
    const m = String(html || "").match(new RegExp(`<strong>${label}:<\\/strong>\\s*<span>([\\s\\S]*?)<\\/span>`, "i"));
    return m ? textOf(m[1]) : "";
}

async function extractDetails(url) {
    const pageUrl = seriesUrl(url);
    console.log(`[Details] 📖 MyAsianTV — ${pageUrl}`);
    sendSupabaseLog("MyAsianTV", "DETAILS", { media_url: pageUrl });

    try {
        const html = await getPage(pageUrl);
        const plot = textOf((html.match(/<h3><i class="t1"><\/i>Plot<\/h3>\s*<div class="info">([\s\S]*?)<\/div>/) || [])[1] || "");

        const aliasParts = [];
        const original = field(html, "Original name");
        if (original) aliasParts.push(original);
        for (const label of ["Country", "Genre", "Status"]) {
            const value = field(html, label);
            if (value) aliasParts.push(value);
        }

        return JSON.stringify([{
            description: plot || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: field(html, "Release year")
        }]);
    } catch (error) {
        sendSupabaseLog("MyAsianTV", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const pageUrl = seriesUrl(url);
    console.log(`[Episodes] 📂 MyAsianTV — ${pageUrl}`);

    try {
        const html = await getPage(pageUrl);
        const block = (html.match(/<ul class="list-episode">([\s\S]*?)<\/ul>/) || [])[1] || "";

        const episodes = [];
        const re = /<span class="([a-z]+)">[^<]*<\/span>\s*<h2><a title="([^"]*)" href="([^"]+)"/g;
        let m;
        while ((m = re.exec(block)) !== null) {
            const path = m[3].replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "");
            const href = `myasiantv-play://${path}`;
            if (episodes.some(e => e.href === href)) continue;
            const title = decodeEntities(m[2]).trim();
            const numMatch = title.match(/\bEp(?:isode)?\s*(\d+(?:\.\d+)?)/i) || path.match(/-ep-(\d+)/i);
            episodes.push({
                href: href,
                number: numMatch ? parseFloat(numMatch[1]) : 0,
                season: 1,
                title: `${m[1].toLowerCase() === 'raw' ? 'RAW · ' : ''}${title}`
            });
        }

        // Newest first on the page.
        episodes.reverse();
        episodes.forEach((e, i) => { if (!e.number) e.number = i + 1; });

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("MyAsianTV", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const path = String(url).replace(/^myasiantv-play:\/\//, "").replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "");
    const mediaUrl = `${MAT_BASE}/${path}`;
    const epNumber = String((path.match(/-ep-(\d+)/i) || [])[1] || "1");
    console.log(`[Player] 🎬 MyAsianTV — ${mediaUrl}`);

    const streams = [];
    const failedLinks = [];

    try {
        const html = await getPage(mediaUrl);
        const embed = decodeEntities((html.match(/<iframe[^>]+data-src="([^"]+)"/) || html.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/) || [])[1] || "");

        const servers = [];
        if (embed) {
            const embedHtml = await getPage(embed, `${MAT_BASE}/`);
            const re = /data-video="([^"]+)"(?:[^>]*data-server="([^"]*)")?[^>]*>([^<]*)/g;
            let m;
            while ((m = re.exec(embedHtml)) !== null) {
                const link = decodeEntities(m[1]);
                if (servers.some(s => s.url === link)) continue;
                servers.push({ url: link, name: (m[3] || m[2] || hostOf(link)).trim() });
            }
            if (servers.length === 0) {
                const iframe = (embedHtml.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/) || [])[1];
                if (iframe) servers.push({ url: decodeEntities(iframe), name: hostOf(iframe) });
            }
        } else {
            failedLinks.push({ server_name: "MyAsianTV", url: mediaUrl, reason: "No player iframe on the page" });
        }

        // The hosts are independent: resolve them together.
        const resolved = await Promise.all(servers.map(s => resolveHost(s.url, embed || `${MAT_BASE}/`).catch(() => null)));
        servers.forEach((server, i) => {
            const result = resolved[i];
            if (result === undefined) {
                failedLinks.push({ server_name: server.name, url: server.url, reason: "Unsupported host" });
            } else if (!result) {
                failedLinks.push({ server_name: server.name, url: server.url, reason: "Extraction failed or file deleted" });
            } else if (!streams.some(s => s.streamUrl === result.streamUrl)) {
                streams.push({ title: `${result.title} · Sub`, streamUrl: result.streamUrl, headers: result.headers });
                console.log(`   -> ${server.name}: ${result.streamUrl.slice(0, 80)}`);
            }
        });

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s).`);

        sendSupabaseLog("MyAsianTV", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: epNumber,
            streams_found: streams.length,
            subtitles_found: false,
            allSubtitles_count: 0,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("MyAsianTV", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: "1", ep_number: epNumber,
                failed_count: failedLinks.length, failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        // Subtitles are burned into these encodes ("Eng Sub").
        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: "",
            subtitlesHeaders: {},
            allSubtitles: []
        });
    } catch (error) {
        sendSupabaseLog("MyAsianTV", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
