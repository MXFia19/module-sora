// ==========================================
// ⚙️ SORA MODULE — VIDRIFT
// ==========================================
// VidRift (embed.vidrift.in) est l'hébergeur qui alimente cinezo et
// plusieurs autres catalogues de films des favoris. Il s'indexe par
// identifiant TMDB, films comme séries.
//
// Sa page d'embarquement porte tout en clair, dans une variable de script :
//   var embedMeta = {tmdbId, type, season, episode, provider,
//                    playbackToken, selfhostUrl, selfhostKind, …};
//   var <subs> = [{code, label, url}, …];
// Aucun chiffrement, aucune signature à reproduire : il suffit de lire la page.
//
// Deux formes de lien selon le titre :
//   - cdn.vidrift.net/movie_<id>/vod.m3u8            (chemin fixe)
//   - reelvault.click/s/<base64>.<hmac>/vod.m3u8     (signé, périssable)
// La seconde forme est parfois signée pour un titre absent du CDN : on sonde
// donc le lien avant de le rendre, plutôt que de promettre un flux mort.

const VR_EMBED = "https://embed.vidrift.in";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Clé TMDB publique, celle déjà utilisée par le module bingebox de ce dépôt.
const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";

const VR_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// VidRift renvoie « Embed this page in an iframe. » (403) aux requêtes qu'il
// juge nues : on se présente toujours comme un embarquement.
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
        console.log(`[Tracker] 🚨 Erreur d'envoi vers Supabase : ${e.message}`);
    }
}

// ==========================================
// 🌐 RÉSEAU
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
// 🧩 LECTURE DE LA PAGE D'EMBARQUEMENT
// ==========================================

function parseEmbedMeta(html) {
    if (!html) return null;
    const match = html.match(/var\s+embedMeta\s*=\s*(\{[\s\S]*?\});/);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch (e) { return null; }
}

