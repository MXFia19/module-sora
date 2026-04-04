// ==========================================
// ⚙️ MODULE SORA — ANIMESULTRA (Supabase + Vitesse Max + Sibnet Pro)
// ==========================================

const BASE_URL = "https://ww.animesultra.org";

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
        
        await fetchv2(`${SUPABASE_URL}/rest/v1/app_logs`, headers, "POST", JSON.stringify(payload));
    } catch (e) { 
        console.log(`[Tracker] 🚨 Erreur d'envoi vers Supabase : ${e.message}`); 
    }
}

// ==========================================
// ⚙️ LOGIQUE DU MODULE ANIMESULTRA
// ==========================================

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    console.log(`[Recherche] 🔍 Lancement pour : "${keyword}"`);

    try {
        const searchUrl = `${BASE_URL}/?story=${encodeURIComponent(keyword)}&do=search&subaction=search`;
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        };

        const response = await fetchv2(searchUrl, { headers });
        const html = await response.text();
        const results = [];

        const items = html.split('class="flw-item"');
        
        for (let i = 1; i < items.length; i++) {
            let item = items[i];
            let linkMatch = item.match(/<a[^>]+href=["']([^"']+)["'][^>]+class=["'][^"']*film-poster-ahref[^"']*["'][^>]+title=["']([^"']+)["']/i);
            let imgMatch = item.match(/<img[^>]+data-src=["']([^"']+)["']/i) || item.match(/<img[^>]+src=["']([^"']+)["']/i);

            if (linkMatch) {
                let href = linkMatch[1];
                let title = linkMatch[2].replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
                let image = imgMatch ? imgMatch[1] : "";
                
                if (image.startsWith('/')) {
                    image = BASE_URL + image;
                }

                if (!results.find(r => r.href === href)) {
                    results.push({ title, image, href });
                }
            }
        }

        // 📡 Log Supabase (Recherche)
        sendSupabaseLog("AnimesUltra", "SEARCH", { 
            keyword: keyword, 
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(results);
    } catch (e) {
        console.log("Erreur Recherche AnimesUltra: " + e);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    console.log(`[Détails] 📖 Chargement des infos pour : ${url}`);
    
    // 📡 Log Supabase (Détails)
    sendSupabaseLog("AnimesUltra", "DETAILS", { anime_url: url });

    try {
        const response = await fetchv2(url);
        const html = await response.text();

        let description = "Pas de description disponible.";
        const descMatch = html.match(/<div class=["'][^"']*film-description[^"']*["'][^>]*>\s*<div class=["']text["']>([\s\S]*?)<\/div>/i);

        if (descMatch && descMatch[1]) {
            description = descMatch[1]
                .replace(/<p>\s*Vous\s*<strong[^>]*>.*?<\/strong>.*?<\/p>/gi, '') 
                .replace(/<[^>]+>/g, '') 
                .replace(/&amp;/g, '&')
                .replace(/&#039;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
        } else {
            const metaDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
            if (metaDescMatch && metaDescMatch[1]) {
                description = metaDescMatch[1].trim();
            }
        }

        let airdate = "N/A";
        const yearMatch = html.match(/<span class=["']item-head["']>Année:<\/span>\s*<span class=["']name["']><a[^>]*>(\d{4})<\/a><\/span>/i) || 
                          html.match(/\/xfsearch\/year\/(\d{4})\//i);
        if (yearMatch) airdate = yearMatch[1];

        return JSON.stringify([{ description, aliases: "AnimesUltra", airdate }]);
    } catch (e) {
        console.log("Erreur Détails AnimesUltra: " + e);
        return JSON.stringify([{ description: "Erreur de chargement", aliases: "AnimesUltra", airdate: "N/A" }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        let newsId = null;
        const urlIdMatch = url.match(/\/(\d+)-[^/]+\.html/i);
        const htmlIdMatch = html.match(/id=["']post_id["']\s+value=["'](\d+)["']/i);

        if (urlIdMatch) newsId = urlIdMatch[1];
        else if (htmlIdMatch) newsId = htmlIdMatch[1];

        if (!newsId) return JSON.stringify([]);

        const ajaxUrl = `${BASE_URL}/engine/ajax/full-story.php?newsId=${newsId}&d=${Date.now()}`;
        const ajaxRes = await fetchv2(ajaxUrl);
        const ajaxText = await ajaxRes.text();
        
        let ajaxHtml = "";
        try {
            const ajaxJson = JSON.parse(ajaxText);
            ajaxHtml = ajaxJson.html || ajaxText; 
        } catch (e) {
            ajaxHtml = ajaxText;
        }

        let results = [];
        const epTagRegex = /<a[^>]+class=["'][^"']*ep-item[^"']*["'][^>]*>/gi;
        let match;
        let sourceToScan = ajaxHtml.includes("ep-item") ? ajaxHtml : html;

        while ((match = epTagRegex.exec(sourceToScan)) !== null) {
            let tag = match[0];
            let hrefMatch = tag.match(/href=["']([^"']+)["']/i);
            let titleMatch = tag.match(/title=["']([^"']+)["']/i);
            let numMatch = tag.match(/data-number=["'](\d+)["']/i);
            
            if (hrefMatch) {
                let epHref = hrefMatch[1];
                if (epHref.startsWith('/')) epHref = BASE_URL + epHref;

                results.push({
                    href: epHref,
                    title: titleMatch ? titleMatch[1] : "Épisode",
                    number: numMatch ? parseInt(numMatch[1]) : (results.length + 1)
                });
            }
        }

        let uniqueResults = [];
        let hrefsSet = new Set();
        for (let ep of results) {
            if (!hrefsSet.has(ep.href)) {
                hrefsSet.add(ep.href);
                uniqueResults.push(ep);
            }
        }

        uniqueResults.sort((a, b) => a.number - b.number);
        return JSON.stringify(uniqueResults);

    } catch (e) {
        console.log("Erreur Episodes AnimesUltra: " + e);
        return JSON.stringify([]);
    }
}

// --- 4. LECTEUR (Version Parallèle Ultra-Rapide) ---
async function extractStreamUrl(url) {
    console.log(`[Lecteur] 🎬 Démarrage via full-story.php pour : ${url}`);
    
    try {
        const globalStartTime = Date.now();

        const idMatch = url.match(/\/(\d+)-[^/]+\/episode-(\d+)\.html/i);
        if (!idMatch) return JSON.stringify({ type: "none" });

        const newsId = idMatch[1];
        const episodeNumber = idMatch[2];

        const ajaxUrl = `${BASE_URL}/engine/ajax/full-story.php?newsId=${newsId}&d=${globalStartTime}`;
        const ajaxRes = await fetchv2(ajaxUrl);
        const ajaxText = await ajaxRes.text();
        
        let html = "";
        try { html = JSON.parse(ajaxText).html || ajaxText; } 
        catch (e) { html = ajaxText; }

        const episodeRes = await fetchv2(url);
        const episodeHtml = await episodeRes.text();
        
        const serverRegex = /data-server-id=["']([^"']+)["']/gi;
        let serverMatches = [...episodeHtml.matchAll(serverRegex)];

        let urlsToProcess = [];

        // 1️⃣ On prépare tous les liens à analyser avant de lancer les requêtes
        for (let match of serverMatches) {
            let serverId = match[1]; 
            let playerRegex = new RegExp(`id=["']content_player_${serverId}["'][^>]*>([^<]+)<\\/div>`, 'i');
            let playerMatch = html.match(playerRegex);

            if (playerMatch) {
                let videoUrl = playerMatch[1].trim();

                if (/^\d+$/.test(videoUrl)) {
                    videoUrl = `https://video.sibnet.ru/shell.php?videoid=${videoUrl}`;
                } else if (!videoUrl.startsWith('http') && videoUrl.length > 10) {
                     videoUrl = `https://lb.daisukianime.xyz/dist/embedm.html?id=${videoUrl}`;
                }

                let urls = videoUrl.replace(/,$/, "").split(",");

                for (let embedUrl of urls) {
                    embedUrl = embedUrl.trim();
                    if (embedUrl.startsWith('//')) embedUrl = "https:" + embedUrl;
                    if (!embedUrl.startsWith('http')) continue;
                    
                    urlsToProcess.push(embedUrl);
                }
            }
        }

        if (urlsToProcess.length === 0) return JSON.stringify({ type: "none" });

        let streams = [];
        let extractedNames = [];
        let failedLinks = []; 
        let serverTimings = [];

        // 2️⃣ 🚀 Lancement de TOUTES les requêtes en même temps (Parallèle)
        const serverPromises = urlsToProcess.map(async (embedUrl) => {
            const serverStartTime = Date.now();
            let success = false;
            let domainMatch = embedUrl.match(/https?:\/\/(?:www\.)?([^/]+)/i);
            let serverFallbackName = domainMatch ? domainMatch[1] : "Inconnu";

            try {
                // --- MOTEUR SIBNET ---
                if (embedUrl.includes("sibnet")) {
                    console.log(`[Lecteur] 🕵️ Extraction Sibnet en cours...`);
                    const req = await fetchv2(embedUrl, { "Referer": BASE_URL }, "GET", null, true, "windows-1251");
                    const sibHtml = await req.text();
                    
                    const mp4Match = sibHtml.match(/src:\s*["'](\/v\/[^"']+\.mp4)["']/i) || 
                                     sibHtml.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i);
                    
                    if (mp4Match) {
                        let directUrl = mp4Match[1].startsWith("http") ? mp4Match[1] : "https://video.sibnet.ru" + mp4Match[1];
                        try {
                            const redirectReq = await fetchv2(directUrl, {
                                "Referer": embedUrl,
                                "User-Agent": "Mozilla/5.0"
                            }, "HEAD");
                            
                            if (redirectReq && redirectReq.url && redirectReq.url !== directUrl) {
                                directUrl = redirectReq.url;
                            }
                        } catch(e) {}

                        streams.push({
                            title: "Sibnet (MP4)",
                            streamUrl: directUrl,
                            headers: { "Referer": embedUrl, "User-Agent": "Mozilla/5.0" }
                        });
                        extractedNames.push("Sibnet");
                        success = true;
                    }
                }
                // --- MOTEUR SENDVID ---
                else if (embedUrl.includes("sendvid")) {
                    console.log(`[Lecteur] 🕵️ Extraction Sendvid en cours...`);
                    const req = await fetchv2(embedUrl);
                    const sendHtml = await req.text();
                    const mp4Match = sendHtml.match(/<source[^>]+src=["']([^"']+\.mp4)["']/i) ||
                                     sendHtml.match(/video_source\s*=\s*["']([^"']+)["']/i);
                    
                    if (mp4Match) {
                        streams.push({
                            title: "Sendvid (MP4)",
                            streamUrl: mp4Match[1],
                            headers: { "Referer": embedUrl }
                        });
                        extractedNames.push("Sendvid");
                        success = true;
                    }
                }
                // --- MOTEUR VOE ---
                else if (embedUrl.includes("voe")) {
                    console.log(`[Lecteur] 🕵️ Extraction VOE en cours sur : ${embedUrl}`);
                    let voeRes = await fetchv2(embedUrl, { "Referer": BASE_URL + "/" }, "GET");
                    if (voeRes) {
                        let voeHtml = await voeRes.text();
                        
                        const redirectMatch = voeHtml.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i) || 
                                              voeHtml.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^;]+;\s*url=([^"']+)["']/i);
                        
                        if (redirectMatch && redirectMatch[1]) {
                            let newUrl = redirectMatch[1];
                            console.log(`[Lecteur] 🔄 VOE : Redirection détectée -> ${newUrl}`);
                            voeRes = await fetchv2(newUrl, { "Referer": BASE_URL + "/" }, "GET");
                            voeHtml = await voeRes.text();
                        }

                        const streamUrl = voeExtractor(voeHtml);
                        
                        if (streamUrl) {
                            const typeStr = streamUrl.includes(".m3u8") ? "HLS" : "MP4";
                            streams.push({ 
                                title: `VOE (${typeStr})`, 
                                streamUrl: streamUrl, 
                                headers: { "Referer": embedUrl } 
                            });
                            extractedNames.push("VOE");
                            success = true;
                        }
                    }
                }
                // --- MOTEUR VIDMOLY ---
                else if (embedUrl.includes("vidmoly")) {
                    console.log(`[Lecteur] 🕵️ Extraction Vidmoly en cours sur : ${embedUrl}`);
                    let fixedVidUrl = embedUrl.replace(/vidmoly\.(to|me|net|ru|is)/i, "vidmoly.biz");
                    const vidRes = await fetchv2(fixedVidUrl, { "Referer": "https://vidmoly.biz/" }, "GET");
                    let finalHtml = await vidRes.text();
                    
                    if (typeof unpack === 'function' && finalHtml.includes('eval(function')) {
                        finalHtml = unpack(finalHtml);
                    }
                    
                    const fileMatch = finalHtml.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || 
                                      finalHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                                      
                    if (fileMatch) {
                        const typeStr = fileMatch[1].includes(".m3u8") ? "HLS" : "MP4";
                        streams.push({ 
                            title: `Vidmoly (${typeStr})`, 
                            streamUrl: fileMatch[1], 
                            headers: { "Referer": "https://vidmoly.biz/" } 
                        });
                        extractedNames.push("Vidmoly");
                        success = true;
                    }
                }
                // --- MOTEUR DAISUKI ---
                else if (embedUrl.includes("daisukianime") || embedUrl.includes("mytv")) {
                    console.log(`[Lecteur] 🕵️ Extraction Daisuki en cours sur : ${embedUrl}`);
                    const dIdMatch = embedUrl.match(/id=([^&]+)/i);
                    let apiUrl = null;
                    if (dIdMatch && dIdMatch[1]) {
                        const videoId = dIdMatch[1];
                        apiUrl = `https://cdn2.daisukianime.xyz/sib/${videoId}?epid=null`;
                    }
                    
                    if (apiUrl) {
                        const req = await fetchv2(apiUrl, { "Referer": embedUrl, "User-Agent": "Mozilla/5.0" }, "GET");
                        const data = JSON.parse(await req.text());

                        if (data && data.sources && data.sources.length > 0) {
                            for (let source of data.sources) {
                                if (source.file) {
                                    const typeStr = source.file.includes(".m3u8") ? "HLS" : "MP4";
                                    streams.push({
                                        title: `Daisuki API (${typeStr})`,
                                        streamUrl: source.file,
                                        headers: { "Referer": embedUrl }
                                    });
                                    extractedNames.push("Daisuki");
                                    success = true;
                                }
                            }
                        }
                    }

                    // Fallback (Si API a planté, on tente de scraper le HTML)
                    if (!success) {
                        const req = await fetchv2(embedUrl, {}, "GET");
                        const daiHtml = await req.text();
                        const mediaMatch = daiHtml.match(/source\s*:\s*["']([^"']+)["']/i) ||
                                           daiHtml.match(/file\s*:\s*["']([^"']+)["']/i) ||
                                           daiHtml.match(/src=["']([^"']+\.(m3u8|mp4)[^"']*)["']/i);
                        
                        if (mediaMatch) {
                            const typeStr = mediaMatch[1].includes(".m3u8") ? "HLS" : "MP4";
                            streams.push({
                                title: `Daisuki HTML (${typeStr})`,
                                streamUrl: mediaMatch[1],
                                headers: { "Referer": embedUrl }
                            });
                            extractedNames.push("Daisuki");
                            success = true;
                        }
                    }
                } else {
                    console.log(`[Lecteur] ❌ Serveur inconnu ou non supporté : ${embedUrl}`);
                }
            } catch (e) {
                console.log(`[Lecteur] 🚨 CRASH sur ${serverFallbackName} : ${e.message}`);
            }

            const serverDuration = (Date.now() - serverStartTime) / 1000;
            serverTimings.push({ nom: serverFallbackName, temps_secondes: serverDuration, statut: success ? "SUCCÈS" : "ÉCHEC" });

            if (!success) {
                failedLinks.push({ server_name: serverFallbackName, url: embedUrl, timeout_seconds: serverDuration });
            }
        });

        // 🟢 C'EST ICI LA MAGIE : On attend que toutes les requêtes parallèles se terminent
        await Promise.all(serverPromises);

        const totalTime = (Date.now() - globalStartTime) / 1000;
        console.log(`[Lecteur] 🏁 Temps total d'extraction : ${totalTime.toFixed(2)}s`);

        let safeStreams = streams.filter(s => 
            s.streamUrl.includes('.mp4') || 
            s.streamUrl.includes('.m3u8') ||
            s.streamUrl.includes('token=')
        );
        
        let uniqueStreams = [];
        let seenUrls = new Set();
        for (let s of safeStreams) {
            if (!seenUrls.has(s.streamUrl)) { seenUrls.add(s.streamUrl); uniqueStreams.push(s); }
        }

        console.log(`[Lecteur] 🎉 Terminé. Flux envoyés : ${uniqueStreams.length}`);
        
        // 📡 Log Supabase : SUCCÈS
        if (uniqueStreams.length > 0) {
            sendSupabaseLog("AnimesUltra", "PLAYER", { 
                anime_url: url, 
                ep_number: episodeNumber,
                temps_total_secondes: totalTime,
                streams_found: uniqueStreams.length,
                servers: [...new Set(extractedNames)],
                benchmarks: serverTimings
            });
        }

        // 📡 Log Supabase : ÉCHECS
        if (failedLinks.length > 0) {
            sendSupabaseLog("AnimesUltra", "UNSUPPORTED_HOSTS", {
                anime_url: url,
                ep_number: episodeNumber,
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }
        
        return JSON.stringify(uniqueStreams.length > 0 ? { type: "servers", streams: uniqueStreams } : { type: "none" });
        
    } catch (e) {
        console.log(`[Lecteur] 🚨 Erreur globale : ${e}`);
        return JSON.stringify({ type: "none" });
    }
}

// ==========================================
// 🛠️ DÉCRYPTEURS UTILITAIRES
// ==========================================

function voeExtractor(html) {
    try {
        console.log("[VOE Extractor] 🔍 Début de l'analyse du code source...");
        
        const jsonScriptMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
        
        if (!jsonScriptMatch) {
            console.log("[VOE Extractor] ❌ Échec : Balise <script type='application/json'> introuvable.");
            return null;
        }
        
        let data = JSON.parse(jsonScriptMatch[1].trim());
        let step1 = data[0].replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
        let step2 = step1; 
        ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(pat => step2 = step2.split(pat).join(""));
        
        const safeAtob = (b64) => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
            let str = String(b64).replace(/=+$/, '');
            let output = '';
            for (let bc = 0, bs, buffer, idx = 0; buffer = str.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
                buffer = chars.indexOf(buffer);
            }
            return output;
        };
        
        let step3 = safeAtob(step2);
        let step4 = step3.split("").map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
        let step5 = step4.split("").reverse().join("");
        let step6 = safeAtob(step5);
        
        let result = JSON.parse(step6);
        let finalUrl = result.direct_access_url || (result.source && result.source.find(s => s.direct_access_url)?.direct_access_url) || null;
        
        if (finalUrl) console.log("[VOE Extractor] 🎯 Succès ! Lien trouvé : " + finalUrl);
        return finalUrl;
        
    } catch (e) { 
        console.log("[VOE Extractor] 🚨 Erreur de calcul : " + e.message);
        return null; 
    }
}
