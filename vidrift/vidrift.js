// ==========================================
// ⚙️ SORA MODULE — VIDRIFT
// ==========================================
// VidRift (embed.vidrift.in) is the host feeding cinezo and several other
// bookmarked movie catalogues. It is keyed by TMDB id, movies and TV alike.
//
// Its embed page carries everything in the clear, in a script variable:
//   var embedMeta = {tmdbId, type, season, episode, provider,
//                    playbackToken, selfhostUrl, selfhostKind, …};
//   var <subs> = [{code, label, url}, …];
// No encryption, no signature to reproduce: just read the page.
//
// Two link shapes depending on the title:
//   - cdn.vidrift.net/movie_<id>/vod.m3u8            (fixed path)
//   - reelvault.click/s/<base64>.<hmac>/vod.m3u8     (signed, perishable)
// The second shape is sometimes signed for a title the CDN does not have, so
// the link is probed before being returned rather than promising a dead stream.
//
// When self-hosting is missing (or alongside it) the player falls back to a
// cascade of relays, which it declares itself in its unminified code:
//   GET /api/source/<movie/<id>|tv/<id>/<s>/<e>>?token=<playbackToken>&provider=<name>
//   -> {success, source, quality, streams:[{index, url, proxyUrl, type}], subtitles}
// "url" there is empty: everything goes through "proxyUrl", sometimes relative.

const VR_EMBED = "https://embed.vidrift.in";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const VR_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// VidRift answers "Embed this page in an iframe." (403) to requests it judges
// bare, so we always present ourselves as an embed.
const VR_PARENT = "https://cinezo.org/";

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
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
        } else {
            return await fetch(url, options);
        }
    } catch (e) {
        try { return await fetch(url, options); } catch (error) { return null; }
    }
}

async function readBody(response) {
    if (!response) return "";
    if (typeof response.text === 'function') return await response.text();
    if (typeof response.data === 'string') return response.data;
    return "";
}

