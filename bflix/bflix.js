// ==========================================
// ⚙️ SORA MODULE — BFLIX (+ arc018)
// ==========================================
// BFLIX (bbflix.one) and arc018 (arc018.stream) are two front-ends of the same
// "FSonline" network: both resolve their players through 0123movie.space, a
// TMDB/IMDb-keyed redirector, and serve subtitles from qqqcdn.cloud.
//   movie : /mv/<imdb>/<tmdb>/   -> Byse (filemoon family, mfw09.org)
//           /vmf/<imdb>/<tmdb>/  -> Vidmoly (kaembed.net / vidmoly.biz)
//   series: /pl/<tmdb>/<s>/<e>/  -> Byse
//           /vms/<tmdb>/<s>/<e>/ -> Vidmoly
// (arc018's "arc018" and "Vidmoly" servers and BFLIX's "Vidstream" and "Vidmoly"
// servers are exactly these four links; their other servers are videasy, vidfast
// and vidsrc embeds, which belong to other modules.)
//
// The catalogue is therefore TMDB, like vidrift. Playback follows the Vidmoly
// redirect: the embed page carries the HLS master in the clear
// (sources: [{ file: '…/master.m3u8?t=…' }]) and the subtitle tracks the site
// attached through ?subget=… (baseTracks: [{ file: '…vtt', label: '…' }]).
// Vidmoly assigns one of its proxy nodes (prx-xx-x-N.vmpx.online) per request;
// some nodes refuse some networks, so when the assigned node answers 403 the
// same signed path is tried on the other node seen in the wild.
// Byse (the first server on both sites) needs a WebCrypto attestation and a
// proof-of-work captcha before it releases its encrypted playback payload, so
// it is not used here.

const FS_REDIRECTOR = "https://0123movie.space";
const BF_SITE = "https://bbflix.one";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Public TMDB key, the one already used by this repository's bingebox module.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const BF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Vidmoly proxy nodes seen serving these files; the first one the page assigns
// is always tried first.
const VM_ALT_NODES = ["prx-ps-a-1"];

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
    if (!headers["User-Agent"]) headers["User-Agent"] = BF_UA;
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

