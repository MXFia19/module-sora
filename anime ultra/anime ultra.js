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

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        
        // On cherche la description (à adapter selon le code source exact du site)
        const descMatch = html.match(/<div class="description"[^>]*>([\s\S]*?)<\/div>/i) || 
                          html.match(/<div class="film-poster-text"[^>]*>([\s\S]*?)<\/div>/i);
                          
        let description = "Pas de description disponible.";
        if (descMatch) {
            description = descMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        return JSON.stringify([{ description, aliases: "AnimesUltra", airdate: "N/A" }]);
    } catch (e) {
        return JSON.stringify([{ description: "Erreur de chargement", aliases: "Erreur", airdate: "N/A" }]);
    }
}

// --- 3. ÉPISODES (Version Renforcée) ---
async function extractEpisodes(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        // 1. Trouver l'ID (Le plus fiable sur ce site, c'est dans l'URL !)
        // Exemple : https://animesultra.org/anime-vostfr/1225-sword-art-online... -> ID = 1225
        let newsId = null;
        const urlIdMatch = url.match(/\/(\d+)-[^/]+\.html/i);
        const htmlIdMatch = html.match(/id=["']post_id["']\s+value=["'](\d+)["']/i); // Sécurité supplémentaire

        if (urlIdMatch) {
            newsId = urlIdMatch[1];
        } else if (htmlIdMatch) {
            newsId = htmlIdMatch[1];
        }

        if (!newsId) {
            console.log("Impossible de trouver l'ID de l'anime.");
            return JSON.stringify([]);
        }

        // 2. Appel AJAX vers le serveur d'AnimesUltra
        const ajaxUrl = `${BASE_URL}/engine/ajax/full-story.php?newsId=${newsId}&d=${Date.now()}`;
        const ajaxRes = await fetchv2(ajaxUrl);
        const ajaxText = await ajaxRes.text();
        
        let ajaxHtml = "";
        try {
            const ajaxJson = JSON.parse(ajaxText);
            ajaxHtml = ajaxJson.html || ajaxText; 
        } catch (e) {
            ajaxHtml = ajaxText; // Cas où le site renvoie directement du texte
        }

        let results = [];
        
        // 3. Extraction flexible (peu importe l'ordre des attributs class, href, title)
        const epTagRegex = /<a[^>]+class=["'][^"']*ep-item[^"']*["'][^>]*>/gi;
        let match;
        
        // On cherche dans le résultat AJAX en priorité, sinon sur la page de base
        let sourceToScan = ajaxHtml.includes("ep-item") ? ajaxHtml : html;

        while ((match = epTagRegex.exec(sourceToScan)) !== null) {
            let tag = match[0];
            
            // On fouille l'intérieur de la balise <a> isolée
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
                    season: 1
                });
            }
        }

        // 4. Nettoyage des doublons éventuels
        let uniqueResults = [];
        let hrefsSet = new Set();
        for (let ep of results) {
            if (!hrefsSet.has(ep.href)) {
                hrefsSet.add(ep.href);
                uniqueResults.push(ep);
            }
        }

        // AnimesUltra trie parfois ses épisodes du plus récent au plus ancien.
        // Reverse remet l'épisode 1 en haut de la liste pour Sora.
        return JSON.stringify(uniqueResults.reverse());

    } catch (e) {
        console.log("Erreur Episodes AnimesUltra: " + e);
        return JSON.stringify([]);
    }
}
// --- 4. LECTEUR (Brouillon temporaire pour tester) ---
async function extractStreamUrl(url) {
    // On mettra la vraie logique ici après avoir validé les étapes 1, 2 et 3 !
    return JSON.stringify([{
        title: "Lecteur Web (Test)",
        streamUrl: `webview://${url}`,
        headers: {}
    }]);
}