async function tmdbGet(path) {
    const glue = path.indexOf('?') === -1 ? '?' : '&';
    const url = `${TMDB_API}${path}${glue}api_key=${TMDB_API_KEY}`;
    const response = await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json" } });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

async function vrEmbedPage(path) {
    const headers = {
        "User-Agent": VR_UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Referer": VR_PARENT
    };
    const response = await soraFetch(`${VR_EMBED}${path}`, { method: 'GET', headers: headers });
    return await readBody(response);
}

// ==========================================
// 🧩 READING THE EMBED PAGE
// ==========================================

function parseEmbedMeta(html) {
    if (!html) return null;
    const match = html.match(/var\s+embedMeta\s*=\s*(\{[\s\S]*?\});/);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch (e) { return null; }
}

// The subtitle list is declared just before embedMeta, under a variable name
// that changes from build to build, so match it by shape rather than by name.
function parseSubtitleList(html) {
    if (!html) return [];
    const match = html.match(/var\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(\[\s*\{\s*"code"[\s\S]*?\}\s*\]);/);
    if (!match) return [];
    try {
        const list = JSON.parse(match[1]);
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

// Relays declared by the player, in its order of preference. "selfhost" is
// handled separately (it is read from embedMeta, with no extra call).
const VR_RELAYS = ["vaplayer", "vidlove", "cinepro"];

// The path /api/source expects carries the id, and for a series the season and
// the episode.
function sourcePath(ref) {
    return ref.kind === 'tv'
        ? `tv/${ref.id}/${ref.season}/${ref.episode}`
        : `movie/${ref.id}`;
}

async function vrRelay(ref, token, provider) {
    const query = `token=${encodeURIComponent(token)}&provider=${encodeURIComponent(provider)}`;
    const url = `${VR_EMBED}/api/source/${sourcePath(ref)}?${query}`;
    const headers = { "User-Agent": VR_UA, "Accept": "application/json", "Referer": `${VR_EMBED}/` };
    const body = await readBody(await soraFetch(url, { method: 'GET', headers: headers }));
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// A signed link can point at a title the CDN does not have, so ask for two
// bytes before offering it.
async function linkIsAlive(url) {
    try {
        const response = await soraFetch(url, {
            method: 'GET',
            headers: { "User-Agent": VR_UA, "Range": "bytes=0-1", "Referer": `${VR_EMBED}/` }
        });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = await readBody(response);
        // The CDN answers "Not found" as plain text, with a 404 that not every
        // client surfaces.
        if (!body) return false;
        if (body.indexOf('Not found') !== -1 && body.indexOf('#EXTM3U') === -1) return false;
        return true;
    } catch (e) { return false; }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 VidRift — searching for "${keyword}"`);
    try {
        const data = await tmdbGet(`/search/multi?query=${encodeURIComponent(keyword)}&include_adult=false&language=en-US`);
        const items = data && Array.isArray(data.results) ? data.results : [];

        const results = [];
        for (const item of items) {
            if (!item || !item.id) continue;
            const kind = item.media_type === 'tv' ? 'tv' : (item.media_type === 'movie' ? 'movie' : null);
            if (!kind) continue;

            const name = item.title || item.name || item.original_title || item.original_name;
            if (!name) continue;

            const date = item.release_date || item.first_air_date || "";
            const year = date ? date.slice(0, 4) : "";
            const badge = kind === 'tv' ? 'TV' : 'Movie';

            results.push({
                title: year ? `${name} (${year}) · ${badge}` : `${name} · ${badge}`,
                image: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : "",
                href: `vidrift://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("VidRift", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("VidRift", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('vidrift://', '').replace('vidrift-play://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 VidRift — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("VidRift", "DETAILS", { media_url: `${VR_EMBED}/embed/${ref.kind}/${ref.id}` });

    try {
        const data = await tmdbGet(`/${ref.kind}/${ref.id}?language=en-US`);
        if (!data || !data.id) {
            return JSON.stringify([{ description: 'Entry not found on TMDB.', aliases: '', airdate: '' }]);
        }

        const description = (data.overview || "").trim() || "No synopsis available.";

        const aliasParts = [];
        if (data.vote_average) aliasParts.push(`Rating: ${Number(data.vote_average).toFixed(1)}/10`);
        if (Array.isArray(data.genres) && data.genres.length) aliasParts.push(data.genres.map(g => g.name).join(', '));
        if (data.runtime) aliasParts.push(`${data.runtime} min`);
        if (data.number_of_seasons) aliasParts.push(`${data.number_of_seasons} season(s)`);

        const airdate = data.release_date || data.first_air_date || "";

        return JSON.stringify([{
            description: description,
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("VidRift", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 VidRift — ${ref.kind} ${ref.id}`);

    try {
        // A movie has a single entry; Sora still expects a list.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `vidrift-play://movie/${ref.id}`,
                number: 1,
                season: 1,
                title: "Movie"
            }]);
        }

        const show = await tmdbGet(`/tv/${ref.id}?language=en-US`);
        const seasons = show && Array.isArray(show.seasons) ? show.seasons : [];

        const episodes = [];
        for (const season of seasons) {
            const seasonNumber = season.season_number;
            // Season 0 collects the specials, which VidRift does not host.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `vidrift-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s) across ${seasons.length} season(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("VidRift", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const path = ref.kind === 'tv'
        ? `/embed/tv/${ref.id}/${ref.season}/${ref.episode}`
        : `/embed/movie/${ref.id}`;
    const mediaUrl = `${VR_EMBED}${path}`;

    console.log(`[Player] 🎬 VidRift — ${mediaUrl}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let bestSubtitleHeaders = {};

    try {
        const html = await vrEmbedPage(path);

        if (!html || html.indexOf('embedMeta') === -1) {
            const reason = html && html.indexOf('iframe') !== -1
                ? "VidRift requires an embed context (403)"
                : "Empty or unexpected page";
            console.log(`[Player] ⚠️ ${reason}`);
            sendSupabaseLog("VidRift", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: String(ref.season || "1"), ep_number: String(ref.episode || "1"),
                failed_count: 1, failed_links: [{ server_name: "VidRift", url: mediaUrl, reason: reason }]
            });
            return JSON.stringify({ type: "none" });
        }

        const meta = parseEmbedMeta(html);
        if (!meta) {
            console.log(`[Player] ⚠️ embedMeta unreadable.`);
            return JSON.stringify({ type: "none" });
        }

        console.log(`[Player] 🧩 provider=${meta.provider} selfhostKind=${meta.selfhostKind || 'none'}`);

        if (meta.selfhostUrl) {
            const alive = await linkIsAlive(meta.selfhostUrl);
            if (alive) {
                const host = (meta.selfhostUrl.match(/https?:\/\/([^/]+)/) || [])[1] || "VidRift";
                streams.push({
                    title: `VidRift Direct (${host})`,
                    streamUrl: meta.selfhostUrl,
                    headers: { "Referer": `${VR_EMBED}/`, "User-Agent": VR_UA }
                });
                console.log(`   -> Direct: ${meta.selfhostUrl.slice(0, 80)}…`);
            } else {
                // VidRift sometimes signs a path for a title it does not have.
                console.log(`   -> Signed link is dead, discarded.`);
                failedLinks.push({ server_name: "VidRift Direct", url: meta.selfhostUrl, reason: "Signed link but missing on the CDN" });
            }
        } else {
            failedLinks.push({ server_name: "VidRift Direct", url: mediaUrl, reason: `No selfhostUrl (provider=${meta.provider})` });
        }

        // The relays: they cover the titles VidRift does not self-host, and add
        // qualities to the ones it does.
        if (meta.playbackToken) {
            for (const provider of VR_RELAYS) {
                const data = await vrRelay(ref, meta.playbackToken, provider);

                if (!data || !Array.isArray(data.streams) || data.streams.length === 0) {
                    failedLinks.push({ server_name: provider, url: `${VR_EMBED}/api/source/${sourcePath(ref)}`, reason: "No stream returned" });
                    continue;
                }

                const label = data.source || provider;
                for (const stream of data.streams) {
                    // "url" is systematically empty on VidRift's side: it is
                    // "proxyUrl" that carries the stream, sometimes relative.
                    let streamUrl = stream.proxyUrl || stream.url || "";
                    if (!streamUrl) continue;
                    if (streamUrl.charAt(0) === '/') streamUrl = `${VR_EMBED}${streamUrl}`;
                    if (streams.some(s => s.streamUrl === streamUrl)) continue;

                    const quality = data.quality || stream.type || 'HLS';
                    streams.push({
                        title: `VidRift ${label} ${stream.index + 1} (${quality})`,
                        streamUrl: streamUrl,
                        headers: { "Referer": `${VR_EMBED}/`, "User-Agent": VR_UA }
                    });
                    console.log(`   -> ${provider}/${label} #${stream.index + 1}`);
                }

                // Each relay carries its own subtitle list.
                if (Array.isArray(data.subtitles)) {
                    for (const caption of data.subtitles) {
                        const subUrl = caption.url || caption.src || caption.file || "";
                        if (!subUrl) continue;
                        if (allSubtitles.some(s => s.url === subUrl)) continue;
                        allSubtitles.push({
                            url: subUrl,
                            label: caption.label || caption.language || caption.lang || provider,
                            kind: "captions",
                            headers: { "Referer": `${VR_EMBED}/` }
                        });
                    }
                }
            }
        }

        for (const caption of parseSubtitleList(html)) {
            const subUrl = caption.url || "";
            if (!subUrl) continue;
            const label = caption.label || caption.code || "Unknown";

            allSubtitles.push({
                url: subUrl,
                label: label,
                kind: "captions",
                headers: { "Referer": `${VR_EMBED}/` }
            });

            const code = String(caption.code || "").toLowerCase();
            if (bestSubtitle === "" || code === 'en') {
                bestSubtitle = subUrl;
                bestSubtitleHeaders = { "Referer": `${VR_EMBED}/` };
            }
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("VidRift", "PLAYER", {
            media_url: mediaUrl,
            season_number: String(ref.season || "1"),
            ep_number: String(ref.episode || "1"),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("VidRift", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl,
                season_number: String(ref.season || "1"),
                ep_number: String(ref.episode || "1"),
                failed_count: failedLinks.length,
                failed_links: failedLinks
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
        sendSupabaseLog("VidRift", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
