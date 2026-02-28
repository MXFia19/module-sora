const BASE_URL = "https://animesultra.org";

async function searchResults(keyword) {
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

        return JSON.stringify(results);
    } catch (e) {
        console.log("Erreur Recherche AnimesUltra: " + e);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
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
                    
  // --- MOTEUR SIBNET ---
                    if (embedUrl.includes("sibnet")) {
                        console.log(`[Lecteur] 🕵️ Extraction Sibnet en cours...`);
                        try {
                            // L'ASTUCE EST ICI : On force l'encodage russe !
                            const req = await fetchv2(embedUrl, { 
                                "Referer": BASE_URL,
                                "encoding": "windows-1251",
                                "Accept-Charset": "windows-1251, utf-8;q=0.7,*;q=0.3" 
                            });
                            
                            const sibHtml = await req.text();
                            
                            // On utilise ta Regex ultra-précise
                            const mp4Match = sibHtml.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i) || 
                                             sibHtml.match(/src:\s*["'](\/v\/[^"']+\.mp4)[^"']*["']/i);
                            
                            if (mp4Match) {
                                let directUrl = mp4Match[1].startsWith("http") ? mp4Match[1] : "https://video.sibnet.ru" + mp4Match[1];
                                
                                // Tentative de récupérer l'URL finale (Location)
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
                    else if (embedUrl.includes("daisukianime") || embedUrl.includes("mytv")) {
                        console.log(`[Lecteur] 🕵️ Extraction Daisuki en cours...`);
                        try {
                            const req = await fetchv2(embedUrl);
                            const daiHtml = await req.text();
                            const mediaMatch = daiHtml.match(/source\s*:\s*["']([^"']+)["']/i) ||
                                               daiHtml.match(/file\s*:\s*["']([^"']+)["']/i) ||
                                               daiHtml.match(/src=["']([^"']+\.(m3u8|mp4)[^"']*)["']/i);
                            
                            if (mediaMatch) {
                                const directUrl = mediaMatch[1];
                                const typeStr = directUrl.includes(".m3u8") ? "HLS" : "MP4";
                                streams.push({
                                    title: `Daisuki (${typeStr})`,
                                    streamUrl: directUrl,
                                    headers: { "Referer": embedUrl }
                                });
                            }
                        } catch (e) {}
                    }
                }
            }
        }

 // Le Filtre Anti-Crash vital pour iOS : 
        let safeStreams = streams.filter(s => 
            s.streamUrl.includes('.mp4') || 
            s.streamUrl.includes('.m3u8')
        );

        console.log(`[Lecteur] 🎉 Terminé. Flux envoyés à l'application : ${safeStreams.length}`);
        
        // LE BON FORMAT (Grâce à ton log !)
        if (safeStreams.length > 0) {
            return JSON.stringify({ 
                type: "servers", 
                streams: safeStreams 
            });
        } else {
            // Si on n'a rien trouvé ou que tout a été filtré
            return JSON.stringify({ type: "none" });
        }
        
    } catch (e) {
        console.log(`[Lecteur] 🚨 Erreur : ${e}`);
        return JSON.stringify({ type: "none" });
    }
}