// La liste des sous-titres est déclarée juste avant embedMeta, sous un nom de
// variable qui change au gré des builds : on la repère à sa forme.
function parseSubtitleList(html) {
    if (!html) return [];
    const match = html.match(/var\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(\[\s*\{\s*"code"[\s\S]*?\}\s*\]);/);
    if (!match) return [];
    try {
        const list = JSON.parse(match[1]);
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

// Un lien signé peut désigner un titre absent du CDN : on demande deux octets
// avant de le proposer.
async function linkIsAlive(url) {
    try {
        const response = await soraFetch(url, {
            method: 'GET',
            headers: { "User-Agent": VR_UA, "Range": "bytes=0-1", "Referer": `${VR_EMBED}/` }
        });
        if (!response) return false;
        if (typeof response.status === 'number' && response.status >= 400) return false;
        const body = await readBody(response);
        // Le CDN répond « Not found » en texte brut, avec un 404 que tous les
        // clients ne remontent pas.
        if (!body) return false;
        if (body.indexOf('Not found') !== -1 && body.indexOf('#EXTM3U') === -1) return false;
        return true;
    } catch (e) { return false; }
}

// ==========================================
// 🔍 RECHERCHE
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 VidRift — recherche de "${keyword}"`);
    try {
        const data = await tmdbGet(`/search/multi?query=${encodeURIComponent(keyword)}&include_adult=false&language=fr-FR`);
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
            const badge = kind === 'tv' ? 'Série' : 'Film';

            results.push({
                title: year ? `${name} (${year}) · ${badge}` : `${name} · ${badge}`,
                image: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : "",
                href: `vidrift://${kind}/${item.id}`
            });
        }

        console.log(`[Search] ✅ ${results.length} résultat(s)`);
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
// 📖 DÉTAILS
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
        const data = await tmdbGet(`/${ref.kind}/${ref.id}?language=fr-FR`);
        if (!data || !data.id) {
            return JSON.stringify([{ description: 'Fiche introuvable sur TMDB.', aliases: '', airdate: '' }]);
        }

        const description = (data.overview || "").trim() || "Pas de synopsis disponible.";

        const aliasParts = [];
        if (data.vote_average) aliasParts.push(`Note : ${Number(data.vote_average).toFixed(1)}/10`);
        if (Array.isArray(data.genres) && data.genres.length) aliasParts.push(data.genres.map(g => g.name).join(', '));
        if (data.runtime) aliasParts.push(`${data.runtime} min`);
        if (data.number_of_seasons) aliasParts.push(`${data.number_of_seasons} saison(s)`);

        const airdate = data.release_date || data.first_air_date || "";

        return JSON.stringify([{
            description: description,
            aliases: aliasParts.join(' | '),
            airdate: airdate
        }]);
    } catch (error) {
        sendSupabaseLog("VidRift", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Erreur de chargement.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 ÉPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 VidRift — ${ref.kind} ${ref.id}`);

    try {
        // Un film n'a qu'une entrée : Sora attend quand même une liste.
        if (ref.kind === 'movie') {
            return JSON.stringify([{
                href: `vidrift-play://movie/${ref.id}`,
                number: 1,
                season: 1,
                title: "Film"
            }]);
        }

        const show = await tmdbGet(`/tv/${ref.id}?language=fr-FR`);
        const seasons = show && Array.isArray(show.seasons) ? show.seasons : [];

        const episodes = [];
        for (const season of seasons) {
            const seasonNumber = season.season_number;
            // La saison 0 regroupe les hors-séries, que VidRift n'héberge pas.
            if (typeof seasonNumber !== 'number' || seasonNumber < 1) continue;

            const detail = await tmdbGet(`/tv/${ref.id}/season/${seasonNumber}?language=fr-FR`);
            const list = detail && Array.isArray(detail.episodes) ? detail.episodes : [];

            for (const episode of list) {
                const n = episode.episode_number;
                if (typeof n !== 'number') continue;
                episodes.push({
                    href: `vidrift-play://tv/${ref.id}/${seasonNumber}/${n}`,
                    number: n,
                    season: seasonNumber,
                    title: episode.name || `Épisode ${n}`
                });
            }
        }

        console.log(`[Episodes] ✅ ${episodes.length} épisode(s) sur ${seasons.length} saison(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("VidRift", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 LECTURE
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
                ? "VidRift exige un embarquement (403)"
                : "Page vide ou inattendue";
            console.log(`[Player] ⚠️ ${reason}`);
            sendSupabaseLog("VidRift", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: String(ref.season || "1"), ep_number: String(ref.episode || "1"),
                failed_count: 1, failed_links: [{ server_name: "VidRift", url: mediaUrl, reason: reason }]
            });
            return JSON.stringify({ type: "none" });
        }

        const meta = parseEmbedMeta(html);
        if (!meta) {
            console.log(`[Player] ⚠️ embedMeta illisible.`);
            return JSON.stringify({ type: "none" });
        }

        console.log(`[Player] 🧩 provider=${meta.provider} selfhostKind=${meta.selfhostKind || 'aucun'}`);

        if (meta.selfhostUrl) {
            const alive = await linkIsAlive(meta.selfhostUrl);
            if (alive) {
                const host = (meta.selfhostUrl.match(/https?:\/\/([^/]+)/) || [])[1] || "VidRift";
                streams.push({
                    title: `VidRift Direct (${host})`,
                    streamUrl: meta.selfhostUrl,
                    headers: { "Referer": `${VR_EMBED}/`, "User-Agent": VR_UA }
                });
                console.log(`   -> Direct : ${meta.selfhostUrl.slice(0, 80)}…`);
            } else {
                // VidRift signe parfois un chemin pour un titre qu'il n'a pas.
                console.log(`   -> Lien signé mort, écarté.`);
                failedLinks.push({ server_name: "VidRift Direct", url: meta.selfhostUrl, reason: "Lien signé mais introuvable côté CDN" });
            }
        } else {
            failedLinks.push({ server_name: "VidRift Direct", url: mediaUrl, reason: `Aucun selfhostUrl (provider=${meta.provider})` });
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
            if (bestSubtitle === "" || code === 'fr') {
                if (bestSubtitle === "" || code === 'fr') {
                    bestSubtitle = subUrl;
                    bestSubtitleHeaders = { "Referer": `${VR_EMBED}/` };
                }
            }
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Bilan : ${streams.length} lien(s), ${allSubtitles.length} sous-titre(s).`);

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
