// ==========================================
// ⚙️ SORA MODULE — PIRATEXPLAY
// ==========================================
// PirateXplay (piratexplay.com is a landing page for piratexplay.cc): anime
// with Indian dubs (Hindi, Tamil, Telugu) plus English and Japanese tracks.
//
// Catalog:
//   Search   : /?s=<q>  -> <article> cards: title, TMDB poster, /series/<slug> or /movies/<slug>
//   Seasons  : the series page links /series/<name>-season-<n>-<tmdbId>/ (data-season)
//   Episodes : GET /api/episodes.php?id=<season slug>
//              -> {data:{tmdb:{overview, release_year, genre…}, episodes:[{season, episode, image}]}}
//   Episode  : /episode/<season slug>-<s>x<e>/   Film: /movies/<slug>/
//
// Playback: each page lists ~15 embeds (iframe src / data-src), all tagged
// "Multi Audio". The ones resolvable in pure JS are Vidmoly's
// (`sources: [{ file: '<master.m3u8>' }]`, often under .net and .biz with the
// same id). The others are out of reach here: Vexal checks the embedding
// domain, Abyss (short.icu), UPNS (cloudy.upns.one), StreamP2P and the
// GDMirror hubs (index11 / gdmirrorbot) hand out AES-wrapped ids for those
// same hosts, Rubystm was down and Strmup / TurboVid did not answer when
// this was written. They are reported, not offered.

const PX_BASE = "https://piratexplay.cc";
const PX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = PX_UA;
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
        headers: { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": referer || `${PX_BASE}/` }
    });
    return await readBody(response);
}

