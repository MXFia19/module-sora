// ==========================================
// ⚙️ MODULE SORA — LIVEWATCH TV (Global Direct - FIX)
// ==========================================

const API_BASE = "https://livewatch.top/api";
const SITE_URL = "https://livewatch.top";

// ==========================================
// 🗄️ TRACKER SUPABASE (Fire & Forget)
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
// ⚙️ LOGIQUE DU MODULE LIVEWATCH
// ==========================================

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    console.log(`[LiveWatch] 🔍 Recherche globale de chaînes pour : "${keyword}"`);
    try {
        // 1. Récupérer la liste de tous les pays
        const countriesRes = await soraFetch(`${API_BASE}/countries/enabled`);
        const countriesJson = await countriesRes.json();
        const allCountries = countriesJson.countries || ["France"];

        // 2. On lance une requête par pays en MÊME TEMPS (Parallèle)
        const fetchPromises = allCountries.map(country => 
            soraFetch(`${API_BASE}/tvvoo/channels?countries=${encodeURIComponent(country)}`)
                .then(res => res.json())
                .catch(() => []) // Si un pays plante, on renvoie un tableau vide pour lui
        );

        const allResultsArray = await Promise.all(fetchPromises);
        
        // 3. On rassemble tous les tableaux en un seul immense tableau
        let allChannels = [];
        allResultsArray.forEach(countryChannels => {
            if (Array.isArray(countryChannels)) {
                allChannels = allChannels.concat(countryChannels);
            }
        });

        let filteredChannels = allChannels;

        // 4. Filtrage dynamique
        if (keyword && keyword.trim() !== "") {
            const cleanKeyword = keyword.trim().toLowerCase();
            filteredChannels = allChannels.filter(c => c.name && c.name.toLowerCase().includes(cleanKeyword));
        } else {
            // Si l'utilisateur ne tape rien, on limite à 100 chaînes pour éviter de faire crasher la mémoire du téléphone
            filteredChannels = allChannels.slice(0, 100);
        }

        const results = [];
        filteredChannels.forEach(c => {
            const fakeUrl = `livewatch://${c.country}/${c.id}`;
            const image = c.logo || c.poster || c.background || "https://via.placeholder.com/500x750/222222/FFFFFF?text=TV";
            
            // On met en évidence le pays dans le titre
            let titleInfo = `${c.name} [${c.country}]`;
            if (c.quality) titleInfo += ` (${c.quality})`;

            results.push({
                title: titleInfo,
                image: image,
                href: fakeUrl
            });
        });

        sendSupabaseLog("LiveWatch", "SEARCH", { 
            keyword: keyword, results_count: results.length, top_results: results.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(results);

    } catch (error) {
        console.log(`[LiveWatch] 🚨 Erreur Search : ${error}`);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    sendSupabaseLog("LiveWatch", "DETAILS", { anime_url: url });
    try {
        const country = url.replace('livewatch://', '').split('/')[0];
        return JSON.stringify([{ 
            description: `Chaîne de télévision en direct (${decodeURIComponent(country)}). Sources fournies par LiveWatch.`, 
            aliases: "En Direct", 
            airdate: "Live" 
        }]);
    } catch (error) {
        return JSON.stringify([{ description: 'Erreur', aliases: '', airdate: '' }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        return JSON.stringify([{ href: url, number: 1, season: 1, title: "Lancer la chaîne" }]);
    } catch (error) { return JSON.stringify([]); }
}

// --- 4. STREAM ---
async function extractStreamUrl(url) {
    console.log(`[Lecteur LiveWatch] 🎬 Demande de flux pour : ${url}`);
    try {
        let streams = [];
        let extractedNames = [];
        let failedLinks = [];

        const parts = url.replace('livewatch://', '').split('/');
        const country = parts[0];
        const channelId = parts.slice(1).join('/'); 

        const safeChannelId = encodeURIComponent(channelId);
        const safeCountry = encodeURIComponent(country);

        const streamApiUrl = `${API_BASE}/tvvoo/stream?channel=${safeChannelId}&countries=${safeCountry}`;
        
        const response = await soraFetch(streamApiUrl);
        const json = await response.json();

        if (json.sources && Array.isArray(json.sources) && json.sources.length > 0) {
            json.sources.forEach((source, index) => {
                if (source.streamUrl) {
                    let serverName = source.name || `Serveur ${index + 1}`;
                    let finalUrl = source.streamUrl.startsWith('/') ? `${SITE_URL}${source.streamUrl}` : source.streamUrl;
                    
                    streams.push({
                        title: serverName,
                        streamUrl: finalUrl,
                        headers: { "User-Agent": "Mozilla/5.0" }
                    });
                    extractedNames.push(serverName);
                }
            });
        } 
        else if (json.streamUrl) {
            let finalUrl = json.streamUrl.startsWith('/') ? `${SITE_URL}${json.streamUrl}` : json.streamUrl;
            streams.push({
                title: "LiveWatch (Principal)",
                streamUrl: finalUrl,
                headers: { "User-Agent": "Mozilla/5.0" }
            });
            extractedNames.push("LiveWatch Principal");
        } else {
            failedLinks.push({ server_name: "API LiveWatch (Vide)", url: streamApiUrl });
        }

        sendSupabaseLog("LiveWatch", "PLAYER", { 
            anime_url: url, season_number: "1", ep_number: "1", 
            streams_found: streams.length, servers: extractedNames,
            video_links: streams.map(s => s.streamUrl)
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("LiveWatch", "UNSUPPORTED_HOSTS", { 
                anime_url: url, season_number: "1", ep_number: "1", 
                failed_count: failedLinks.length, failed_links: failedLinks 
            });
        }

        return JSON.stringify(streams.length > 0 ? { type: "servers", streams: streams } : { type: "none" });

    } catch (error) { return JSON.stringify({ type: "none" }); }
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
