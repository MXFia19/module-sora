// ==========================================
// ⚙️ MODULE SORA — HOSTCORD (Supabase Edition)
// ==========================================

const BASE_URL = "https://hostcord.xyz";

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
// ⚙️ LOGIQUE DU MODULE HOSTCORD
// ==========================================

// --- FONCTION MAGIQUE : EXTRACTION DU JSON CACHÉ DANS LE HTML ---
async function getInertiaData(url) {
    const response = await soraFetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": `${BASE_URL}/`
        }
    });
    const html = await response.text();
    
    const match = html.match(/data-page=(['"])(.*?)\1/);
    if (match && match[2]) {
        let jsonString = match[2]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
            
        return JSON.parse(jsonString);
    }
    throw new Error("Impossible de trouver les données Inertia dans la page HTML.");
}

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    console.log(`[Recherche Hostcord] 🔍 Lancement pour : "${keyword}"`);
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

        // 📡 Log Supabase (Recherche)
        sendSupabaseLog("Hostcord", "SEARCH", { 
            keyword: keyword, 
            results_count: transformedResults.length,
            top_results: transformedResults.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log('[Hostcord] Erreur searchResults : ' + error);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    console.log(`[Détails Hostcord] 📖 Chargement des infos pour : ${url}`);
    
    // 📡 Log Supabase (Détails)
    sendSupabaseLog("Hostcord", "DETAILS", { anime_url: url });

    try {
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
        
        if (json.props.movie && json.props.movie.video_url) {
            return JSON.stringify([{
                href: json.props.movie.video_url, 
                number: 1,
                season: 1,
                title: "Film Complet"
            }]);
        }
        
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

// --- 4. EXTRACTION VIDÉO (Capture d'erreurs Supabase ajoutée) ---
async function extractStreamUrl(url) {
    try {
        console.log(`[Hostcord] 🎬 Analyse de l'iframe : ${url}`);
        
        const response = await soraFetch(url, {
            headers: {
                "Referer": `${BASE_URL}/`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        
        const html = await response.text();
        let streams = [];
        let extractedNames = [];
        let failedLinks = [];

        // On cherche le lien vidéo (MP4 ou M3U8)
        const jwplayerMatch = html.match(/file:\s*["']([^"']+\.(?:mp4|m3u8))["']/i);
        
        if (jwplayerMatch && jwplayerMatch[1]) {
            let videoPath = jwplayerMatch[1];
            let finalUrl = videoPath.startsWith('/') ? `https://ptb.rdmfile.eu${videoPath}` : videoPath;
            
            console.log(`[Hostcord] ✅ Lien Vidéo trouvé : ${finalUrl}`);
            
            streams.push({
                title: "Serveur RDM (Direct)",
                streamUrl: finalUrl,
                headers: { "Referer": "https://ptb.rdmfile.eu/" }
            });
            extractedNames.push("Serveur RDM");
            
        } else {
            console.log("[Hostcord] ❌ Lien introuvable. Basculement sur Lecteur Web et Envoi vers Appsmith.");
            
            // On signale l'erreur à Supabase (lien mort ou sécurité modifiée)
            failedLinks.push({
                server_name: "RDM (Inconnu / Supprimé)",
                url: url
            });
            
            streams.push({
                title: "Serveur RDM (Lecteur Web)",
                streamUrl: `webview://${url}`,
                headers: { "Referer": `${BASE_URL}/` }
            });
        }

        // 📡 Log Supabase : SUCCÈS
        sendSupabaseLog("Hostcord", "PLAYER", { 
            anime_url: url, 
            ep_number: 1, // Par défaut
            streams_found: streams.length,
            servers: extractedNames
        });

        // 📡 Log Supabase : ÉCHECS (Les liens à décrypter / morts)
        if (failedLinks.length > 0) {
            sendSupabaseLog("Hostcord", "UNSUPPORTED_HOSTS", {
                anime_url: url,
                ep_number: 1,
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }

        return JSON.stringify({ streams, subtitles: "" });

    } catch (error) {
        console.log('[Hostcord] 🚨 Erreur extractStreamUrl: ' + error);
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
