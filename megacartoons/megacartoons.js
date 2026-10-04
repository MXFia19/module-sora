// ==========================================
// ⚙️ SORA MODULE — MEGACARTOONS (+ FunnierMoments mirror)
// ==========================================
// megacartoons.net and funniermoments.net are the same WordPress site under
// two names: same series, same episode slugs, and the same mp4 files on two
// storage hosts (identical size and ETag). One module, two servers.
//
// Catalog (WordPress REST, no key):
//   GET /wp-json/wp/v2/video-series?search=<q>      -> series {id, name, count, description}
//   GET /wp-json/wp/v2/posts?video-series=<id>&…    -> the episodes of a series (paged by 100)
//   GET /wp-json/wp/v2/posts?search=<q>&_embed=…    -> single episodes matching the query
//
// Playback: the episode page hands the file to its JW Player in the clear,
//   <input name="main_video_url" value="https://ww.megacartoons.net/cartoons/<serie>/<ep>.mp4">
// and the mirror serves the very same path on ww.funniermoments.net.

const MC_BASE = "https://www.megacartoons.net";
const MC_MIRROR_BASE = "https://www.funniermoments.net";
const MC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = MC_UA;
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

async function wpJson(path) {
    const response = await soraFetch(`${MC_BASE}/wp-json/wp/v2/${path}`, { method: 'GET', headers: { "Accept": "application/json" } });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

async function getPage(url) {
    const response = await soraFetch(url, {
        method: 'GET',
        headers: { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": `${MC_BASE}/` }
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

function stripTags(html) {
    return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function featuredImage(post) {
    try {
        const media = post._embedded["wp:featuredmedia"][0];
        const sizes = (media.media_details && media.media_details.sizes) || {};
        return (sizes.medium_large || sizes["post-thumbnail"] || sizes.full || {}).source_url || media.source_url || "";
    } catch (e) { return ""; }
}

// The episode page carries the mp4 twice: a hidden input and the JW Player setup.
function findVideoUrl(html) {
    if (!html) return "";
    const input = html.match(/name=["']main_video_url["']\s+value=["']([^"']+)["']/i);
    if (input && /^https?:/.test(input[1])) return decodeEntities(input[1]);
    const jw = html.match(/\.setup\(\{\s*file:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
    if (jw) return decodeEntities(jw[1]);
    const any = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
    return any ? decodeEntities(any[1]) : "";
}

// Asks for two bytes so a missing file is not offered.
async function fileIsAlive(url, referer) {
    try {
        const response = await soraFetch(url, { method: 'GET', headers: { "User-Agent": MC_UA, "Range": "bytes=0-1", "Referer": referer } });
        if (!response) return false;
        if (typeof response.status === 'number' && (response.status === 0 || response.status >= 400)) return false;
        return true;
    } catch (e) { return false; }
}

async function seriesCover(seriesId) {
    const posts = await wpJson(`posts?video-series=${seriesId}&per_page=1&_embed=wp:featuredmedia&_fields=id,_links,_embedded`);
    return Array.isArray(posts) && posts[0] ? featuredImage(posts[0]) : "";
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 MegaCartoons — searching for "${keyword}"`);
    try {
        const q = encodeURIComponent(String(keyword || "").trim());
        const results = [];

        // Series first: they open on their full episode list.
        const series = await wpJson(`video-series?search=${q}&per_page=20&_fields=id,name,count`);
        if (Array.isArray(series)) {
            for (const serie of series.slice(0, 10)) {
                if (!serie || !serie.id) continue;
                results.push({
                    title: `${decodeEntities(serie.name)} · Series (${serie.count || 0} ep.)`,
                    image: await seriesCover(serie.id),
                    href: `megacartoons://series/${serie.id}`
                });
            }
        }

        // Then single cartoons whose title matches.
        const posts = await wpJson(`posts?search=${q}&per_page=30&_embed=wp:featuredmedia&_fields=id,title,_links,_embedded`);
        if (Array.isArray(posts)) {
            for (const post of posts) {
                if (!post || !post.id) continue;
                results.push({
                    title: decodeEntities(post.title && post.title.rendered) || `Cartoon ${post.id}`,
                    image: featuredImage(post),
                    href: `megacartoons://post/${post.id}`
                });
            }
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("MegaCartoons", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("MegaCartoons", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const m = String(url).match(/^megacartoons:\/\/(series|post)\/(\d+)/);
    if (m) return { kind: m[1], id: m[2] };
    return { kind: 'page', id: String(url).replace(/^megacartoons-play:\/\//, "") };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 MegaCartoons — ${ref.kind} ${ref.id}`);
    sendSupabaseLog("MegaCartoons", "DETAILS", { media_url: url });

    try {
        if (ref.kind === 'series') {
            const serie = await wpJson(`video-series/${ref.id}?_fields=id,name,count,description`);
            if (!serie || !serie.id) return JSON.stringify([{ description: 'Series not found.', aliases: '', airdate: '' }]);
            return JSON.stringify([{
                description: stripTags(serie.description) || "No synopsis available.",
                aliases: `${decodeEntities(serie.name)} | ${serie.count || 0} episode(s)`,
                airdate: ""
            }]);
        }

        if (ref.kind === 'post') {
            const post = await wpJson(`posts/${ref.id}?_fields=id,title,excerpt,date`);
            if (!post || !post.id) return JSON.stringify([{ description: 'Cartoon not found.', aliases: '', airdate: '' }]);
            return JSON.stringify([{
                description: stripTags(post.excerpt && post.excerpt.rendered) || "No synopsis available.",
                aliases: decodeEntities(post.title && post.title.rendered),
                airdate: String(post.date || "").slice(0, 10)
            }]);
        }

        return JSON.stringify([{ description: "No synopsis available.", aliases: '', airdate: '' }]);
    } catch (error) {
        sendSupabaseLog("MegaCartoons", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

function playHref(link) {
    // Keep only the path: the host is fixed and the mirror shares it.
    const path = String(link || "").replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "");
    return `megacartoons-play://${path}`;
}

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 MegaCartoons — ${ref.kind} ${ref.id}`);

    try {
        if (ref.kind === 'post') {
            const post = await wpJson(`posts/${ref.id}?_fields=id,title,link`);
            if (!post || !post.link) return JSON.stringify([]);
            return JSON.stringify([{
                href: playHref(post.link),
                number: 1,
                season: 1,
                title: decodeEntities(post.title && post.title.rendered) || "Cartoon"
            }]);
        }

        if (ref.kind !== 'series') return JSON.stringify([]);

        // Oldest first: the site uploads each show in broadcast order.
        const all = [];
        for (let page = 1; page <= 15; page++) {
            const posts = await wpJson(`posts?video-series=${ref.id}&per_page=100&page=${page}&orderby=date&order=asc&_fields=id,title,link`);
            if (!Array.isArray(posts) || posts.length === 0) break;
            for (const post of posts) if (post && post.link) all.push(post);
            if (posts.length < 100) break;
        }

        const episodes = all.map((post, index) => ({
            href: playHref(post.link),
            number: index + 1,
            season: 1,
            title: decodeEntities(post.title && post.title.rendered) || `Episode ${index + 1}`
        }));

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("MegaCartoons", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const path = "/" + String(url).replace(/^megacartoons-play:\/\//, "").replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "");
    const mediaUrl = `${MC_BASE}${path}`;
    console.log(`[Player] 🎬 MegaCartoons — ${mediaUrl}`);

    const streams = [];
    const failedLinks = [];

    try {
        let videoUrl = findVideoUrl(await getPage(mediaUrl));
        let pageBase = MC_BASE;

        // The mirror carries the same slugs: use it if the main page fails.
        if (!videoUrl) {
            videoUrl = findVideoUrl(await getPage(`${MC_MIRROR_BASE}${path}`));
            pageBase = MC_MIRROR_BASE;
        }

        if (!videoUrl) {
            failedLinks.push({ server_name: "MegaCartoons", url: mediaUrl, reason: "No video file on the page" });
        } else {
            const mainHost = videoUrl.replace(/^(https?:\/\/[^/]+).*$/, "$1");
            const filePath = videoUrl.slice(mainHost.length);
            const candidates = [
                { title: "MegaCartoons", url: `https://ww.megacartoons.net${filePath}`, referer: `${MC_BASE}/` },
                { title: "FunnierMoments (mirror)", url: `https://ww.funniermoments.net${filePath}`, referer: `${MC_MIRROR_BASE}/` }
            ];
            // An unexpected storage host: offer it as found.
            if (!/ww\.(megacartoons|funniermoments)\.net$/.test(mainHost)) {
                candidates.unshift({ title: "MegaCartoons", url: videoUrl, referer: `${pageBase}/` });
            }

            for (const candidate of candidates) {
                if (streams.some(s => s.streamUrl === candidate.url)) continue;
                if (await fileIsAlive(candidate.url, candidate.referer)) {
                    streams.push({
                        title: `${candidate.title} · MP4`,
                        streamUrl: candidate.url,
                        headers: { "User-Agent": MC_UA, "Referer": candidate.referer }
                    });
                } else {
                    failedLinks.push({ server_name: candidate.title, url: candidate.url, reason: "File missing on this host" });
                }
            }
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s).`);

        sendSupabaseLog("MegaCartoons", "PLAYER", {
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
            sendSupabaseLog("MegaCartoons", "UNSUPPORTED_HOSTS", {
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
        sendSupabaseLog("MegaCartoons", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
