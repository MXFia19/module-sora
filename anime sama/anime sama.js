// --- 1. RECHERCHE (Multi-Domaines Dynamiques & API Anime-Sama) ---

// Récupération des domaines actifs du moment
async function getDomainsList() {
    console.log(`[Domaines] 🌐 Récupération des domaines actifs...`);
    try {
        const response = await fetchv2("https://anime-sama.pw/");
        const html = await response.text();

        const domainRegex = /{ name: '([^']+)' }/g;
        const domains = [];
        let match;
        while ((match = domainRegex.exec(html)) !== null) {
            domains.push(match[1]);
        }
        
        console.log(`[Domaines] ✅ Domaines trouvés : ${domains.join(', ')}`);
        return domains.length > 0 ? domains : ["anime-sama.to"];
    } catch (err) {
        console.log(`[Domaines] 🚨 Erreur, fallback sur anime-sama.fr`);
        return ["anime-sama.to"];
    }
}

// Fonction d'extraction sur un domaine spécifique
async function trySearch(domain, keyword) {
    console.log(`[Recherche AS] 🔍 Tentative sur : ${domain} pour "${keyword}"`);
    try {
        const headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `https://${domain}/`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        };

        const response = await fetchv2(
            `https://${domain}/template-php/defaut/fetch.php`,
            headers,
            "POST",
            `query=${encodeURIComponent(keyword)}`
        );
        
        const html = await response.text();
        const results = [];
        
        const regex = /<a[^>]+href=["']([^"']+)["'][\s\S]*?<img[^>]+src=["']([^"']+)["'][\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            let href = match[1].trim();
            let image = match[2].trim();
            let title = match[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&#8211;/g, "-").trim();
            
            if (href.startsWith('/')) href = `https://${domain}${href}`;
            if (image.startsWith('/')) image = `https://${domain}${image}`;
            
            // 🗑️ CORRECTION : On a retiré le "|Referer=..." ici car GitHub n'en a pas besoin ! 🗑️

            if (!results.find(r => r.href === href)) {
                results.push({ title, image, href });
            }
        }
        
        return results;
    } catch (e) {
        console.log(`[Recherche AS] 🚨 Erreur sur ${domain} : ${e}`);
        return [];
    }
}

