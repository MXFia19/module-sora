// ==========================================
// ⚙️ SORA MODULE — HOLLYMOVIEHD
// ==========================================
// HollyMovieHD (yeshd.net, nmovies.cc; hollymoviehd.cc and novamovie.net are
// Cloudflare-gated mirrors of the same WordPress) hosts its uploads on its own
// player, goodstream.cc.
//   search  : GET /search/<keywords>          (cards: a.ml-mask + img.mli-thumb;
//             "?s=" is challenged by Cloudflare, this route is not)
//   movie   : /<slug>                          one page per movie
//   series  : /series/<slug>-season-<n>        one page per season,
//             episodes at /episode/<slug>-season-<n>-episode-<e>
//   player  : every movie/episode page carries
//             <div id="player2" data-streamkey="…" data-wpnonce="…">
//             POST /wp-admin/admin-ajax.php action=ajax_getlinkstream
//                  &streamkey&nonce&imdbid&tmdbid
//             -> {servers_iframe:{streamsvr:"https://goodstream.cc/embed/<id>?e=…"},
//                 mq:[{title, servers_iframe:{streamsvr, hydrax}}]}
//   goodstream.cc/embed/<id> embeds a csrf_token; POSTing it back to the same
//   URL (form: token=&csrf_token=…) returns {sources:[{file, label, type:"hls"}]}
//   — two HLS mirrors ("LS" on letsgocdn, "GS" on goodstream itself). The
//   segments are TS files named .png/.svg; playlists and segments need the
//   embed page URL as Referer.
// Hydrax (playhydrax.com) links are not used.

const HM_SITE = "https://yeshd.net";
const GS_HOST = "https://goodstream.cc";
const HM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    if (!headers["User-Agent"]) headers["User-Agent"] = HM_UA;
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
    const headers = { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Referer": referer || `${HM_SITE}/` };
    return await readBody(await soraFetch(url, { method: 'GET', headers: headers }));
}

function decodeEntities(s) {
    return String(s || "")
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8211;/g, '–').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&amp;/g, '&');
}

