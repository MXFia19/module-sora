// ==========================================
// ⚙️ SORA MODULE — KISSASIAN
// ==========================================
// KissAsian (kissasian.gr; the FMHY link wwv21.kissasian.com.lv redirects
// there) is a WordPress drama catalog. Its own search form finds nothing,
// but the REST API is open:
//   GET /wp-json/wp/v2/series?search=<q>&_embed=wp:featuredmedia  -> series + cover
// A series page lists its episodes (/<slug>-episode-<n>/, newest first) and
// each episode page offers two servers in <li data-video="…">:
//
//   "Standard Server"  catalog.dramavibe.cfd/player_embed.php?episode=<id>
//       The embed resolves its sources at runtime:
//       GET /player_source.php?episode=<id> -> {ok, src, list:[m3u8 on
//       cdn.dramav2.xyz, cdn.drama3.click]}. Both CDNs answer a Cloudflare
//       block page unless the Referer/Origin is the embed's site.
//       Subtitles: storage.dramavibe.cfd/api/public/video/<uuid>/subtitles
//       (the uuid is the m3u8's folder) -> [{lang, format, url}].
//
//   "Backup Server"    kissasian.gr/…/kisskh-player.php?ep=<kisskh id>
//       A thin page around KissKH's CDN: `var src = "…m3u8"` and
//       `var subtitleList = [{url, label, land}]` in clear (the site proxies
//       segments only to dodge browser CORS, a native player needs no proxy).

const KA_BASE = "https://kissasian.gr";
const KA_DV_ORIGIN = "https://catalog.dramavibe.cfd";
const KA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = KA_UA;
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
        headers: { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": referer || `${KA_BASE}/` }
    });
    return await readBody(response);
}

