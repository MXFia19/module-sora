// ==========================================
// ⚙️ MODULE SORA — LIVEWATCH TV (V2 - Nouvelle API)
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
    console.log(`\n==============================================`);
    console.log(`[LiveWatch] 🔍 DÉMARRAGE RECHERCHE : "${keyword}"`);
    
    try {
        const cleanKeyword = keyword ? keyword.trim() : "";
        let searchUrl = `${API_BASE}/channels?limit=100`; // Par défaut on prend 100 chaînes max
        
        if (cleanKeyword !== "") {
            searchUrl += `&search=${encodeURIComponent(cleanKeyword)}`;
            console.log(`[LiveWatch] 📡 Recherche ciblée : ${searchUrl}`);
        } else {
            console.log(`[LiveWatch] 📡 Recherche globale (Top 100) : ${searchUrl}`);
        }

        const response = await soraFetch(searchUrl);
        if (!response) {
            console.log(`[LiveWatch] ❌ Échec réseau sur l'API channels.`);
            throw new Error("API LiveWatch injoignable.");
        }

        const textResponse = await response.text();
        const json = JSON.parse(textResponse);
        
        const channels = json.channels || [];
        console.log(`[LiveWatch] 📊 ${channels.length} chaînes trouvées (Total dispo: ${json.total || 0}).`);

        const results = [];
        
        channels.forEach(c => {
            // On sauvegarde le nom de la chaîne dans l'URL pour pouvoir chercher l'EPG plus tard
            const safeName = encodeURIComponent(c.name || "Inconnu");
            const fakeUrl = `livewatch://${encodeURIComponent(c.country || "Unknown")}/${c.id}?name=${safeName}`;
            
            let image = c.logo || "https://via.placeholder.com/500x750/222222/FFFFFF?text=TV";
            
            // On met en évidence le pays dans le titre
            let titleInfo = `${c.name} [${c.country}]`;
            if (c.source) titleInfo += ` (${c.source})`;

            results.push({
                title: titleInfo,
                image: image,
                href: fakeUrl
            });
        });

        console.log(`[LiveWatch] 🎉 Fin recherche. Renvoi de ${results.length} chaînes.`);

        sendSupabaseLog("LiveWatch", "SEARCH", { 
            keyword: keyword, results_count: results.length, top_results: results.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(results);

    } catch (error) {
        console.log(`[LiveWatch] 🚨 ERREUR RECHERCHE : ${error.message}`);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    console.log(`\n[LiveWatch] 📖 DÉTAILS POUR : ${url}`);
    sendSupabaseLog("LiveWatch", "DETAILS", { anime_url: url });
    
    try {
        const match = url.match(/livewatch:\/\/([^/]+)\/([^?]+)/);
        const nameMatch = url.match(/[?&]name=([^&]+)/);
        
        const country = match ? decodeURIComponent(match[1]) : "Inconnu";
        const channelName = nameMatch ? decodeURIComponent(nameMatch[1]) : "";
        
        let description = `Chaîne de télévision en direct (${country}). Sources fournies par LiveWatch.`;
        let aliases = "En Direct";

        // 🌟 NOUVEAU : Récupération du Programme TV (EPG)
        if (channelName) {
            console.log(`[LiveWatch] 📅 Recherche de l'EPG (Programme TV) pour : ${channelName}`);
            try {
                const epgRes = await soraFetch(`${API_BASE}/epg/now?name=${encodeURIComponent(channelName)}`);
                if (epgRes) {
                    const epgText = await epgRes.text();
                    const epgJson = JSON.parse(epgText);
                    
                    if (epgJson.current && epgJson.current.title) {
                        console.log(`[LiveWatch] ✅ EPG trouvé ! Actuellement : ${epgJson.current.title}`);
                        
                        description = `📺 EN CE MOMENT :\n${epgJson.current.title}`;
                        if (epgJson.current.sub_title) description += ` - ${epgJson.current.sub_title}`;
                        if (epgJson.current.desc) description += `\n\n📝 ${epgJson.current.desc}\n`;
                        
                        if (epgJson.next && epgJson.next.title) {
                            description += `\n\n🔜 À SUIVRE :\n${epgJson.next.title}`;
                            if (epgJson.next.sub_title) description += ` - ${epgJson.next.sub_title}`;
                        }
                    } else {
                        console.log(`[LiveWatch] ⚠️ Aucun programme en cours renvoyé par l'API.`);
                    }
                }
            } catch(epgErr) {
                console.log(`[LiveWatch] ⚠️ Échec de récupération de l'EPG : ${epgErr.message}`);
            }
        }

        return JSON.stringify([{ 
            description: description, 
            aliases: aliases, 
            airdate: "Live" 
        }]);

    } catch (error) {
        console.log(`[LiveWatch] 🚨 ERREUR DÉTAILS : ${error.message}`);
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
    console.log(`\n==============================================`);
    console.log(`[Lecteur LiveWatch] 🎬 DÉMARRAGE DU STREAM POUR : ${url}`);
    
    try {
        let streams = [];
        let extractedNames = [];
        let failedLinks = [];

        const match = url.match(/livewatch:\/\/([^/]+)\/([^?]+)/);
        if (!match) throw new Error("Format d'URL invalide");
        
        const channelId = match[2]; 
        console.log(`[Lecteur LiveWatch] 🧩 ID de la chaîne extrait : "${channelId}"`);

        const streamApiUrl = `${API_BASE}/stream/${channelId}`;
        console.log(`[Lecteur LiveWatch] 📡 Appel API : ${streamApiUrl}`);
        
        const response = await soraFetch(streamApiUrl);
        
        if (!response) {
            console.log(`[Lecteur LiveWatch] ❌ Échec réseau. Le serveur n'a pas répondu.`);
            throw new Error("L'API n'a pas répondu.");
        }

        console.log(`[Lecteur LiveWatch] 📥 Réponse reçue. Statut HTTP : ${response.status}`);
        
        const textResponse = await response.text();
        console.log(`[Lecteur LiveWatch] 📄 Texte brut reçu du serveur : ${textResponse}`);

        let json;
        try {
            json = JSON.parse(textResponse);
        } catch(e) {
            throw new Error("JSON Invalide");
        }

        // 🌟 NOUVEAU : Lecture du paramètre "proxy_url"
        if (json.proxy_url) {
            console.log(`[Lecteur LiveWatch] ✅ URL Proxy trouvée.`);
            
            // Lien via le proxy officiel (Recommandé pour contourner le CORS)
            let proxyStreamUrl = json.proxy_url.startsWith('http') ? json.proxy_url : `${SITE_URL}${json.proxy_url}`;
            
            streams.push({
                title: "LiveWatch (Proxy Officiel)",
                streamUrl: proxyStreamUrl,
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": SITE_URL + "/" }
            });
            extractedNames.push("Proxy Officiel");
            console.log(`   -> 🟢 Ajout du flux Proxy : ${proxyStreamUrl}`);

            // 💡 ASTUCE : On extrait aussi le lien original (caché dans le paramètre u=)
            let rawUrlMatch = json.proxy_url.match(/u=([^&]+)/);
            if (rawUrlMatch && rawUrlMatch[1]) {
                let decodedRawUrl = decodeURIComponent(rawUrlMatch[1]);
                streams.push({
                    title: "LiveWatch (Lien Direct)",
                    streamUrl: decodedRawUrl,
                    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
                });
                extractedNames.push("Lien Direct");
                console.log(`   -> 🟢 Ajout du flux Direct : ${decodedRawUrl}`);
            }
        } else {
            console.log(`[Lecteur LiveWatch] ⚠️ Attention: Aucune "proxy_url" trouvée dans le JSON !`);
            failedLinks.push({ server_name: "API LiveWatch (Vide)", url: streamApiUrl });
        }

        console.log(`[Lecteur LiveWatch] 📊 Fin de l'extraction. Total des flux validés : ${streams.length}`);

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

    } catch (error) {
        console.log(`[Lecteur LiveWatch] 🚨 ERREUR DANS LE LECTEUR : ${error.message}`);
        return JSON.stringify({ type: "none" }); 
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