function stripTags(s) {
    return decodeEntities(String(s || "").replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function formEncode(obj) {
    return Object.keys(obj).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k] == null ? '' : obj[k])}`).join('&');
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 HollyMovieHD — searching for "${keyword}"`);
    try {
        const html = await getPage(`${HM_SITE}/search/${encodeURIComponent(keyword)}`);
        const results = [];
        const seen = {};
        const cardRe = /<a href="(https:\/\/[^"]+)"[^>]*class="ml-mask[^"]*"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = cardRe.exec(html)) !== null) {
            const href = m[1].replace(/^https:\/\/(?:www\.)?[^/]+/, HM_SITE);
            if (seen[href]) continue;
            seen[href] = true;
            const img = m[3].match(/<img[^>]+src="([^"]+)"/);
            results.push({ title: decodeEntities(m[2]), image: img ? img[1] : "", href: href });
        }

        // The WordPress REST search as a fallback (no posters).
        if (results.length === 0) {
            const body = await readBody(await soraFetch(`${HM_SITE}/wp-json/wp/v2/search?search=${encodeURIComponent(keyword)}&per_page=20`, { headers: { "Accept": "application/json" } }));
            let list = [];
            try { list = JSON.parse(body); } catch (e) { }
            for (const item of (Array.isArray(list) ? list : [])) {
                if (!item || !item.url || seen[item.url]) continue;
                if (item.subtype !== 'post' && item.subtype !== 'tvshows') continue;
                seen[item.url] = true;
                results.push({ title: decodeEntities(item.title), image: "", href: item.url });
            }
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("HollyMovieHD", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("HollyMovieHD", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

async function extractDetails(url) {
    console.log(`[Details] 📖 HollyMovieHD — ${url}`);
    sendSupabaseLog("HollyMovieHD", "DETAILS", { media_url: url });

    try {
        const html = await getPage(url);
        const desc = html.match(/<div class="desc"[^>]*>([\s\S]*?)<\/div>/)
            || html.match(/itemprop="description"[^>]*>([\s\S]*?)<\/(?:div|p)>/);
        const meta = html.match(/<meta (?:name|property)="(?:og:)?description" content="([^"]*)"/);
        const description = (desc ? stripTags(desc[1]) : "") || (meta ? decodeEntities(meta[1]) : "") || "No synopsis available.";

        const genres = [];
        const genreRe = /href="https:\/\/[^"]+\/genre\/[^"]+" rel="category tag">([^<]+)</g;
        let g;
        while ((g = genreRe.exec(html)) !== null && genres.length < 4) genres.push(decodeEntities(g[1]));
        const rating = (html.match(/class="imdb-r"[^>]*>([^<]+)</) || [])[1] || "";
        const year = (html.match(/Release:\s*<\/strong>\s*<a[^>]*>((?:19|20)\d{2})/) || html.match(/itemprop="datePublished"[^>]*content="((?:19|20)\d{2})/) || [])[1] || "";

        const aliases = [];
        if (rating) aliases.push(`Rating: ${rating.trim()}`);
        if (genres.length) aliases.push(genres.join(', '));

        return JSON.stringify([{ description: description, aliases: aliases.join(' | '), airdate: year }]);
    } catch (error) {
        sendSupabaseLog("HollyMovieHD", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    console.log(`[Episodes] 📂 HollyMovieHD — ${url}`);
    try {
        if (url.indexOf('/series/') === -1) {
            return JSON.stringify([{ href: url, number: 1, season: 1, title: "Movie" }]);
        }

        const html = await getPage(url);
        const season = parseInt((url.match(/-season-(\d+)/) || [])[1] || "1", 10);
        const list = html.match(/<ul class="episodeList">([\s\S]*?)<\/ul>/);
        const episodes = [];
        const seen = {};
        const epRe = /<a href='(https:\/\/[^']+\/episode\/[^']+)'>([^<]*)<\/a>/g;
        let m;
        while ((m = epRe.exec(list ? list[1] : html)) !== null) {
            const href = m[1].replace(/^https:\/\/(?:www\.)?[^/]+/, HM_SITE);
            if (seen[href]) continue;
            seen[href] = true;
            const n = parseInt(m[2], 10) || parseInt((href.match(/-episode-(\d+)/) || [])[1] || "0", 10) || (episodes.length + 1);
            episodes.push({ href: href, number: n, season: season, title: `Episode ${n}` });
        }
        episodes.sort((a, b) => a.number - b.number);

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("HollyMovieHD", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎞️ HOST: GOODSTREAM
// ==========================================

async function goodstream(embedUrl, pageUrl) {
    const html = await getPage(embedUrl, `${HM_SITE}/`);
    const csrf = (html.match(/id="csrf_token" value="([^"]+)"/) || [])[1] || "";
    if (!csrf) return { error: /not found|removed|deleted/i.test(html) ? "File removed" : "No csrf_token on the embed" };

    const response = await soraFetch(embedUrl, {
        method: 'POST',
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Accept": "application/json, */*",
            "Referer": embedUrl,
            "Origin": GS_HOST
        },
        body: formEncode({ token: "", csrf_token: csrf })
    });
    let data = null;
    try { data = JSON.parse(await readBody(response)); } catch (e) { }
    if (!data || !data.success || !Array.isArray(data.sources)) return { error: "goodstream refused the source request" };

    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    const sources = data.sources
        .filter(s => s && s.file)
        .map(s => ({ url: /^https?:/.test(s.file) ? s.file : `${GS_HOST}${s.file.charAt(0) === '/' ? '' : '/'}${s.file}`, label: s.label || 'HLS' }));
    return { sources: sources, title: decodeEntities(title) };
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    console.log(`[Player] 🎬 HollyMovieHD — ${url}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];

    try {
        const html = await getPage(url);
        const streamkey = (html.match(/data-streamkey="([^"]+)"/) || [])[1] || "";
        const nonce = (html.match(/data-wpnonce="([^"]+)"/) || [])[1] || (html.match(/data-nonce="([^"]+)"/) || [])[1] || "";
        const imdbid = (html.match(/data-imdbid="([^"]+)"/) || [])[1] || "";
        const tmdbid = (html.match(/data-tmdbid="([^"]+)"/) || [])[1] || "";

        if (!streamkey) {
            failedLinks.push({ server_name: "HollyMovieHD", url: url, reason: "No stream key on the page" });
        } else {
            const response = await soraFetch(`${HM_SITE}/wp-admin/admin-ajax.php`, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttp" + "Request",
                    "Accept": "application/json, */*",
                    "Referer": url,
                    "Origin": HM_SITE
                },
                body: formEncode({ action: "ajax_getlinkstream", streamkey: streamkey, nonce: nonce, imdbid: imdbid, tmdbid: tmdbid })
            });
            let data = null;
            try { data = JSON.parse(await readBody(response)); } catch (e) { }

            // One entry per uploaded version (quality); the top-level one is the default.
            const versions = [];
            if (data && data.servers_iframe) versions.push({ title: "", servers: data.servers_iframe, subtitles: data.subtitles });
            for (const mq of ((data && data.mq) || [])) if (mq && mq.servers_iframe) versions.push({ title: mq.title || "", servers: mq.servers_iframe, subtitles: mq.subtitles });

            const embeds = [];
            for (const v of versions) {
                for (const name of Object.keys(v.servers)) {
                    const link = v.servers[name];
                    if (!link) continue;
                    if (!/goodstream|streamsvr/i.test(name + link)) {
                        failedLinks.push({ server_name: name, url: link, reason: `${name} not supported` });
                        continue;
                    }
                    // The same embed appears with and without its ?e= signature: keep one per id.
                    const id = (link.match(/\/embed\/([A-Za-z0-9]+)/) || [])[1] || link;
                    const existing = embeds.find(e => e.id === id);
                    if (existing) { if (link.indexOf('?e=') !== -1 && existing.link.indexOf('?e=') === -1) existing.link = link; continue; }
                    embeds.push({ id: id, link: link, title: v.title });
                }
                const subs = v.subtitles;
                if (subs && typeof subs === 'object') {
                    for (const lang of Object.keys(subs)) {
                        const subUrl = subs[lang];
                        if (typeof subUrl === 'string' && /^https?:/.test(subUrl) && !allSubtitles.some(s => s.url === subUrl)) {
                            allSubtitles.push({ url: subUrl, label: lang, kind: "captions", headers: { "Referer": `${GS_HOST}/` } });
                        }
                    }
                }
            }

            for (const embed of embeds.slice(0, 3)) {
                const res = await goodstream(embed.link, url);
                if (res.error) {
                    failedLinks.push({ server_name: "goodstream", url: embed.link, reason: res.error });
                    continue;
                }
                const quality = ((embed.title || res.title).match(/(2160|1080|720|480|360)p/i) || [])[0] || "";
                // Playlists only answer with the embed page itself as Referer
                // (the bare goodstream.cc origin gets a 403); segments accept it too.
                const referer = embed.link.split('?')[0];
                for (const source of res.sources) {
                    if (streams.some(s => s.streamUrl === source.url)) continue;
                    streams.push({
                        title: `GoodStream ${source.label}${quality ? ` ${quality}` : ''}`,
                        streamUrl: source.url,
                        headers: { "Referer": referer, "User-Agent": HM_UA }
                    });
                }
            }
        }

        const english = allSubtitles.find(s => /english|^en/i.test(s.label));
        const bestSubtitle = english ? english.url : (allSubtitles[0] ? allSubtitles[0].url : "");

        console.log(`[Player] 📊 Summary: ${streams.length} link(s).`);

        sendSupabaseLog("HollyMovieHD", "PLAYER", {
            media_url: url,
            season_number: String((url.match(/-season-(\d+)/) || [])[1] || "1"),
            ep_number: String((url.match(/-episode-(\d+)/) || [])[1] || "1"),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("HollyMovieHD", "UNSUPPORTED_HOSTS", {
                media_url: url,
                season_number: String((url.match(/-season-(\d+)/) || [])[1] || "1"),
                ep_number: String((url.match(/-episode-(\d+)/) || [])[1] || "1"),
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: bestSubtitle,
            subtitlesHeaders: bestSubtitle ? { "Referer": `${GS_HOST}/` } : {},
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("HollyMovieHD", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
