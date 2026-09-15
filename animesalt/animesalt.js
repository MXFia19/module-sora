// ==========================================
// ⚙️ SORA MODULE — ANIMESALT
// ==========================================
// animesalt.cx is a WordPress site (DooPlay theme). Nothing is encrypted; the
// whole chain fits in HTML plus two POSTs:
//
//   1. Search    GET  /?s=<text>              -> <article> with /series/<slug>/
//   2. Seasons   POST /wp-admin/admin-ajax.php
//                     action=action_select_season&season=<n>&post=<id>
//                -> the <li> of every episode in that season
//   3. Episode   GET  /episode/<slug>-<S>x<E>/
//                -> <iframe src="https://as-cdnNN.top/video/<hash>">
//                   plus a multi-language player whose links are base64
//   4. Stream    POST https://as-cdnNN.top/player/index.php?data=<hash>&do=getVideo
//                     hash=<hash>&r=<referrer>
//                -> {"hls":true,"videoSource":"…/master.m3u8?md5=…&expires=…"}
//
// The final link is signed (`?md5=…&expires=…`) and **bound to the IP** of the
// client that called getVideo: nginx's `secure_link` takes `remote_addr` into
// its hash. From a player this is transparent — the same machine makes both
// calls. From a rotating-IP sandbox the stream returns 403 about one time in
// fifteen, when both requests happen to land on the same egress: the chain up
// to `videoSource` is therefore verified, the final playback is not verifiable
// from there. Same situation as FireStream (section 15 of DECRYPTORS.md).
//
// Practical consequence: do not cache the link, and consume it immediately
// after getVideo.

const AS_BASE = "https://animesalt.cx";

const AS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    // the caller did not set one (AniList and TMDB calls, notably).
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = AS_UA;
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

async function asGet(url, referer) {
    const headers = {
        "User-Agent": AS_UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Referer": referer || `${AS_BASE}/`
    };
    return await readBody(await soraFetch(url, { method: 'GET', headers: headers }));
}

async function asPost(url, referer, body) {
    const headers = {
        "User-Agent": AS_UA,
        "Accept": "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer
    };
    return await readBody(await soraFetch(url, { method: 'POST', headers: headers, body: body }));
}

