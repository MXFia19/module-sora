// ==========================================
// ⚙️ SORA MODULE — LEVIDIA
// ==========================================
// Levidia (levidia.ch, formerly piratenz.eu; mirror goojara.to) is a link
// directory: its own catalogue of movies and series, each title/episode page
// listing third-party host links.
//   search  : GET /search.php?q=<q>            -> movie.php?watch=… / tv-show.php?watch=…
//   series  : GET /tv-show.php?watch=<slug>    -> tv-episode.php?watch=<slug>-s<S>e<E>-<title>
//   links   : <li class="xxx0"> … <b>Host</b> … <a href="/go.php?url=<token>">
// go.php only redirects when the request carries the PHPSESSID of the page
// that listed the link plus a cookie the page sets from inline JS:
//   _3chk('<name>','<value>')  ->  document.cookie = name=value
// (otherwise it answers 404). Both are read from the page response here.
//
// Hosts: almost every link goes to Luluvdo. go.php still points at the dead
// luluvdo.com domain, so its Location is read without following it and only
// the 12-character file code is kept; the player now lives on lplaygo.com
// (lulustream.com redirects there). Its
// /e/<code> player hides the HLS master in a Dean Edwards p.a.c.k.e.r block,
// unpacked locally. Many Luluvdo files are deleted, so links are tried in
// order until a few live ones are found. Nearly every title also has one
// Wootly link (MP4, read below). Doodstream is not used: dood.re answers a
// Cloudflare challenge for every live file.

const LV_SITE = "https://www.levidia.ch";
const LV_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const LV_MAX_STREAMS = 3;   // Luluvdo: stop once this many live streams are found
const LV_MAX_TRIES = 12;    // Luluvdo links tried at most per page (many are deleted)
const LV_MAX_WOOTLY = 2;    // Wootly links tried at most per page

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
    if (!headers["User-Agent"]) headers["User-Agent"] = LV_UA;
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
    const headers = { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", ...(extra || {}) };
    const response = await soraFetch(url, { method: 'GET', headers: headers });
    return { response: response, html: await readBody(response) };
}

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
    const re = new RegExp(`(?:^|[\\s,;])${name}=([^;,\\s]+)`);
    for (const v of values) {
        const m = (' ' + v).match(re);
        if (m) return m[1];
    }
    return "";
}

function decodeEntities(s) {
    return String(s || "")
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&middot;/g, '·').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&amp;/g, '&');
}

