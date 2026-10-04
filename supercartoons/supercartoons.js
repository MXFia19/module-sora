// ==========================================
// ⚙️ SORA MODULE — SUPERCARTOONS
// ==========================================
// supercartoons.net is a WordPress site of classic cartoons (same theme and storage
// layout as its sister sites b98.tv and toontales.net). Everything is plain HTML:
//
//   Series list : https://www.supercartoons.net/serie/series/ (a grid with covers)
//   A series    : https://www.supercartoons.net/serie/<slug>/page/<n>/   (a grid of cartoons, 24 per page)
//   Search      : https://www.supercartoons.net/?s=<query>                      (the same grid)
//   A cartoon   : https://www.supercartoons.net/cartoon/<slug>/            -> playerInstance.setup({ file: "…mp4" })
//
// The mp4 sits on the site's own storage host (ww.supercartoons.net) and plays as-is;
// no token, no expiry. The Referer is sent anyway, as the site's player does.

const CT_NAME = "SuperCartoons";
const CT_BASE = "https://www.supercartoons.net";
const CT_SCHEME = "supercartoons";
const CT_CAT_PATH = "/serie/";
const CT_VIDEO_PATH = "/cartoon/";
const CT_LIST_PAGES = ["/serie/series/"];   // grids of series (with covers)
const CT_MENU_PAGES = [];   // pages whose menu links the series
const CT_MAX_PAGES = 40;
const CT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = CT_UA;
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

