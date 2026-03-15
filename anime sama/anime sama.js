// --- 1. RECHERCHE (Multi-Domaines Dynamiques & API Anime-Sama) ---

// ==========================================
// 📊 TRACKERS DISCORD (3 Webhooks séparés)
// ==========================================

const WEBHOOK_RECHERCHE = "https://discord.com/api/webhooks/1482435597372100628/vmjrJ5zOsOfV2tVv4SEeUcC1uP-jEBg1oxEJb4sPsQ7qxnqkANs0G976sPBlSF6HiLZf";
const WEBHOOK_LECTEUR = "https://discord.com/api/webhooks/1482436048373026816/pPA0G1N6JSulfgPtAiArewD5veeHnrPLqofm3HSidpNG5Ro5BIxhNBdzjl56IvvJhMPc";
const WEBHOOK_DETAILS = "https://discord.com/api/webhooks/1482456590107021352/aHuhNRb0fRMa_-KT9wFIKyu2Lz3qxClLYc-7bTqdsFYlIPpw35wuN8PhOMTaW7NKtDPv";

// 1. Tracker pour les Recherches
async function sendTracker(moduleName, keyword, results, apiUrl) {
    try {
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
        // Extraction du nom de l'anime depuis l'URL Anime-Sama (ex: https://anime-sama.fr/catalogue/naruto/)
        let match = url.match(/\/catalogue\/([^/]+)\/?/i);
        if (match) readableName = match[1].replace(/-/g, ' ').toUpperCase();

        const payload = {
            embeds: [{
                title: `🖱️ Clic sur une affiche (${moduleName})`,
                description: `**Anime sélectionné :** \`${readableName}\`\n**URL Utilisée :** ${apiUrl}`,
                color: 16766720, // Jaune/Orange
                timestamp: new Date().toISOString()
            }]
        };

        const headers = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" };
        await fetchv2(WEBHOOK_DETAILS, headers, "POST", JSON.stringify(payload));
    } catch (e) { console.log("Erreur Tracker Details : " + e); }
}

