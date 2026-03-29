// ==========================================
// ⚙️ MODULE SORA — NAKASTREAM (Supabase + Sauvegarde Token)
// ==========================================

const BASE_URL = "https://nakastream.tv";
const API_URL = "https://nakastream.tv/api/v1";

// ==========================================
// 🔐 GESTION DU TOKEN (Sauvegarde Persistante)
// ==========================================

let SESSION_TOKEN = ""; 

function getNakaToken() {
    // 1. On fouille d'abord dans la mémoire "à vie" de l'application
    if (typeof localStorage !== 'undefined') {
        const savedToken = localStorage.getItem('sora_naka_token');
        if (savedToken && savedToken !== "") {
            return `Bearer ${savedToken}`;
        }
    }
    
    // 2. Sinon, on utilise la mémoire de secours de la session
    if (SESSION_TOKEN !== "") {
        return `Bearer ${SESSION_TOKEN}`;
    }
    
    // 3. S'il n'y a rien, on y va sans token
    return ""; 
}

// ==========================================
// 🗄️ TRACKER SUPABASE
// ==========================================

const SUPABASE_URL = "https://qyeisgowjisqbatrmqta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F68CBjFVPh71U0SdD9BQJg_UJgL9-Fj";

async function sendSupabaseLog(moduleName, actionType, dataPayload) {
    try {
        const payload = { module: moduleName, action: actionType, data: dataPayload };
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
    } catch (e) { console.log(`[Tracker] 🚨 Erreur Supabase : ${e.message}`); }
}