async function tmdbGet(path) {
    const glue = path.indexOf('?') === -1 ? '?' : '&';
    const url = `${TMDB_API}${path}${glue}api_key=${TMDB_API_KEY}`;
    const response = await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json" } });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 BFLIX — searching for "${keyword}"`);
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
                href: `bflix://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("BFLIX", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("BFLIX", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    const rest = url.replace('bflix://', '').replace('bflix-play://', '');
    const parts = rest.split('/');
    return { kind: parts[0] === 'tv' ? 'tv' : 'movie', id: parts[1], season: parts[2], episode: parts[3] };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 BFLIX — ${ref.kind} TMDB ${ref.id}`);
    sendSupabaseLog("BFLIX", "DETAILS", { media_url: `${FS_REDIRECTOR}/${ref.kind}/${ref.id}` });

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

        return JSON.stringify([{
            description: description,
            aliases: aliasParts.join(' | '),
            airdate: data.release_date || data.first_air_date || ""
        }]);
    } catch (error) {
        sendSupabaseLog("BFLIX", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 BFLIX — ${ref.kind} ${ref.id}`);

    try {
        if (ref.kind === 'movie') {
            return JSON.stringify([{ href: `bflix-play://movie/${ref.id}`, number: 1, season: 1, title: "Movie" }]);
        }

        const show = await tmdbGet(`/tv/${ref.id}?language=en-US`);
        const seasons = show && Array.isArray(show.seasons) ? show.seasons : [];

        const episodes = [];
        for (const season of seasons) {
            const seasonNumber = season.season_number;
            // Season 0 collects the specials, which the redirector does not map.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=en-US`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `bflix-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Episode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} episode(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("BFLIX", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function decodeEntities(s) {
    return String(s || "").replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"');
}

// Asks for the first bytes of a playlist: Vidmoly nodes answer 403 (or an
// HTML error) when they refuse the caller.
async function playlistAlive(url, headers) {
    try {
        const response = await soraFetch(url, { method: 'GET', headers: { ...headers } });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = await readBody(response);
        return body.indexOf('#EXTM3U') !== -1;
    } catch (e) { return false; }
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    console.log(`[Player] 🎬 BFLIX — ${ref.kind} ${ref.id} ${ref.season || ''}/${ref.episode || ''}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    let mediaUrl = "";

    try {
        // Movies are keyed by IMDb id (the TMDB id is only informative), series by TMDB id.
        let path;
        if (ref.kind === 'tv') {
            path = `/vms/${ref.id}/${ref.season}/${ref.episode}/`;
        } else {
            const movie = await tmdbGet(`/movie/${ref.id}`);
            const imdb = movie && movie.imdb_id ? movie.imdb_id : "";
            if (!imdb) {
                console.log(`[Player] ⚠️ No IMDb id for TMDB ${ref.id}`);
                return JSON.stringify({ type: "none" });
            }
            path = `/vmf/${imdb}/${ref.id}/`;
        }
        mediaUrl = `${FS_REDIRECTOR}${path}`;

        // The redirector answers 302 to the Vidmoly embed; the client follows it.
        const response = await soraFetch(mediaUrl, {
            method: 'GET',
            headers: { "Referer": `${BF_SITE}/`, "Accept": "text/html,*/*;q=0.8" }
        });
        const html = await readBody(response);
        const finalUrl = (response && typeof response.url === 'string' && response.url) ? response.url : "";
        const embedOrigin = (finalUrl.match(/^https?:\/\/[^/]+/) || ["https://kaembed.net"])[0];

        const fileMatch = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i)
            || html.match(/['"](https?:\/\/[^'"]+\/hls2?\/[^'"]+\.m3u8[^'"]*)['"]/i);

        if (!fileMatch) {
            const reason = /not found|deleted|no longer/i.test(html) ? "File deleted on Vidmoly" : "No Vidmoly source in the page";
            failedLinks.push({ server_name: "Vidmoly", url: mediaUrl, reason: reason });
        } else {
            const master = decodeEntities(fileMatch[1]);
            const headers = { "Referer": `${embedOrigin}/`, "Origin": embedOrigin, "User-Agent": BF_UA };

            const candidates = [master];
            const node = (master.match(/^https?:\/\/(prx-[a-z0-9-]+)\./i) || [])[1];
            if (node) {
                for (const alt of VM_ALT_NODES) if (alt !== node) candidates.push(master.replace(`//${node}.`, `//${alt}.`));
            }

            let chosen = "";
            for (const candidate of candidates) {
                if (await playlistAlive(candidate, headers)) { chosen = candidate; break; }
            }

            if (chosen) {
                streams.push({ title: "Vidmoly (HLS)", streamUrl: chosen, headers: headers });
                console.log(`   -> Vidmoly: ${chosen.slice(0, 90)}…`);
            } else {
                failedLinks.push({ server_name: "Vidmoly", url: master, reason: "Every proxy node refused the playlist" });
            }

            // Subtitles the site attached (qqqcdn.cloud, one VTT per language).
            const trackRe = /file\s*:\s*['"]([^'"]+\.vtt[^'"]*)['"]\s*,\s*label\s*:\s*['"]([^'"]*)['"]/gi;
            let t;
            while ((t = trackRe.exec(html)) !== null) {
                const subUrl = decodeEntities(t[1]);
                if (allSubtitles.some(s => s.url === subUrl)) continue;
                allSubtitles.push({ url: subUrl, label: t[2] || "Unknown", kind: "captions", headers: { "Referer": `${embedOrigin}/` } });
                if (!bestSubtitle && /english/i.test(t[2])) bestSubtitle = subUrl;
            }
            if (!bestSubtitle && allSubtitles.length) bestSubtitle = allSubtitles[0].url;
        }

        failedLinks.push({ server_name: "Byse", url: `${FS_REDIRECTOR}${path.replace('/vmf/', '/mv/').replace('/vms/', '/pl/')}`, reason: "Attestation + proof-of-work captcha (not supported)" });

        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("BFLIX", "PLAYER", {
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
            sendSupabaseLog("BFLIX", "UNSUPPORTED_HOSTS", {
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
            subtitlesHeaders: bestSubtitle ? { "Referer": `${embedOrigin}/` } : {},
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("BFLIX", "ERROR", { media_url: mediaUrl || url, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
