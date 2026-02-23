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

async function searchResults(keyword) {
    try {
        const domain = await getWorkingDomain();
        const cleanKeyword = keyword.trim().toLowerCase();
        let apiUrl = "";
        let isCatalog = false;

        // --- GESTION DES COMMANDES COMBINÉES ---
        // Si le texte contient au moins un "!", on active le mode catalogue
        if (cleanKeyword.includes("!")) {
            isCatalog = true;

            // 1. Définition du TYPE (Par défaut : étoile * = tout)
            let typeParam = "*";
            if (cleanKeyword.includes("!anime")) typeParam = "anime";
            else if (cleanKeyword.includes("!movie") || cleanKeyword.includes("!film")) typeParam = "movie";
            else if (cleanKeyword.includes("!serie") || cleanKeyword.includes("!tv")) typeParam = "tv";

            // 2. Définition du TRI (Par défaut : les ajouts récents)
            let sortParam = "recently-added";
            if (cleanKeyword.includes("!trend") || cleanKeyword.includes("!populaire")) sortParam = "most-viewed";
            else if (cleanKeyword.includes("!top")) sortParam = "best-rated";
            else if (cleanKeyword.includes("!new")) sortParam = "newest";

            // On fabrique l'URL sur mesure en combinant les deux !
            apiUrl = `https://api.${domain}/api/v1/catalog/movies?page=1&sortBy=${sortParam}&types=${typeParam}&categoriesIds=*&franchisesIds=*&displayMode=large&perPage=50`;
        } 
        else {
            // --- RECHERCHE NORMALE ---
            const encodedKeyword = encodeURIComponent(keyword);
            apiUrl = `https://api.${domain}/api/v1/search-bar/search/${encodedKeyword}`;
        }

        const responseText = await soraFetch(apiUrl);
        const data = await responseText.json();

        // --- FONCTION CHERCHEUSE DE TABLEAU (Le Labyrinthe) ---
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

        // Sécurité finale
        if (!Array.isArray(items) || items.length === 0) {
             return JSON.stringify([]);
        }

        // --- TRANSFORMATION DES RÉSULTATS ---
        const transformedResults = items.map(result => {
            let imgUrl = result.large_poster_path || result.small_poster_path || result.wallpaper_poster_path || result.poster_path || "https://via.placeholder.com/300x450/222222/FFFFFF?text=Aucune+Affiche";
            let title = result.title || result.name || "Titre inconnu";
            let hrefType = (result.type === "movie") ? "movie" : "serie";

            // Si l'API catalogue ne renvoie pas le champ "type", on force celui qu'on a demandé
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

async function extractDetails(url) {
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

// --- C'EST ICI QUE TOUT SE JOUE POUR LES AFFICHES / SAISONS / DURÉES ---
async function extractEpisodes(url) {
    try {
        const domain = await getWorkingDomain();

        // 1. SI C'EST UN FILM
        if(url.includes('movie')) {
            const match = url.match(/\/movie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");
            const movieId = match[1];
            
            // Appel API pour récupérer l'image et la durée du film
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

            // On boucle sur toutes les saisons
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
                        // On boucle sur tous les épisodes de la saison
                        for (const episode of seasonData.episodes) {
                            allEpisodes.push({
                                href: `${showId}/${i}/${episode.episode}`,
                                number: episode.episode,
                                season: i,                                 // On ajoute le numéro de saison
                                title: episode.name || `Épisode ${episode.episode}`,
                                image: episode.poster || "",               // On ajoute l'image de l'épisode
                                duration: episode.runtime ? episode.runtime.human : "" // On ajoute la durée
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

async function extractStreamUrl(url) {
    try {
        const domain = await getWorkingDomain();
        let streams = [];
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
        const json = await response.json();
        const sources = json?.data?.items?.sources || [];

        for (const source of sources) {
            if (source.stream_url) {
                streams.push({
                    title: source.source_name || "Purstream (Ouvrir avec VLC)",
                    streamUrl: source.stream_url,
                    headers: {
                        "Origin": `https://${domain}`,
                        "Referer": `https://${domain}/`,
                        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
                    }
                });
            }
        }

        return JSON.stringify({ streams, subtitles: "" });

    } catch (error) {
        console.log('Fetch error in extractStreamUrl: ' + error);
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
