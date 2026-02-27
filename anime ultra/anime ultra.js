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
// --- 4. LECTEUR (Via full-story.php - Découverte de génie) ---
async function extractStreamUrl(url) {
    console.log(`[Lecteur] 🎬 Démarrage via full-story.php pour : ${url}`);
    
    try {
        // 1. On retrouve le newsId depuis l'URL (ex: 1221)
        const idMatch = url.match(/\/(\d+)-[^/]+\/episode-(\d+)\.html/i);
        if (!idMatch) {
            console.log("[Lecteur] ❌ Impossible de trouver l'ID dans l'URL");
            return JSON.stringify([]);
        }

        const newsId = idMatch[1];
        const episodeNum = idMatch[2]; // ex: "1"
        const dataId = `${newsId}-${episodeNum}`; // ex: "1221-1"
        console.log(`[Lecteur] 🔎 Recherche des lecteurs pour data-id = ${dataId}`);

        // 2. On appelle full-story.php
        const ajaxUrl = `${BASE_URL}/engine/ajax/full-story.php?newsId=${newsId}&d=${Date.now()}`;
        const ajaxRes = await fetchv2(ajaxUrl);
        const ajaxText = await ajaxRes.text();
        
        let html = "";
        try {
            html = JSON.parse(ajaxText).html || ajaxText;
        } catch (e) {
            html = ajaxText;
        }

        let streams = [];

        // 3. Il faut trouver où commence la ligne de notre épisode dans ce gros fichier
        // Le site est malin : l'épisode 1 a les lecteurs 1 à 5, l'épisode 2 les lecteurs 6 à 10...
        // MAIS pour être sûr, on va scanner TOUS les div de type content_player_X 
        // L'astuce c'est qu'on a besoin de la page de l'épisode pour connaître le nom des boutons.
        
        // Finalement, le plus simple est de télécharger la page de l'épisode JUSTE pour avoir le nom des boutons
        const episodeRes = await fetchv2(url);
        const episodeHtml = await episodeRes.text();
        
        const serverRegex = /data-server-id=["']([^"']+)["']/gi;
        let serverMatches = [...episodeHtml.matchAll(serverRegex)];
        console.log(`[Lecteur] 🔍 Boutons trouvés sur la page de l'épisode : ${serverMatches.length}`);

        for (let match of serverMatches) {
            let serverId = match[1]; // ex: "1v", "5sen"
            
            // 4. On cherche CE serveur précis dans le gros HTML de full-story.php !
            let playerRegex = new RegExp(`id=["']content_player_${serverId}["'][^>]*>([^<]+)<\\/div>`, 'i');
            let playerMatch = html.match(playerRegex);

            if (playerMatch) {
                let videoUrl = playerMatch[1].trim();
                console.log(`[Lecteur] 🔗 Lien trouvé pour ${serverId} : ${videoUrl}`);

                // Astuces Sibnet
                if (/^\d+$/.test(videoUrl)) {
                    videoUrl = `https://video.sibnet.ru/shell.php?videoid=${videoUrl}`;
                } else if (!videoUrl.startsWith('http') && videoUrl.length > 10) {
                     // Astuce Mytv (ils mettent juste un code, ex: "ex31u8xgqst...")
                     videoUrl = `https://lb.daisukianime.xyz/dist/embedm.html?id=${videoUrl}`;
                }

                let urls = videoUrl.replace(/,$/, "").split(",");

                for (let embedUrl of urls) {
                    embedUrl = embedUrl.trim();
                    if (embedUrl.startsWith('//')) embedUrl = "https:" + embedUrl;
                    if (!embedUrl.startsWith('http')) continue;

                    let label = "Lecteur Externe";
                    if (embedUrl.includes("sibnet")) label = "Sibnet";
                    else if (embedUrl.includes("sendvid")) label = "Sendvid";
                    else if (embedUrl.includes("daisukianime") || embedUrl.includes("mytv")) label = "Daisuki/MyTV";
                    else if (embedUrl.includes("vidmoly")) label = "Vidmoly";
                    else if (embedUrl.includes("voe")) label = "VOE";

                    console.log(`[Lecteur] ✅ Ajout: [${label}] -> ${embedUrl}`);
                    streams.push({
                        title: label,
                        streamUrl: embedUrl,
                        headers: { "Referer": BASE_URL }
                    });
                }
            }
        }

        console.log(`[Lecteur] 🎉 Terminé. Flux envoyés : ${streams.length}`);
        return JSON.stringify(streams);
        
    } catch (e) {
        console.log(`[Lecteur] 🚨 Erreur : ${e}`);
        return JSON.stringify([]);
    }
}
