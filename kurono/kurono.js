// ==========================================
// ⚙️ SORA MODULE — KURONO
// ==========================================
// kurono.nl is a Next.js anime site whose API is entirely open. Its notable
// feature is soft subtitles: up to 28 tracks per title, French included.
//
//   1. Catalogue  GET /sitemap.xml
//                 -> every /series/<slug> (1929) and /movies/<slug> (716).
//                    There is no search endpoint, so the sitemap is the index
//                    and titles are derived from the slugs.
//   2. Synopsis   GET /api/synopsis?slug=<slug>      -> {synopsis}
//   3. Episodes   GET /api/anikoto-episodes?slug=&title=
//                 -> {seasons:[{anikotoSlug, seasonNumber, label,
//                      episodes:[{num,title,thumbnail,description,sub,dub}]}]}
//   4. Playback   GET /api/stream-resolve?slug=&ep=&anikotoSlug=&title=
//                 -> {m3u8, subtitles:[{label,lang,url}], intro, outro, sourceId}
//
// Subtitles hang off the source: `legacy` carries the soft tracks, `anibd`
// returns none because it is hard-subbed. So the module queries the default
// source first (that is the one with the subtitles) and then asks again with
// &exclude=legacy purely to add a second stream. Getting that backwards would
// silently lose every subtitle.
//
// m3u8 and subtitle urls come back relative, pointing at the site's own
// proxy (/api/anime-stream?proxy=<upstream>), so they are prefixed with the
// base and need no extra headers.

const KU_BASE = "https://kurono.nl";

const KU_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Preferred subtitle language for the single `subtitles` field Sora shows by
// default; everything else still ships in allSubtitles.
const KU_PREFERRED_SUBS = ["french", "english"];

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
    if (!headers["User-Agent"]) headers["User-Agent"] = KU_UA;
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

async function kuGet(path, referer) {
    const headers = {
        "User-Agent": KU_UA,
        "Accept": "*/*",
        "Referer": referer || `${KU_BASE}/`
    };
    return await readBody(await soraFetch(`${KU_BASE}${path}`, { method: 'GET', headers: headers }));
}

async function kuGetJson(path, referer) {
    const body = await kuGet(path, referer);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// Absolute the site-relative urls the API hands back.
function absolute(url) {
    if (!url) return "";
    return url.charAt(0) === '/' ? `${KU_BASE}${url}` : url;
}

// "bleach-thousand-year-blood-war" -> "Bleach Thousand Year Blood War".
// The sitemap only carries slugs, so this is how search results get a name.
function deslug(slug) {
    return String(slug)
        .split('-')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function normalise(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Kurono — searching for "${keyword}"`);
    try {
        // No search endpoint exists; the sitemap is the catalogue.
        const xml = await kuGet('/sitemap.xml');
        if (!xml) return JSON.stringify([]);

        const needle = normalise(keyword);
        const results = [];
        const seen = new Set();

        const re = /\/(series|movies)\/([a-z0-9-]+)/g;
        let m;
        while ((m = re.exec(xml)) !== null) {
            const kind = m[1];
            const slug = m[2];
            const key = `${kind}/${slug}`;
            if (seen.has(key)) continue;
            seen.add(key);

            if (needle && normalise(slug).indexOf(needle) === -1) continue;

            results.push({
                title: `${deslug(slug)} · ${kind === 'movies' ? 'Movie' : 'Series'}`,
                image: `${KU_BASE}/api/poster?slug=${encodeURIComponent(slug)}`,
                href: `kurono://${kind}/${slug}`
            });
            if (results.length >= 40) break;
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Kurono", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Kurono", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('kurono://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'movies' ? 'movies' : 'series', slug: parts[1] || '' };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 Kurono — ${ref.kind}/${ref.slug}`);
    sendSupabaseLog("Kurono", "DETAILS", { media_url: `${KU_BASE}/${ref.kind}/${ref.slug}` });

    try {
        const data = await kuGetJson(`/api/synopsis?slug=${encodeURIComponent(ref.slug)}`);
        const description = (data && (data.synopsis || data.overview || data.description)) || "";

        const aliasParts = [];
        const airing = await kuGetJson(`/api/airing?slug=${encodeURIComponent(ref.slug)}`);
        if (airing && airing.status) aliasParts.push(String(airing.status));
        if (airing && airing.nextEpisode) aliasParts.push(`Next episode: ${airing.nextEpisode}`);

        return JSON.stringify([{
            description: description || "No synopsis available.",
            aliases: aliasParts.join(' | '),
            airdate: (airing && (airing.startDate || airing.airingAt)) ? String(airing.startDate || airing.airingAt) : ""
        }]);
    } catch (error) {
        sendSupabaseLog("Kurono", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 Kurono — ${ref.kind}/${ref.slug}`);

    try {
        const title = deslug(ref.slug);
        const data = await kuGetJson(
            `/api/anikoto-episodes?slug=${encodeURIComponent(ref.slug)}&title=${encodeURIComponent(title)}&cv=8`
        );
        const seasons = data && Array.isArray(data.seasons) ? data.seasons : [];

        const episodes = [];
        for (const season of seasons) {
            // Each season carries its own anikotoSlug, and playback needs it,
            // so it rides along in the href rather than being re-fetched.
            const anikotoSlug = season.anikotoSlug || ref.slug;
            const seasonNumber = typeof season.seasonNumber === 'number' ? season.seasonNumber : 1;
            const list = Array.isArray(season.episodes) ? season.episodes : [];

            for (const ep of list) {
                const n = typeof ep.num === 'number' ? ep.num : parseInt(ep.num, 10);
                if (!Number.isFinite(n)) continue;
                episodes.push({
                    href: `kurono-play://${ref.slug}/${anikotoSlug}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: ep.title || `Episode ${n}`
                });
            }
        }

        episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));
        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Kurono", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function resolveSource(slug, anikotoSlug, ep, title, exclude) {
    let path = `/api/stream-resolve?slug=${encodeURIComponent(slug)}&ep=${encodeURIComponent(ep)}`
        + `&anikotoSlug=${encodeURIComponent(anikotoSlug)}&title=${encodeURIComponent(title)}`;
    if (exclude) path += `&exclude=${encodeURIComponent(exclude)}`;
    return await kuGetJson(path, `${KU_BASE}/series/${slug}`);
}