async function getJson(url) {
    const response = await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json", "Referer": `${PX_BASE}/` } });
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

function hostOf(url) {
    return (String(url).match(/^https?:\/\/([^/]+)/) || [])[1] || "";
}

function parseHref(url) {
    const m = String(url).match(/^piratexplay(?:-play)?:\/\/(series|movies|episode)\/([^/?#]+)/);
    if (m) return { kind: m[1], slug: m[2] };
    const web = String(url).match(/\/(series|movies|episode)\/([^/?#]+)/);
    return web ? { kind: web[1], slug: web[2] } : { kind: 'series', slug: String(url) };
}

async function seasonData(seasonSlug) {
    const data = await getJson(`${PX_BASE}/api/episodes.php?id=${encodeURIComponent(seasonSlug)}`);
    return data && data.status === 'success' && data.data ? data.data : null;
}

// ==========================================
// 🔌 HOSTS
// ==========================================

async function vidmolyExtract(embedUrl) {
    const url = embedUrl.replace(/vidmoly\.(?:to|me|net|ru|is)\//i, "vidmoly.biz/");
    const html = await getPage(url, `${PX_BASE}/`);
    if (!html) return null;
    const m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/) ||
        html.match(/file\s*:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/);
    if (!m) return null;
    const origin = `https://${hostOf(url)}`;
    return { title: "Vidmoly · HLS · Multi Audio", streamUrl: m[1], headers: { "User-Agent": PX_UA, "Referer": `${origin}/`, "Origin": origin } };
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 PirateXplay — searching for "${keyword}"`);
    try {
        const html = await getPage(`${PX_BASE}/?s=${encodeURIComponent(String(keyword || "").trim())}`);
        const results = [];
        const re = /<article class="post[^"]*">([\s\S]*?)<\/article>/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const card = m[1];
            const link = (card.match(/<a href="([^"]+)" class="lnk-blk"/) || [])[1] || "";
            const ref = link.match(/\/(series|movies)\/([^/?#]+)/);
            if (!ref) continue;
            const title = decodeEntities((card.match(/<h2 class="entry-title">([^<]+)<\/h2>/) || [])[1] || ref[2]).trim();
            const image = (card.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
            const href = `piratexplay://${ref[1]}/${ref[2]}`;
            if (results.some(r => r.href === href)) continue;
            results.push({ title: ref[1] === 'movies' ? `${title} · Movie` : title, image: image, href: href });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("PirateXplay", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("PirateXplay", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

async function extractDetails(url) {
    const ref = parseHref(url);
    const pageUrl = `${PX_BASE}/${ref.kind}/${ref.slug}/`;
    console.log(`[Details] 📖 PirateXplay — ${pageUrl}`);
    sendSupabaseLog("PirateXplay", "DETAILS", { media_url: pageUrl });

    try {
        if (ref.kind === 'series') {
            const data = await seasonData(ref.slug);
            const tmdb = data && data.tmdb;
            if (tmdb) {
                const aliasParts = [];
                if (tmdb.rating) aliasParts.push(`TMDB ${Number(tmdb.rating).toFixed(1)}/10`);
                if (Array.isArray(tmdb.genre) && tmdb.genre.length) aliasParts.push(tmdb.genre.slice(0, 6).join(', '));
                if (tmdb.status) aliasParts.push(tmdb.status);
                if (tmdb.total_episodes) aliasParts.push(`${tmdb.total_episodes} episode(s)`);
                return JSON.stringify([{
                    description: String(tmdb.overview || "").trim() || "No synopsis available.",
                    aliases: aliasParts.join(' | '),
                    airdate: tmdb.release_year ? String(tmdb.release_year) : ""
                }]);
            }
        }

        // Films (and a failed API call): the page's own description.
        const html = await getPage(pageUrl);
        const description = decodeEntities((html.match(/<meta (?:name="description"|property="og:description") content="([^"]*)"/) || [])[1] || "").trim();
        const year = (html.match(/class="year[^"]*">\s*<span[^>]*>\s*(\d{4})/) || [])[1] || "";
        return JSON.stringify([{ description: description || "No synopsis available.", aliases: "", airdate: year }]);
    } catch (error) {
        sendSupabaseLog("PirateXplay", "ERROR", { media_url: pageUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 PirateXplay — ${ref.kind} ${ref.slug}`);

    try {
        if (ref.kind === 'movies') {
            return JSON.stringify([{ href: `piratexplay-play://movies/${ref.slug}`, number: 1, title: "Movie" }]);
        }

        // Every season of the show is linked from any season page.
        const html = await getPage(`${PX_BASE}/series/${ref.slug}/`);
        const seasons = [];
        const re = /href="\/series\/([^/"]+)\/?"[^>]*class="season-btn[^"]*"[^>]*data-season="(\d+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            if (!seasons.some(s => s.slug === m[1])) seasons.push({ slug: m[1], season: parseInt(m[2], 10) });
        }
        if (seasons.length === 0) seasons.push({ slug: ref.slug, season: parseInt((ref.slug.match(/-season-(\d+)-/) || [])[1] || "1", 10) });
        seasons.sort((a, b) => a.season - b.season);

        // Season lists, a few at a time.
        const lists = [];
        for (let i = 0; i < seasons.length; i += 5) {
            const batch = await Promise.all(seasons.slice(i, i + 5).map(s => seasonData(s.slug).catch(() => null)));
            batch.forEach((data, j) => lists.push({ season: seasons[i + j], data: data }));
        }

        const episodes = [];
        for (const entry of lists) {
            const items = entry.data && Array.isArray(entry.data.episodes) ? entry.data.episodes : [];
            for (const ep of items) {
                const s = parseInt(ep.season, 10) || entry.season.season;
                const e = parseInt(ep.episode, 10);
                if (!e) continue;
                episodes.push({
                    href: `piratexplay-play://episode/${entry.season.slug}-${s}x${e}`,
                    number: episodes.length + 1,
                    season: s,
                    title: seasons.length > 1 ? `S${s} · E${e}` : `Episode ${e}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) over ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("PirateXplay", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = `${PX_BASE}/${ref.kind}/${ref.slug}/`;
    const epNumber = String((ref.slug.match(/-\d+x(\d+)$/) || [])[1] || "1");
    const seasonNumber = String((ref.slug.match(/-(\d+)x\d+$/) || [])[1] || "1");
    console.log(`[Player] 🎬 PirateXplay — ${mediaUrl}`);

    const streams = [];
    const failedLinks = [];

    try {
        const html = await getPage(mediaUrl);
        const embeds = [];
        const re = /<iframe[^>]+(?:data-src|src)="(https?:\/\/[^"]+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const link = decodeEntities(m[1]);
            if (embeds.indexOf(link) === -1) embeds.push(link);
        }

        // Vidmoly often appears twice (.net and .biz): resolve each id once.
        const vidmoly = [];
        for (const link of embeds) {
            if (/vidmoly\./i.test(link)) {
                const id = (link.match(/embed-([a-z0-9]+)/i) || [])[1] || link;
                if (!vidmoly.some(v => v.id === id)) vidmoly.push({ id: id, url: link });
            } else {
                failedLinks.push({ server_name: hostOf(link) || "unknown", url: link, reason: "Unsupported host (encrypted, domain-locked or unreachable)" });
            }
        }

        const resolved = await Promise.all(vidmoly.map(v => vidmolyExtract(v.url).catch(() => null)));
        vidmoly.forEach((v, i) => {
            const result = resolved[i];
            if (result && !streams.some(s => s.streamUrl === result.streamUrl)) {
                streams.push({ title: vidmoly.length > 1 ? `${result.title} #${i + 1}` : result.title, streamUrl: result.streamUrl, headers: result.headers });
            } else if (!result) {
                failedLinks.push({ server_name: "Vidmoly", url: v.url, reason: "Extraction failed" });
            }
        });

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${failedLinks.length} unsupported.`);

        sendSupabaseLog("PirateXplay", "PLAYER", {
            media_url: mediaUrl,
            season_number: seasonNumber,
            ep_number: epNumber,
            streams_found: streams.length,
            subtitles_found: false,
            allSubtitles_count: 0,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("PirateXplay", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: seasonNumber, ep_number: epNumber,
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
        sendSupabaseLog("PirateXplay", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
