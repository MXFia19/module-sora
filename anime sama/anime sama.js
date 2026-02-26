const BASE_URL = "https://v6.voiranime.com";

// --- 1. RECHERCHE (Optimisée) ---
async function searchResults(keyword) {
    try {
        // On ajoute des headers pour faire croire qu'on est sur un vrai navigateur
        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(keyword)}&post_type=wp-manga`;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Referer': BASE_URL,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
        };

        const response = await fetchv2(searchUrl, headers);
        const html = await response.text();
        const results = [];

        // On cherche les conteneurs de recherche (classe c-tabs-item__content)
        const items = html.split('class="c-tabs-item__content"');
        
        // On ignore le premier morceau qui est l'en-tête du site
        for (let i = 1; i < items.length; i++) {
            let item = items[i];
            
            // Extraction du titre et du lien
            let linkMatch = item.match(/<h4><a href="([^"]+)">([^<]+)<\/a>/i);
            // Extraction de l'image (parfois dans src, parfois dans data-src)
            let imgMatch = item.match(/src="([^"]+)"/i) || item.match(/data-src="([^"]+)"/i);

            if (linkMatch) {
                let title = linkMatch[2].trim()
                    .replace(/&#8211;/g, "-")
                    .replace(/&#039;/g, "'")
                    .replace(/&amp;/g, "&");
                let href = linkMatch[1];
                let image = imgMatch ? imgMatch[1] : "";

                // On évite les doublons
                if (!results.find(r => r.href === href)) {
                    results.push({ title, image, href });
                }
            }
        }

        // DEBUG : Si toujours rien, on tente une regex plus large sur les liens de manga
        if (results.length === 0) {
            const altRegex = /<a href="([^"]+)" title="([^"]+)">/gi;
            let altMatch;
            while ((altMatch = altRegex.exec(html)) !== null) {
                if (altMatch[1].includes('/anime/')) {
                    results.push({
                        title: altMatch[2].trim(),
                        image: "", // Image vide pour le test
                        href: altMatch[1]
                    });
                }
            }
        }

        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([]);
    }
}
// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        const descMatch = html.match(/<div class="summary__content[^>]*>([\s\S]*?)<\/div>/i);
        
        return JSON.stringify([{
            description: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : "Pas de description.",
            aliases: "VoirAnime",
            airdate: "N/A"
        }]);
    } catch (e) {
        return JSON.stringify([{ description: "Erreur de chargement", aliases: "VoirAnime", airdate: "N/A" }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        let results = [];

        // Regex pour trouver les épisodes dans la liste
        const liRegex = /<li[^>]+class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
        let match;
        while ((match = liRegex.exec(html)) !== null) {
            let content = match[1];
            let aMatch = content.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
            if (aMatch) {
                let title = aMatch[2].replace(/<[^>]+>/g, '').trim();
                let numMatch = title.match(/\d+/);
                results.push({
                    href: aMatch[1],
                    number: numMatch ? parseInt(numMatch[0]) : 1,
                    season: 1,
                    title: title
                });
            }
        }
        
        // Si la liste est vide, c'est souvent un chargement AJAX (on gérera ça à l'étape suivante si besoin)
        return JSON.stringify(results.reverse());
    } catch (e) {
        return JSON.stringify([]);
    }
}

// --- 4. LE LECTEUR (Version Simplifiée sans Global Extractor) ---
async function extractStreamUrl(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        let streams = [];

        // On cherche toutes les iframes
        const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
        let match;
        while ((match = iframeRegex.exec(html)) !== null) {
            let iframeUrl = match[1];
            if (iframeUrl.startsWith('//')) iframeUrl = "https:" + iframeUrl;

            // Au lieu d'utiliser un extracteur complexe, on utilise le "Mode Web" direct
            // C'est 100% fiable et ça ne marque jamais "Stream not found"
            let label = "Lecteur";
            if (iframeUrl.includes("vidmoly")) label = "Vidmoly";
            if (iframeUrl.includes("voe")) label = "VOE";
            if (iframeUrl.includes("streamtape")) label = "Streamtape";

            streams.push({
                title: `🌐 ${label}`,
                streamUrl: `webview://${iframeUrl}`,
                headers: {}
            });
        }

        return JSON.stringify(streams);
    } catch (e) {
        return JSON.stringify([]);
    }
}