function stripTags(s) {
    return decodeEntities(String(s || "").replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function absolute(href) {
    if (/^https?:\/\//i.test(href)) return href.replace(/^http:/, 'https:');
    return `${LV_SITE}/${String(href).replace(/^\/+/, '')}`;
}

// ==========================================
// 📦 P.A.C.K.E.R
// ==========================================

function unpack(packed) {
    const args = packed.match(/}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!args) return "";
    let p = args[1].replace(/\\'/g, "'");
    const a = parseInt(args[2], 10);
    let c = parseInt(args[3], 10);
    const k = args[4].split('|');
    const base = (n) => (n < a ? '' : base(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    while (c--) {
        if (k[c]) p = p.replace(new RegExp('\\b' + base(c) + '\\b', 'g'), k[c]);
    }
    return p;
}

function unpackAll(html) {
    let out = "";
    const re = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)[^)]*\)\)/g;
    let m;
    while ((m = re.exec(html)) !== null) out += "\n" + unpack(m[0]);
    return out;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Levidia — searching for "${keyword}"`);
    try {
        const { html } = await getPage(`${LV_SITE}/search.php?q=${encodeURIComponent(keyword)}`);
        const results = [];
        const seen = {};
        const itemRe = /<li class="mlist"[\s\S]*?<\/li>/g;
        let m;
        while ((m = itemRe.exec(html)) !== null) {
            const item = m[0];
            const link = item.match(/href="(https?:\/\/[^"]+\/(?:movie|tv-show)\.php\?watch=[^"]+)"/);
            if (!link) continue;
            const href = absolute(link[1]);
            if (seen[href]) continue;
            seen[href] = true;
            const name = (item.match(/<strong>([\s\S]*?)<\/strong>\s*(\(\d{4}\))?/) || []);
            const img = (item.match(/<img src="([^"]+)" class="avatarm"/) || [])[1] || "";
            const kind = href.indexOf('tv-show.php') !== -1 ? 'TV' : 'Movie';
            results.push({
                title: `${stripTags(name[1] || href.split('watch=')[1])}${name[2] ? ` ${name[2]}` : ''} · ${kind}`,
                image: /noimg\.png/.test(img) ? "" : img,
                href: href
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Levidia", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Levidia", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

async function extractDetails(url) {
    console.log(`[Details] 📖 Levidia — ${url}`);
    sendSupabaseLog("Levidia", "DETAILS", { media_url: url });
    try {
        const { html } = await getPage(url);
        const plot = html.match(/<div class="plot"[^>]*>([\s\S]*?)<\/div>/);
        const genre = html.match(/<div class="kanan genre">([\s\S]*?)<\/div>/);
        const year = (html.match(/nd=release&(?:amp;)?year=(\d{4})/) || [])[1] || "";
        return JSON.stringify([{
            description: plot ? stripTags(plot[1]) : "No synopsis available.",
            aliases: genre ? stripTags(genre[1]) : "",
            airdate: year
        }]);
    } catch (error) {
        sendSupabaseLog("Levidia", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    console.log(`[Episodes] 📂 Levidia — ${url}`);
    try {
        if (url.indexOf('tv-show.php') === -1) {
            return JSON.stringify([{ href: url, number: 1, season: 1, title: "Movie" }]);
        }
        const { html } = await getPage(url);
        const episodes = [];
        const seen = {};
        const re = /<a\s+href="((?:https?:\/\/[^"]+\/)?tv-episode\.php\?watch=([^"]+))"[^>]*>([^<]*)<\/a>/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const se = m[2].match(/-s(\d+)e(\d+)(?:-|$)/i);
            if (!se) continue;
            const href = absolute(m[1]);
            if (seen[href]) continue;
            seen[href] = true;
            const season = parseInt(se[1], 10), number = parseInt(se[2], 10);
            if (season < 1) continue;
            episodes.push({ href: href, number: number, season: season, title: decodeEntities(m[3]).trim() || `Episode ${number}` });
        }
        episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));
        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Levidia", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎞️ HOST: LULUVDO
// ==========================================

const LULU_HOST = "https://lplaygo.com";

// Where go.php points, without following it (the target domain is dead).
async function goTarget(goUrl, headers) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            const h = { "User-Agent": LV_UA, ...headers };
            const res = await fetchv2(goUrl, h, 'GET', null, false);
            const hs = res && res.headers;
            let loc = "";
            if (hs) {
                if (typeof hs.get === 'function') loc = hs.get('location') || hs.get('Location') || "";
                else loc = hs.location || hs.Location || "";
            }
            if (loc) return { location: String(loc), html: "" };
            const body = await readBody(res);
            return { location: res && typeof res.url === 'string' ? res.url : "", html: body };
        }
    } catch (e) { /* falls back to a followed request below */ }
    const hop = await getPage(goUrl, headers);
    return { location: hop.response && typeof hop.response.url === 'string' ? hop.response.url : "", html: hop.html };
}

async function luluvdo(code) {
    const embedUrl = `${LULU_HOST}/e/${code}`;
    const { html } = await getPage(embedUrl, { "Referer": `${LV_SITE}/` });
    if (/no longer available|deleted|not found/i.test(html) && html.indexOf('eval(function(p,a,c,k,e,d)') === -1) return { error: "File deleted on Luluvdo" };
    const code2 = html + unpackAll(html);
    const file = code2.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/) || code2.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (!file) return { error: "No HLS in the Luluvdo player" };
    return { streamUrl: file[1].replace(/\\\//g, '/'), headers: { "Referer": `${LULU_HOST}/`, "Origin": LULU_HOST, "User-Agent": LV_UA } };
}

// ==========================================
// 🎞️ HOST: WOOTLY
// ==========================================

// go.php -> www.wootly.ch/?v=<token>, a page whose iframe is
// web.wootly.ch/e/<…>. That player only shows a play button; clicking it
// POSTs qdfx=1 back to the same address, which answers the real player:
//   var vd="<id>", tk="<token>"  ->  GET /grabm?t=<tk>&id=<vd>  -> MP4 link
// The MP4 link is signed for the IP that asked for it: the device makes every
// request itself, so it plays there; it is not cached.
async function wootly(pageUrl, referer) {
    const { html } = await getPage(pageUrl, { "Referer": referer });
    const iframe = (html.match(/<iframe[^>]+src="([^"]+)"/i) || [])[1];
    if (!iframe) return { error: /not found|deleted|removed/i.test(html) ? "File deleted on Wootly" : "No Wootly player" };
    const playerUrl = iframe.indexOf("//") === 0 ? `https:${iframe}` : iframe;
    const playerOrigin = (playerUrl.match(/^https?:\/\/[^/]+/) || [])[0];
    if (!playerOrigin) return { error: "Bad Wootly player address" };

    const res = await soraFetch(playerUrl, {
        method: 'POST',
        headers: { "Referer": playerUrl, "Origin": playerOrigin, "Content-Type": "application/x-www-form-urlencoded" },
        body: "qdfx=1"
    });
    const player = await readBody(res);
    const vd = (player.match(/\bvd\s*=\s*"(\d+)"/) || [])[1];
    const tk = (player.match(/\btk\s*=\s*"([^"]+)"/) || [])[1];
    if (!vd || !tk) return { error: "No Wootly token after play" };

    const link = (await readBody(await soraFetch(`${playerOrigin}/grabm?t=${encodeURIComponent(tk)}&id=${encodeURIComponent(vd)}`, {
        method: 'GET', headers: { "Referer": playerUrl }
    }))).trim();
    if (!/^https?:\/\//.test(link)) return { error: "Wootly returned no video link" };
    return { streamUrl: link, headers: { "Referer": `${playerOrigin}/`, "User-Agent": LV_UA } };
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function parseLinks(html) {
    const links = [];
    const itemRe = /<li class="xxx0">([\s\S]*?)<\/li>/g;
    let m;
    while ((m = itemRe.exec(html)) !== null) {
        const go = m[1].match(/href="(https?:\/\/[^"]+\/go\.php\?url=[^"]+)"/);
        if (!go) continue;
        const host = (m[1].match(/class="kiri xxx1[^"]*">(?:\s*<a[^>]*>)?\s*<b>([^<]+)<\/b>/) || [])[1] || "";
        const quality = stripTags((m[1].match(/class="kiri xxx3">([^<]*)</) || [])[1] || "");
        links.push({ host: host.trim(), quality: quality, go: absolute(go[1]) });
    }
    return links;
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    console.log(`[Player] 🎬 Levidia — ${url}`);

    const streams = [];
    const failedLinks = [];

    try {
        const { response, html } = await getPage(url);
        const session = cookieValue(response, 'PHPSESSID');
        const js = html.match(/_3chk\('([^']+)','([^']+)'\)/);
        const cookie = [session ? `PHPSESSID=${session}` : "", js ? `${js[1]}=${js[2]}` : ""].filter(Boolean).join('; ');

        const links = parseLinks(html);
        let tries = 0, luluFound = 0, wootlyTries = 0;
        for (const link of links) {
            const isLulu = /lulu/i.test(link.host);
            const isWootly = /wootly/i.test(link.host);
            if (!isLulu && !isWootly) {
                failedLinks.push({ server_name: link.host || "unknown", url: link.go, reason: `${link.host} not supported` });
                continue;
            }
            // Luluvdo: tried in order until a few live files; Wootly (usually a
            // single listing per page) has its own budget.
            if (isLulu && (luluFound >= LV_MAX_STREAMS || tries >= LV_MAX_TRIES)) continue;
            if (isWootly && wootlyTries >= LV_MAX_WOOTLY) continue;
            if (isLulu) tries++; else wootlyTries++;
            try {
                // go.php -> 302 -> luluvdo.com/[d/]<code> or www.wootly.ch/?v=<token> (read, not followed).
                const hop = await goTarget(link.go, cookie ? { "Referer": url, "Cookie": cookie } : { "Referer": url });
                const finalUrl = hop.location;
                if (isWootly) {
                    if (!/^https?:\/\/[^/]*wootly\./i.test(finalUrl)) {
                        failedLinks.push({ server_name: link.host, url: link.go, reason: hop.html ? "No Wootly page after go.php" : "go.php refused (cookies)" });
                        continue;
                    }
                    const wres = await wootly(finalUrl, url);
                    if (wres.error) {
                        failedLinks.push({ server_name: link.host, url: finalUrl, reason: wres.error });
                        continue;
                    }
                    streams.push({ title: `Wootly${link.quality ? ` (${link.quality})` : ''} · MP4`, streamUrl: wres.streamUrl, headers: wres.headers });
                    console.log(`   -> Wootly`);
                    continue;
                }
                const code = (finalUrl.match(/^https?:\/\/[^/]+\/(?:[de]\/)?([a-z0-9]{12})(?:[/?#]|$)/i) || [])[1]
                    || (hop.html.match(/lulu[a-z]*\.[a-z]+\/e\/([a-z0-9]{12})/i) || [])[1]
                    || (hop.html.match(/name="file_code" value="([a-z0-9]{12})"/i) || [])[1];
                if (!code) {
                    failedLinks.push({ server_name: link.host, url: link.go, reason: hop.html ? "No Luluvdo code after go.php" : "go.php refused (cookies)" });
                    continue;
                }
                const res = await luluvdo(code);
                if (res.error) {
                    failedLinks.push({ server_name: link.host, url: `${LULU_HOST}/e/${code}`, reason: res.error });
                    continue;
                }
                // Several listings often point at the same upload: compare without the token.
                const same = (a) => a.split('?')[0] === res.streamUrl.split('?')[0];
                if (streams.some(s => same(s.streamUrl))) continue;
                luluFound++;
                streams.push({ title: `Luluvdo${link.quality ? ` (${link.quality})` : ''} #${luluFound}`, streamUrl: res.streamUrl, headers: res.headers });
                console.log(`   -> Luluvdo ${code}`);
            } catch (e) {
                failedLinks.push({ server_name: link.host, url: link.go, reason: String(e) });
            }
        }

        console.log(`[Player] 📊 Summary: ${streams.length} link(s) from ${links.length} listed.`);

        const se = url.match(/-s(\d+)e(\d+)/i);
        sendSupabaseLog("Levidia", "PLAYER", {
            media_url: url,
            season_number: se ? se[1] : "1",
            ep_number: se ? se[2] : "1",
            streams_found: streams.length,
            subtitles_found: false,
            allSubtitles_count: 0,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("Levidia", "UNSUPPORTED_HOSTS", {
                media_url: url,
                season_number: se ? se[1] : "1",
                ep_number: se ? se[2] : "1",
                failed_count: failedLinks.length,
                failed_links: failedLinks.slice(0, 20)
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
        sendSupabaseLog("Levidia", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
