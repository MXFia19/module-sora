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

// --- 4. EXTRACTION VIDÉO (Extraction JWPlayer) ---
async function extractStreamUrl(url) {
    try {
        console.log(`[Hostcord] Analyse de l'iframe : ${url}`);
        
        const response = await soraFetch(url, {
            headers: {
                "Referer": `${BASE_URL}/`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        
        const html = await response.text();
        let streams = [];

        // On cherche précisément la ligne file: "/video/...mp4" du lecteur JWPlayer
        const jwplayerMatch = html.match(/file:\s*["']([^"']+\.mp4)["']/i);
        
        if (jwplayerMatch && jwplayerMatch[1]) {
            let videoPath = jwplayerMatch[1]; // Contient: /video/fc4b91ff/8c624ca...mp4
            
            // On reconstruit l'URL absolue en collant le domaine de l'iframe devant
            let finalUrl = videoPath;
            if (videoPath.startsWith('/')) {
                try {
                    const urlObj = new URL(url); // Récupère https://ptb.rdmfile.eu
                    finalUrl = urlObj.origin + videoPath;
                } catch (e) {
                    finalUrl = `https://ptb.rdmfile.eu${videoPath}`; // Sécurité
                }
            }
            
            console.log(`[Hostcord] Lien MP4 capturé avec succès : ${finalUrl}`);
            
            streams.push({
                title: "Serveur RDM (Direct)",
                streamUrl: finalUrl,
                headers: { 
                    "Referer": url, // RDMFile a besoin de savoir qu'on vient de son iframe
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
                }
            });
        } else {
            console.log("[Hostcord] Lien introuvable dans JWPlayer. Basculement WebView.");
            streams.push({
                title: "Serveur RDM (Lecteur Web)",
                streamUrl: `webview://${url}`,
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