// 3. Tracker pour le Lecteur
async function sendPlayerTracker(moduleName, url, streams, apiUrl) {
    try {
        let readableInfo = url;
        
        // Extraction spécifique pour Anime-Sama (ex: .../naruto/saison1/vostfr?episode_index=2)
        let animeMatch = url.match(/\/catalogue\/([^/]+)\/(.+)/i);
        if (animeMatch) {
            let animeName = animeMatch[1].replace(/-/g, ' ').toUpperCase();
            
            // On essaie de trouver le numéro de l'épisode
            let epNumber = "1"; // Par défaut 1 si on n'a pas l'index
            let indexMatch = url.match(/episode_index=(\d+)/i);
            if (indexMatch) {
                epNumber = parseInt(indexMatch[1]) + 1; // L'index commence à 0 sur Anime-Sama
            }
            
            // On essaie de trouver la saison/langue
            let detailsMatch = animeMatch[2].split('?')[0].replace(/\//g, ' ');

            readableInfo = `Anime : **${animeName}**\nDétails : ${detailsMatch}\nÉpisode : **${epNumber}**`;
        } else {
            readableInfo = `Lien brut : \`${url}\``;
        }

        let desc = `${readableInfo}\n**URL Fichier JS :** ${apiUrl}\n\n**Serveurs extraits :** ${streams.length}\n`;
        
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

        const fetchUrl = `https://${domain}/template-php/defaut/fetch.php`;

        const response = await fetchv2(
            fetchUrl,
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

            if (!results.find(r => r.href === href)) {
                results.push({ title, image, href });
            }
        }
        
        return { results: results, apiUrl: fetchUrl };
    } catch (e) {
        console.log(`[Recherche AS] 🚨 Erreur sur ${domain} : ${e}`);
        return { results: [], apiUrl: `https://${domain}/template-php/defaut/fetch.php` };
    }
}

// Fonction principale de recherche
async function searchResults(keyword) {
    try {
        const domains = await getDomainsList();
        console.log(`[Recherche AS] 🔍 Démarrage de la recherche sur ${domains.length} domaines.`);
        
        let finalResults = [];
        let finalApiUrl = "Aucune (Échec total)";

        for (let i = 0; i < domains.length; i++) {
            let currentDomain = domains[i];
            console.log(`[Recherche AS] 📡 Vérification du radar pour : ${currentDomain}...`);
            
            try {
                const checkRes = await fetchv2(
                    `https://anime-sama.pw/?check=${currentDomain}`, 
                    { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }, 
                    "GET"
                );
                const checkData = JSON.parse(await checkRes.text());
                
                if (checkData.code !== 200) {
                    console.log(`[Recherche AS] ⏭️ ${currentDomain} ignoré.`);
                    continue; 
                }
            } catch (e) {}

            try {
                let searchAttempt = await trySearch(currentDomain, keyword);
                
                if (searchAttempt.results && searchAttempt.results.length > 0) {
                    console.log(`[Recherche AS] 🚀 Succès sur ${currentDomain} ! ${searchAttempt.results.length} résultats extraits.`);
                    finalResults = searchAttempt.results;
                    finalApiUrl = searchAttempt.apiUrl;
                    break; // On a trouvé, on sort de la boucle !
                }
            } catch (err) {}
        }

        // 🕵️ Appel du tracker avec les résultats !
        await sendTracker("Anime-Sama", keyword, finalResults, finalApiUrl);

        return JSON.stringify(finalResults);

    } catch (globalErr) {
        console.log(`[Recherche AS] 🚨 Crash global : ${globalErr}`);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    console.log(`[Détails AS] 📖 Chargement des infos pour : ${url}`);
    
    // 🕵️ Appel du tracker Détails
    await sendDetailsTracker("Anime-Sama", url, url); // L'API d'Anime-Sama est directement le lien de la page

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
                    let currentSeason = fallbackSeason;
                    let seasonMatch = cleanTabName.match(/saison\s*(\d+)/i);
                    
                    if (seasonMatch) {
                        currentSeason = parseInt(seasonMatch[1]);
                    } else if (cleanTabName.toLowerCase().includes('film') || cleanTabName.toLowerCase().includes('oav')) {
                        currentSeason = 0; 
                    }

                    for (let i = 0; i < maxEpisodes; i++) {
                        let separator = jsUrl.includes('?') ? '&' : '?';
                        let epHref = `${jsUrl}${separator}episode_index=${i}`;
                        let epTitle = maxEpisodes === 1 ? cleanTabName : `Épisode ${i + 1}`;
                        
                        results.push({
                            title: epTitle,
                            name: epTitle,
                            href: epHref,
                            number: i + 1,            
                            season: currentSeason     
                        });
                    }
                    if (!cleanTabName.toLowerCase().includes('film')) {
                        fallbackSeason++;
                    }
                }
            } catch (e) { }
        }

        return JSON.stringify(results);
    } catch (e) {
        return JSON.stringify([]);
    }
}

// --- 4. LECTEUR (Pieuvre 3.0 : Sans VK) ---
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
            // 3. LECTEUR VIDMOLY
            else if (urlLower.includes("vidmoly")) {
                try {
                    let fixedVidUrl = embedUrl.replace(/vidmoly\.(to|me|net|ru|is)/i, "vidmoly.biz");
                    const vidRes = await fetchv2(fixedVidUrl, { "Referer": "https://vidmoly.biz/" }, "GET");
                    const vidHtml = await vidRes.text();
                    const fileMatch = vidHtml.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || vidHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                    if (fileMatch) streams.push({ title: `${prefix} Vidmoly`, streamUrl: fileMatch[1], headers: { "Referer": "https://vidmoly.biz/" } });
                } catch (e) {}
            }
            // 4. LECTEUR SENDVID
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

        // 🕵️ Appel du tracker avec les flux récupérés !
        await sendPlayerTracker("Anime-Sama", url, uniqueStreams, jsUrl1);

        return JSON.stringify(uniqueStreams.length > 0 ? { type: "servers", streams: uniqueStreams } : { type: "none" });

    } catch (e) {
        return JSON.stringify({ type: "none" });
    }
}

// Fonction utilitaire pour décoder VOE
function voeExtractor(html) {
    try {
        const jsonScriptMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (!jsonScriptMatch) return null;
        let data = JSON.parse(jsonScriptMatch[1].trim());
        let step1 = data[0].replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
        let step2 = step1; ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(pat => step2 = step2.split(pat).join(""));
        const _atob = (str) => typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
        let step3 = _atob(step2);
        let step4 = step3.split("").map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
        let step5 = step4.split("").reverse().join("");
        let step6 = _atob(step5);
        let result = JSON.parse(step6);
        return result.direct_access_url || (result.source && result.source.find(s => s.direct_access_url)?.direct_access_url) || null;
    } catch (e) { return null; }
}
