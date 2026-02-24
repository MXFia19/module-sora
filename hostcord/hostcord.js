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

// --- 3. ÉPISODES (Nettoyé pour éviter les erreurs JSON) ---
async function extractEpisodes(url) {
    try {
        const json = await getInertiaData(url);
        
        // Cas 1 : C'est un Film
        if (json.props.movie && json.props.movie.video_url) {
            return JSON.stringify([{
                href: json.props.movie.video_url, 
                number: 1,
                season: 1,
                title: "Film Complet"
            }]);
        }
        
        // Cas 2 : C'est une Série
        if (json.props.serie || json.props.show) {
            const show = json.props.serie || json.props.show;
            let allEpisodes = [];
            
            if (show.episodes && Array.isArray(show.episodes)) {
                show.episodes.forEach((ep, index) => {
                    if (ep.video_url || ep.url) {
                        allEpisodes.push({
                            href: ep.video_url || ep.url,
                            number: ep.episode_number || (index + 1),
                            season: ep.season_number || 1,
                            title: ep.title || `Épisode ${ep.episode_number || (index + 1)}`
                        });
                    }
                });
            } else if (show.seasons && Array.isArray(show.seasons)) {
                show.seasons.forEach(season => {
                    if(season.episodes && Array.isArray(season.episodes)) {
                        season.episodes.forEach((ep, index) => {
                            if (ep.video_url || ep.url) {
                                allEpisodes.push({
                                    href: ep.video_url || ep.url,
                                    number: ep.episode_number || (index + 1),
                                    season: season.season_number || 1,
                                    title: ep.title || `Épisode ${ep.episode_number || (index + 1)}`
                                });
                            }
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

// --- 4. EXTRACTION VIDÉO (Instantanée, sans ping) ---
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

        // On cherche le lien vidéo (MP4 ou M3U8)
        const jwplayerMatch = html.match(/file:\s*["']([^"']+\.(?:mp4|m3u8))["']/i);
        
        if (jwplayerMatch && jwplayerMatch[1]) {
            let videoPath = jwplayerMatch[1];
            let finalUrl = videoPath.startsWith('/') ? `https://ptb.rdmfile.eu${videoPath}` : videoPath;
            
            console.log(`[Hostcord] Lien Vidéo trouvé : ${finalUrl}`);
            
            streams.push({
                title: "Serveur RDM (Direct)",
                streamUrl: finalUrl,
                headers: { 
                    "Referer": "https://ptb.rdmfile.eu/" 
                }
            });
        } else {
            console.log("[Hostcord] Lien introuvable. Basculement sur Lecteur Web.");
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
