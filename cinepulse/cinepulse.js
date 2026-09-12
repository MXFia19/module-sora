// Settings start
const profileId = "votre_id_de_profil_ici"; // L'ID de votre profil Cinepulse (x-profile-id)
const initialRefreshToken = "votre_refresh_token_ici"; // Votre 1er Refresh Token (Sera mis à jour auto dans le Cloud)
// Settings end

// ==========================================
// ⚙️ MODULE SORA — CINEPULSE (Coffre-fort Personnel)
// ==========================================

const BASE_URL = "https://cinepulse.vc";
const API_URL = "https://apiapi.cinepulse.vc";

// ==========================================
// 🗄️ TRACKER SUPABASE (Statistiques)
// ==========================================

const SUPABASE_URL = "https://qyeisgowjisqbatrmqta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F68CBjFVPh71U0SdD9BQJg_UJgL9-Fj";

async function sendSupabaseLog(moduleName, actionType, dataPayload) {
    try {
        const payload = { module: moduleName, action: actionType, data: dataPayload };
        const headers = { 
            "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Prefer": "return=minimal" 
        };
        if (typeof fetchv2 !== 'undefined') await fetchv2(`${SUPABASE_URL}/rest/v1/app_logs`, headers, "POST", JSON.stringify(payload));
        else await fetch(`${SUPABASE_URL}/rest/v1/app_logs`, { method: "POST", headers: headers, body: JSON.stringify(payload) });
    } catch (e) {}
}

// ==========================================
// 🔑 VAULT SUPABASE : GESTION DES TOKENS PAR UTILISATEUR
// ==========================================

const CONFIG_TABLE_URL = `${SUPABASE_URL}/rest/v1/site_configs`;
// On crée un nom de ligne unique pour l'utilisateur (ex: cinepulse_a589c3f2...)
const UNIQUE_USER_KEY = `cinepulse_${profileId}`; 

