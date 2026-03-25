// ==========================================
// ⚙️ MODULE SORA — PURSTREAM (Supabase Edition)
// ==========================================

// ==========================================
// 🗄️ TRACKER SUPABASE (Base de données)
// ==========================================

const SUPABASE_URL = "https://qyeisgowjisqbatrmqta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F68CBjFVPh71U0SdD9BQJg_UJgL9-Fj";

async function sendSupabaseLog(moduleName, actionType, dataPayload) {
    try {
        const payload = {
            module: moduleName,
            action: actionType,
            data: dataPayload
        };

        const headers = { 
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            "Prefer": "return=minimal" 
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
// ⚙️ LOGIQUE DU MODULE PURSTREAM
// ==========================================

let WORKING_DOMAIN = null;

async function getWorkingDomain() {
    if (WORKING_DOMAIN) return WORKING_DOMAIN; 

    try {
        console.log("[Purstream] Recherche de l'URL officielle sur purstream.wiki...");
        const response = await soraFetch("https://purstream.wiki/");
        const html = await response.text();
        const match = html.match(/https:\/\/(purstream\.[a-z]+)/);
        
        if (match && match[1]) {
            WORKING_DOMAIN = match[1]; // Ex: purstream.me
            console.log(`[Purstream] Domaine officiel trouvé : ${WORKING_DOMAIN}`);
            return WORKING_DOMAIN;
        } else {
            throw new Error("Impossible de trouver le domaine sur le wiki.");
        }
    } catch (err) {
        console.log(`[Purstream] Échec du wiki. Utilisation du domaine de secours. Erreur: ${err}`);
        WORKING_DOMAIN = "purstream.me"; 
        return WORKING_DOMAIN;
    }
}

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    try {
        const domain = await getWorkingDomain();
        const cleanKeyword = keyword.trim().toLowerCase();
        let apiUrl = "";
        let isCatalog = false;

        // --- GESTION DES COMMANDES COMBINÉES ---
        if (cleanKeyword.includes("!")) {
            isCatalog = true;

            let typeParam = "*";
            if (cleanKeyword.includes("!anime")) typeParam = "anime";
            else if (cleanKeyword.includes("!movie") || cleanKeyword.includes("!film")) typeParam = "movie";
            else if (cleanKeyword.includes("!serie") || cleanKeyword.includes("!tv")) typeParam = "tv";

            let sortParam = "recently-added";
            if (cleanKeyword.includes("!trend") || cleanKeyword.includes("!populaire")) sortParam = "most-viewed";
            else if (cleanKeyword.includes("!top")) sortParam = "best-rated";
            else if (cleanKeyword.includes("!new")) sortParam = "newest";

            apiUrl = `https://api.${domain}/api/v1/catalog/movies?page=1&sortBy=${sortParam}&types=${typeParam}&categoriesIds=*&franchisesIds=*&displayMode=large&perPage=50`;
        } 
        else {
            // --- RECHERCHE NORMALE ---
            const encodedKeyword = encodeURIComponent(keyword);
            apiUrl = `https://api.${domain}/api/v1/search-bar/search/${encodedKeyword}`;
        }

        const responseText = await soraFetch(apiUrl);
        const data = await responseText.json();

        function findArrayInObject(obj) {
            if (Array.isArray(obj)) return obj;
            if (obj && typeof obj === 'object') {
                for (let key in obj) {
                    if (Array.isArray(obj[key])) return obj[key];
                    let found = findArrayInObject(obj[key]);
                    if (found) return found;
                }
            }
            return null;
        }

        let items = [];

        if (isCatalog) {
            items = findArrayInObject(data) || [];
        } else {
            items = data?.data?.items?.movies?.items || [];
        }

        if (!Array.isArray(items) || items.length === 0) {
             return JSON.stringify([]);
        }

        // --- TRANSFORMATION DES RÉSULTATS ---
        const transformedResults = items.map(result => {
            let imgUrl = result.large_poster_path || result.small_poster_path || result.wallpaper_poster_path || result.poster_path || "https://via.placeholder.com/300x450/222222/FFFFFF?text=Aucune+Affiche";
            let title = result.title || result.name || "Titre inconnu";
            let hrefType = (result.type === "movie") ? "movie" : "serie";

            if (!result.type && isCatalog) {
                if (cleanKeyword.includes("!anime") || cleanKeyword.includes("!serie") || cleanKeyword.includes("!tv")) hrefType = "serie";
                if (cleanKeyword.includes("!movie") || cleanKeyword.includes("!film")) hrefType = "movie";
            }

            return {
                title: title,
                image: imgUrl,
                href: `https://${domain}/${hrefType}/${result.id}-${slugify(title)}`
            };
        }).filter(Boolean);

        // 📡 Log Supabase (Recherche)
        sendSupabaseLog("Purstream", "SEARCH", { 
            keyword: keyword, 
            results_count: transformedResults.length,
            top_results: transformedResults.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(transformedResults);
        
    } catch (error) {
        console.log('Fetch error in searchResults: ' + error);
        return JSON.stringify([]);
    }
}

function slugify(title) {
    return title
      .toLowerCase()
      .normalize("NFKD")                 
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")      
      .trim()
      .replace(/\s+/g, "-")              
      .replace(/-+/g, "-");              
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    console.log(`[Détails] 📖 Chargement des infos pour : ${url}`);
    
    // 📡 Log Supabase (Détails)
    sendSupabaseLog("Purstream", "DETAILS", { anime_url: url });

    try {
        const domain = await getWorkingDomain();
        let apiUrl = "";

        if(url.includes('movie')) {
            const match = url.match(/\/movie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");
            apiUrl = `https://api.${domain}/api/v1/media/${match[1]}/sheet`;
        } else if(url.includes('serie')) {
            const match = url.match(/\/serie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");
            apiUrl = `https://api.${domain}/api/v1/media/${match[1]}/sheet`;
        } else {
            throw new Error("Invalid URL format");
        }

        const responseText = await soraFetch(apiUrl, {
            headers: {
                "Referer": `https://${domain}/`,
                "Origin": `https://${domain}`
            }
        });
        const json = await responseText.json();
        const data = json.data.items;

        const duration = url.includes('movie') && data.runtime?.minutes 
            ? `${data.runtime.minutes} minutes` 
            : 'N/A';

        const transformedResults = [{
            description: data.overview || 'No description available',
            aliases: `Duration: ${duration}`,
            airdate: `Released: ${data.releaseDate ? data.releaseDate : 'N/A'}`
        }];

        return JSON.stringify(transformedResults);

    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Duration: Unknown',
            airdate: 'Aired/Released: Unknown'
        }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        const domain = await getWorkingDomain();

        // 1. SI C'EST UN FILM
        if(url.includes('movie')) {
            const match = url.match(/\/movie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");
            const movieId = match[1];
            
            const responseText = await soraFetch(`https://api.${domain}/api/v1/media/${movieId}/sheet`, {
                headers: {
                    "Referer": `https://${domain}/`,
                    "Origin": `https://${domain}`
                }
            });
            const json = await responseText.json();
            const data = json.data.items;

            return JSON.stringify([
                { 
                    href: `${movieId}/movie`, 
                    number: 1, 
                    season: 1, 
                    title: data.title || data.name || "Film complet", 
                    image: data.posters ? (data.posters.large || data.posters.small) : "", 
                    duration: data.runtime ? data.runtime.human : ""
                }
            ]);
            
        // 2. SI C'EST UNE SÉRIE / UN ANIME
        } else if(url.includes('serie')) {
            const match = url.match(/\/serie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");
            const showId = match[1];

            const responseText = await soraFetch(`https://api.${domain}/api/v1/media/${showId}/sheet`, {
                headers: {
                    "Referer": `https://${domain}/`,
                    "Origin": `https://${domain}`
                }
            });
            const json = await responseText.json();
            const data = json.data.items;
            let allEpisodes = [];

            for (let i = 1; i <= data.seasons; i++) {
                try {
                    const seasonResponseText = await soraFetch(`https://api.${domain}/api/v1/media/${showId}/season/${i}`, {
                        headers: {
                            "Referer": `https://${domain}/`,
                            "Origin": `https://${domain}`
                        }
                    });
                    const seasonJson = await seasonResponseText.json();
                    
                    if (seasonJson && seasonJson.data && seasonJson.data.items) {
                        const seasonData = seasonJson.data.items;
                        for (const episode of seasonData.episodes) {
                            allEpisodes.push({
                                href: `${showId}/${i}/${episode.episode}`,
                                number: episode.episode,
                                season: i,
                                title: episode.name || `Épisode ${episode.episode}`,
                                image: episode.poster || "",
                                duration: episode.runtime ? episode.runtime.human : ""
                            });
                        }
                    }
                } catch (e) {
                    console.log(`[Purstream] Erreur chargement saison ${i}:`, e);
                }
            }
            return JSON.stringify(allEpisodes);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Fetch error in extractEpisodes: ' + error);
        return JSON.stringify([]);
    }   
}

// --- 4. LECTEUR (Supabase Tracker Ajouté) ---
async function extractStreamUrl(url) {
    try {
        const domain = await getWorkingDomain();
        let streams = [];
        let extractedNames = [];
        let failedLinks = [];
        let showId = "";
        let seasonNumber = "";
        let episodeNumber = "";

        if (url.includes('movie')) {
            const parts = url.split('/');
            showId = parts[0];
            episodeNumber = parts[1];
        } else {
            const parts = url.split('/');
            showId = parts[0];
            seasonNumber = parts[1];
            episodeNumber = parts[2];
        }

        let apiUrl = episodeNumber === "movie" 
            ? `https://api.${domain}/api/v1/stream/${showId}`
            : `https://api.${domain}/api/v1/stream/${showId}/episode?season=${seasonNumber}&episode=${episodeNumber}`;

        const response = await soraFetch(apiUrl, {
            headers: {
                "Referer": `https://${domain}/`,
                "Origin": `https://${domain}`,
            }
        });
        
        let json = {};
        try {
            json = await response.json();
        } catch(e) {
            // L'API est cassée ou injoignable
            failedLinks.push({ server_name: "API Purstream (Crash)", url: apiUrl });
        }

        const sources = json?.data?.items?.sources || [];

        for (const source of sources) {
            if (source.stream_url) {
                let serverName = source.source_name || "Purstream (Direct)";
                streams.push({
                    title: serverName,
                    streamUrl: source.stream_url,
                    headers: {
                        "Origin": `https://${domain}`,
                        "Referer": `https://${domain}/`,
                        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
                    }
                });
                extractedNames.push(serverName);
            }
        }

        // 🚨 Capture de l'erreur si aucun flux n'est trouvé
        if (streams.length === 0 && failedLinks.length === 0) {
            failedLinks.push({ server_name: "API Purstream (Vidéo Supprimée/Vide)", url: apiUrl });
        }

        // 📡 Log Supabase : SUCCÈS
        sendSupabaseLog("Purstream", "PLAYER", { 
            anime_url: url, 
            ep_number: episodeNumber,
            streams_found: streams.length,
            servers: extractedNames
        });

        // 📡 Log Supabase : ÉCHECS (Les liens morts ou API Vide)
        if (failedLinks.length > 0) {
            sendSupabaseLog("Purstream", "UNSUPPORTED_HOSTS", {
                anime_url: url,
                ep_number: episodeNumber,
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }

        return JSON.stringify({ streams, subtitles: "" });

    } catch (error) {
        console.log('Fetch error in extractStreamUrl: ' + error);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}

// --- FONCTION UTILITAIRE SORA ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(
                url,
                options.headers ?? {},
                options.method ?? 'GET',
                options.body ?? null,
                true,
                options.encoding ?? 'utf-8'
            );
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
