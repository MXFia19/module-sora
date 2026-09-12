// ==========================================
// ⚙️ SORA MODULE — BINGEBOX v3 (API .ac Unifiée)
// ==========================================

const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";
const BINGEBOX_API = "https://bingebox.ac/api/sources";
const BINGEBOX_REFERER = "https://bingebox.ac/";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Priorité des langues pour le sous-titre par défaut (Seulement Anglais)
const SUB_PRIORITY = ["eng", "english", "en"];

// ==========================================
// 🛠️ HELPERS
// ==========================================

function parseQuery(queryString) {
    const params = {};
    const pairs = queryString.split('&');
    for (let pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const key = decodeURIComponent(pair.slice(0, idx));
        const val = decodeURIComponent(pair.slice(idx + 1));
        params[key] = val;
    }
    return params;
}

// Sélection du meilleur sous-titre selon priorité de langue
function selectBestSubtitle(allSubtitles) {
    for (let lang of SUB_PRIORITY) {
        const found = allSubtitles.find(s =>
            (s.label || "").toLowerCase().includes(lang) ||
            (s.language || "").toLowerCase().includes(lang)
        );
        if (found) return found.url;
    }
    return allSubtitles.length > 0 ? allSubtitles[0].url : "";
}

function makeHeaders(referer) {
    return { "User-Agent": DEFAULT_USER_AGENT, "Referer": referer || BINGEBOX_REFERER };
}

// ==========================================
// ⚙️ CORE LOGIC
// ==========================================

// 1. RECHERCHE (Via TMDB)
async function searchResults(keyword) {
    console.log(`[Bingebox] 🔍 Recherche de : "${keyword}"`);
    try {
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(keyword)}&page=1&include_adult=false&language=en-US`;
        const res = await soraFetch(url);
        if (!res) return JSON.stringify([]);

        const data = JSON.parse(await res.text());
        const results = [];

        for (let item of (data.results || [])) {
            if (item.media_type !== 'movie' && item.media_type !== 'tv') continue;

            const title = item.title || item.name || "Titre inconnu";
            const year = (item.release_date || item.first_air_date || '').split('-')[0];
            const image = item.poster_path
                ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                : 'https://via.placeholder.com/500x750?text=No+Image';

            const href = `bingebox://${item.media_type}/${item.id}?title=${encodeURIComponent(title)}&year=${year}`;

            results.push({
                title: year ? `${title} (${year})` : title,
                image,
                href
            });
        }

        console.log(`[Bingebox] ✅ ${results.length} résultats trouvés.`);
        return JSON.stringify(results);
    } catch (e) {
        console.error(`[Bingebox] ❌ Erreur Recherche: ${e.message}`);
        return JSON.stringify([]);
    }
}

// 2. DÉTAILS (Via TMDB)
async function extractDetails(url) {
    console.log(`[Bingebox] 📖 Chargement détails : ${url}`);
    try {
        const match = url.match(/bingebox:\/\/([^/]+)\/([^?]+)/);
        if (!match) throw new Error("URL invalide");

        const [, type, id] = match;
        const res = await soraFetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=en-US`);
        if (!res) throw new Error("Échec réseau TMDB");

        const data = JSON.parse(await res.text());

        return JSON.stringify([{
            description: data.overview || "No description available.",
            aliases: `Rating: ${data.vote_average ? data.vote_average.toFixed(1) + '/10' : 'N/A'}`,
            airdate: `Released: ${data.release_date || data.first_air_date || 'Unknown'}`
        }]);
    } catch (e) {
        console.error(`[Bingebox] ❌ Erreur Détails: ${e.message}`);
        return JSON.stringify([{ description: "Erreur lors du chargement des détails." }]);
    }
}

// 3. ÉPISODES / FILM
async function extractEpisodes(url) {
    console.log(`[Bingebox] 📂 Chargement épisodes : ${url}`);
    try {
        const match = url.match(/bingebox:\/\/([^/]+)\/([^?]+)\?(.+)/);
        if (!match) throw new Error("URL invalide");

        const type = match[1];
        const id   = match[2];
        const params = parseQuery(match[3]);
        const title = params['title'] || "";
        const year  = params['year']  || "";

        // CAS A : Film
        if (type === 'movie') {
            return JSON.stringify([{
                href: `bingebox-play://movie/${id}?title=${encodeURIComponent(title)}&year=${year}`,
                title: "Full Movie",
                number: 1,
                season: 1
            }]);
        }

        // CAS B : Série
        const res = await soraFetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&language=en-US`);
        if (!res) throw new Error("Échec réseau TMDB");
        const data = JSON.parse(await res.text());

        let episodes = [];

        const seasonPromises = (data.seasons || []).map(async (season) => {
            if (season.season_number === 0) return;

            const sRes = await soraFetch(
                `https://api.themoviedb.org/3/tv/${id}/season/${season.season_number}?api_key=${TMDB_API_KEY}&language=en-US`
            );
            if (!sRes) return;

            const sData = JSON.parse(await sRes.text());
            for (let ep of (sData.episodes || [])) {
                episodes.push({
                    href: `bingebox-play://tv/${id}?title=${encodeURIComponent(title)}&year=${year}&s=${season.season_number}&e=${ep.episode_number}`,
                    title: ep.name || `Episode ${ep.episode_number}`,
                    number: ep.episode_number,
                    season: season.season_number,
                    image: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : ''
                });
            }
        });

        await Promise.all(seasonPromises);
        episodes.sort((a, b) => a.season !== b.season ? a.season - b.season : a.number - b.number);

        console.log(`[Bingebox] ✅ ${episodes.length} épisodes chargés.`);
        return JSON.stringify(episodes);

    } catch (e) {
        console.error(`[Bingebox] ❌ Erreur Épisodes: ${e.message}`);
        return JSON.stringify([]);
    }
}

