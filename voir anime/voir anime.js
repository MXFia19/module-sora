const BASE_URL = "https://v6.voiranime.com";

// --- 1. RECHERCHE (Multi-pages ultra-rapide) ---
async function searchResults(keyword) {
    console.log(`[Recherche] 🔍 Lancement multi-pages pour : "${keyword}"`);
    try {
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        };

        const results = [];
        const pagesToFetch = [1, 2, 3];

        const fetchPromises = pagesToFetch.map(page => {
            let searchUrl = page === 1 
                ? `${BASE_URL}/?s=${encodeURIComponent(keyword)}&post_type=wp-manga`
                : `${BASE_URL}/page/${page}/?s=${encodeURIComponent(keyword)}&post_type=wp-manga`;
                
            return fetchv2(searchUrl, { headers }).then(res => res.text()).catch(() => "");
        });

        const pagesHtml = await Promise.all(fetchPromises);
        console.log(`[Recherche] 📥 ${pagesHtml.length} pages téléchargées avec succès.`);

        for (const html of pagesHtml) {
            if (!html) continue;

            const blocks = html.split('class="c-image"');

            for (let i = 1; i < blocks.length; i++) {
                let block = blocks[i];
                let hrefMatch = block.match(/href=["']([^"']+)["']/i);
                let titleMatch = block.match(/title=["']([^"']+)["']/i) || block.match(/alt=["']([^"']+)["']/i);
                let imgMatch = block.match(/data-src=["']([^"']+)["']/i) || block.match(/src=["']([^"']+)["']/i);

                if (hrefMatch && titleMatch) {
                    let href = hrefMatch[1];
                    let title = titleMatch[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
                    let image = imgMatch ? imgMatch[1] : "";
                    if (image.startsWith('/')) image = BASE_URL + image;

                    if (!results.find(r => r.href === href)) {
                        results.push({ title, image, href });
                    }
                }
            }

            if (blocks.length <= 1) {
                const blocksH3 = html.split('<h3 class="h4">');
                for (let i = 1; i < blocksH3.length; i++) {
                    let block = blocksH3[i];
                    let linkMatch = block.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                    
                    if (linkMatch) {
                        let href = linkMatch[1];
                        let title = linkMatch[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
                        if (!results.find(r => r.href === href)) {
                            results.push({ href, title, image: "" });
                        }
                    }
                }
            }
        }
        return JSON.stringify(results);
    } catch (e) { return JSON.stringify([]); }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        let description = "Pas de description disponible.";
        const descMatch = html.match(/<div class=["']summary__content[^>]*>([\s\S]*?)<\/div>/i) ||
                          html.match(/<div class=["']description-summary[^>]*>([\s\S]*?)<\/div>/i);

        if (descMatch && descMatch[1]) {
            description = descMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim();
        }

        let airdate = "N/A";
        const yearMatch = html.match(/<div class=["']summary-heading["']>\s*<h5>Release<\/h5>\s*<\/div>\s*<div class=["']summary-content["']>\s*<a[^>]*>(\d{4})<\/a>/i);
        if (yearMatch) airdate = yearMatch[1];

        return JSON.stringify([{ description, aliases: "Voiranime", airdate }]);
    } catch (e) { return JSON.stringify([{ description: "Erreur de chargement", aliases: "Voiranime", airdate: "N/A" }]); }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        const response = await fetchv2(url);
        let html = await response.text();
        let results = [];
        
        const epRegex = /<li class=["'][^"']*wp-manga-chapter[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;

        while ((match = epRegex.exec(html)) !== null) {
            let epHref = match[1];
            let epTitle = match[2].replace(/<[^>]+>/g, '').trim();
            let numMatch = epTitle.match(/(?:Épisode|Episode|Ep|OAV)\s*(\d+)/i) || epHref.match(/-(\d+)(?:-vostfr|-vf)?\/?$/i);
            let epNumber = numMatch ? parseInt(numMatch[1]) : (results.length + 1);

            results.push({ href: epHref, title: epTitle, number: epNumber });
        }

        results.sort((a, b) => a.number - b.number);
        return JSON.stringify(results);
    } catch (e) { return JSON.stringify([]); }
}

// --- 4. LECTEUR ---
async function extractStreamUrl(url) {
    console.log(`[Lecteur] 🎬 Démarrage pour : ${url}`);
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        
        let streams = [];
        let embedUrls = [];

        const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
        let match;
        while ((match = iframeRegex.exec(html)) !== null) {
            let iframeUrl = match[1];
            if (iframeUrl.startsWith('//')) iframeUrl = "https:" + iframeUrl;
            if (iframeUrl.startsWith('http') && !embedUrls.includes(iframeUrl)) embedUrls.push(iframeUrl);
        }

        const redirectRegex = /data-redirect=["']([^"']+\?host=[^"']+)["']/gi;
        let pagesToFetch = [];
        
        while ((match = redirectRegex.exec(html)) !== null) {
            let redirectUrl = match[1].replace(/&amp;/g, '&');
            if (redirectUrl.startsWith('/')) redirectUrl = BASE_URL + redirectUrl;
            if (!pagesToFetch.includes(redirectUrl)) pagesToFetch.push(redirectUrl);
        }

        if (pagesToFetch.length > 0) {
            const pagesHtml = await Promise.all(
                pagesToFetch.map(p => fetchv2(p, { headers: { "Referer": url } }).then(res => res.text()).catch(() => ""))
            );

            for (const pageSource of pagesHtml) {
                const frameMatch = pageSource.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                if (frameMatch) {
                    let frameUrl = frameMatch[1];
                    if (frameUrl.startsWith('//')) frameUrl = "https:" + frameUrl;
                    if (frameUrl.startsWith('http') && !embedUrls.includes(frameUrl)) embedUrls.push(frameUrl);
                }
            }
        }

        for (let embedUrl of embedUrls) {
            // CORRECTION STREAMTAPE : On utilise urlLower juste pour les "includes", 
            // mais on garde embedUrl intact pour les fetch !
            let urlLower = embedUrl.toLowerCase();
            console.log(`[Lecteur] 🔬 Analyse : ${embedUrl}`); 

            // --- MOTEUR VOE ---
            if (urlLower.includes("voe.sx") || urlLower.includes("voe.network") || urlLower.includes("voe") || urlLower.includes("lancewhosedifficult")) {
                try {
                    console.log(`[VOE] ⏳ Téléchargement de la page : ${embedUrl}`);
                    const voeRes = await fetchv2(embedUrl, { "Referer": BASE_URL });
                    const voeHtml = await voeRes.text();
                    
                    const streamUrl = voeExtractor(voeHtml);
                    if (streamUrl) {
                        console.log(`[VOE] ✅ Succès absolu : ${streamUrl}`); 
                        streams.push({ title: "VOE (Direct)", streamUrl: streamUrl, headers: { "Referer": embedUrl } });
                    } else {
                        console.log(`[VOE] ❌ Échec de l'extraction sur la page HTML téléchargée.`);
                    }
                } catch(e) {
                    console.log(`[VOE] 🚨 Erreur Réseau/Crash : ${e}`);
                }
            }
           // --- MOTEUR STREAMTAPE ---
            else if (urlLower.includes("streamtape.com")) {
                try {
                    console.log(`[Lecteur] 🕵️ Tentative Streamtape sur : ${embedUrl}`);
                    const stRes = await fetchv2(embedUrl);
                    const stHtml = await stRes.text();

                    // On cible précisément la ligne du "robotlink" qui contient le vrai jeton
                    const robotLinkMatch = stHtml.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*[^;]+\(['"]([^'"]+)['"]\)/i);

                    if (robotLinkMatch) {
                        // robotLinkMatch[1] donne par exemple : "xcdmtape.com/get_video?id=jgX..."
                        let tokenString = robotLinkMatch[1];
                        
                        // On coupe toute la fausse première partie pour ne garder que "/get_video?..."
                        let videoPath = tokenString.substring(tokenString.indexOf('/get_video'));
                        
                        // On fabrique l'URL parfaite à la main !
                        let directUrl = "https://streamtape.com" + videoPath + "&dl=1";

                        console.log(`[Lecteur] ✅ Streamtape extrait : ${directUrl}`);
                        streams.push({ 
                            title: "Streamtape (Direct)", 
                            streamUrl: directUrl, 
                            headers: { "Referer": "https://streamtape.com/", "User-Agent": "Mozilla/5.0" } 
                        });
                    } else {
                        console.log(`[Lecteur] ⚠️ Impossible de reconstituer le robotlink Streamtape.`);
                    }
                } catch (e) {
                    console.log(`[Lecteur] 🚨 Erreur Streamtape : ${e}`);
                }
            }
            // --- MOTEUR VIDMOLY ---
            else if (urlLower.includes("vidmoly")) {
                try {
                    const vidRes = await fetchv2(embedUrl, { "Referer": BASE_URL });
                    const vidHtml = await vidRes.text();
                    const fileMatch = vidHtml.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                    if (fileMatch) {
                        streams.push({ title: "Vidmoly (Direct)", streamUrl: fileMatch[1], headers: { "Referer": "https://vidmoly.to/", "Origin": "https://vidmoly.to" } });
                    }
                } catch (e) {}
            }
            // --- MOTEUR MAIL.RU ---
            else if (urlLower.includes("my.mail.ru")) {
                try {
                    const idMatch = embedUrl.match(/video\/embed\/(\d+)/i);
                    if (idMatch) {
                        const apiRes = await fetchv2(`https://my.mail.ru/+/video/meta/${idMatch[1]}`);
                        const apiJson = JSON.parse(await apiRes.text());
                        if (apiJson && apiJson.videos) {
                            for (let vid of apiJson.videos) {
                                let directUrl = vid.url.startsWith('//') ? "https:" + vid.url : vid.url;
                                streams.push({ title: `Mail.ru (${vid.key})`, streamUrl: directUrl, headers: { "Referer": "https://my.mail.ru/", "User-Agent": "Mozilla/5.0" } });
                            }
                        }
                    }
                } catch (e) {}
            }
            // --- MOTEUR SIBNET ---
            else if (urlLower.includes("sibnet")) {
                try {
                    const req = await fetchv2(embedUrl, { "Referer": BASE_URL, "encoding": "windows-1251" });
                    const sibHtml = await req.text();
                    const mp4Match = sibHtml.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i) || sibHtml.match(/src:\s*["'](\/v\/[^"']+\.mp4)[^"']*["']/i);
                    if (mp4Match) {
                        let directUrl = mp4Match[1].startsWith("http") ? mp4Match[1] : "https://video.sibnet.ru" + mp4Match[1];
                        streams.push({ title: "Sibnet (MP4)", streamUrl: directUrl, headers: { "Referer": embedUrl, "User-Agent": "Mozilla/5.0" } });
                    }
                } catch (e) {}
            }
            // --- MOTEUR DAISUKI / MYTV / MOON ---
            else if (urlLower.includes("daisuki") || urlLower.includes("mytv") || urlLower.includes("moon")) {
                try {
                    const req = await fetchv2(embedUrl);
                    const daiHtml = await req.text();
                    const mediaMatch = daiHtml.match(/source\s*:\s*["']([^"']+)["']/i) || daiHtml.match(/file\s*:\s*["']([^"']+)["']/i) || daiHtml.match(/src=["']([^"']+\.(m3u8|mp4)[^"']*)["']/i);
                    if (mediaMatch) {
                        const typeStr = mediaMatch[1].includes(".m3u8") ? "HLS" : "MP4";
                        streams.push({ title: `Daisuki (${typeStr})`, streamUrl: mediaMatch[1], headers: { "Referer": embedUrl } });
                    }
                } catch (e) {}
            }
            // --- MOTEUR SENDVID ---
            else if (urlLower.includes("sendvid")) {
                try {
                    const req = await fetchv2(embedUrl);
                    const sendHtml = await req.text();
                    const mp4Match = sendHtml.match(/<source[^>]+src=["']([^"']+\.mp4)["']/i) || sendHtml.match(/video_source\s*=\s*["']([^"']+)["']/i);
                    if (mp4Match) streams.push({ title: "Sendvid (MP4)", streamUrl: mp4Match[1], headers: { "Referer": embedUrl } });
                } catch (e) {}
            }
        }

        let safeStreams = streams.filter(s => s.streamUrl.includes('.mp4') || s.streamUrl.includes('.m3u8'));
        let uniqueStreams = [];
        let seenUrls = new Set();
        for (let s of safeStreams) {
            if (!seenUrls.has(s.streamUrl)) { seenUrls.add(s.streamUrl); uniqueStreams.push(s); }
        }

        if (uniqueStreams.length > 0) {
            return JSON.stringify({ type: "servers", streams: uniqueStreams });
        } else {
            return JSON.stringify({ type: "none" });
        }

    } catch (e) {
        return JSON.stringify({ type: "none" });
    }
}

// =====================================================================
// OUTILS DE DÉCODAGE (VOE) - DEBUG MODE
// =====================================================================
function voeExtractor(html) {
    try {
        const jsonScriptMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (!jsonScriptMatch) {
            console.log("[VOE DEBUG] ⚠️ Pas de balise <script type='application/json'> trouvée. Le site a peut-être bloqué la requête ou redirigé ailleurs.");
            return null;
        }

        const obfuscatedJson = jsonScriptMatch[1].trim();
        let data;
        try { data = JSON.parse(obfuscatedJson); } catch (e) { 
            console.log("[VOE DEBUG] ⚠️ JSON parse 1 a échoué."); return null; 
        }
        
        if (!Array.isArray(data) || typeof data[0] !== "string") {
            console.log("[VOE DEBUG] ⚠️ Le format du JSON initial est inattendu."); return null;
        }
        
        let obfuscatedString = data[0];

        // Decryptage en 6 étapes
        let step1 = voeRot13(obfuscatedString);
        let step2 = voeRemovePatterns(step1);
        let step3 = voeBase64Decode(step2);
        let step4 = voeShiftChars(step3, 3);
        let step5 = step4.split("").reverse().join("");
        let step6 = voeBase64Decode(step5);

        // Prévention contre les caractères bizarres UTF-8 avant le parse
        try { step6 = decodeURIComponent(escape(step6)); } catch(e) {}

        let result;
        try { 
            result = JSON.parse(step6); 
        } catch (e) { 
            console.log(`[VOE DEBUG] ⚠️ JSON parse final a échoué ! Résultat de step6 : ${step6.substring(0, 100)}...`); 
            return null; 
        }

        if (result && typeof result === "object") {
            console.log("[VOE DEBUG] 🔍 Structure du JSON décodé : " + Object.keys(result).join(", "));
            
            // On cherche le lien de toutes les façons possibles
            let streamUrl = result.direct_access_url;
            if (!streamUrl && result.source && Array.isArray(result.source)) {
                let found = result.source.find(url => url && url.direct_access_url && url.direct_access_url.startsWith("http"));
                if(found) streamUrl = found.direct_access_url;
            }
            if (!streamUrl) {
                const stringified = JSON.stringify(result);
                const m3u8Match = stringified.match(/https?:\/\/[^"]+\.m3u8[^"]*/i);
                if (m3u8Match) streamUrl = m3u8Match[0];
            }

            if (streamUrl) return streamUrl;
            console.log("[VOE DEBUG] ⚠️ JSON décodé avec succès, mais aucun lien m3u8/mp4 n'a été trouvé à l'intérieur.");
        }
        return null;
    } catch(err) {
        console.log(`[VOE DEBUG] 🚨 Crash total de l'extracteur : ${err.message}`);
        return null;
    }
}

function voeRot13(str) {
    return str.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}

function voeRemovePatterns(str) {
    const patterns = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
    let result = str;
    for (const pat of patterns) {
        result = result.split(pat).join("");
    }
    return result;
}

function voeBase64Decode(str) {
    if (typeof atob === "function") {
        try { return atob(str); } catch (e) {}
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let output = '';
    str = String(str).replace(/[=]+$/, '');
    for (let bc = 0, bs, buffer, idx = 0; buffer = str.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
        buffer = chars.indexOf(buffer);
    }
    return output;
}

function voeShiftChars(str, shift) {
    return str.split("").map((c) => String.fromCharCode(c.charCodeAt(0) - shift)).join("");
}