// ==========================================
// ⚙️ LOGIQUE DU MODULE NAKASTREAM
// ==========================================

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    console.log(`\n======================================`);
    console.log(`[Recherche Nakastream] 🔍 Lancement pour : "${keyword}"`);

    try {
        const cleanKeyword = keyword.trim();

        // 🎮 LE CHEAT CODE EST ICI : ENREGISTRER LE TOKEN 🎮
        if (cleanKeyword.startsWith("!naka ") && cleanKeyword !== "!naka clear") {
            const newToken = cleanKeyword.replace("!naka ", "").trim();
            SESSION_TOKEN = newToken; 
            
            // 💾 SAUVEGARDE DÉFINITIVE
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('sora_naka_token', newToken);
            }
            
            console.log(`[Nakastream] 🔐 Nouveau Token sauvegardé à vie : ${newToken.substring(0, 10)}...`);
            
            return JSON.stringify([{
                title: "✅ Token Nakastream Sauvegardé !",
                image: "https://via.placeholder.com/500x750/00FF00/FFFFFF?text=Sauvegard%C3%A9+%C3%A0+vie+%21",
                href: `${BASE_URL}/`
            }]);
        }

        // 🗑️ LE CHEAT CODE EST ICI : EFFACER LE TOKEN 🗑️
        if (cleanKeyword === "!naka clear") {
            SESSION_TOKEN = "";
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem('sora_naka_token');
            }
            return JSON.stringify([{
                title: "🗑️ Token Nakastream Effacé !",
                image: "https://via.placeholder.com/500x750/FF0000/FFFFFF?text=Token+Supprim%C3%A9",
                href: `${BASE_URL}/`
            }]);
        }

        // --- RECHERCHE NORMALE ---
        const encodedKeyword = encodeURIComponent(cleanKeyword);
        const searchUrl = `${API_URL}/browse/catalog?page=1&limit=20&sort=recent&search=${encodedKeyword}`;
        
        let headers = { "Accept": "application/json", "User-Agent": "Mozilla/5.0" };
        let token = getNakaToken();
        if (token !== "") headers["Authorization"] = token; // On injecte le token s'il existe

        const response = await soraFetch(searchUrl, { headers: headers });
        const json = await response.json();
        const results = [];

        if (json.data && Array.isArray(json.data)) {
            for (let item of json.data) {
                let imgUrl = "https://via.placeholder.com/500x750/222222/FFFFFF?text=Aucune+Affiche";
                if (item.posterPath) imgUrl = `https://image.tmdb.org/t/p/w500${item.posterPath}`;

                results.push({
                    title: item.title,
                    image: imgUrl,
                    href: `${BASE_URL}/${item.mediaType}/${item.id}`
                });
            }
        }

        sendSupabaseLog("NakaStream", "SEARCH", { 
            keyword: keyword, results_count: results.length, top_results: results.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(results);

    } catch (error) {
        console.log('[Nakastream] 🚨 Erreur searchResults : ' + error);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    // Si l'utilisateur a cliqué sur la fausse affiche de validation du Token
    if (url === `${BASE_URL}/`) {
        return JSON.stringify([{ description: "Action effectuée avec succès. Vous pouvez maintenant rechercher des animes normalement !", aliases: "Système", airdate: "N/A" }]);
    }

    sendSupabaseLog("NakaStream", "DETAILS", { anime_url: url });

    try {
        const match = url.match(/\/(tv|movie)\/(\d+)/i);
        if (!match) throw new Error("Format d'URL invalide");
        
        const id = match[2];
        const detailsUrl = `${API_URL}/browse/catalog?page=1&limit=1&search=&id=${id}`;

        let headers = { "Accept": "application/json" };
        let token = getNakaToken();
        if (token !== "") headers["Authorization"] = token;

        const response = await soraFetch(detailsUrl, { headers: headers });
        const json = await response.json();
        
        if (json.data && json.data.length > 0) {
            const item = json.data.find(d => String(d.id) === id) || json.data[0];
            const description = item.overview || "Aucune description disponible.";
            const rating = item.voteAverage ? `${item.voteAverage}/10` : "N/A";
            const year = item.releaseDate ? item.releaseDate.substring(0, 4) : "Inconnue";

            return JSON.stringify([{ description: description, aliases: `Note : ${rating}`, airdate: year }]);
        }
        throw new Error("Aucune donnée trouvée");
    } catch (error) {
        return JSON.stringify([{ description: 'Erreur de chargement ou Token manquant. Tapez !naka suivi de votre token dans la recherche.', aliases: '', airdate: '' }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    if (url === `${BASE_URL}/`) return JSON.stringify([]);

    try {
        const match = url.match(/\/(tv|movie)\/(\d+)/i);
        if (!match) throw new Error("Format d'URL invalide");
        
        const type = match[1];
        const showId = match[2];
        let episodesList = [];

        if (type === "movie") {
            episodesList.push({ href: `${showId}/movie/1/1`, number: 1, season: 1, title: "Film Complet" });
            return JSON.stringify(episodesList);
        }

        let headers = { "Accept": "application/json" };
        let token = getNakaToken();
        if (token !== "") headers["Authorization"] = token;

        const detailsUrl = `${API_URL}/browse/catalog?page=1&limit=1&id=${showId}`;
        const detailsRes = await soraFetch(detailsUrl, { headers: headers });
        const detailsJson = await detailsRes.json();
        
        if (detailsJson.data && detailsJson.data.length > 0) {
            const item = detailsJson.data.find(d => String(d.id) === showId) || detailsJson.data[0];
            const maxSeasons = item.numberOfSeasons || 1;

            for (let s = 1; s <= maxSeasons; s++) {
                try {
                    const seasonUrl = `${API_URL}/browse/${showId}/season/${s}`;
                    const sRes = await soraFetch(seasonUrl, { headers: headers });
                    const sJson = await sRes.json();

                    if (sJson.episodes && Array.isArray(sJson.episodes)) {
                        for (let ep of sJson.episodes) {
                            episodesList.push({
                                href: `${showId}/tv/${s}/${ep.episode_number}`,
                                number: ep.episode_number,
                                season: s,
                                title: ep.name || `Épisode ${ep.episode_number}`
                            });
                        }
                    }
                } catch (e) { }
            }
        }
        return JSON.stringify(episodesList);
    } catch (error) {
        return JSON.stringify([]);
    }
}

// --- 4. LECTEUR ---
async function extractStreamUrl(url) {
    if (url === `${BASE_URL}/`) return JSON.stringify({ type: "none" });

    console.log(`[Lecteur Nakastream] 🎬 Demande de flux pour : ${url}`);
    try {
        const parts = url.split('/');
        const showId = parts[0];
        const type = parts[1];
        const seasonNum = parts[2];
        const episodeNum = parts[3];

        let apiUrl = `${API_URL}/streaming/sources/${showId}?type=${type}`;
        if (type === "tv") apiUrl += `&season=${seasonNum}&episode=${episodeNum}`;

        let headers = { "Accept": "application/json" };
        let token = getNakaToken();
        if (token !== "") headers["Authorization"] = token;

        const response = await soraFetch(apiUrl, { headers: headers });
        let json = {};
        let failedLinks = [];
        
        try { json = await response.json(); } catch(e) { failedLinks.push({ server_name: "API Nakastream (Crash)", url: apiUrl }); }

        let streams = [];
        let extractedNames = [];
        const sources = json.sources || [];

        for (let i = 0; i < sources.length; i++) {
            let source = sources[i];
            if (!source.url) continue;

            let finalUrl = source.url.startsWith('/') ? BASE_URL + source.url : source.url;
            let serverName = source.type === "encoded" ? "Serveur Nakastream (Encode)" : "Serveur Alternatif";
            if (source.maxQuality) serverName += ` [${source.maxQuality}]`;

            streams.push({
                title: serverName,
                streamUrl: finalUrl,
                headers: { "Referer": BASE_URL + "/", "User-Agent": "Mozilla/5.0" }
            });
            extractedNames.push(serverName);

            if (source.subtitles && Array.isArray(source.subtitles)) {
                for (let sub of source.subtitles) {
                    if (sub.url && sub.lang === "fre") {
                        let subUrl = sub.url.startsWith('/') ? BASE_URL + sub.url : sub.url;
                        streams[streams.length - 1].subtitles = subUrl; 
                    }
                }
            }
        }

        if (streams.length === 0 && failedLinks.length === 0) {
            failedLinks.push({ server_name: "API Nakastream (Vide/Token Invalide)", url: apiUrl });
        }

        sendSupabaseLog("NakaStream", "PLAYER", { anime_url: url, season_number: seasonNum, ep_number: episodeNum, streams_found: streams.length, servers: extractedNames });

        if (failedLinks.length > 0) {
            sendSupabaseLog("NakaStream", "UNSUPPORTED_HOSTS", { anime_url: url, season_number: seasonNum, ep_number: episodeNum, failed_count: failedLinks.length, failed_links: failedLinks });
        }

        return JSON.stringify({ streams: streams, subtitles: streams.find(s => s.subtitles)?.subtitles || "" });

    } catch (error) {
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