// Fonction principale de recherche (Séquentielle, Sécurisée & Radar Strict Code 200)
async function searchResults(keyword) {
    try {
        const domains = await getDomainsList();
        console.log(`[Recherche AS] 🔍 Démarrage de la recherche sur ${domains.length} domaines.`);
        
        for (let i = 0; i < domains.length; i++) {
            let currentDomain = domains[i];
            console.log(`[Recherche AS] 📡 Vérification du radar pour : ${currentDomain}...`);
            
            // 1. LE RADAR (Filtre strict Code 200)
            try {
                const checkRes = await fetchv2(
                    `https://anime-sama.pw/?check=${currentDomain}`, 
                    { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }, 
                    "GET"
                );
                const checkData = JSON.parse(await checkRes.text());
                
                // Si ce n'est pas un 200 parfait (online), on dégage !
                if (checkData.code !== 200) {
                    console.log(`[Recherche AS] ⏭️ ${currentDomain} ignoré (Status: ${checkData.status}, Code: ${checkData.code}).`);
                    continue; // On zappe instantanément le domaine
                }
                console.log(`[Recherche AS] 🟢 ${currentDomain} est 100% EN LIGNE ! Lancement de la recherche...`);
            } catch (e) {
                console.log(`[Recherche AS] ⚠️ Radar indisponible pour ${currentDomain}, on tente quand même au cas où.`);
            }

            // 2. LA RECHERCHE (Seulement sur les survivants)
            try {
                let results = await trySearch(currentDomain, keyword);
                
                if (results && results.length > 0) {
                    console.log(`[Recherche AS] 🚀 Succès sur ${currentDomain} ! ${results.length} résultats extraits.`);
                    return JSON.stringify(results);
                } else {
                    console.log(`[Recherche AS] 🔄 Aucun résultat ou blocage Cloudflare sur ${currentDomain}.`);
                }
            } catch (err) {
                console.log(`[Recherche AS] ⚠️ Erreur interceptée sur ${currentDomain}.`);
            }
        }

        console.log(`[Recherche AS] ❌ Aucun résultat trouvé après avoir testé tous les domaines.`);
        return JSON.stringify([]);

    } catch (globalErr) {
        console.log(`[Recherche AS] 🚨 Crash global évité : ${globalErr}`);
        return JSON.stringify([]);
    }
}
// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        let description = "Pas de description disponible.";
        let descMatch = html.match(/id=["']synopsis["'][^>]*>([\s\S]*?)<\//i) || 
                          html.match(/class=["']synopsis["'][^>]*>([\s\S]*?)<\//i) || 
                          html.match(/<p class=["']text-sm[^>]*>([\s\S]*?)<\/p>/i);

        if (descMatch && descMatch[1]) {
            description = descMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
        }

        let airdate = "N/A";
        let yearMatch = html.match(/(?:20\d{2}|19\d{2})/);
        if (yearMatch) {
            airdate = yearMatch[0];
        }

        return JSON.stringify([{ description, aliases: "Anime-Sama", airdate }]);
    } catch (e) { 
        return JSON.stringify([{ description: "Erreur de chargement", aliases: "Anime-Sama", airdate: "N/A" }]); 
    }
}

// --- 3. ÉPISODES (Liste Propre et Mappage TMDB) ---
async function extractEpisodes(url) {
    console.log(`[Episodes AS] 📂 Analyse multi-saisons : ${url}`);
    try {
        if (!url.endsWith('/')) url += '/';

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": url
        };

        const response = await fetchv2(url, headers, "GET");
        const html = await response.text();

        // 1. Chercher tous les onglets
        const seasonRegex = /panneauAnime\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gi;
        let match;
        let tabs = [];
        
        while ((match = seasonRegex.exec(html)) !== null) {
            let name = match[1].trim();
            let path = match[2].trim();
            if (name.toLowerCase() === 'nom' || path.toLowerCase() === 'url') continue;
            let fullUrl = path.startsWith('http') ? path : url + path;
            tabs.push({ name: name, url: fullUrl });
        }

        if (tabs.length === 0) {
            tabs.push({ name: "Saison 1", url: url + "saison1/vostfr" });
        }

        let results = [];
        let fallbackSeason = 1;

        // 2. On parcourt les onglets trouvés
        for (let tab of tabs) {
            try {
                let jsUrl = tab.url;
                if (!jsUrl.endsWith('/')) jsUrl += '/';
                jsUrl += "episodes.js";
                
                let jsRes = await fetchv2(jsUrl, headers, "GET");
                let jsContent = await jsRes.text();

                if (!jsContent || jsContent.includes("<html") || jsContent.length < 50) {
                    let tabRes = await fetchv2(tab.url, headers, "GET");
                    let tabText = await tabRes.text();
                    let scriptMatch = tabText.match(/<script[^>]+src=['"]([^'"]*episodes\.js[^'"]*)['"]/i);
                    if (scriptMatch) {
                        let scriptSrc = scriptMatch[1].trim();
                        let baseFolder = tab.url.endsWith('/') ? tab.url : tab.url + '/';
                        jsUrl = scriptSrc.startsWith('http') ? scriptSrc : (scriptSrc.startsWith('/') ? new URL(url).origin + scriptSrc : baseFolder + scriptSrc);
                        jsRes = await fetchv2(jsUrl, headers, "GET");
                        jsContent = await jsRes.text();
                    }
                }

                if (!jsContent || jsContent.includes("<html") || jsContent.length < 50) continue;

                const arrayRegex = /(?:var|let|const)\s+[a-zA-Z0-9_]+\s*=\s*\[([\s\S]*?)\]/gm;
                let arrMatch;
                let maxEpisodes = 0;

                while ((arrMatch = arrayRegex.exec(jsContent)) !== null) {
                    let arrayContent = arrMatch[1];
                    let urls = arrayContent.match(/['"]([^'"]+)['"]/g) || [];
                    if (urls.length > maxEpisodes) maxEpisodes = urls.length;
                }

                if (maxEpisodes > 0) {
                    let cleanTabName = tab.name.replace(/\(?(VOSTFR|VF)\)?/i, '').trim();
                    
                    // 🌟 ASTUCE TMDB : Analyse intelligente du numéro de saison
                    let currentSeason = fallbackSeason;
                    let seasonMatch = cleanTabName.match(/saison\s*(\d+)/i);
                    
                    if (seasonMatch) {
                        currentSeason = parseInt(seasonMatch[1]);
                    } else if (cleanTabName.toLowerCase().includes('film') || cleanTabName.toLowerCase().includes('oav')) {
                        currentSeason = 0; // 0 est le dossier des Films/Spéciaux sur TMDB
                    }

                    for (let i = 0; i < maxEpisodes; i++) {
                        let separator = jsUrl.includes('?') ? '&' : '?';
                        let epHref = `${jsUrl}${separator}episode_index=${i}`;
                        let epTitle = maxEpisodes === 1 ? cleanTabName : `Épisode ${i + 1}`;
                        
                        results.push({
                            title: epTitle,
                            name: epTitle,
                            href: epHref,
                            number: i + 1,            // On remet le numéro à 1 pour chaque début de saison !
                            season: currentSeason     // On indique à l'application dans quelle saison on est
                        });
                    }
                    
                    // On incrémente le backup au cas où le prochain onglet ne s'appelle pas "saison X"
                    if (!cleanTabName.toLowerCase().includes('film')) {
                        fallbackSeason++;
                    }
                }

            } catch (e) {
                console.log(`[Episodes AS] ⚠️ Erreur sur l'onglet ${tab.name} : ${e}`);
            }
        }

        return JSON.stringify(results);

    } catch (e) {
        return JSON.stringify([]);
    }
}

// --- 4. LECTEUR (Pieuvre 3.0 : Sans VK, avec Patch Sibnet Anti-Cyrillique) ---
async function extractStreamUrl(url) {
    console.log(`[Lecteur AS] 🎬 Démarrage pour : ${url}`);
    try {
        let epIndex = 0;
        let jsUrl1 = url;
        
        if (url.includes('episode_index=')) {
            let parts = url.split('episode_index=');
            epIndex = parseInt(parts[1]) || 0;
            jsUrl1 = parts[0];
            if (jsUrl1.endsWith('?') || jsUrl1.endsWith('&')) jsUrl1 = jsUrl1.slice(0, -1);
        }

        let jsUrl2 = "";
        let lang1 = "VOSTFR";
        let lang2 = "VF";

        if (jsUrl1.includes('/vostfr/')) {
            jsUrl2 = jsUrl1.replace('/vostfr/', '/vf/');
        } else if (jsUrl1.includes('/vf/')) {
            lang1 = "VF";
            lang2 = "VOSTFR";
            jsUrl2 = jsUrl1.replace('/vf/', '/vostfr/');
        }

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://anime-sama.fr/"
        };

        let fetchPromises = [fetchv2(jsUrl1, headers, "GET").then(r => r.text()).catch(()=>"")];
        if (jsUrl2) fetchPromises.push(fetchv2(jsUrl2, headers, "GET").then(r => r.text()).catch(()=>""));
        
        let contents = await Promise.all(fetchPromises);
        let allEmbeds = [];

        function parseJsContent(jsText, langTag) {
            if (!jsText || jsText.includes("<html") || jsText.length < 50) return;
            const arrayRegex = /(?:var|let|const)\s+([a-zA-Z0-9_]+)\s*=\s*\[([\s\S]*?)\];/gm;
            let match;
            while ((match = arrayRegex.exec(jsText)) !== null) {
                let urls = match[2].match(/['"]([^'"]+)['"]/g) || [];
                if (epIndex < urls.length) {
                    let rawUrl = urls[epIndex].replace(/['"]/g, '').trim();
                    if (rawUrl.startsWith('http')) {
                        allEmbeds.push({ url: rawUrl, lang: langTag });
                    }
                }
            }
        }

        parseJsContent(contents[0], lang1);
        if (contents[1]) parseJsContent(contents[1], lang2);

        let streams = [];

        for (let embed of allEmbeds) {
            let embedUrl = embed.url;
            let urlLower = embedUrl.toLowerCase();
            let prefix = `[${embed.lang}]`;

            // 1. LECTEUR VOE
            if (urlLower.includes("voe.sx") || urlLower.includes("voe.network") || urlLower.includes("voe") || urlLower.includes("lancewhosedifficult")) {
                try {
                    const voeRes = await fetchv2(embedUrl, { "Referer": "https://anime-sama.fr" }, "GET");
                    const streamUrl = voeExtractor(await voeRes.text());
                    if (streamUrl) streams.push({ title: `${prefix} VOE`, streamUrl: streamUrl, headers: { "Referer": embedUrl } });
                } catch(e) {}
            }
            // 2. LECTEUR STREAMTAPE
            else if (urlLower.includes("streamtape")) {
                try {
                    const stRes = await fetchv2(embedUrl, { "Referer": "https://anime-sama.fr" }, "GET");
                    const stHtml = await stRes.text();
                    const robotMatch = stHtml.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*[^;]+\(['"]([^'"]+)['"]\)/i);
                    if (robotMatch) {
                        let tokenStr = robotMatch[1];
                        let directUrl = "https://streamtape.com" + tokenStr.substring(tokenStr.indexOf('/get_video')) + "&dl=1";
                        streams.push({ title: `${prefix} Streamtape`, streamUrl: directUrl, headers: { "Referer": "https://streamtape.com/" } });
                    }
                } catch (e) {}
            }
            // 3. LECTEUR VIDMOLY (Patch .biz)
            else if (urlLower.includes("vidmoly")) {
                try {
                    let fixedVidUrl = embedUrl.replace(/vidmoly\.(to|me|net|ru|is)/i, "vidmoly.biz");
                    const vidRes = await fetchv2(fixedVidUrl, { "Referer": "https://vidmoly.biz/" }, "GET");
                    const vidHtml = await vidRes.text();
                    const fileMatch = vidHtml.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || vidHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                    if (fileMatch) streams.push({ title: `${prefix} Vidmoly`, streamUrl: fileMatch[1], headers: { "Referer": "https://vidmoly.biz/" } });
                } catch (e) {}
            }
// LECTEUR SIBNET (📱 App extrait dv97 -> 📡 Worker extrait cvs)
            else if (urlLower.includes("sibnet")) {
                try {
                    // 1. On télécharge la page Web pour avoir le jeton de session (hash)
                    const req = await fetchv2(embedUrl, { "Referer": "https://anime-sama.fr" }, "GET");
                    const sibHtml = await req.text();
                    
                    // 2. On extrait le lien COMPLET avec le hash (ex: /v/c7c3.../4738490.mp4)
                    const mp4Match = sibHtml.match(/src:\s*["'](\/v\/[^"']+\.mp4)[^"']*["']/i) || sibHtml.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i);
                    
                    if (mp4Match) {
                        let hashedUrl = mp4Match[1].startsWith("http") ? mp4Match[1] : "https://video.sibnet.ru" + mp4Match[1];
                        let intermediateUrl = "";

                        // 3. L'application demande elle-même la redirection pour obtenir le dv97 (avec noip=1)
                        try {
                            const resolveRes = await fetchv2(hashedUrl, { "Referer": embedUrl, "User-Agent": "Mozilla/5.0" }, "HEAD");
                            if (resolveRes.url && resolveRes.url !== hashedUrl) {
                                intermediateUrl = resolveRes.url;
                            } else {
                                // Fallback si HEAD ne suffit pas
                                const getRes = await fetchv2(hashedUrl, { "Referer": embedUrl, "User-Agent": "Mozilla/5.0" }, "GET");
                                if (getRes.url && getRes.url !== hashedUrl) intermediateUrl = getRes.url;
                            }
                        } catch(e) {}

                        // 4. Si on a bien obtenu le lien dv97...
                        if (intermediateUrl && intermediateUrl.includes(".mp4")) {
                            console.log(`[Lecteur AS] 📱 Lien intermédiaire trouvé : ${intermediateUrl}`);
                            
                            // 🛑 TON WORKER CLOUDFLARE 🛑
                            let myWorkerUrl = "https://shiny-lab-d171.kurzmathis4.workers.dev";
                            
                            try {
                                // 5. On donne le dv97 au Worker pour qu'il trouve le cvs final
                                console.log(`[Lecteur AS] 📡 Demande au Worker de dérouler : ${intermediateUrl}`);
                                const workerRes = await fetchv2(`${myWorkerUrl}/?url=${encodeURIComponent(intermediateUrl)}`, {}, "GET");
                                const finalCvsUrl = await workerRes.text();
                                
                                // 6. On ajoute le lien final pour le lecteur !
                                if (finalCvsUrl && finalCvsUrl.startsWith("http")) {
                                    streams.push({ 
                                        title: `${prefix} Sibnet (Final Worker)`, 
                                        streamUrl: finalCvsUrl, 
                                        headers: { "User-Agent": "Mozilla/5.0" } // Plus de Referer requis
                                    });
                                }
                            } catch(workerErr) {
                                console.log(`[Lecteur AS] ⚠️ Erreur du Worker : ${workerErr}`);
                            }
                        }
                    }
                } catch (e) {}
            }
            // 5. LECTEUR SENDVID
            else if (urlLower.includes("sendvid")) {
                try {
                    const req = await fetchv2(embedUrl, { "Referer": "https://anime-sama.fr" }, "GET");
                    const sendHtml = await req.text();
                    const mp4Match = sendHtml.match(/<source[^>]+src=["']([^"']+\.mp4)["']/i) || sendHtml.match(/video_source\s*=\s*["']([^"']+)["']/i);
                    if (mp4Match) streams.push({ title: `${prefix} Sendvid`, streamUrl: mp4Match[1], headers: { "Referer": embedUrl } });
                } catch (e) {}
            }
        }

        let safeStreams = streams.filter(s => s.streamUrl.includes('.mp4') || s.streamUrl.includes('.m3u8'));
        let uniqueStreams = [];
        let seenUrls = new Set();
        for (let s of safeStreams) {
            if (!seenUrls.has(s.streamUrl)) { seenUrls.add(s.streamUrl); uniqueStreams.push(s); }
        }

        return JSON.stringify(uniqueStreams.length > 0 ? { type: "servers", streams: uniqueStreams } : { type: "none" });

    } catch (e) {
        return JSON.stringify({ type: "none" });
    }
}