// 4. LECTEUR VIDÉO
async function extractStreamUrl(url) {
    console.log(`[Bingebox] 🎬 Extraction vidéo : ${url}`);
    try {
        const match = url.match(/bingebox-play:\/\/([^/]+)\/([^?]+)\?(.+)/);
        if (!match) throw new Error("URL Play invalide");

        const type   = match[1];
        const id     = match[2];
        const params = parseQuery(match[3]);
        const title  = params['title'] || "";
        const year   = params['year']  || "";
        const s      = params['s'];
        const e      = params['e'];

        const apiMediaType = type === 'tv' ? 'show' : 'movie';

        // Nouvelle API Bingebox unifiée qui renvoie toutes les sources d'un coup
        let apiUrl = `${BINGEBOX_API}?tmdbId=${id}&mediaType=${apiMediaType}&title=${encodeURIComponent(title)}&year=${year}`;
        if (type === 'tv' && s && e) apiUrl += `&season=${s}&episode=${e}`;

        console.log(`[Bingebox] 📡 Appel API globale : ${apiUrl}`);

        const res = await soraFetch(apiUrl, { headers: makeHeaders(BINGEBOX_REFERER) });
        if (!res) throw new Error("Pas de réponse de l'API Bingebox");

        const text = await res.text();
        const json = JSON.parse(text);

        if (!json.success || !json.sources || json.sources.length === 0) {
            console.log(`[Bingebox] ⚠️ Aucune source retournée par l'API.`);
            return JSON.stringify({ type: "none" });
        }

        let streams = [];
        let allSubtitles = [];
        const seenUrls = new Set();
        const seenSubUrls = new Set();

        // Parcourir le tableau `sources`
        for (let source of json.sources) {
            const serverName = source.label || source.sourceId || "Serveur inconnu";
            
            if (source.stream) {
                // Flux vidéo (priorité à `playlist`, fallback sur `url`)
                const videoUrl = source.stream.playlist || source.stream.url;
                
                if (videoUrl && !seenUrls.has(videoUrl)) {
                    seenUrls.add(videoUrl);
                    
                    streams.push({
                        title: `Bingebox ${serverName.toUpperCase()}`,
                        streamUrl: videoUrl,
                        headers: makeHeaders(BINGEBOX_REFERER)
                    });
                    
                    console.log(`   ✅ [${serverName}] Ajouté : ${videoUrl.split('?')[0]}`);
                }

                // Sous-titres
                if (Array.isArray(source.stream.captions)) {
                    for (let cap of source.stream.captions) {
                        if (!cap.url || seenSubUrls.has(cap.url)) continue;
                        seenSubUrls.add(cap.url);

                        const subReferer = (cap.url.match(/https?:\/\/[^/]+/) || [BINGEBOX_REFERER])[0] + "/";

                        allSubtitles.push({
                            url: cap.url,
                            label: cap.label || cap.language || "SUB",
                            language: cap.language || "",
                            kind: cap.type === 'srt' ? 'subtitles' : 'captions',
                            headers: { "Referer": subReferer }
                        });
                    }
                }
            }
        }

        console.log(`[Bingebox] 📊 ${streams.length} streams | ${allSubtitles.length} sous-titres`);

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        // Trier les sous-titres selon la priorité (Anglais)
        allSubtitles.sort((a, b) => {
            const getPrio = (s) => {
                const lang = (s.label || s.language || "").toLowerCase();
                for (let i = 0; i < SUB_PRIORITY.length; i++) {
                    if (lang.includes(SUB_PRIORITY[i])) return i;
                }
                return 99; // Priorité la plus basse
            };
            return getPrio(a) - getPrio(b);
        });

        return JSON.stringify({
            type: "servers",
            streams,
            subtitles: selectBestSubtitle(allSubtitles),
            subtitlesHeaders: allSubtitles.length > 0
                ? allSubtitles.find(s => s.url === selectBestSubtitle(allSubtitles))?.headers || {}
                : {},
            allSubtitles
        });

    } catch (e) {
        console.error(`[Bingebox] ❌ Erreur Stream: ${e.message}`);
        return JSON.stringify({ type: "none" });
    }
}

// ==========================================
// 🛠️ OUTIL RÉSEAU
// ==========================================
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
        }
        return await fetch(url, options);
    } catch(e) {
        try { return await fetch(url, options); } catch { return null; }
    }
}