async function getJson(url, headers) {
    const response = await soraFetch(url, { method: 'GET', headers: Object.assign({ "Accept": "application/json" }, headers || {}) });
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

// A JS string literal from the page ("…" with \/ escapes).
function jsString(html, name) {
    const m = String(html || "").match(new RegExp(`var\\s+${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (!m) return "";
    try { return JSON.parse(`"${m[1]}"`); } catch (e) { return m[1].replace(/\\\//g, "/"); }
}

function featuredImage(item) {
    try {
        const media = item._embedded["wp:featuredmedia"][0];
        return media.source_url || "";
    } catch (e) { return ""; }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 KissAsian — searching for "${keyword}"`);
    try {
        const q = encodeURIComponent(String(keyword || "").trim());
        const list = await getJson(`${KA_BASE}/wp-json/wp/v2/series?search=${q}&per_page=40&_embed=wp:featuredmedia&_fields=id,link,title,_links,_embedded`);

        const results = [];
        for (const item of (Array.isArray(list) ? list : [])) {
            if (!item || !item.link) continue;
            const slug = (String(item.link).match(/\/series\/([^/]+)/) || [])[1];
            if (!slug) continue;
            results.push({
                title: decodeEntities(item.title && item.title.rendered) || slug,
                image: featuredImage(item),
                href: `kissasian://series/${slug}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("KissAsian", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("KissAsian", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function seriesUrl(url) {
    const slug = (String(url).match(/^kissasian:\/\/series\/([^/?#]+)/) || String(url).match(/\/series\/([^/?#]+)/) || [])[1];
    return slug ? `${KA_BASE}/series/${slug}/` : String(url);
}

async function extractDetails(url) {
    const pageUrl = seriesUrl(url);
    console.log(`[Details] 📖 KissAsian — ${pageUrl}`);
    sendSupabaseLog("KissAsian", "DETAILS", { media_url: pageUrl });

    try {
        const html = await getPage(pageUrl);
        const info = (html.match(/<div class="info">([\s\S]*?)<\/div>/) || [])[1] || "";

        // The site has no synopsis: the info card is the description.
        const lines = [];
        const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
        let m;
        while ((m = re.exec(info)) !== null) {
            const line = textOf(m[1]);
            if (line) lines.push(line);
        }
        const otherName = textOf((info.match(/<p class="other_name">([\s\S]*?)<\/p>/) || [])[1] || "").replace(/^Other name:\s*/i, "");
        const year = ((html.match(/<h1>[^<]*\((\d{4})\)<\/h1>/) || [])[1]) || "";

        return JSON.stringify([{
            description: lines.filter(l => !/^Other name/i.test(l)).join("\n") || "No synopsis available.",
            aliases: otherName,
            airdate: year
        }]);
    } catch (error) {
        sendSupabaseLog("KissAsian", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const pageUrl = seriesUrl(url);
    console.log(`[Episodes] 📂 KissAsian — ${pageUrl}`);

    try {
        const html = await getPage(pageUrl);
        const block = (html.match(/<ul class="list-episode-item-2 all-episode">([\s\S]*?)<\/ul>/) || [])[1] || html;

        const episodes = [];
        const re = /<a href="([^"]+)" class="img">\s*<span class="type ([A-Za-z]+)">[^<]*<\/span>\s*<h3 class="title"[^>]*>([^<]+)<\/h3>/g;
        let m;
        while ((m = re.exec(block)) !== null) {
            const link = m[1];
            const href = `kissasian-play://${link.replace(KA_BASE, "").replace(/^\/+/, "")}`;
            if (episodes.some(e => e.href === href)) continue;
            const title = decodeEntities(m[3]).trim();
            const numMatch = title.match(/Episode\s+(\d+(?:\.\d+)?)/i) || link.match(/episode-(\d+)/i);
            const num = numMatch ? parseFloat(numMatch[1]) : 0;
            episodes.push({
                href: href,
                number: num || 0,
                season: 1,
                title: `${m[2].toUpperCase() === 'RAW' ? 'RAW · ' : ''}${title}`
            });
        }

        // Newest first on the page: play order is the reverse.
        episodes.reverse();
        episodes.forEach((e, i) => { if (!e.number) e.number = i + 1; });

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("KissAsian", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// "Standard Server": dramavibe's runtime source list + its subtitle API.
async function dramavibeStreams(embedUrl, streams, subtitles, failedLinks) {
    const episodeId = (embedUrl.match(/[?&]episode=(\d+)/) || [])[1];
    if (!episodeId) return;
    const data = await getJson(`${KA_DV_ORIGIN}/player_source.php?episode=${episodeId}`, { "Referer": embedUrl });
    const list = data && data.ok && Array.isArray(data.list) ? data.list : (data && data.src ? [data.src] : []);
    if (list.length === 0) {
        failedLinks.push({ server_name: "Standard Server", url: embedUrl, reason: "player_source returned no source" });
        return;
    }

    const headers = { "User-Agent": KA_UA, "Referer": `${KA_DV_ORIGIN}/`, "Origin": KA_DV_ORIGIN };
    list.forEach((src, i) => {
        if (streams.some(s => s.streamUrl === src)) return;
        const host = (src.match(/^https?:\/\/([^/]+)/) || [])[1] || "CDN";
        streams.push({ title: `Standard Server ${i + 1} (${host}) · Sub`, streamUrl: src, headers: headers });
    });

    const uuid = (list[0].match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i) || [])[1];
    if (!uuid) return;
    const subs = await getJson(`https://storage.dramavibe.cfd/api/public/video/${uuid}/subtitles?client=cdn2`, { "Referer": `${KA_DV_ORIGIN}/`, "Origin": KA_DV_ORIGIN });
    for (const sub of (Array.isArray(subs) ? subs : [])) {
        const subUrl = sub.url || (Array.isArray(sub.urls) ? sub.urls[0] : "");
        if (!subUrl || subtitles.some(s => s.url === subUrl)) continue;
        subtitles.push({ url: subUrl, label: String(sub.lang || "Sub").toUpperCase(), lang: String(sub.lang || "").toLowerCase(), kind: "captions", headers: { "User-Agent": KA_UA, "Referer": `${KA_DV_ORIGIN}/` } });
    }
}

// "Backup Server": KissKH's own m3u8 and subtitle list, in clear.
async function kisskhStreams(playerUrl, streams, subtitles, failedLinks) {
    const html = await getPage(playerUrl, `${KA_BASE}/`);
    const src = jsString(html, "src");
    if (!src) {
        failedLinks.push({ server_name: "Backup Server (KissKH)", url: playerUrl, reason: "No source in the player" });
        return;
    }
    if (!streams.some(s => s.streamUrl === src)) {
        streams.push({ title: "Backup Server (KissKH) · Sub", streamUrl: src, headers: { "User-Agent": KA_UA, "Referer": `${KA_BASE}/` } });
    }

    const listMatch = html.match(/var\s+subtitleList\s*=\s*(\[[\s\S]*?\]);/);
    if (!listMatch) return;
    let list = [];
    try { list = JSON.parse(listMatch[1]); } catch (e) { list = []; }
    for (const sub of list) {
        if (!sub || !sub.url || subtitles.some(s => s.url === sub.url)) continue;
        subtitles.push({ url: sub.url, label: sub.label || sub.land || "Sub", lang: String(sub.land || "").toLowerCase(), kind: "captions", headers: { "User-Agent": KA_UA } });
    }
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const path = "/" + String(url).replace(/^kissasian-play:\/\//, "").replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "");
    const mediaUrl = `${KA_BASE}${path}`;
    console.log(`[Player] 🎬 KissAsian — ${mediaUrl}`);

    const streams = [];
    const subtitles = [];
    const failedLinks = [];

    try {
        const html = await getPage(mediaUrl);
        const servers = [];
        const re = /<li[^>]*data-video="([^"]+)"[^>]*>/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const link = decodeEntities(m[1]);
            if (servers.indexOf(link) === -1) servers.push(link);
        }
        if (servers.length === 0) {
            const iframe = (html.match(/<iframe[^>]+src="([^"]+)"/) || [])[1];
            if (iframe) servers.push(decodeEntities(iframe));
        }

        for (const server of servers) {
            try {
                if (server.indexOf("dramavibe") !== -1 && server.indexOf("player_embed") !== -1) {
                    await dramavibeStreams(server, streams, subtitles, failedLinks);
                } else if (server.indexOf("kisskh-player") !== -1) {
                    await kisskhStreams(server, streams, subtitles, failedLinks);
                } else {
                    failedLinks.push({ server_name: (server.match(/^https?:\/\/([^/]+)/) || [])[1] || "unknown", url: server, reason: "Unsupported host" });
                }
            } catch (e) {
                failedLinks.push({ server_name: server, url: server, reason: String(e) });
            }
        }

        const english = subtitles.find(s => s.lang === 'en' || /english/i.test(s.label)) || subtitles[0];
        const bestSubtitle = english ? english.url : "";

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${subtitles.length} subtitle track(s).`);

        sendSupabaseLog("KissAsian", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: String((path.match(/episode-(\d+)/) || [])[1] || "1"),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: subtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("KissAsian", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: "1", ep_number: String((path.match(/episode-(\d+)/) || [])[1] || "1"),
                failed_count: failedLinks.length, failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: bestSubtitle,
            subtitlesHeaders: english ? english.headers : {},
            allSubtitles: subtitles.map(s => ({ url: s.url, label: s.label, kind: "captions", headers: s.headers }))
        });
    } catch (error) {
        sendSupabaseLog("KissAsian", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
