// Variables globales qui vont stocker les adresses officielles
let BASE_URL = "";
let API_URL = "";
let HOSTNAME = "";

// --- LE CERVEAU AUTO-RÉPARATEUR ---
async function initUrls() {
    if (BASE_URL !== "") return; // Si on l'a déjà trouvé, on ne refait pas la recherche

    try {
        console.log("[Nakios] Recherche de la nouvelle adresse officielle sur nakios.online...");
        const response = await soraFetch("https://nakios.online/");
        const text = await response.text();

        // On cherche le lien dans le bouton "Visiter le site"
        const match = text.match(/href="([^"]+)"[^>]*>.*?Visiter/i) || text.match(/(https:\/\/nakios\.[a-z]+)/i);
        
        if (match && match[1]) {
            BASE_URL = match[1];
            if (BASE_URL.endsWith('/')) BASE_URL = BASE_URL.slice(0, -1);
        } else {
            throw new Error("Aucun lien trouvé");
        }
    } catch (e) {
        console.log("[Nakios] Impossible de récupérer l'adresse, utilisation de l'adresse de secours.");
        BASE_URL = "https://nakios.site"; // Plan B
    }

    // On déduit l'API et le domaine à partir de l'adresse trouvée
    try {
        // Enlève le https:// pour récupérer juste le domaine (ex: nakios.site)
        HOSTNAME = BASE_URL.replace(/^https?:\/\//, ''); 
        API_URL = `https://api.${HOSTNAME}`;
    } catch(e) {
        HOSTNAME = "nakios.site";
        API_URL = "https://api.nakios.site";
    }
    
    console.log(`[Nakios] Configuration terminée -> Base: ${BASE_URL} | API: ${API_URL}`);
}


// --- 1. RECHERCHE (VIA L'API OFFICIELLE DE NAKIOS) ---
async function searchResults(keyword) {
    try {
        // 1. On s'assure d'avoir la bonne adresse de l'API (Auto-réparation)
        await initUrls();

        const encodedKeyword = encodeURIComponent(keyword);
        
        // 2. On utilise la propre API de Nakios avec notre variable dynamique !
        const searchUrl = `${API_URL}/api/search/multi?query=${encodedKeyword}&page=1`;
        console.log(`[Nakios] Lancement de la recherche interne : ${searchUrl}`);
        
        const responseText = await soraFetch(searchUrl, {
            headers: {
                "Origin": BASE_URL,
                "Referer": `${BASE_URL}/`
            }
        });
        
        const data = await responseText.json();

        // 3. Transformation des résultats
        // Nakios renvoie probablement une structure similaire à TMDB, on cherche le tableau de résultats
        const items = data.results || data.data || data.items || data; 

        if (!Array.isArray(items)) {
            console.log("[Nakios] Structure de recherche inattendue :", JSON.stringify(data).substring(0, 200));
            return JSON.stringify([]);
        }

        const transformedResults = items.map(result => {
            // On déduit si c'est un film ou une série
            let type = result.media_type || (result.name ? "tv" : "movie");
            let title = result.title || result.name || result.original_title;
            let id = result.id || result.tmdb_id;
            
            // Gestion de l'image (si Nakios renvoie un bout de lien ou un lien complet)
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
                    // On crée le lien avec notre BASE_URL auto-réparée
                    href: `${BASE_URL}/${type}/${id}`
                };
            }
        });

        return JSON.stringify(transformedResults.filter(Boolean));
    } catch (error) {
        console.log('[Nakios] Erreur fatale dans searchResults : ' + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        if(url.includes('movie')) {
            const match = url.match(/movie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];
            const responseText = await soraFetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&language=fr-FR`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'Aucune description disponible.',
                aliases: `Durée : ${data.runtime ? data.runtime + " minutes" : 'Inconnue'}`,
                airdate: `Date de sortie : ${data.release_date ? data.release_date : 'Inconnue'}`
            }];

            return JSON.stringify(transformedResults);
        } else if(url.includes('tv')) {
            const match = url.match(/tv\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];
            const responseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}?api_key=${TMDB_API_KEY}&language=fr-FR`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'Aucune description disponible.',
                aliases: `Durée : ${data.episode_run_time && data.episode_run_time.length ? data.episode_run_time[0] + " minutes" : 'Inconnue'}`,
                airdate: `Première diffusion : ${data.first_air_date ? data.first_air_date : 'Inconnue'}`
            }];

            return JSON.stringify(transformedResults);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Erreur lors du chargement de la description',
            aliases: 'Durée : Inconnue',
            airdate: 'Date : Inconnue'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        if(url.includes('movie')) {
            const match = url.match(/movie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");
            const movieId = match[1];
            
            return JSON.stringify([
                { href: `${movieId}/movie`, number: 1, title: "Film Complet" }
            ]);
        } else if(url.includes('tv')) {
            const match = url.match(/tv\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");
            const showId = match[1];
            
            const showResponseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}?api_key=${TMDB_API_KEY}&language=fr-FR`);
            const showData = await showResponseText.json();
            
            let allEpisodes = [];
            for (const season of showData.seasons) {
                const seasonNumber = season.season_number;

                if(seasonNumber === 0) continue; 
                
                const seasonResponseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=fr-FR`);
                const seasonData = await seasonResponseText.json();
                
                if (seasonData.episodes && seasonData.episodes.length) {
                    const episodes = seasonData.episodes.map(episode => ({
                        href: `${showId}/${seasonNumber}/${episode.episode_number}`,
                        number: episode.episode_number,
                        title: episode.name || `Épisode ${episode.episode_number}`
                    }));
                    allEpisodes = allEpisodes.concat(episodes);
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

async function extractStreamUrl(url) {
    try {
        // 1. On s'assure d'avoir la bonne adresse et sa bonne API
        await initUrls();

        let streams = [];
        let showId = "";
        let seasonNumber = "";
        let episodeNumber = "";
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

        let apiUrl = "";
        if (isMovie) {
            apiUrl = `${API_URL}/api/sources/movie/${showId}`;
        } else {
            apiUrl = `${API_URL}/api/sources/tv/${showId}/${seasonNumber}/${episodeNumber}`;
        }

        const response = await soraFetch(apiUrl, {
            headers: {
                "Origin": BASE_URL,
                "Referer": `${BASE_URL}/`
            }
        });
        
        let data = {};
        try {
            data = await response.json();
        } catch(e) {
            console.log("[Nakios] L'API n'a pas renvoyé de JSON valide.");
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
                    // On accepte les m3u8, mp4 et les liens des serveurs connus
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

        // Dé-duplication des liens
        let uniqueStreams = [];
        let seenUrls = new Set();
        for (let item of rawStreams) {
            if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                uniqueStreams.push(item);
            }
        }
        
        // Finalisation des liens SANS LE PROXY
        for (let item of uniqueStreams) {
            let finalUrl = item.url;
            
            // Si le lien est relatif (ex: /hls/video.m3u8), on lui colle l'adresse du serveur
            if (item.url.startsWith('/')) {
                finalUrl = `${API_URL}${item.url}`;
            }

            // Et c'est tout ! On ne touche plus au reste (les liens fsvid, vidzy, etc.)
            streams.push({
                title: item.name, 
                streamUrl: finalUrl,
                headers: {
                    "Origin": BASE_URL,
                    "Referer": `${BASE_URL}/`
                }
            });
        }

        return JSON.stringify({ streams, subtitles: "" });

    } catch (error) {
        console.log('[Nakios] Erreur extractStreamUrl: ' + error);
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
