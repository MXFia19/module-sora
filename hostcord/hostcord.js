const BASE_URL = "https://hostcord.xyz";

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const searchUrl = `${BASE_URL}/search/suggest?q=${encodedKeyword}`;
        
        const response = await soraFetch(searchUrl);
        const data = await response.json();

        // Le site renvoie directement un tableau d'objets
        if (!Array.isArray(data)) return JSON.stringify([]);

        const transformedResults = data.map(item => {
            return {
                title: item.title,
                image: item.poster,
                href: item.url // Exemple: "https://hostcord.xyz/movie/281"
            };
        });

        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log('[Hostcord] Erreur searchResults : ' + error);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        // La magie d'Inertia.js : on demande au serveur de renvoyer le JSON plutôt que la page web
        const response = await soraFetch(url, {
            headers: {
                "X-Inertia": "true", // <--- LE SECRET EST ICI
                "X-Inertia-Version": "",
                "Referer": BASE_URL
            }
        });
        
        const json = await response.json();
        
        // On récupère l'objet "movie" ou "serie" dans les props
        const item = json.props.movie || json.props.serie || json.props.show;
        
        if (!item) throw new Error("Données introuvables");

        const transformedResults = [{
            description: item.description || 'Aucune description disponible.',
            aliases: `Note : ${item.rating ? item.rating + '/10' : 'N/A'}`,
            airdate: `Année : ${item.release_year || 'Inconnue'}`
        }];

        return JSON.stringify(transformedResults);
        
    } catch (error) {
        console.log('[Hostcord] Erreur extractDetails : ' + error);
        return JSON.stringify([{ description: 'Erreur', aliases: '', airdate: '' }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        const response = await soraFetch(url, {
            headers: { "X-Inertia": "true", "Referer": BASE_URL }
        });
        const json = await response.json();
        
        // --- CAS 1 : C'EST UN FILM ---
        if (json.props.movie && json.props.movie.video_url) {
            return JSON.stringify([{
                href: json.props.movie.video_url, // L'iframe: "https://ptb.rdmfile.eu/iframe/..."
                number: 1,
                title: "Film Complet"
            }]);
        }
        
        // --- CAS 2 : C'EST UNE SÉRIE (Logique préventive) ---
        if (json.props.serie || json.props.show) {
            const show = json.props.serie || json.props.show;
            let allEpisodes = [];
            
            // Note: Comme on n'a pas vu le JSON exact d'une série, ceci est une déduction logique.
            // Si le site a un tableau "episodes" direct :
            if (show.episodes && Array.isArray(show.episodes)) {
                show.episodes.forEach(ep => {
                    allEpisodes.push({
                        href: ep.video_url || ep.url,
                        number: ep.episode_number || ep.id,
                        title: ep.title || `Épisode ${ep.episode_number}`
                    });
                });
            } 
            // Si le site a des "seasons" qui contiennent des "episodes" :
            else if (show.seasons && Array.isArray(show.seasons)) {
                show.seasons.forEach(season => {
                    if(season.episodes) {
                        season.episodes.forEach(ep => {
                            allEpisodes.push({
                                href: ep.video_url,
                                number: ep.episode_number,
                                title: `S${season.season_number} E${ep.episode_number}`
                            });
                        });
                    }
                });
            }
            
            return JSON.stringify(allEpisodes);
        }

        return JSON.stringify([]);
    } catch (error) {
        console.log('[Hostcord] Erreur extractEpisodes : ' + error);
        return JSON.stringify([]);
    }    
}

// --- 4. EXTRACTION VIDÉO (Scraping de rdmfile.eu) ---
async function extractStreamUrl(url) {
    try {
        // L'URL ici est l'iframe (ex: https://ptb.rdmfile.eu/iframe/fc4b91ff)
        console.log(`[Hostcord] Extraction de l'iframe : ${url}`);
        
        const response = await soraFetch(url, {
            headers: {
                "Referer": `${BASE_URL}/`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        
        const html = await response.text();
        let streams = [];

        // On cherche le lien vidéo caché dans le code de l'iframe (format standard .m3u8 ou .mp4)
        const fileMatch = html.match(/(?:file|src)\s*:\s*["'](https:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
        if (fileMatch) {
            streams.push({
                title: "Serveur RDM (Direct)",
                streamUrl: fileMatch[1],
                headers: { "Referer": url }
            });
        }
        
        // Si le lien vidéo est dans une balise <source> HTML5
        if (streams.length === 0) {
            const sourceMatch = html.match(/<source[^>]+src=["']([^"']+)["']/i);
            if (sourceMatch) {
                streams.push({
                    title: "Serveur RDM (HTML5)",
                    streamUrl: sourceMatch[1],
                    headers: { "Referer": url }
                });
            }
        }

        // Si le lecteur cache un autre iFrame à l'intérieur
        if (streams.length === 0) {
            const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (iframeMatch) {
                streams.push({
                    title: "Lecteur Externe",
                    streamUrl: iframeMatch[1],
                    headers: { "Referer": url }
                });
            }
        }

        // Sécurité ultime : Si on n'arrive pas à extraire le flux, on renvoie l'iframe tel quel
        // pour que Sora tente de le gérer ou pour l'ouvrir dans le lecteur web.
        if (streams.length === 0) {
            console.log("[Hostcord] Flux non trouvé dans l'iframe, tentative d'envoi du lien brut.");
            streams.push({
                title: "Lecteur Web",
                streamUrl: url,
                headers: { "Referer": `${BASE_URL}/` }
            });
        }

        return JSON.stringify({ streams, subtitles: "" });

    } catch (error) {
        console.log('[Hostcord] Erreur extractStreamUrl: ' + error);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}

// --- FONCTION UTILITAIRE SORA ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8');
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try { return await fetch(url, options); } catch(error) { return null; }
    }
}
