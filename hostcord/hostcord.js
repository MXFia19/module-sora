const BASE_URL = "https://hostcord.xyz";

// --- FONCTION MAGIQUE : EXTRACTION DU JSON CACHÉ DANS LE HTML ---
async function getInertiaData(url) {
    const response = await soraFetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": `${BASE_URL}/`
        }
    });
    const html = await response.text();
    
    // On cherche l'attribut data-page qui contient le JSON crypté en entités HTML
    const match = html.match(/data-page=(['"])(.*?)\1/);
    if (match && match[2]) {
        // On nettoie le texte pour qu'il redevienne du vrai JSON
        let jsonString = match[2]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
            
        return JSON.parse(jsonString);
    }
    throw new Error("Impossible de trouver les données Inertia dans la page HTML.");
}

// --- 1. RECHERCHE (Fonctionnait déjà parfaitement) ---
async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const searchUrl = `${BASE_URL}/search/suggest?q=${encodedKeyword}`;
        
        const response = await soraFetch(searchUrl);
        const data = await response.json();

        if (!Array.isArray(data)) return JSON.stringify([]);

        const transformedResults = data.map(item => {
            return {
                title: item.title,
                image: item.poster,
                href: item.url
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
        // On utilise notre nouvelle fonction pour lire la page web
        const json = await getInertiaData(url);
        
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
        const json = await getInertiaData(url);
        
        // Film
        if (json.props.movie && json.props.movie.video_url) {
            return JSON.stringify([{
                href: json.props.movie.video_url, 
                number: 1,
                title: "Film Complet"
            }]);
        }
        
        // Série (logique dynamique)
        if (json.props.serie || json.props.show) {
            const show = json.props.serie || json.props.show;
            let allEpisodes = [];
            
            if (show.episodes && Array.isArray(show.episodes)) {
                show.episodes.forEach(ep => {
                    allEpisodes.push({
                        href: ep.video_url || ep.url,
                        number: ep.episode_number || ep.id,
                        title: ep.title || `Épisode ${ep.episode_number}`
                    });
                });
            } else if (show.seasons && Array.isArray(show.seasons)) {
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

// --- 4. EXTRACTION VIDÉO (Scraping de l'iframe rdmfile) ---
async function extractStreamUrl(url) {
    try {
        console.log(`[Hostcord] Extraction de l'iframe : ${url}`);
        
        const response = await soraFetch(url, {
            headers: {
                "Referer": `${BASE_URL}/`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        
        const html = await response.text();
        let streams = [];

        const fileMatch = html.match(/(?:file|src)\s*:\s*["'](https:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
        if (fileMatch) {
            streams.push({
                title: "Serveur RDM (Direct)",
                streamUrl: fileMatch[1],
                headers: { "Referer": url }
            });
        }
        
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

        if (streams.length === 0) {
            console.log("[Hostcord] Flux non trouvé dans l'iframe, envoi du lien brut.");
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
