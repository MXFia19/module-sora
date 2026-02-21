// ==========================================================
// MODULE SORA : CINEPULSE (AUTO-REFRESH VERSION)
// ==========================================================
const TMDB_API_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";

// La clé maître (Expire dans ~30 jours, à renouveler une fois par mois)
const REFRESH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI5ODExNjVjYi1kYzJlLTQzNTAtYjM0YS1lM2FlNzA1NjYwOTkiLCJzZXNzaW9uSWQiOiJlN2ViNzQxYy1lMTg3LTRmN2YtYjQ0Zi1mODhhM2QzODI0MTMiLCJpYXQiOjE3NzE2ODg5NTEsImV4cCI6MTc3NDI4MDk1MSwiYXVkIjoiY2luZXB1bHNlLWZyb250ZW5kIiwiaXNzIjoiY2luZXB1bHNlLWJhY2tlbmQtYXBpIn0._U9kiwQU63HqB0oll85UpEGj5bOvTXcdCrDFLrMi1ow";

// --- FONCTION MAGIQUE : GÉNÉRATEUR DE JETON ---
async function getFreshToken() {
    try {
        console.log("[Cinepulse] Demande d'un nouveau pass d'accès...");
        const response = await soraFetch("https://apiapi.cinepulse.lol/api/v2/auth/refresh-auth-token", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://cinepulse.lol',
                'Referer': 'https://cinepulse.lol/'
            },
            // Le nom du paramètre exact peut varier, on tente le standard
            body: JSON.stringify({ refreshToken: REFRESH_TOKEN })
        });
        
        const data = await response.json();
        
        // On récupère le nouveau jeton tout neuf
        const newToken = data.accessToken || data.token;
        if (newToken) {
            console.log("[Cinepulse] Nouveau pass obtenu avec succès !");
            return newToken;
        } else {
            console.log("[Cinepulse] Échec de la récupération du pass :", JSON.stringify(data));
            return null;
        }
    } catch (e) {
        console.log("[Cinepulse] Erreur fatale du générateur de jeton :", e);
        return null;
    }
}

// --- OUTILS DE SÉCURITÉ CINEPULSE (REVERSE-ENGINEERED) ---

function soraBtoa(str) {
    if (typeof btoa === 'function') return btoa(str);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let block, charCode, idx = 0, map = chars, output = '';
    for (block = 0; str.charAt(idx | 0) || (map = '=', idx % 1); output += map.charAt(63 & block >> 8 - idx % 1 * 8)) {
        charCode = str.charCodeAt(idx += 3/4);
        block = block << 8 | charCode;
    }
    return output;
}

