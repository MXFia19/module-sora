const BASE_URL = "https://animesultra.org";

async function searchResults(keyword) {
    try {
        // Nouvelle URL de recherche basée sur ton retour
        const searchUrl = `${BASE_URL}/?story=${encodeURIComponent(keyword)}&do=search&subaction=search`;
        
        // Un header simple pour passer pour un navigateur
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        };

        const response = await fetchv2(searchUrl, { headers });
        const html = await response.text();
        const results = [];

        // On découpe le HTML par bloc de résultat ("flw-item")
        const items = html.split('class="flw-item"');
        
        // On commence à 1 car l'index 0 contient l'en-tête de la page
        for (let i = 1; i < items.length; i++) {
            let item = items[i];
            
            // On cherche le lien et le titre dans la balise <a> (film-poster-ahref)
            let linkMatch = item.match(/<a[^>]+href=["']([^"']+)["'][^>]+class=["'][^"']*film-poster-ahref[^"']*["'][^>]+title=["']([^"']+)["']/i);
            
            // On cherche l'image (data-src en priorité à cause du lazyload que tu m'as montré)
            let imgMatch = item.match(/<img[^>]+data-src=["']([^"']+)["']/i) || item.match(/<img[^>]+src=["']([^"']+)["']/i);

            if (linkMatch) {
                let href = linkMatch[1];
                let title = linkMatch[2].replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
                let image = imgMatch ? imgMatch[1] : "";
                
                // Si l'image commence par "/", on rajoute https://animesultra.org devant
                if (image.startsWith('/')) {
                    image = BASE_URL + image;
                }

                // On vérifie qu'on n'a pas déjà ajouté ce lien
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

// --- 2. DÉTAILS (Spécial AnimesUltra) ---
async function extractDetails(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        let description = "Pas de description disponible.";

        // On cible EXACTEMENT la structure du site : <div class="film-description..."><div class="text">...</div>
        const descMatch = html.match(/<div class=["'][^"']*film-description[^"']*["'][^>]*>\s*<div class=["']text["']>([\s\S]*?)<\/div>/i);

        if (descMatch && descMatch[1]) {
            description = descMatch[1]
                // 1. On supprime la pub "Vous Regarder XYZ en streaming" qui pollue le résumé
                .replace(/<p>\s*Vous\s*<strong[^>]*>.*?<\/strong>.*?<\/p>/gi, '') 
                // 2. On nettoie les balises HTML restantes (<p>, <br>, etc.)
                .replace(/<[^>]+>/g, '') 
                .replace(/&amp;/g, '&')
                .replace(/&#039;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
        } else {
            // Plan de secours : balise meta SEO (og:description)
            const metaDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
            if (metaDescMatch && metaDescMatch[1]) {
                description = metaDescMatch[1].trim();
            }
        }

        // On récupère l'année exactement où elle est rangée (<span class="item-head">Année:</span>)
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
// --- 3. ÉPISODES (Le Tri Parfait) ---
async function extractEpisodes(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        // 1. Trouver l'ID
        let newsId = null;
        const urlIdMatch = url.match(/\/(\d+)-[^/]+\.html/i);
        const htmlIdMatch = html.match(/id=["']post_id["']\s+value=["'](\d+)["']/i);

        if (urlIdMatch) {
            newsId = urlIdMatch[1];
        } else if (htmlIdMatch) {
            newsId = htmlIdMatch[1];
        }

        if (!newsId) return JSON.stringify([]);

        // 2. Appel AJAX
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
        
        // 3. Extraction
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
                    number: numMatch ? parseInt(numMatch[1]) : (results.length + 1),
                    season: 1 // On force tout proprement dans la Saison 1
                });
            }
        }

        // 4. Nettoyage des doublons
        let uniqueResults = [];
        let hrefsSet = new Set();
        for (let ep of results) {
            if (!hrefsSet.has(ep.href)) {
                hrefsSet.add(ep.href);
                uniqueResults.push(ep);
            }
        }

        // LE CORRECTIF EST ICI : On trie strictement de 1 à 25
        uniqueResults.sort((a, b) => a.number - b.number);

        return JSON.stringify(uniqueResults);

    } catch (e) {
        console.log("Erreur Episodes AnimesUltra: " + e);
        return JSON.stringify([]);
    }
}
// --- 4. LECTEUR (Interception de la redirection dynamique Sibnet) ---
async function extractStreamUrl(url) {
    console.log(`[Lecteur] 🎬 Démarrage via full-story.php pour : ${url}`);
    
    try {
        const idMatch = url.match(/\/(\d+)-[^/]+\/episode-(\d+)\.html/i);
        if (!idMatch) return JSON.stringify({ type: "none" });

        const newsId = idMatch[1];
        const episodeNum = idMatch[2];
        const dataId = `${newsId}-${episodeNum}`;

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
                    
                    if (embedUrl.includes("sibnet")) {
                        console.log(`[Lecteur] 🕵️ Extraction Sibnet en cours...`);
                        try {
                            const req = await fetchv2(embedUrl);
                            const sibHtml = await req.text();
                            const mp4Match = sibHtml.match(/src:\s*["'](\/v\/[^"']+\.mp4)[^"']*["']/i) || 
                                             sibHtml.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i);
                            
                            if (mp4Match) {
                                let directUrl = mp4Match[1].startsWith("http") ? mp4Match[1] : "https://video.sibnet.ru" + mp4Match[1];
                                console.log(`[Lecteur] 🔄 Lien de redirection Sibnet : ${directUrl}`);
                                
                                // ---------------------------------------------------------
                                // 🏴‍☠️ INTERCEPTION DU CDN SIBNET AVEC LOCATION
                                // ---------------------------------------------------------
                                try {
                                    const redirectReq = await fetch(directUrl, {
                                        method: "GET",
                                        headers: { 
                                            "Referer": embedUrl,
                                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                                        },
                                        redirect: "manual" // Bloque la redirection pour lire l'URL
                                    });
                                    
                                    // On récupère la vraie adresse secrète !
                                    const location = redirectReq.headers.get("location") || redirectReq.headers.get("Location");
                                    if (location) {
                                        directUrl = location.startsWith("//") ? "https:" + location : location;
                                        console.log(`[Lecteur] 🎯 VRAI CDN SIBNET TROUVÉ (Location) : ${directUrl}`);
                                    } else if (redirectReq.url && redirectReq.url !== directUrl) {
                                        directUrl = redirectReq.url;
                                        console.log(`[Lecteur] 🎯 VRAI CDN SIBNET TROUVÉ (URL) : ${directUrl}`);
                                    }
                                } catch(e) {
                                    console.log(`[Lecteur] ⚠️ Interception CDN échouée : ${e}`);
                                }

                                streams.push({
                                    title: "Sibnet (MP4)",
                                    streamUrl: directUrl,
                                    headers: { 
                                        "Referer": embedUrl,
                                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                                    }
                                });
                            } else {
                                streams.push({ title: "Sibnet (Embed)", streamUrl: embedUrl, headers: { "Referer": BASE_URL } });
                            }
                        } catch (e) { 
                            streams.push({ title: "Sibnet (Embed)", streamUrl: embedUrl, headers: { "Referer": BASE_URL } });
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
                            } else {
                                streams.push({ title: "Sendvid (Embed)", streamUrl: embedUrl, headers: { "Referer": BASE_URL } });
                            }
                        } catch (e) { 
                            streams.push({ title: "Sendvid (Embed)", streamUrl: embedUrl, headers: { "Referer": BASE_URL } });
                        }
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
                            } else {
                                streams.push({ title: "Daisuki (Embed)", streamUrl: embedUrl, headers: { "Referer": BASE_URL } });
                            }
                        } catch (e) { 
                            streams.push({ title: "Daisuki (Embed)", streamUrl: embedUrl, headers: { "Referer": BASE_URL } });
                        }
                    }
                    else {
                        let label = "Lecteur Web (Embed)";
                        if (embedUrl.includes("vidmoly")) label = "Vidmoly (Embed)";
                        if (embedUrl.includes("voe")) label = "VOE (Embed)";
                        
                        streams.push({
                            title: label,
                            streamUrl: embedUrl,
                            headers: { "Referer": BASE_URL }
                        });
                    }
                }
            }
        }

        console.log(`[Lecteur] 🎉 Terminé. Flux envoyés : ${streams.length}`);
        
        if (streams.length > 0) {
            return JSON.stringify({ type: "servers", streams: streams });
        } else {
            return JSON.stringify({ type: "none" });
        }
        
    } catch (e) {
        console.log(`[Lecteur] 🚨 Erreur : ${e}`);
        return JSON.stringify({ type: "none" });
    }
}
