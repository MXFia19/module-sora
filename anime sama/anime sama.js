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

async function extractStreamUrl(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        
        let pagesToFetch = [url]; // On commence avec la page actuelle
        let streams = [];

        // 1. REQUÊTE "PIEUVRE" : On récupère tous les liens du menu déroulant (data-redirect)
        const redirectRegex = /data-redirect=["']([^"']+)["']/gi;
        let match;
        while ((match = redirectRegex.exec(html)) !== null) {
            let redirectUrl = match[1];
            if (redirectUrl.startsWith('/')) redirectUrl = "https://v6.voiranime.com" + redirectUrl;
            if (!pagesToFetch.includes(redirectUrl)) {
                pagesToFetch.push(redirectUrl);
            }
        }

        // 2. TÉLÉCHARGEMENT SIMULTANÉ de toutes les pages de lecteurs
        const pagesHtml = await Promise.all(
            pagesToFetch.map(p => fetchv2(p).then(res => res.text()).catch(() => ""))
        );

        // 3. EXTRACTION DES IFRAMES ET DES LIENS VIDÉOS
        for (const pageSource of pagesHtml) {
            const iframeMatch = pageSource.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (!iframeMatch) continue;

            let embedUrl = iframeMatch[1];
            if (embedUrl.startsWith('//')) embedUrl = "https:" + embedUrl;

            // Identification du nom du lecteur pour l'affichage
            let label = "Lecteur";
            if (embedUrl.includes("voe")) label = "VOE";
            else if (embedUrl.includes("vidmoly")) label = "Vidmoly";
            else if (embedUrl.includes("streamtape")) label = "Stape";
            else if (embedUrl.includes("mixdrop")) label = "Mixdrop";
            else if (embedUrl.includes("uqload")) label = "Uqload";

            // Tentative d'extraction directe pour éviter le "Stream not found"
            // On se concentre sur les headers que VLC et Safari utilisent
            const headers = {
                "Referer": "https://vidmoly.to/", // Valide pour bcp d'hébergeurs
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
                "Origin": "https://vidmoly.to"
            };

            // On ajoute deux options par lecteur pour être sûr :
            // A. Le lien vers l'embed (qui peut marcher si Sora gère l'iframe)
            streams.push({
                title: `${label} (Embed)`,
                streamUrl: embedUrl,
                headers: { "Referer": "https://v6.voiranime.com/" }
            });

            // B. On tente de fouiller l'intérieur de l'iframe si c'est Vidmoly
            if (embedUrl.includes("vidmoly")) {
                try {
                    const vidRes = await fetchv2(embedUrl, { "Referer": "https://v6.voiranime.com/" });
                    const vidHtml = await vidRes.text();
                    const fileMatch = vidHtml.match(/file\s*:\s*["']([^"']+)["']/i);
                    if (fileMatch) {
                        streams.push({
                            title: `${label} (Lien Direct)`,
                            streamUrl: fileMatch[1],
                            headers: headers
                        });
                    }
                } catch (e) {}
            }
        }

        // Suppression des doublons de liens
        const uniqueStreams = streams.filter((v, i, a) => a.findIndex(t => t.streamUrl === v.streamUrl) === i);

        return JSON.stringify(uniqueStreams);
    } catch (e) {
        return JSON.stringify([]);
    }
}
