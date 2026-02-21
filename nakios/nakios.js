const TMDB_API_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";

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


async function searchResults(keyword) {
    try {
        // 1. On s'assure d'avoir la bonne adresse
        await initUrls();

        const encodedKeyword = encodeURIComponent(keyword);
        const responseText = await soraFetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodedKeyword}&language=fr-FR&page=1&include_adult=false&sort_by=popularity.desc`);
        const data = await responseText.json();

        const transformedResults = data.results.map(result => {
            if(result.media_type === "movie" || result.title) {
                return {
                    title: result.title || result.name,
                    image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
                    href: `${BASE_URL}/movie/${result.id}` // <-- Utilise l'adresse dynamique
                };
            }
            else if(result.media_type === "tv" || result.name) {
                return {
                    title: result.name || result.title,
                    image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
                    href: `${BASE_URL}/tv/${result.id}` // <-- Utilise l'adresse dynamique
                };
            }
        });

        return JSON.stringify(transformedResults.filter(Boolean));
    } catch (error) {
        console.log('Fetch error in searchResults: ' + error);
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
                    let isVideoUrl = value.includes('.m3u8') || value.includes('.mp4') || value.includes('fsvid.lol');
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
            
            // Si le lien commence par "/", on rajoute juste l'adresse de l'API devant.
            // Sinon (si c'est un lien http vers fsvid ou autre), on le laisse intact !
            if (item.url.startsWith('/')) {
                finalUrl = `${API_URL}${item.url}`;
            }

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