async function getTokensFromSupabase() {
    try {
        const response = await soraFetch(`${CONFIG_TABLE_URL}?site_name=eq.${UNIQUE_USER_KEY}&select=*`, {
            headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const data = await response.json();
        if (data && data.length > 0) return data[0];
    } catch (e) { console.log("[Vault] 🚨 Erreur lecture DB"); }
    return null;
}

async function updateTokensInSupabase(newAccess, newRefresh, isNewUser) {
    try {
        const payload = { 
            site_name: UNIQUE_USER_KEY, 
            access_token: newAccess, 
            refresh_token: newRefresh, 
            updated_at: new Date().toISOString() 
        };
        
        // Si l'utilisateur n'existe pas, on POST (création). Sinon on PATCH (mise à jour)
        const method = isNewUser ? "POST" : "PATCH";
        const url = isNewUser ? CONFIG_TABLE_URL : `${CONFIG_TABLE_URL}?site_name=eq.${UNIQUE_USER_KEY}`;

        await soraFetch(url, { 
            method: method, 
            headers: { 
                "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, 
                "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Prefer": "return=minimal" 
            }, 
            body: JSON.stringify(payload) 
        });
        console.log("[Vault] ✅ Nouveaux jetons de l'utilisateur sécurisés dans Supabase !");
    } catch (e) { console.log("[Vault] 🚨 Erreur écriture DB"); }
}

async function ensureValidToken(forceRefresh = false) {
    // 1. On interroge Supabase pour voir si l'utilisateur y a déjà ses jetons rotatifs
    const dbData = await getTokensFromSupabase();
    let isNewUser = false;
    let currentRefreshToken = initialRefreshToken; // Par défaut, on prend celui des settings Sora

    if (dbData && dbData.refresh_token) {
        currentRefreshToken = dbData.refresh_token; // S'il existe en DB, on écrase celui des settings !
    } else {
        isNewUser = true; // C'est la toute première fois qu'il utilise le module
    }

    if (!currentRefreshToken || currentRefreshToken === "votre_refresh_token_ici") {
        console.log("[Cinepulse] ❌ Aucun Refresh Token initial configuré !");
        return null; 
    }

    // 2. Vérification de la validité (14 minutes)
    if (!forceRefresh && dbData && dbData.access_token && dbData.updated_at) {
        const lastUpdatedTime = new Date(dbData.updated_at).getTime();
        if ((Date.now() - lastUpdatedTime) < (900000 - 60000)) return dbData.access_token;
    }

    // 3. Rafraîchissement avec Cinepulse
    try {
        console.log("[Cinepulse] ⏳ Actualisation des jetons via Cinepulse...");
        const response = await soraFetch(`${API_URL}/api/v2/auth/refresh-auth-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: currentRefreshToken })
        });

        const json = await response.json();

        if (json.type === "success" && json.data && json.data.items) {
            const items = json.data.items;
            // 4. On sauvegarde IMMÉDIATEMENT le nouveau Refresh Token dans Supabase
            await updateTokensInSupabase(items.accessToken, items.refreshToken, isNewUser);
            return items.accessToken;
        }
    } catch (e) {
        console.log("[Cinepulse] 🚨 Échec du refresh. Le token est peut-être périmé.");
    }
    
    return dbData ? dbData.access_token : null;
}

// ==========================================
// 🛡️ ALGORITHME DE CHIFFREMENT CINEPULSE
// ==========================================

function safeBtoa(str) {
    try { return btoa(str); } catch (e) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        let out = '', i = 0, len = str.length;
        while (i < len) {
            let c1 = str.charCodeAt(i++) & 0xff;
            if (i === len) { out += chars.charAt(c1 >> 2) + chars.charAt((c1 & 0x3) << 4) + "=="; break; }
            let c2 = str.charCodeAt(i++);
            if (i === len) { out += chars.charAt(c1 >> 2) + chars.charAt(((c1 & 0x3) << 4) | ((c2 & 0xf0) >> 4)) + chars.charAt((c2 & 0xf) << 2) + "="; break; }
            let c3 = str.charCodeAt(i++);
            out += chars.charAt(c1 >> 2) + chars.charAt(((c1 & 0x3) << 4) | ((c2 & 0xf0) >> 4)) + chars.charAt(((c2 & 0xf) << 2) | ((c3 & 0xc0) >> 6)) + chars.charAt(c3 & 0x3f);
        }
        return out;
    }
}

function generateRandomKey(e = 8) {
    const t = "abceghjklmnopqrtuvwxyzABCEGHIJKLMNOPQRTUVWXYZ0123456789";
    let s = "";
    for (let r = 0; r < e; r++) s += t.charAt(Math.floor(55 * Math.random()));
    return s;
}

function encodeValue(e, t) {
    const s = String(e);
    if ("id" === t) {
        let res = "";
        for (let i = 0; i < s.length; i++) {
            const r = s.charAt(i);
            if (/\d/.test(r)) res += ((parseInt(r, 10) + 7) % 10).toString();
            else res += r;
        }
        return `c${safeBtoa(res)}`;
    }
    if ("type" === t) {
        let res = "";
        const k = "k";
        for (let r = 0; r < s.length; r++) res += String.fromCharCode(s.charCodeAt(r) ^ k.charCodeAt(0));
        return `t${safeBtoa(res)}`;
    }
    if ("season" === t) {
        const t_str = String(parseInt(s, 10) + 5);
        let r = "";
        for (let i = 0; i < t_str.length; i++) r += ((parseInt(t_str.charAt(i), 10) + 3) % 10).toString();
        return `s${r}`;
    }
    if ("episode" === t) {
        const t_str = String(parseInt(s, 10) + 9);
        let r = "";
        for (let i = 0; i < t_str.length; i++) r += ((parseInt(t_str.charAt(i), 10) + 4) % 10).toString();
        return `e${r}`;
    }
    if ("exp" === t) {
        const hexStr = s.split("").map(char => char.charCodeAt(0).toString(16)).join("");
        return `x${safeBtoa(hexStr)}`;
    }
    return `d${safeBtoa(s)}`;
}

function obfuscateParams(params, lifespan = 600000) {
    const t = {};
    const s = Date.now() + lifespan;
    t[generateRandomKey()] = encodeValue(s, "exp");

    Object.entries(params).forEach(([key, value]) => {
        if (value == null) return;
        let r = key.substring(0, 2);
        if (key === "tmdbId") r = "id";
        else if (key === "type") r = "type";
        else if (key === "season") r = "season";
        else if (key === "episode") r = "episode";
        else if (key === "sessionId") r = "sid";

        t[generateRandomKey()] = encodeValue(value, r);
    });

    const randomPrefixes = ["q", "w", "p", "z", "h", "j"];
    const n = 10 + Math.floor(10 * Math.random());
    for (let a = 0; a < n; a++) {
        const prefix = randomPrefixes[Math.floor(Math.random() * randomPrefixes.length)];
        const randomB64 = safeBtoa(generateRandomKey(8 + Math.floor(8 * Math.random())));
        t[generateRandomKey()] = `${prefix}${randomB64}`;
    }
    return t;
}

// ==========================================
// ⚙️ LOGIQUE DU MODULE SORA
// ==========================================

async function searchResults(keyword) {
    try {
        const token = await ensureValidToken();
        if (!token) return JSON.stringify([]);
        const encodedKeyword = encodeURIComponent(keyword);
        const searchApiUrl = `${API_URL}/content/advanced-search?query=${encodedKeyword}&sortBy=pertinence&page=1`; 
        const responseText = await soraFetch(searchApiUrl, {
            headers: { "Authorization": `Bearer ${token}`, "Origin": BASE_URL, "Referer": `${BASE_URL}/` }
        });
        const data = await responseText.json();
        let items = [];
        if (data && data.data && data.data.items && data.data.items.medias && data.data.items.medias.all) {
            items = data.data.items.medias.all;
        }
        const transformedResults = items.map(result => {
            let title = result.title; let tmdbId = result.tmdbId; let type = result.type; 
            let image = result.posterPath || "https://via.placeholder.com/500x750?text=Pas+d'image";
            if (title && tmdbId) return { title: title, image: image, href: `cinepulse://${type}/${tmdbId}` };
        }).filter(Boolean);
        sendSupabaseLog("Cinepulse", "SEARCH", { keyword: keyword, results_count: transformedResults.length });
        return JSON.stringify(transformedResults);
    } catch (error) { return JSON.stringify([]); }
}

async function extractDetails(url) {
    try {
        const token = await ensureValidToken();
        if (!token) return JSON.stringify([{ description: 'Veuillez configurer votre Refresh Token.', aliases: '', airdate: '' }]);
        
        const parts = url.replace('cinepulse://', '').split('/');
        const type = parts[0]; const tmdbId = parts[1];
        const responseText = await soraFetch(`${API_URL}/sheet/details?type=${type}&tmdbId=${tmdbId}`, {
            headers: { "Authorization": `Bearer ${token}`, "Origin": BASE_URL, "Referer": `${BASE_URL}/` }
        });
        const data = await responseText.json();
        let info = {}; if (data && data.data && data.data.items) info = data.data.items;
        let description = info.overview || "Aucune description disponible.";
        let duration = info.duration ? `${info.duration} min` : (info.seasonsCount ? `${info.seasonsCount} Saison(s)` : "Inconnue");
        let date = info.releasedAt ? info.releasedAt.split('T')[0] : "Inconnue";
        return JSON.stringify([{ description: description, aliases: `Durée/Format : ${duration}`, airdate: `Date : ${date}` }]);
    } catch (error) { return JSON.stringify([{ description: 'Erreur', aliases: '', airdate: '' }]); }
}

async function extractEpisodes(url) {
    try {
        const token = await ensureValidToken();
        if (!token) return JSON.stringify([]);
        
        const parts = url.replace('cinepulse://', '').split('/');
        const type = parts[0]; const tmdbId = parts[1];

        if (type === 'movie') {
            return JSON.stringify([{ href: `cinepulse-play://movie/${tmdbId}`, number: 1, title: "Film Complet", image: "" }]);
        }

        const response = await soraFetch(`${API_URL}/sheet/episodes?tmdbId=${tmdbId}`, {
            headers: { "Authorization": `Bearer ${token}`, "Origin": BASE_URL, "Referer": `${BASE_URL}/` }
        });
        const data = await response.json();
        let allEpisodes = [];

        if (data && data.data && data.data.items && data.data.items.seasons) {
            for (const season of data.data.items.seasons) {
                if (season.episodes && Array.isArray(season.episodes)) {
                    for (const ep of season.episodes) {
                        allEpisodes.push({
                            href: `cinepulse-play://tv/${tmdbId}/${season.number}/${ep.number}`, 
                            number: ep.number, season: season.number, title: ep.name || `Épisode ${ep.number}`, image: ep.poster || ""
                        });
                    }
                }
            }
        }
        return JSON.stringify(allEpisodes);
    } catch (error) { return JSON.stringify([]); }
}

async function extractStreamUrl(url) {
    try {
        console.log(`[Cinepulse] 🎬 Extraction Démarrée pour : ${url}`);
        let token = await ensureValidToken();
        if (!token) throw new Error("Authentification échouée (Token non configuré ou expiré)");

        const parts = url.replace('cinepulse-play://', '').split('/');
        const type = parts[0];
        const tmdbId = parts[1];
        const seasonNumber = parts[2] || "1";
        const episodeNumber = parts[3] || "1";

        const fetchVideos = async (currentToken) => {
            const requestData = { tmdbId: tmdbId, type: type };
            if (type !== "movie") {
                requestData.season = parseInt(seasonNumber, 10);
                requestData.episode = parseInt(episodeNumber, 10);
            }

            const encryptedParams = obfuscateParams(requestData, 600000); 
            const queryString = Object.keys(encryptedParams).map(key => `${key}=${encodeURIComponent(encryptedParams[key])}`).join('&');
            const videoApiUrl = `${API_URL}/watch/sources?${queryString}`;
            
            console.log(`[Cinepulse] 🔗 Génération URL: ${videoApiUrl}`);

            const res = await soraFetch(videoApiUrl, {
                headers: { 
                    "Authorization": `Bearer ${currentToken}`, 
                    "x-profile-id": profileId, // Variable venant des Settings
                    "Accept": "application/json, text/plain, */*",
                    "Origin": BASE_URL, 
                    "Referer": `${BASE_URL}/play/${tmdbId}`,
                    "X-Client-Version": "3.5.2",
                    "X-Screen-Size": safeBtoa("1920x1080"),
                    "X-Request-Time": Date.now().toString(),
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
                }
            });
            
            if (!res) throw new Error("Erreur réseau");
            return await res.text();
        };

        let responseText = await fetchVideos(token);
        let data = {};
        try { data = JSON.parse(responseText); } catch(e) {}

        if (!data || (data.type === "error" && data.message && data.message.toLowerCase().includes("unauthorized"))) {
            console.log(`[Cinepulse] ⚠️ Token refusé par l'API. Rafraîchissement forcé et 2e essai...`);
            token = await ensureValidToken(true); 
            if (token) {
                responseText = await fetchVideos(token);
                try { data = JSON.parse(responseText); } catch(e) {}
            }
        }
        
        let rawStreams = [];
        let streams = [];
        let failedLinks = [];
        
        if (data && data.type === "success" && data.data && Array.isArray(data.data.items)) {
            data.data.items.forEach(item => {
                if (item.url && item.url.trim() !== "") {
                    let name = item.label || "Serveur";
                    if (item.language) name += ` [${item.language}]`;
                    if (item.quality) name += ` - ${item.quality}`;
                    rawStreams.push({ url: item.url, name: name });
                }
            });
        } else {
            console.log("[Cinepulse] ❌ Échec final : " + (data.message || "Aucune vidéo trouvée"));
        }

        let seenUrls = new Set();
        for (let item of rawStreams) {
            if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                let streamHeaders = {};

                let valLower = item.url.toLowerCase();
                if (valLower.includes('fsvid') || valLower.includes('vidzy') || valLower.includes('darkibox')) {
                    try {
                        const urlObj = new URL(item.url);
                        streamHeaders["Referer"] = urlObj.origin + "/";
                    } catch(e) {}
                }

                streams.push({
                    title: item.name, 
                    streamUrl: item.url,
                    headers: streamHeaders
                });
            }
        }
        if (streams.length === 0) failedLinks.push({ server_name: "API Cinepulse (Vide/Rejet)", url: "Cinepulse_API" });

        sendSupabaseLog("Cinepulse", "PLAYER", { 
            media_path: url, type: type.toUpperCase(), saison: type === "movie" ? "N/A" : seasonNumber, episode: episodeNumber,
            streams_found: streams.length,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        return JSON.stringify({ streams, subtitles: "" });

    } catch (error) {
        console.log(`[Cinepulse] 🚨 Erreur Critique: ${error}`);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}

// --- UTILS SORA ---
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