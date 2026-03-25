// ==========================================
// ⚙️ MODULE SORA — NAKIOS (Supabase Edition)
// ==========================================

const TMDB_API_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";

// Variables globales
let BASE_URL = "";
let API_URL = "";
let HOSTNAME = "";

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
// ⚙️ LOGIQUE DU MODULE NAKIOS
// ==========================================

async function initUrls() {
    if (BASE_URL !== "") return;

    try {
        console.log("[Nakios] Recherche de la nouvelle adresse officielle sur nakios.online...");
        const response = await soraFetch("https://nakios.online/");
        const text = await response.text();

        const match = text.match(/href="([^"]+)"[^>]*>.*?Visiter/i) || text.match(/(https:\/\/nakios\.[a-z]+)/i);
        
        if (match && match[1]) {
            BASE_URL = match[1];
            if (BASE_URL.endsWith('/')) BASE_URL = BASE_URL.slice(0, -1);
        } else {
            throw new Error("Aucun lien trouvé");
        }
    } catch (e) {
        BASE_URL = "https://nakios.site";
    }

    try {
        HOSTNAME = BASE_URL.replace(/^https?:\/\//, ''); 
        API_URL = `https://api.${HOSTNAME}`;
    } catch(e) {
        HOSTNAME = "nakios.site";
        API_URL = "https://api.nakios.site";
    }
}

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    try {
        await initUrls();

        const encodedKeyword = encodeURIComponent(keyword);
        const searchUrl = `${API_URL}/api/search/multi?query=${encodedKeyword}&page=1`;
        
        const responseText = await soraFetch(searchUrl, {
            headers: { "Origin": BASE_URL, "Referer": `${BASE_URL}/` }
        });
        
        const data = await responseText.json();
        const items = data.results || data.data || data.items || data; 

        if (!Array.isArray(items)) {
            return JSON.stringify([]);
        }

        const transformedResults = items.map(result => {
            let type = result.media_type || (result.name ? "tv" : "movie");
            
            // Remplacement strict de "tv" par "series" pour coller au site Nakios !
            if (type === "tv") type = "series"; 

            let title = result.title || result.name || result.original_title;
            let id = result.id || result.tmdb_id;
            
            let image = "https://via.placeholder.com/500x750?text=Pas+d'image";
            if (result.poster_path) {
                image = result.poster_path.startsWith('http') 
                    ? result.poster_path 
                    : `https://image.tmdb.org/t/p/w500${result.poster_path}`;
            }

            if (title && id) {
                return {
                    title: title,
                    image: image,
                    href: `${BASE_URL}/${type}/${id}` // Cela génèrera bien /series/ID
                };
            }
        }).filter(Boolean);

        // 📡 Log Supabase (Recherche)
        sendSupabaseLog("Nakios", "SEARCH", { 
            keyword: keyword, 
            results_count: transformedResults.length,
            top_results: transformedResults.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(transformedResults);
    } catch (error) {
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    console.log(`[Détails] 📖 Chargement des infos pour : ${url}`);
    
    // 📡 Log Supabase (Détails)
    sendSupabaseLog("Nakios", "DETAILS", { anime_url: url });

    try {
        await initUrls();
        
        const isMovie = url.includes('movie');
        const match = url.match(/(?:movie|series|tv)\/(\d+)/);
        if (!match) throw new Error("Invalid URL format");

        const id = match[1];
        
        const tmdbUrl = isMovie 
            ? `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=fr-FR`
            : `https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&language=fr-FR`;
            
        let responseText = await soraFetch(tmdbUrl);
        let data = await responseText.json();
        
        if (data.success === false || !data.id) {
            const nakiosUrl = isMovie ? `${API_URL}/api/movie/${id}` : `${API_URL}/api/series/${id}`;
            responseText = await soraFetch(nakiosUrl, { headers: { "Origin": BASE_URL, "Referer": `${BASE_URL}/` } });
            data = await responseText.json();
            data = data.data || data; 
        }

        let duration = 'Inconnue';
        if (data.runtime) {
            duration = data.runtime; 
        } else if (data.episode_run_time && data.episode_run_time.length > 0) {
            duration = data.episode_run_time[0]; 
        } else if (data.episodes && data.episodes.length > 0 && data.episodes[0].runtime) {
            duration = data.episodes[0].runtime; 
        }

        let releaseDate = data.release_date || data.first_air_date || data.air_date || 'Inconnue';
        let overview = data.overview || data.description || 'Aucune description disponible.';

        const transformedResults = [{
            description: overview,
            aliases: `Durée : ${duration !== 'Inconnue' ? duration + ' minutes' : 'Inconnue'}`,
            airdate: `Date de sortie : ${releaseDate}`
        }];

        return JSON.stringify(transformedResults);
        
    } catch (error) {
        return JSON.stringify([{
            description: 'Erreur lors du chargement de la description',
            aliases: 'Durée : Inconnue',
            airdate: 'Date : Inconnue'
        }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        await initUrls();
        
        const isMovie = url.includes('movie');
        const match = url.match(/(?:movie|series|tv)\/(\d+)/);
        if (!match) throw new Error("Invalid URL format");
        
        const id = match[1];

        if (isMovie) {
            return JSON.stringify([{ href: `${id}/movie`, number: 1, title: "Film Complet" }]);
        } else {
            const seriesUrl = `${API_URL}/api/series/${id}`;
            const responseText = await soraFetch(seriesUrl, {
                headers: { "Origin": BASE_URL, "Referer": `${BASE_URL}/` }
            });
            const data = await responseText.json();
            const info = data.data || data;
            
            let allEpisodes = [];
            
            if (info.seasons && Array.isArray(info.seasons)) {
                for (const season of info.seasons) {
                    const seasonNumber = season.season_number;
                    if(seasonNumber === 0) continue; 
                    
                    const seasonUrl = `${API_URL}/api/series/${id}/season/${seasonNumber}`;
                    const seasonResponse = await soraFetch(seasonUrl, {
                        headers: { "Origin": BASE_URL, "Referer": `${BASE_URL}/` }
                    });
                    const seasonData = await seasonResponse.json();
                    
                    const sInfo = seasonData.data || seasonData;
                    const episodesList = sInfo.episodes || (Array.isArray(sInfo) ? sInfo : []);
                    
                    if (episodesList && episodesList.length) {
                        const episodes = episodesList.map(episode => ({
                            href: `${id}/${seasonNumber}/${episode.episode_number}`,
                            number: episode.episode_number,
                            title: episode.name || `Épisode ${episode.episode_number}`
                        }));
                        allEpisodes = allEpisodes.concat(episodes);
                    }
                }
            }
            return JSON.stringify(allEpisodes);
        }
    } catch (error) {
        return JSON.stringify([]);
    }   
}

// --- 4. EXTRACTION VIDÉO (Supabase Tracker Ajouté) ---
async function extractStreamUrl(url) {
    try {
        await initUrls();

        let streams = [];
        let extractedNames = [];
        let failedLinks = [];
        let showId = "";
        let seasonNumber = "";
        let episodeNumber = "1";
        let isMovie = url.includes('movie');

        if (isMovie) {
            const parts = url.split('/');
            showId = parts[0]; 
        } else {
            const parts = url.split('/');
            showId = parts[0];         
            seasonNumber = parts[1];   
            episodeNumber = parts[2];  
        }

        let apiUrl = isMovie 
            ? `${API_URL}/api/sources/movie/${showId}` 
            : `${API_URL}/api/sources/tv/${showId}/${seasonNumber}/${episodeNumber}`;

        const response = await soraFetch(apiUrl, {
            headers: { "Origin": BASE_URL, "Referer": `${BASE_URL}/` }
        });
        
        let data = {};
        try {
            data = await response.json();
        } catch(e) {
            // L'API a planté ou renvoyé du texte cassé
            failedLinks.push({ server_name: "API Nakios (Crash)", url: apiUrl });
            sendSupabaseLog("Nakios", "UNSUPPORTED_HOSTS", { anime_url: url, ep_number: episodeNumber, failed_count: 1, failed_links: failedLinks });
            return JSON.stringify({ streams: [], subtitles: "" });
        }
        
        let rawStreams = [];
        
        function findStreams(obj, currentName = "Serveur Nakios") {
            if (obj === null || typeof obj !== 'object') return;
            
            if (Array.isArray(obj)) {
                obj.forEach(item => findStreams(item, currentName));
                return;
            }
            
            let name = obj.name || obj.title || obj.server || obj.language || obj.lang || currentName;
            
            for (const [key, value] of Object.entries(obj)) {
                let passName = name;

                if (["VF", "VOSTFR", "VFF", "VFQ", "FRENCH", "ENGLISH"].includes(key.toUpperCase())) {
                    passName = key.toUpperCase();
                }
                
                if (typeof value === 'string') {
                    let isVideoUrl = value.includes('.m3u8') || value.includes('.mp4') || value.includes('fsvid.lol') || value.includes('vidzy.org');
                    let isApiUrl = value.startsWith('http') && ['url', 'link', 'file', 'src'].includes(key.toLowerCase());
                    
                    if (isVideoUrl || isApiUrl) {
                        let finalName = passName;
                        if (obj.quality) finalName += ` - ${obj.quality}`;
                        rawStreams.push({ url: value, name: finalName });
                    }
                } else if (typeof value === 'object') {
                    findStreams(value, passName);
                }
            }
        }

        findStreams(data);

        let uniqueStreams = [];
        let seenUrls = new Set();
        for (let item of rawStreams) {
            if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                uniqueStreams.push(item);
            }
        }
        
        for (let item of uniqueStreams) {
            let finalUrl = item.url;
            if (item.url.startsWith('/')) finalUrl = `${API_URL}${item.url}`;

            let streamHeaders = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
                "Origin": BASE_URL,
                "Referer": `${BASE_URL}/`
            };

            if (finalUrl.includes('fsvid') || finalUrl.includes('vidzy')) {
                try {
                    const urlObj = new URL(finalUrl);
                    streamHeaders["Origin"] = urlObj.origin;
                    streamHeaders["Referer"] = urlObj.origin + "/";
                } catch(e) {}
            }

            streams.push({
                title: item.name, 
                streamUrl: finalUrl,
                headers: streamHeaders
            });
            extractedNames.push(item.name);
        }

        // 🚨 Capture de l'erreur si aucun flux n'est trouvé dans le JSON
        if (streams.length === 0) {
            failedLinks.push({ server_name: "API Nakios (Vide)", url: apiUrl });
        }

        // 📡 Log Supabase : SUCCÈS
        sendSupabaseLog("Nakios", "PLAYER", { 
            anime_url: url, 
            ep_number: episodeNumber,
            streams_found: streams.length,
            servers: extractedNames
        });

        // 📡 Log Supabase : ÉCHECS
        if (failedLinks.length > 0) {
            sendSupabaseLog("Nakios", "UNSUPPORTED_HOSTS", {
                anime_url: url,
                ep_number: episodeNumber,
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }

        return JSON.stringify({ streams, subtitles: "" });

    } catch (error) {
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}

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