function subtitleRank(lang) {
    const index = KU_PREFERRED_SUBS.indexOf(String(lang || '').toLowerCase());
    return index === -1 ? KU_PREFERRED_SUBS.length : index;
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const parts = url.replace('kurono-play://', '').split('/');
    const slug = parts[0];
    const anikotoSlug = parts[1] || slug;
    const ep = parts[2] || '1';
    const title = deslug(slug);
    const mediaUrl = `${KU_BASE}/series/${slug}`;

    console.log(`[Player] 🎬 Kurono — ${slug} (${anikotoSlug}), episode ${ep}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};
    let bestRank = KU_PREFERRED_SUBS.length + 1;

    try {
        // The anikotoSlug decides which source answers, and the two forms do
        // not give the same thing: for Look Back the bare slug returns the
        // `legacy` source with 28 subtitle tracks, while the suffixed
        // `look-back-dxt0w` returns `anibd` with none. Neither form wins
        // everywhere, so both are asked and the results merged.
        const attempts = [{ ak: anikotoSlug, exclude: null }];
        if (slug !== anikotoSlug) attempts.push({ ak: slug, exclude: null });
        attempts.push({ ak: anikotoSlug, exclude: 'legacy' });

        const payloads = [];
        for (const attempt of attempts) {
            payloads.push(await resolveSource(slug, attempt.ak, ep, title, attempt.exclude));
        }

        for (const data of payloads) {
            if (!data) continue;

            const streamUrl = absolute(data.m3u8);
            if (streamUrl && !streams.some(s => s.streamUrl === streamUrl)) {
                streams.push({
                    title: `Kurono ${data.sourceId || 'source'}`,
                    streamUrl: streamUrl,
                    headers: { "Referer": `${KU_BASE}/`, "User-Agent": KU_UA }
                });
                console.log(`   -> stream ${data.sourceId || '?'}`);
            }

            for (const caption of (Array.isArray(data.subtitles) ? data.subtitles : [])) {
                const subUrl = absolute(caption.url || caption.src || caption.file);
                if (!subUrl) continue;
                if (allSubtitles.some(s => s.url === subUrl)) continue;

                const label = caption.label || caption.lang || "Unknown";
                allSubtitles.push({
                    url: subUrl,
                    label: label,
                    kind: "captions",
                    headers: { "Referer": `${KU_BASE}/` }
                });

                const rank = subtitleRank(caption.lang);
                if (rank < bestRank) {
                    bestRank = rank;
                    bestSubtitle = subUrl;
                    bestSubtitleHeaders = { "Referer": `${KU_BASE}/` };
                }
            }
        }

        // Without a preferred language, still offer the first track found.
        if (!bestSubtitle && allSubtitles.length) {
            bestSubtitle = allSubtitles[0].url;
            bestSubtitleHeaders = { "Referer": `${KU_BASE}/` };
        }

        if (streams.length === 0) {
            failedLinks.push({ server_name: "Kurono", url: mediaUrl, reason: "stream-resolve returned no m3u8" });
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("Kurono", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: String(ep),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("Kurono", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: "1", ep_number: String(ep),
                failed_count: failedLinks.length, failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: bestSubtitle,
            subtitlesHeaders: bestSubtitleHeaders,
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("Kurono", "ERROR", { media_url: mediaUrl, season_number: "1", error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
