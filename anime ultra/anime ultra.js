const BASE_URL = "https://animesultra.org";

// ==========================================
// 📊 TRACKERS DISCORD (3 Webhooks séparés)
// ==========================================

const WEBHOOK_RECHERCHE = "https://discord.com/api/webhooks/1482435597372100628/vmjrJ5zOsOfV2tVv4SEeUcC1uP-jEBg1oxEJb4sPsQ7qxnqkANs0G976sPBlSF6HiLZf";
const WEBHOOK_LECTEUR = "https://discord.com/api/webhooks/1482436048373026816/pPA0G1N6JSulfgPtAiArewD5veeHnrPLqofm3HSidpNG5Ro5BIxhNBdzjl56IvvJhMPc";
const WEBHOOK_DETAILS = "https://discord.com/api/webhooks/1482456590107021352/aHuhNRb0fRMa_-KT9wFIKyu2Lz3qxClLYc-7bTqdsFYlIPpw35wuN8PhOMTaW7NKtDPv";

// 1. Tracker pour les Recherches
async function sendTracker(moduleName, keyword, results, apiUrl) {
    try {
        // Sans backticks autour de apiUrl pour qu'il soit cliquable sur Discord
        let desc = `**Mot-clé :** \`${keyword}\`\n**Résultats trouvés :** ${results.length}\n**URL Utilisée :** ${apiUrl}\n`;
        
        if (results.length > 0) {
            desc += `\n**Top résultats :**\n`;
            let top = results.slice(0, 5);
            for (let r of top) { desc += `🎬 ${r.title}\n`; }
            if (results.length > 5) { desc += `*... et ${results.length - 5} autres*`; }
        } else {
            desc += `\n❌ Aucun anime trouvé.`;
        }

        const payload = {
            embeds: [{
                title: `📊 Recherche sur ${moduleName}`,
                description: desc,
                color: 5814783, // Bleu
                timestamp: new Date().toISOString()
            }]
        };

        const headers = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" };
        await fetchv2(WEBHOOK_RECHERCHE, headers, "POST", JSON.stringify(payload));
    } catch (e) { console.log("Erreur Tracker Recherche : " + e); }
}

// 2. Tracker pour les clics sur les affiches (Détails)
async function sendDetailsTracker(moduleName, url, apiUrl) {
    try {
        let readableName = url;
        let match = url.match(/\/\d+-([^/]+)\.html/i);
        if (match) readableName = match[1].replace(/-/g, ' ').toUpperCase();

        const payload = {
            embeds: [{
                title: `🖱️ Clic sur une affiche (${moduleName})`,
                description: `**Anime sélectionné :** \`${readableName}\`\n**URL de la page :** ${apiUrl}`,
                color: 16766720, // Jaune/Orange
                timestamp: new Date().toISOString()
            }]
        };

        const headers = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" };
        await fetchv2(WEBHOOK_DETAILS, headers, "POST", JSON.stringify(payload));
    } catch (e) { console.log("Erreur Tracker Details : " + e); }
}

// 3. Tracker pour le Lecteur
async function sendPlayerTracker(moduleName, url, streams, apiUrls) {
    try {
        let readableInfo = url;
        let match = url.match(/([^/]+)\/episode-(\d+)\.html/i) || url.match(/-([^/]+)\/episode-(\d+)/i);
        
        if (match) {
            let animeName = match[1].replace(/-/g, ' ').toUpperCase();
            readableInfo = `Anime : **${animeName}**\nÉpisode : **${match[2]}**`;
        } else {
            readableInfo = `Lien brut : \`${url}\``;
        }

        let desc = `${readableInfo}\n\n**Requête API :**\n${apiUrls}\n\n**Serveurs extraits :** ${streams.length}\n`;
        
        if (streams.length > 0) {
            for (let s of streams) { desc += `✅ ${s.title}\n`; }
        } else {
            desc += `❌ Aucun lien vidéo valide trouvé.`;
        }

        const payload = {
            embeds: [{
                title: `▶️ Lancement Vidéo sur ${moduleName}`,
                description: desc,
                color: 5763719, // Vert
                timestamp: new Date().toISOString()
            }]
        };

        const headers = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" };
        await fetchv2(WEBHOOK_LECTEUR, headers, "POST", JSON.stringify(payload));
    } catch (e) { console.log("Erreur Tracker Lecteur : " + e); }
}