function generateRandomKey(length = 8) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for ( let i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function encodeValue(e, t) {
    const s = String(e);
    if ("id" === t) {
        let out = "";
        for (let i = 0; i < s.length; i++) {
            const r = s.charAt(i);
            if (/\d/.test(r)) { out += ((parseInt(r, 10) + 7) % 10).toString(); } 
            else { out += r; }
        }
        return `c${soraBtoa(out)}`;
    }
    if ("type" === t) {
        let out = "";
        const k = "k";
        for (let i = 0; i < s.length; i++) {
            out += String.fromCharCode(s.charCodeAt(i) ^ k.charCodeAt(0));
        }
        return `t${soraBtoa(out)}`;
    }
    if ("season" === t) {
        const num = parseInt(s, 10);
        const val = String(num + 5);
        let out = "";
        for (let i = 0; i < val.length; i++) {
            out += ((parseInt(val.charAt(i), 10) + 3) % 10).toString();
        }
        return `s${out}`;
    }
    if ("episode" === t) {
        const num = parseInt(s, 10);
        const val = String(num + 9);
        let out = "";
        for (let i = 0; i < val.length; i++) {
            out += ((parseInt(val.charAt(i), 10) + 4) % 10).toString();
        }
        return `e${out}`;
    }
    if ("exp" === t) {
        const out = s.split("").map(c => c.charCodeAt(0).toString(16)).join("");
        return `x${soraBtoa(out)}`;
    }
    return `d${soraBtoa(s)}`;
}

function obfuscateParams(paramsObj) {
    const t = {};
    const s = Date.now() + 60000; 
    t[generateRandomKey(8)] = encodeValue(s, "exp");

    Object.entries(paramsObj).forEach(([key, val]) => {
        if (val == null) return;
        let r = key.substring(0, 2);
        if (key === "tmdbId") r = "id";
        else if (key === "type") r = "type";
        else if (key === "season") r = "season";
        else if (key === "episode") r = "episode";
        else if (key === "sessionId") r = "sid";

        t[generateRandomKey(8)] = encodeValue(val, r);
    });

    const prefixes = ["q", "w", "p", "z", "h", "j"];
    const n = 10 + Math.floor(10 * Math.random());
    for (let i = 0; i < n; i++) {
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const randomStr = soraBtoa(generateRandomKey(8 + Math.floor(8 * Math.random())));
        t[generateRandomKey(8)] = `${prefix}${randomStr}`;
    }
    return t;
}

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const responseText = await soraFetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodedKeyword}&language=fr-FR&page=1&include_adult=false&sort_by=popularity.desc`);
        const data = await responseText.json();

        const transformedResults = data.results.map(result => {
            if(result.media_type === "movie" || result.title) {
                return {
                    title: result.title || result.name,
                    image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
                    href: `cinepulse/movie/${result.id}`
                };
            }
            else if(result.media_type === "tv" || result.name) {
                return {
                    title: result.name || result.title,
                    image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
                    href: `cinepulse/tv/${result.id}`
                };
            }
        });

        return JSON.stringify(transformedResults.filter(Boolean));
    } catch (error) {
        console.log('Fetch error in searchResults: ' + error);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        if(url.includes('movie')) {
            const match = url.match(/movie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];
            const responseText = await soraFetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&language=fr-FR`);
            const data = await responseText.json();

            return JSON.stringify([{
                description: data.overview || 'Aucune description disponible.',
                aliases: `Durée : ${data.runtime ? data.runtime + " minutes" : 'Inconnue'}`,
                airdate: `Date de sortie : ${data.release_date ? data.release_date : 'Inconnue'}`
            }]);
        } else if(url.includes('tv')) {
            const match = url.match(/tv\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];
            const responseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}?api_key=${TMDB_API_KEY}&language=fr-FR`);
            const data = await responseText.json();

            return JSON.stringify([{
                description: data.overview || 'Aucune description disponible.',
                aliases: `Durée : ${data.episode_run_time && data.episode_run_time.length ? data.episode_run_time[0] + " minutes" : 'Inconnue'}`,
                airdate: `Première diffusion : ${data.first_air_date ? data.first_air_date : 'Inconnue'}`
            }]);
        }
    } catch (error) {
        return JSON.stringify([{ description: 'Erreur', aliases: '', airdate: '' }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        if(url.includes('movie')) {
            const match = url.match(/movie\/(\d+)/);
            const movieId = match[1];
            return JSON.stringify([{ href: `${movieId}/movie`, number: 1, title: "Film Complet" }]);
        } else if(url.includes('tv')) {
            const match = url.match(/tv\/(\d+)/);
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
        }
    } catch (error) {
        return JSON.stringify([]);
    }    
}

// --- 4. EXTRACTION VIDÉO (AVEC AUTO-LOGIN + CRYPTAGE) ---
async function extractStreamUrl(url) {
    try {
        let streams = [];
        let showId = "";
        let seasonNumber = "";
        let episodeNumber = "";
        let isMovie = url.includes('movie');

        if (isMovie) {
            const parts = url.split('/');
            showId = parts[0]; 
        } else {
            const parts = split('/');
            showId = parts[0];         
            seasonNumber = parts[1];   
            episodeNumber = parts[2];  
        }

        // 1. OBTENTION DU NOUVEAU JETON 
        const freshAccessToken = await getFreshToken();
        if (!freshAccessToken) {
            throw new Error("Impossible de rafraîchir le jeton d'accès");
        }

        // 2. Préparation de l'objet de base
        const payload = {
            tmdbId: showId,
            type: isMovie ? "movie" : "tv",
            season: isMovie ? undefined : parseInt(seasonNumber),
            episode: isMovie ? undefined : parseInt(episodeNumber)
        };

        // 3. CRYPTAGE DES PARAMÈTRES
        const encryptedParams = obfuscateParams(payload);
        
        // 4. Création de l'URL
        const queryString = Object.keys(encryptedParams).map(key => key + '=' + encodeURIComponent(encryptedParams[key])).join('&');
        const apiUrl = `https://apiapi.cinepulse.lol/watch/sources?${queryString}`;

        console.log("[Cinepulse] URL d'attaque générée :", apiUrl);

        // 5. Exécution de la requête avec le jeton FRAIS
        const response = await soraFetch(apiUrl, {
            method: 'GET',
            headers: {
                "Authorization": `Bearer ${freshAccessToken}`,
                "X-Client-Version": "3.5.2",
                "X-Screen-Size": soraBtoa("1920x1080"),
                "X-Request-Time": Date.now().toString(),
                "Origin": "https://cinepulse.lol",
                "Referer": "https://cinepulse.lol/",
                "Accept": "application/json"
            }
        });
        
        const data = await response.json();
        
        // 6. Extraction des Liens
        let rawStreams = [];
        function findStreams(obj, currentName = "Serveur Cinepulse") {
            if (obj === null || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach(item => findStreams(item, currentName));
                return;
            }
            
            let name = obj.name || obj.title || obj.server || obj.language || obj.lang || currentName;
            
            for (const [key, value] of Object.entries(obj)) {
                let passName = name;
                if (["VF", "VOSTFR", "VFF", "VFQ", "FRENCH", "ENGLISH"].includes(key.toUpperCase())) { passName = key.toUpperCase(); }
                
                if (typeof value === 'string') {
                    if (value.includes('.m3u8') || value.includes('.mp4') || (value.startsWith('http') && ['url', 'link', 'file', 'src'].includes(key.toLowerCase()))) {
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

        let seenUrls = new Set();
        for (let item of rawStreams) {
            if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                streams.push({
                    title: item.name,
                    streamUrl: item.url,
                    headers: {
                        "Origin": "https://cinepulse.lol",
                        "Referer": "https://cinepulse.lol/"
                    }
                });
            }
        }

        return JSON.stringify({ streams, subtitles: "" });

    } catch (error) {
        console.log('[Cinepulse] Erreur extractStreamUrl: ' + error);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}

// --- OUTIL FETCH ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8');
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        return await fetch(url, options).catch(() => null);
    }
}