async function getPage(url) {
    const response = await soraFetch(url, {
        method: 'GET',
        headers: { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": `${CT_BASE}/` }
    });
    return await readBody(response);
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

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function naturalCompare(a, b) {
    const ax = String(a).toLowerCase().match(/\d+|\D+/g) || [];
    const bx = String(b).toLowerCase().match(/\d+|\D+/g) || [];
    for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
        const an = /^\d/.test(ax[i]), bn = /^\d/.test(bx[i]);
        if (an && bn) {
            const d = parseInt(ax[i], 10) - parseInt(bx[i], 10);
            if (d !== 0) return d;
        } else if (ax[i] !== bx[i]) {
            return ax[i] < bx[i] ? -1 : 1;
        }
    }
    return ax.length - bx.length;
}

// The theme's grid: <a href="…"><img src="…" alt="Title" />, for series and cartoons alike.
function parseGrid(html, pathPrefix) {
    const items = [];
    if (!html) return items;
    const start = html.indexOf('id="main"');
    const body = start !== -1 ? html.slice(start) : html;
    const re = new RegExp(`<a href="(${escapeRegExp(CT_BASE)}${escapeRegExp(pathPrefix)}([^"/]+)/?)"[^>]*>\\s*<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"`, "g");
    let m;
    while ((m = re.exec(body)) !== null) {
        if (items.some(i => i.slug === m[2])) continue;
        items.push({ slug: m[2], url: m[1], image: m[3], title: decodeEntities(m[4]).trim() });
    }
    return items;
}

function lastPageNumber(html) {
    let max = 1;
    const re = /\/page\/(\d+)\/?["']/g;
    let m;
    while ((m = re.exec(html || "")) !== null) max = Math.max(max, parseInt(m[1], 10));
    return Math.min(max, CT_MAX_PAGES);
}

function metaDescription(html) {
    const m = (html || "").match(/<meta (?:name="description"|property="og:description") content="([^"]*)"/);
    return m ? decodeEntities(m[1]).trim() : "";
}

function metaContent(html, property) {
    const m = (html || "").match(new RegExp(`<meta property="${escapeRegExp(property)}" content="([^"]*)"`));
    return m ? decodeEntities(m[1]).trim() : "";
}

// All series (and studios) the site groups its cartoons into.
async function listCategories() {
    const categories = [];
    for (const path of CT_LIST_PAGES) {
        for (const item of parseGrid(await getPage(`${CT_BASE}${path}`), CT_CAT_PATH)) {
            if (!categories.some(c => c.slug === item.slug)) categories.push(item);
        }
    }
    for (const path of CT_MENU_PAGES) {
        const html = await getPage(`${CT_BASE}${path}`);
        const re = new RegExp(`<a href="${escapeRegExp(CT_BASE)}${escapeRegExp(CT_CAT_PATH)}([^"/]+)/?"[^>]*>([^<]+)</a>`, "g");
        let m;
        while ((m = re.exec(html || "")) !== null) {
            if (categories.some(c => c.slug === m[1])) continue;
            categories.push({ slug: m[1], url: `${CT_BASE}${CT_CAT_PATH}${m[1]}/`, image: "", title: decodeEntities(m[2]).trim() });
        }
    }
    return categories;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 ${CT_NAME} — searching for "${keyword}"`);
    try {
        const query = String(keyword || "").trim();
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const results = [];

        // Series whose name holds every word of the query.
        const categories = await listCategories();
        for (const category of categories) {
            const name = category.title.toLowerCase();
            if (!words.length || !words.every(w => name.indexOf(w) !== -1)) continue;
            let image = category.image;
            if (!image) {
                const first = parseGrid(await getPage(category.url), CT_VIDEO_PATH)[0];
                image = first ? first.image : "";
            }
            results.push({ title: `${category.title} · Series`, image: image, href: `${CT_SCHEME}://category/${category.slug}` });
        }

        // Then the site's own search over single cartoons (two pages at most;
        // its pager is "?s=<q>&paged=<n>").
        for (let page = 1; page <= 2; page++) {
            const url = `${CT_BASE}/?s=${encodeURIComponent(query)}${page > 1 ? `&paged=${page}` : ""}`;
            const html = await getPage(url);
            const items = parseGrid(html, CT_VIDEO_PATH);
            for (const item of items) {
                if (results.some(r => r.href === `${CT_SCHEME}://video/${item.slug}`)) continue;
                results.push({ title: item.title, image: item.image, href: `${CT_SCHEME}://video/${item.slug}` });
            }
            if (!new RegExp(`paged=${page + 1}\\b`).test(html || "")) break;
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog(CT_NAME, "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog(CT_NAME, "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const m = String(url).match(new RegExp(`^${CT_SCHEME}(?:-play)?:\\/\\/(category|video)\\/([^/?#]+)`));
    if (m) return { kind: m[1], slug: decodeURIComponent(m[2]) };
    const web = String(url).match(new RegExp(`${escapeRegExp(CT_VIDEO_PATH)}([^/?#]+)`));
    return { kind: 'video', slug: web ? web[1] : String(url) };
}

function pageUrl(ref) {
    return ref.kind === 'category'
        ? `${CT_BASE}${CT_CAT_PATH}${ref.slug}/`
        : `${CT_BASE}${CT_VIDEO_PATH}${ref.slug}/`;
}

async function extractDetails(url) {
    const ref = parseHref(url);
    const mediaUrl = pageUrl(ref);
    console.log(`[Details] 📖 ${CT_NAME} — ${mediaUrl}`);
    sendSupabaseLog(CT_NAME, "DETAILS", { media_url: mediaUrl });

    try {
        const html = await getPage(mediaUrl);
        if (!html) return JSON.stringify([{ description: 'Page unavailable.', aliases: '', airdate: '' }]);

        let description = metaDescription(html);
        if (!description && ref.kind === 'category') {
            const block = html.match(/<div class="archive-desc">([\s\S]*?)<\/div>/);
            description = block ? decodeEntities(block[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
        }

        const title = metaContent(html, "og:title");
        const upload = (html.match(/"uploadDate":"([^"]+)"/) || [])[1] || "";
        return JSON.stringify([{
            description: description || "No synopsis available.",
            aliases: title,
            airdate: upload.slice(0, 10)
        }]);
    } catch (error) {
        sendSupabaseLog(CT_NAME, "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 ${CT_NAME} — ${ref.kind} ${ref.slug}`);

    try {
        if (ref.kind === 'video') {
            const html = await getPage(pageUrl(ref));
            const title = metaContent(html, "og:title") || ref.slug;
            return JSON.stringify([{ href: `${CT_SCHEME}-play://video/${ref.slug}`, number: 1, season: 1, title: title }]);
        }

        const first = await getPage(pageUrl(ref));
        const items = parseGrid(first, CT_VIDEO_PATH);
        const last = lastPageNumber(first);

        // The remaining pages, a few at a time.
        const pages = [];
        for (let p = 2; p <= last; p++) pages.push(p);
        for (let i = 0; i < pages.length; i += 6) {
            const batch = pages.slice(i, i + 6);
            const bodies = await Promise.all(batch.map(p => getPage(`${CT_BASE}${CT_CAT_PATH}${ref.slug}/page/${p}/`)));
            for (const body of bodies) {
                for (const item of parseGrid(body, CT_VIDEO_PATH)) {
                    if (!items.some(x => x.slug === item.slug)) items.push(item);
                }
            }
        }

        // The site sorts by title, give or take a pinned post: sort it fully.
        items.sort((a, b) => naturalCompare(a.title, b.title));
        const episodes = items.map((item, index) => ({
            href: `${CT_SCHEME}-play://video/${item.slug}`,
            number: index + 1,
            season: 1,
            title: item.title
        }));

        console.log(`[Episodes] ✅ ${episodes.length} cartoon(s) over ${last} page(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog(CT_NAME, "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function findVideoUrl(html) {
    if (!html) return "";
    const jw = html.match(/\.setup\(\{\s*file:\s*["']([^"']+)["']/);
    if (jw && /^https?:/.test(jw[1])) return decodeEntities(jw[1]);
    const ld = html.match(/"contentUrl":"([^"]+\.(?:mp4|m3u8)[^"]*)"/);
    if (ld) return ld[1].replace(/\\\//g, "/");
    const any = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
    return any ? any[1] : "";
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = pageUrl({ kind: 'video', slug: ref.slug });
    console.log(`[Player] 🎬 ${CT_NAME} — ${mediaUrl}`);

    const streams = [];
    const failedLinks = [];

    try {
        const html = await getPage(mediaUrl);
        const videoUrl = findVideoUrl(html);

        if (videoUrl) {
            const kind = /\.m3u8/i.test(videoUrl) ? "HLS" : "MP4";
            streams.push({
                title: `${CT_NAME} · ${kind}`,
                streamUrl: videoUrl,
                headers: { "User-Agent": CT_UA, "Referer": `${CT_BASE}/` }
            });
            console.log(`   -> ${videoUrl}`);
        } else {
            failedLinks.push({ server_name: CT_NAME, url: mediaUrl, reason: html ? "No video file on the page" : "Page unavailable" });
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s).`);

        sendSupabaseLog(CT_NAME, "PLAYER", {
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
            sendSupabaseLog(CT_NAME, "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog(CT_NAME, "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