// ==========================================
// ⚙️ LOGIQUE DU MODULE ANIMESULTRA
// ==========================================

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

        // 🕵️ Appel du tracker Recherche avec searchUrl
        await sendTracker("AnimesUltra", keyword, results, searchUrl);

        return JSON.stringify(results);
    } catch (e) {
        console.log("Erreur Recherche AnimesUltra: " + e);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    console.log(`[Détails] 📖 Chargement des infos pour : ${url}`);
    
    // 🕵️ Appel du tracker Détails avec l'URL de la page
    await sendDetailsTracker("AnimesUltra", url, url);

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
        if (yearMatch) {
            airdate = yearMatch[1];
        }

        return JSON.stringify([{ description, aliases: "AnimesUltra", airdate }]);
    } catch (e) {
        console.log("Erreur Détails AnimesUltra: " + e);
        return JSON.stringify([{ description: "Erreur de chargement", aliases: "AnimesUltra", airdate: "N/A" }]);
    }
}

async function extractEpisodes(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        let newsId = null;
        const urlIdMatch = url.match(/\/(\d+)-[^/]+\.html/i);
        const htmlIdMatch = html.match(/id=["']post_id["']\s+value=["'](\d+)["']/i);

        if (urlIdMatch) {
            newsId = urlIdMatch[1];
        } else if (htmlIdMatch) {
            newsId = htmlIdMatch[1];
        }

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

async function extractStreamUrl(url) {
    console.log(`[Lecteur] 🎬 Démarrage via full-story.php pour : ${url}`);

    try {
        const idMatch = url.match(/\/(\d+)-[^/]+\/episode-(\d+)\.html/i);
        if (!idMatch) return JSON.stringify([]);

        const newsId = idMatch[1];

        // C'est ce lien qu'on veut envoyer à Discord pour le debug
        const ajaxUrl = `${BASE_URL}/engine/ajax/full-story.php?newsId=${newsId}&d=${Date.now()}`;
        
        const ajaxRes = await fetchv2(ajaxUrl);
        const ajaxText = await ajaxRes.text();
        
        let html = "";
        try { html = JSON.parse(ajaxText).html || ajaxText; } 
        catch (e) { html = ajaxText; }

        let streams = [];
        
        const episodeRes = await fetchv2(url);
        const episodeHtml = await episodeRes.text();
        
        const serverRegex = /data-server-id=["']([^"']+)["']/gi;
        let serverMatches = [...episodeHtml.matchAll(serverRegex)];

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
                    
                    // --- MOTEUR SIBNET CLASSIQUE ---
                    if (embedUrl.includes("sibnet")) {
                        console.log(`[Lecteur] 🕵️ Extraction Sibnet en cours...`);
                        try {
                            const req = await fetchv2(embedUrl, { 
                                "Referer": BASE_URL,
                                "encoding": "windows-1251",
                                "Accept-Charset": "windows-1251, utf-8;q=0.7,*;q=0.3" 
                            });
                            
                            const sibHtml = await req.text();
                            
                            const mp4Match = sibHtml.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i) || 
                                             sibHtml.match(/src:\s*["'](\/v\/[^"']+\.mp4)[^"']*["']/i);
                            
                            if (mp4Match) {
                                let directUrl = mp4Match[1].startsWith("http") ? mp4Match[1] : "https://video.sibnet.ru" + mp4Match[1];
                                
                                try {
                                    const redirectReq = await fetch(directUrl, {
                                        method: "GET",
                                        headers: { 
                                            "Referer": embedUrl,
                                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                                        },
                                        redirect: "manual"
                                    });
                                    
                                    const location = redirectReq.headers.get("location") || redirectReq.headers.get("Location");
                                    if (location) {
                                        directUrl = location.startsWith("//") ? "https:" + location : location;
                                    } else if (redirectReq.url && redirectReq.url !== directUrl) {
                                        directUrl = redirectReq.url;
                                    }
                                } catch(e) {}

                                streams.push({
                                    title: "Sibnet (MP4)",
                                    streamUrl: directUrl,
                                    headers: { 
                                        "Referer": embedUrl,
                                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                                    }
                                });
                            }
                        } catch (e) {
                            console.log(`[Lecteur] Erreur Sibnet : ${e}`);
                        }
                    }
                    // --- MOTEUR SENDVID ---
                    else if (embedUrl.includes("sendvid")) {
                        console.log(`[Lecteur] 🕵️ Extraction Sendvid en cours...`);
                        try {
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
                            }
                        } catch (e) {}
                    }
                    // --- NOUVEAU MOTEUR DAISUKI (API JSON) ---
                    else if (embedUrl.includes("daisukianime") || embedUrl.includes("mytv")) {
                        console.log(`[Lecteur] 🕵️ Extraction Daisuki API en cours...`);
                        try {
                            const idMatch = embedUrl.match(/id=([^&]+)/i);
                            
                            if (idMatch && idMatch[1]) {
                                const videoId = idMatch[1];
                                const apiUrl = `https://cdn2.daisukianime.xyz/sib/${videoId}?epid=null`;
                                console.log(`[Lecteur] 📡 Appel API Daisuki : ${apiUrl}`);

                                const req = await fetchv2(apiUrl, {
                                    "Referer": embedUrl,
                                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                                });
                                
                                const jsonText = await req.text();
                                const data = JSON.parse(jsonText);

                                if (data && data.sources && data.sources.length > 0) {
                                    for (let source of data.sources) {
                                        if (source.file) {
                                            const typeStr = source.file.includes(".m3u8") ? "HLS" : "MP4";
                                            streams.push({
                                                title: `Daisuki API (${typeStr})`,
                                                streamUrl: source.file,
                                                headers: { "Referer": embedUrl }
                                            });
                                        }
                                    }
                                }
                            } else {
                                const req = await fetchv2(embedUrl);
                                const daiHtml = await req.text();
                                const mediaMatch = daiHtml.match(/source\s*:\s*["']([^"']+)["']/i) ||
                                                   daiHtml.match(/file\s*:\s*["']([^"']+)["']/i) ||
                                                   daiHtml.match(/src=["']([^"']+\.(m3u8|mp4)[^"']*)["']/i);
                                
                                if (mediaMatch) {
                                    const directUrl = mediaMatch[1];
                                    const typeStr = directUrl.includes(".m3u8") ? "HLS" : "MP4";
                                    streams.push({
                                        title: `Daisuki HTML (${typeStr})`,
                                        streamUrl: directUrl,
                                        headers: { "Referer": embedUrl }
                                    });
                                }
                            }
                        } catch (e) {
                            console.log(`[Lecteur] 🚨 Erreur API Daisuki : ${e}`);
                        }
                    }
                }
            }
        }

        let safeStreams = streams.filter(s => 
            s.streamUrl.includes('.mp4') || 
            s.streamUrl.includes('.m3u8')
        );

        console.log(`[Lecteur] 🎉 Terminé. Flux envoyés à l'application : ${safeStreams.length}`);
        
        // 🕵️ Appel du tracker Lecteur avec l'URL Ajax (secrète) utilisée
        await sendPlayerTracker("AnimesUltra", url, safeStreams, ajaxUrl);
        
        if (safeStreams.length > 0) {
            return JSON.stringify({ 
                type: "servers", 
                streams: safeStreams 
            });
        } else {
            return JSON.stringify({ type: "none" });
        }
        
    } catch (e) {
        console.log(`[Lecteur] 🚨 Erreur : ${e}`);
        return JSON.stringify({ type: "none" });
    }
}
