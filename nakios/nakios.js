const TMDB_API_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";

// Variables globales
let BASE_URL = "";
let API_URL = "";
let HOSTNAME = "";

// ==========================================
// 📊 TRACKERS DISCORD
// ==========================================

const WEBHOOK_RECHERCHE = "https://discord.com/api/webhooks/1482435597372100628/vmjrJ5zOsOfV2tVv4SEeUcC1uP-jEBg1oxEJb4sPsQ7qxnqkANs0G976sPBlSF6HiLZf";
const WEBHOOK_LECTEUR = "https://discord.com/api/webhooks/1482436048373026816/pPA0G1N6JSulfgPtAiArewD5veeHnrPLqofm3HSidpNG5Ro5BIxhNBdzjl56IvvJhMPc";
const WEBHOOK_DETAILS = "https://discord.com/api/webhooks/1482456590107021352/aHuhNRb0fRMa_-KT9wFIKyu2Lz3qxClLYc-7bTqdsFYlIPpw35wuN8PhOMTaW7NKtDPv";

// 1. Tracker pour les Recherches
async function sendTracker(moduleName, keyword, results, apiUrl) {
    try {
        let desc = `**Mot-clé :** \`${keyword}\`\n**Résultats trouvés :** ${results.length}\n**URL de l'API :** ${apiUrl}\n`;
        
        if (results.length > 0) {
            desc += `\n**Top résultats :**\n`;
            let top = results.slice(0, 5);
            for (let r of top) { desc += `🎬 ${r.title}\n`; }
            if (results.length > 5) { desc += `*... et ${results.length - 5} autres*`; }
        } else {
            desc += `\n❌ Aucun média trouvé.`;
        }

        const payload = {
            embeds: [{
                title: `📊 Recherche sur ${moduleName}`,
                description: desc,
                color: 5814783,
                timestamp: new Date().toISOString()
            }]
        };

        const headers = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" };
        await fetchv2(WEBHOOK_RECHERCHE, headers, "POST", JSON.stringify(payload));
    } catch (e) {}
}

// 2. Tracker pour les clics sur les affiches (Détails)
async function sendDetailsTracker(moduleName, url) {
    try {
        let readableName = url;
        // CORRECTION ICI : On accepte "series" en plus de "tv" et "movie"
        let match = url.match(/\/(movie|series|tv)\/(\d+)/i);
        if (match) {
            let type = match[1].toLowerCase() === "movie" ? "Film" : "Série";
            readableName = `[${type}] ID TMDB : ${match[2]}`;
        }

        const payload = {
            embeds: [{
                title: `🖱️ Clic sur une affiche (${moduleName})`,
                description: `**Média sélectionné :** \`${readableName}\`\n**Lien source :** ${url}`,
                color: 16766720,
                timestamp: new Date().toISOString()
            }]
        };

        const headers = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" };
        await fetchv2(WEBHOOK_DETAILS, headers, "POST", JSON.stringify(payload));
    } catch (e) {}
}

// 3. Tracker pour le Lecteur
async function sendPlayerTracker(moduleName, url, streams, apiUrl) {
    try {
        let readableInfo = url;
        
        if (url.includes('movie')) {
            let parts = url.split('/');
            readableInfo = `🎬 **Film** (ID TMDB: ${parts[0]})`;
        } else {
            let parts = url.split('/');
            if (parts.length >= 3) {
                readableInfo = `📺 **Série** (ID TMDB: ${parts[0]})\nSaison : **${parts[1]}**\nÉpisode : **${parts[2]}**`;
            }
        }

        let desc = `${readableInfo}\n**URL de l'API :** ${apiUrl}\n\n**Serveurs extraits :** ${streams.length}\n`;
        
        if (streams.length > 0) {
            for (let s of streams) { desc += `✅ ${s.title}\n`; }
        } else {
            desc += `❌ Aucun lien vidéo valide trouvé.`;
        }

        const payload = {
            embeds: [{
                title: `▶️ Lancement Vidéo sur ${moduleName}`,
                description: desc,
                color: 5763719,
                timestamp: new Date().toISOString()
            }]
        };

        const headers = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" };
        await fetchv2(WEBHOOK_LECTEUR, headers, "POST", JSON.stringify(payload));
    } catch (e) {}
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
            await sendTracker("Nakios", keyword, [], searchUrl);
            return JSON.stringify([]);
        }

        const transformedResults = items.map(result => {
            let type = result.media_type || (result.name ? "tv" : "movie");
            
            // CORRECTION ICI : Remplacement strict de "tv" par "series" pour coller au site Nakios !
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

        await sendTracker("Nakios", keyword, transformedResults, searchUrl);
        return JSON.stringify(transformedResults);
    } catch (error) {
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    console.log(`[Détails] 📖 Chargement des infos pour : ${url}`);
    await sendDetailsTracker("Nakios", url);

    try {
        await initUrls();
        
        const isMovie = url.includes('movie');
        // CORRECTION ICI : On inclut "series" dans le regex
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
        // CORRECTION ICI : On inclut "series" dans le regex
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

// --- 4. EXTRACTION VIDÉO ---
async function extractStreamUrl(url) {
    try {
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
            headers: { "Origin": BASE_URL, "Referer": `${BASE_URL}/` }
        });
        
        let data = {};
        try {
            data = await response.json();
        } catch(e) {
            await sendPlayerTracker("Nakios", url, [], apiUrl);
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
        }

        await sendPlayerTracker("Nakios", url, streams, apiUrl);
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