function decodeEntities(text) {
    if (!text) return "";
    return String(text)
        .replace(/&#8217;|&#039;|&#39;|&rsquo;/g, "'")
        .replace(/&#8211;|&ndash;/g, '–')
        .replace(/&quot;|&#34;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code, 10)))
        .trim();
}

function stripTags(html) {
    return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 AnimeSalt — searching for "${keyword}"`);
    try {
        const html = await asGet(`${AS_BASE}/?s=${encodeURIComponent(keyword)}`, `${AS_BASE}/`);

        const results = [];
        const seen = new Set();

        // Each result is an <article> carrying its title, its poster and, last,
        // the full-block link to the entry.
        const articles = html.match(/<article[^>]*class="post[^"]*"[\s\S]*?<\/article>/g) || [];
        for (const article of articles) {
            const hrefMatch = article.match(/href="(https:\/\/animesalt\.cx\/(?:series|movies)\/[^"]+)"/);
            if (!hrefMatch) continue;
            const href = hrefMatch[1];
            if (seen.has(href)) continue;
            seen.add(href);

            const titleMatch = article.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/);
            const title = titleMatch ? stripTags(titleMatch[1]) : href;

            // The poster sits in data-src (lazy loading) and often has no
            // protocol.
            const imgMatch = article.match(/data-src="([^"]+)"/) || article.match(/<img[^>]+src="(https?:[^"]+)"/);
            let image = imgMatch ? imgMatch[1] : "";
            if (image.indexOf('//') === 0) image = `https:${image}`;

            const kind = href.indexOf('/movies/') !== -1 ? 'Movie' : 'Series';
            results.push({ title: `${title} · ${kind}`, image: image, href: href });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("AnimeSalt", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("AnimeSalt", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

async function extractDetails(url) {
    console.log(`[Details] 📖 AnimeSalt — ${url}`);
    sendSupabaseLog("AnimeSalt", "DETAILS", { media_url: url });

    try {
        const html = await asGet(url, `${AS_BASE}/`);

        let description = "";
        const descMatch = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        if (descMatch) description = stripTags(descMatch[1]);
        if (!description) {
            const ogMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/);
            if (ogMatch) description = decodeEntities(ogMatch[1]);
        }

        const aliasParts = [];
        const ratingMatch = html.match(/<span[^>]*class="[^"]*dt_rating_vgs[^"]*"[^>]*>([^<]+)</);
        if (ratingMatch) aliasParts.push(`Rating: ${ratingMatch[1].trim()}`);

        const genres = [];
        const genreBlock = html.match(/<div[^>]*class="[^"]*sgeneros[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        if (genreBlock) {
            const links = genreBlock[1].match(/>([^<>]+)<\/a>/g) || [];
            for (const g of links) genres.push(stripTags(g));
        }
        if (genres.length) aliasParts.push(genres.join(', '));

        let airdate = "";
        const dateMatch = html.match(/<span[^>]*class="date"[^>]*>([^<]+)</) || html.match(/annee-(\d{4})/);
        if (dateMatch) airdate = decodeEntities(dateMatch[1]);

        return JSON.stringify([{
            description: description || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("AnimeSalt", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

// The <li> returned by the entry page and by the season AJAX share one shape.
function parseEpisodeItems(html, seasonNumber) {
    const episodes = [];
    const items = html.match(/<li>[\s\S]*?<\/li>/g) || [];

    for (const item of items) {
        const hrefMatch = item.match(/href="(https:\/\/animesalt\.cx\/episode\/[^"]+)"/);
        if (!hrefMatch) continue;

        // The episode number sits in <span class="num-epi">, and the URL
        // confirms it in the form -<S>x<E>/.
        const numMatch = item.match(/<span[^>]*class="num-epi"[^>]*>\s*(\d+)/);
        const urlMatch = hrefMatch[1].match(/-(\d+)x(\d+)\/?$/);

        const season = urlMatch ? parseInt(urlMatch[1], 10) : seasonNumber;
        const number = urlMatch ? parseInt(urlMatch[2], 10) : (numMatch ? parseInt(numMatch[1], 10) : 0);
        if (!number) continue;

        const titleMatch = item.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/);
        const title = titleMatch ? stripTags(titleMatch[1]) : `Episode ${number}`;

        episodes.push({ href: hrefMatch[1], number: number, season: season, title: title });
    }
    return episodes;
}

async function extractEpisodes(url) {
    console.log(`[Episodes] 📂 AnimeSalt — ${url}`);

    try {
        const html = await asGet(url, `${AS_BASE}/`);

        // A movie has no list: it plays from its own page.
        if (url.indexOf('/movies/') !== -1) {
            return JSON.stringify([{ href: url, number: 1, season: 1, title: "Movie" }]);
        }

        // The season tabs carry the post id and the season number:
        // data-post="1258" data-season="2".
        const postMatch = html.match(/data-post="(\d+)"/);
        const postId = postMatch ? postMatch[1] : null;

        const seasons = [];
        const seasonRe = /data-season="(\d+)"/g;
        let m;
        while ((m = seasonRe.exec(html)) !== null) {
            const n = parseInt(m[1], 10);
            if (seasons.indexOf(n) === -1) seasons.push(n);
        }
        if (seasons.length === 0) seasons.push(1);
        seasons.sort((a, b) => a - b);

        const all = [];
        const seen = new Set();

        // The season shown up front is already in the page.
        for (const ep of parseEpisodeItems(html, seasons[0])) {
            const key = `${ep.season}x${ep.number}`;
            if (seen.has(key)) continue;
            seen.add(key);
            all.push(ep);
        }

        // The others are asked of the theme's AJAX endpoint.
        for (const season of seasons) {
            if (all.some(ep => ep.season === season)) continue;
            if (!postId) continue;

            const body = `action=action_select_season&season=${season}&post=${postId}`;
            const chunk = await asPost(`${AS_BASE}/wp-admin/admin-ajax.php`, url, body);
            for (const ep of parseEpisodeItems(chunk, season)) {
                const key = `${ep.season}x${ep.number}`;
                if (seen.has(key)) continue;
                seen.add(key);
                all.push(ep);
            }
        }

        all.sort((a, b) => (a.season - b.season) || (a.number - b.number));

        console.log(`[Episodes] ✅ ${all.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(all);
    } catch (error) {
        sendSupabaseLog("AnimeSalt", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

// The page's multi-language player encodes its list in base64:
//   player.php?data=W3sibGFuZ3VhZ2UiOiJIaW5kaSIsImxpbmsiOiJodHRwczpcL1wv…
// that is, [{"language":"Hindi","link":"https://short.icu/…"}, …].
function pureAtob(input) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const str = String(input).replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '');
    let output = '';
    let bc = 0, bs = 0, buffer;
    for (let i = 0; i < str.length; i++) {
        buffer = chars.indexOf(str.charAt(i));
        if (buffer === -1) continue;
        bs = bc % 4 ? bs * 64 + buffer : buffer;
        if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
    return output;
}

function parseMultiLang(html) {
    const match = html.match(/multi-lang-plyr\/player\.php\?data=([A-Za-z0-9+/=]+)/);
    if (!match) return [];
    try {
        const list = JSON.parse(pureAtob(match[1]));
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

// The iframe names the host and the token: https://as-cdnNN.top/video/<hash>
function parseCdnEmbeds(html) {
    const embeds = [];
    const re = /https:\/\/([a-z0-9-]+\.top)\/video\/([a-f0-9]{16,64})/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const entry = { host: m[1], hash: m[2] };
        if (!embeds.some(e => e.hash === entry.hash)) embeds.push(entry);
    }
    return embeds;
}

async function resolveCdn(host, hash, referer) {
    const url = `https://${host}/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`;
    const body = `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent(referer)}`;
    const text = await asPost(url, `https://${host}/video/${hash}`, body);
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    console.log(`[Player] 🎬 AnimeSalt — ${url}`);

    const streams = [];
    const failedLinks = [];

    try {
        const html = await asGet(url, `${AS_BASE}/`);

        const embeds = parseCdnEmbeds(html);
        console.log(`[Player] 🧩 ${embeds.length} CDN embed(s) detected`);

        for (const embed of embeds) {
            const data = await resolveCdn(embed.host, embed.hash, `${AS_BASE}/`);

            if (!data) {
                failedLinks.push({ server_name: embed.host, url: `https://${embed.host}/video/${embed.hash}`, reason: "getVideo returned no JSON" });
                continue;
            }

            // A single stream (HLS) or a list of sources, depending on the title.
            const candidates = [];
            if (data.videoSource) candidates.push({ url: data.videoSource, label: data.hls ? 'HLS' : 'Direct' });
            if (Array.isArray(data.videoSources)) {
                for (const s of data.videoSources) {
                    if (s && s.file) candidates.push({ url: s.file, label: s.label || s.type || 'Direct' });
                }
            }

            if (candidates.length === 0) {
                failedLinks.push({ server_name: embed.host, url: `https://${embed.host}/video/${embed.hash}`, reason: "No source in the response" });
                continue;
            }

            for (const candidate of candidates) {
                if (streams.some(s => s.streamUrl === candidate.url)) continue;
                streams.push({
                    title: `AnimeSalt ${embed.host} (${candidate.label})`,
                    streamUrl: candidate.url,
                    headers: { "Referer": `https://${embed.host}/`, "User-Agent": AS_UA }
                });
                console.log(`   -> ${embed.host} / ${candidate.label}`);
            }
        }

        // The multi-language tracks go through a URL shortener: they cannot be
        // returned as they are, but they are reported rather than pretended
        // out of existence.
        const langs = parseMultiLang(html);
        if (langs.length) {
            console.log(`[Player] 🌐 ${langs.length} multi-language track(s) behind a shortener, unresolved: ${langs.map(l => l.language).join(', ')}`);
            failedLinks.push({
                server_name: "multi-lang-plyr",
                url: langs.map(l => l.link).join(' '),
                reason: `Links behind short.icu (${langs.map(l => l.language).join('/')})`
            });
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s).`);

        sendSupabaseLog("AnimeSalt", "PLAYER", {
            media_url: url,
            season_number: "1",
            ep_number: "1",
            streams_found: streams.length,
            subtitles_found: false,
            allSubtitles_count: 0,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("AnimeSalt", "UNSUPPORTED_HOSTS", {
                media_url: url, season_number: "1", ep_number: "1",
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
        sendSupabaseLog("AnimeSalt", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
