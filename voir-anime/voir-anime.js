// ==========================================
// ⚙️ MODULE SORA — VOIRANIME (Tracker Pro)
// ==========================================

const BASE_URL = "https://voir-anime.to";

// ==========================================
// 🗄️ TRACKER SUPABASE (Base de données)
// ==========================================
const SUPABASE_URL = "https://qyeisgowjisqbatrmqta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F68CBjFVPh71U0SdD9BQJg_UJgL9-Fj";

async function sendSupabaseLog(moduleName, actionType, dataPayload) {
    try {
        const payload = {
            module: moduleName,
            action: actionType,
            data: dataPayload
        };

        const headers = { 
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            "Prefer": "return=minimal" 
        };
        
        if (typeof fetchv2 !== 'undefined') {
            await fetchv2(`${SUPABASE_URL}/rest/v1/app_logs`, headers, "POST", JSON.stringify(payload));
        } else {
            await fetch(`${SUPABASE_URL}/rest/v1/app_logs`, { method: "POST", headers: headers, body: JSON.stringify(payload) });
        }
    } catch (e) { 
        console.log(`[Tracker] 🚨 Erreur d'envoi vers Supabase : ${e.message}`); 
    }
}

// ==========================================
// ⚙️ LOGIQUE DU MODULE VOIRANIME
// ==========================================

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    console.log(`[Recherche] 🔍 Recherche classique pour : "${keyword}"`);
    try {
        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(keyword)}&post_type=wp-manga`;
        console.log(`[Recherche] 🔗 URL appelée : ${searchUrl}`);

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://voir-anime.to"
        };

        const response = await fetchv2(searchUrl, { headers });
        const html = await response.text();

        if (html.includes("Just a moment...") || html.includes("Cloudflare") || html.includes("DDoS")) {
            console.log(`[Recherche] ⛔ AÏE ! L'application est bloquée par Cloudflare.`);
            sendSupabaseLog("VoirAnime", "BLOCKED", { keyword: keyword, reason: "Cloudflare" });
            return JSON.stringify([]);
        }

        const results = [];
        const blocks = html.split(/c-tabs-item__content|page-item-detail|class=["']c-image["']/i);

        for (let i = 1; i < blocks.length; i++) {
            let block = blocks[i];
            
            let hrefMatch = block.match(/href=["']([^"']+)["']/i);
            let titleMatch = block.match(/title=["']([^"']+)["']/i) || block.match(/alt=["']([^"']+)["']/i);
            let imgMatch = block.match(/data-src=["']([^"']+)["']/i) || block.match(/src=["']([^"']+)["']/i);
            let yearMatch = block.match(/release-year[^>]*>\s*<a[^>]*>(\d{4})<\/a>/i);

            if (hrefMatch && titleMatch) {
                let href = hrefMatch[1];
                let title = titleMatch[1];
                
                if (href.includes('.css') || href.includes('.js') || href.includes('wp-') || title.includes('RSD') || !href.includes(BASE_URL)) {
                    continue;
                }

                title = title.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&#8211;/g, "-").trim();
                let rawImage = imgMatch ? imgMatch[1] : "";
                if (rawImage.startsWith('/')) rawImage = BASE_URL + rawImage;
                
                const monProxyVercel = "https://proxy-imaga-sora.kurzmathis4.workers.dev/?url=";
                let image = rawImage ? `${monProxyVercel}${encodeURIComponent(rawImage)}` : `${BASE_URL}/wp-content/uploads/2021/04/voiranime-logo.png`;

                let year = yearMatch ? yearMatch[1] : null;

                if (!results.find(r => r.href === href)) {
                    let item = { title: title, image: image, href: href };
                    if (year) item.year = year; 
                    results.push(item);
                }
            }
        }
        
        sendSupabaseLog("VoirAnime", "SEARCH", { 
            keyword: keyword, 
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(results);

    } catch (e) { 
        sendSupabaseLog("VoirAnime", "ERROR", { keyword: keyword, error_message: String(e) });
        return JSON.stringify([]); 
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    sendSupabaseLog("VoirAnime", "DETAILS", { anime_url: url });

    try {
        const response = await fetchv2(url);
        const html = await response.text();

        let description = "Pas de description disponible.";
        const descMatch = html.match(/<div class=["']summary__content[^>]*>([\s\S]*?)<\/div>/i) || html.match(/<div class=["']description-summary[^>]*>([\s\S]*?)<\/div>/i);

        if (descMatch && descMatch[1]) {
            description = descMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&#8217;/g, "'").replace(/&#8230;/g, "...").replace(/&quot;/g, '"').replace(/&#8220;?/g, '"').replace(/&#8221;?/g, '"').replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"').trim();
        }

        let airdate = "N/A";
        const fullDateMatch = html.match(/(?:Start\s*date|End\s*date|Année\s*de\s*sortie|Année|Release|Sortie|Year)[^<]*<\/h5>[\s\S]{1,150}?<div[^>]*class=["'][^"']*summary-content[^"']*["'][^>]*>\s*([^<]+?)\s*<\/div>/i);
        
        if (fullDateMatch && fullDateMatch[1]) { airdate = fullDateMatch[1].trim(); } 
        else {
            const yearFallback = html.match(/(?:Start\s*date|End\s*date|Année\s*de\s*sortie|Année|Release|Sortie|Year)[\s\S]{1,150}?\b(19\d{2}|20\d{2})\b/i);
            if (yearFallback && yearFallback[1]) { airdate = yearFallback[1]; } 
            else {
                const altMatch = html.match(/href=["'][^"']*(?:anime-release|release|year|\/annee\/)[^"']*["'][^>]*>\s*(19\d{2}|20\d{2})\s*<\/a>/i);
                if (altMatch && altMatch[1]) { airdate = altMatch[1]; }
            }
        }

        return JSON.stringify([{ description, aliases: "Voiranime", airdate }]);
    } catch (e) { 
        return JSON.stringify([{ description: "Erreur de chargement", aliases: "Voiranime", airdate: "N/A" }]); 
    }
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

// --- 4. LECTEUR (Avec Tracker des Liens Morts) ---
async function extractStreamUrl(url) {
    console.log(`[Lecteur] 🎬 Démarrage pour : ${url}`);
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        
        let streams = [];
        let embedUrls = [];
        let failedLinks = []; // 🚨 NOUVEAU : Le carnet des liens morts

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

        // Si on ne trouve absolument aucune iframe sur la page
        if (embedUrls.length === 0) {
            failedLinks.push({ server_name: "Extracteur Global", url: "Aucun lecteur détecté sur la page" });
        }

        for (let embedUrl of embedUrls) {
            let urlLower = embedUrl.toLowerCase();

            // --- MOTEUR VOE ---
            if (urlLower.includes("voe.sx") || urlLower.includes("voe.network") || urlLower.includes("voe") || urlLower.includes("lancewhosedifficult")) {
                try {
                    let voeRes = await fetchv2(embedUrl, { "Referer": BASE_URL });
                    if (voeRes) {
                        let voeHtml = await voeRes.text();
                        const redirectMatch = voeHtml.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
                        if (redirectMatch && redirectMatch[1]) {
                            voeRes = await fetchv2(redirectMatch[1], { "Referer": BASE_URL });
                            voeHtml = await voeRes.text();
                        }
                        const streamUrl = voeExtractor(voeHtml);
                        if (streamUrl) {
                            const typeStr = streamUrl.includes(".m3u8") ? "HLS" : "MP4";
                            streams.push({ title: `VOE (${typeStr})`, streamUrl: streamUrl, headers: { "Referer": embedUrl } });
                        } else {
                            failedLinks.push({ server_name: "VOE (Décodage Échoué)", url: embedUrl });
                        }
                    } else {
                        failedLinks.push({ server_name: "VOE (Page inaccessible)", url: embedUrl });
                    }
                } catch(e) { failedLinks.push({ server_name: "VOE (Crash)", url: embedUrl }); }
            }
            // --- MOTEUR STREAMTAPE ---
            else if (urlLower.includes("streamtape.com")) {
                try {
                    const stRes = await fetchv2(embedUrl);
                    const stHtml = await stRes.text();
                    
                    // 1. On isole UNIQUEMENT la ligne de code JavaScript qui contient 'robotlink'
                    const robotLineMatch = stHtml.match(/document\.getElementById\(['"]robotlink['"]\).*?;/);

                    if (robotLineMatch) {
                        // 2. On extrait brutalement les paramètres secrets (qui commencent par "id=")
                        // Le [^'"]+ veut dire : "Prends tout jusqu'au prochain guillemet"
                        const paramsMatch = robotLineMatch[0].match(/(id=[^'"]+)/);
                        
                        if (paramsMatch) {
                            // 3. On reconstruit le lien parfait à la main, en contournant leur protection !
                            const directUrl = "https://streamtape.com/get_video?" + paramsMatch[1] + "&stream=1";
                            
                            streams.push({ 
                                title: "Streamtape", 
                                streamUrl: directUrl, 
                                headers: { "Referer": "https://streamtape.com/", "User-Agent": "Mozilla/5.0" } 
                            });
                        } else {
                            failedLinks.push({ server_name: "Streamtape (Paramètres Introuvables)", url: embedUrl });
                        }
                    } else {
                        failedLinks.push({ server_name: "Streamtape (Robotlink Introuvable)", url: embedUrl });
                    }
                } catch (e) { failedLinks.push({ server_name: "Streamtape (Crash)", url: embedUrl }); }
            }
            // --- MOTEUR F16PX / STREAMHIDE ---
            else if (urlLower.includes("streamhide") || urlLower.includes("vidhide") || urlLower.includes("luluvdo")) {
                try {
                    const req = await fetchv2(embedUrl, { "Referer": BASE_URL }, "GET");
                    let streamUrl = vidhideExtractor(await req.text()); 
                    if (streamUrl) {
                        const typeStr = streamUrl.includes(".m3u8") ? "HLS" : "MP4";
                        streams.push({ title: `Streamhide (${typeStr})`, streamUrl: streamUrl, headers: { "Referer": embedUrl, "User-Agent": "Mozilla/5.0" } });
                    } else {
                        failedLinks.push({ server_name: "Streamhide/F16px (Protégé ou Mort)", url: embedUrl });
                    }
                } catch(e) { failedLinks.push({ server_name: "Streamhide (Crash)", url: embedUrl }); }
            }
            // --- MOTEUR YOURUPLOAD ---
            else if (urlLower.includes("yourupload")) {
                try {
                    const yuRes = await fetchv2(embedUrl, { "Referer": BASE_URL });
                    const yuHtml = await yuRes.text();
                    const yuMatch = yuHtml.match(/property=["']og:video["'][^>]+content=["']([^"']+)["']/i) || yuHtml.match(/file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i);
                    
                    if (yuMatch) {
                        let initialStreamUrl = yuMatch[1];
                        let finalStreamUrl = initialStreamUrl;
                        try {
                            const redirectReq = await fetchv2(initialStreamUrl, { "Referer": embedUrl, "User-Agent": "Mozilla/5.0" }, "HEAD");
                            if (redirectReq && redirectReq.url && redirectReq.url !== initialStreamUrl) {
                                finalStreamUrl = redirectReq.url;
                            }
                        } catch(e) {}
                        streams.push({ title: "YourUpload (MP4)", streamUrl: finalStreamUrl, headers: { "Referer": embedUrl, "Origin": "https://www.yourupload.com", "User-Agent": "Mozilla/5.0" } });
                    } else {
                        failedLinks.push({ server_name: "YourUpload (Fichier Introuvable)", url: embedUrl });
                    }
                } catch(e) { failedLinks.push({ server_name: "YourUpload (Crash)", url: embedUrl }); }
            }
            // --- MOTEUR VIDMOLY ---
            else if (urlLower.includes("vidmoly")) {
                try {
                    const vidRes = await fetchv2(embedUrl, { "Referer": BASE_URL });
                    const vidHtml = await vidRes.text();
                    const fileMatch = vidHtml.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                    if (fileMatch) {
                        streams.push({ title: "Vidmoly (Direct)", streamUrl: fileMatch[1], headers: { "Referer": "https://vidmoly.to/", "Origin": "https://vidmoly.to" } });
                    } else {
                        failedLinks.push({ server_name: "Vidmoly (Lien Introuvable)", url: embedUrl });
                    }
                } catch (e) { failedLinks.push({ server_name: "Vidmoly (Crash)", url: embedUrl }); }
            }
            // --- MOTEUR MAIL.RU ---
            else if (urlLower.includes("my.mail.ru")) {
                try {
                    const idMatch = embedUrl.match(/video\/embed\/(\d+)/i);
                    if (idMatch) {
                        const apiRes = await fetchv2(`https://my.mail.ru/+/video/meta/${idMatch[1]}`);
                        const apiJson = JSON.parse(await apiRes.text());
                        if (apiJson && apiJson.videos && apiJson.videos.length > 0) {
                            for (let vid of apiJson.videos) {
                                let directUrl = vid.url.startsWith('//') ? "https:" + vid.url : vid.url;
                                streams.push({ title: `Mail.ru (${vid.key})`, streamUrl: directUrl, headers: { "Referer": "https://my.mail.ru/", "User-Agent": "Mozilla/5.0" } });
                            }
                        } else {
                            failedLinks.push({ server_name: "Mail.ru (API Vide)", url: embedUrl });
                        }
                    } else {
                        failedLinks.push({ server_name: "Mail.ru (ID Invalide)", url: embedUrl });
                    }
                } catch (e) { failedLinks.push({ server_name: "Mail.ru (Crash)", url: embedUrl }); }
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
                    } else {
                        failedLinks.push({ server_name: "Sibnet (MP4 Introuvable)", url: embedUrl });
                    }
                } catch (e) { failedLinks.push({ server_name: "Sibnet (Crash)", url: embedUrl }); }
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
                    } else {
                        failedLinks.push({ server_name: "Daisuki/Moon (Média Introuvable)", url: embedUrl });
                    }
                } catch (e) { failedLinks.push({ server_name: "Daisuki/Moon (Crash)", url: embedUrl }); }
            }
            // --- MOTEUR SENDVID ---
            else if (urlLower.includes("sendvid")) {
                try {
                    const req = await fetchv2(embedUrl);
                    const sendHtml = await req.text();
                    const mp4Match = sendHtml.match(/<source[^>]+src=["']([^"']+\.mp4)["']/i) || sendHtml.match(/video_source\s*=\s*["']([^"']+)["']/i);
                    if (mp4Match) {
                        streams.push({ title: "Sendvid (MP4)", streamUrl: mp4Match[1], headers: { "Referer": embedUrl } });
                    } else {
                        failedLinks.push({ server_name: "Sendvid (Vidéo Introuvable)", url: embedUrl });
                    }
                } catch (e) { failedLinks.push({ server_name: "Sendvid (Crash)", url: embedUrl }); }
            }
            else {
                // Lecteur inconnu
                failedLinks.push({ server_name: "Lecteur Non Supporté", url: embedUrl });
            }
        }

        let safeStreams = streams.filter(s => 
            s.streamUrl.includes('.mp4') || 
            s.streamUrl.includes('.m3u8') || 
            s.streamUrl.includes('streamtape.com')
        );
        
        let uniqueStreams = [];
        let seenUrls = new Set();
        for (let s of safeStreams) {
            if (!seenUrls.has(s.streamUrl)) { seenUrls.add(s.streamUrl); uniqueStreams.push(s); }
        }

        // 📡 Log Supabase : LIENS MORTS (Nakios Style)
        // Se déclenche s'il y a eu au moins 1 erreur, même si des streams ont marché !
        if (failedLinks.length > 0) {
            sendSupabaseLog("VoirAnime", "UNSUPPORTED_HOSTS", { 
                media_path: url, 
                failed_count: failedLinks.length,
                failed_links: failedLinks
            });
        }

        // 📡 Log Supabase : LECTEUR (Succès)
        if (uniqueStreams.length > 0) {
            sendSupabaseLog("VoirAnime", "PLAYER", { 
                media_path: url, 
                streams_found: uniqueStreams.length,
                servers: uniqueStreams.map(s => ({ nom: s.title, lien: s.streamUrl }))
            });
            return JSON.stringify({ type: "servers", streams: uniqueStreams });
        } else {
            return JSON.stringify({ type: "none" });
        }

    } catch (e) {
        sendSupabaseLog("VoirAnime", "ERROR", { media_path: url, error_message: String(e) });
        return JSON.stringify({ type: "none" });
    }
}

// =====================================================================
// OUTILS DE DÉCODAGE (VOE & VIDHIDE)
// =====================================================================
function voeExtractor(html) {
    try {
        const jsonScriptMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (!jsonScriptMatch) return null;

        const obfuscatedJson = jsonScriptMatch[1].trim();
        let data;
        try { data = JSON.parse(obfuscatedJson); } catch (e) { return null; }
        
        if (!Array.isArray(data) || typeof data[0] !== "string") return null;
        
        let obfuscatedString = data[0];
        let step1 = voeRot13(obfuscatedString);
        let step2 = voeRemovePatterns(step1);
        let step3 = voeBase64Decode(step2);
        let step4 = voeShiftChars(step3, 3);
        let step5 = step4.split("").reverse().join("");
        let step6 = voeBase64Decode(step5);

        try { step6 = decodeURIComponent(escape(step6)); } catch(e) {}

        let result;
        try { result = JSON.parse(step6); } catch (e) { return null; }

        if (result && typeof result === "object") {
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
        }
        return null;
    } catch(err) { return null; }
}

function voeRot13(str) {
    return str.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}

function voeRemovePatterns(str) {
    const patterns = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
    let result = str;
    for (const pat of patterns) { result = result.split(pat).join(""); }
    return result;
}

function voeBase64Decode(str) {
    if (typeof atob === "function") { try { return atob(str); } catch (e) {} }
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

function vidhideExtractor(html) {
    try {
        let videoUrl = null;
        let directMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
        if (directMatch) {
            videoUrl = directMatch[1];
        } 
        else if (html.includes('eval(function(p,a,c,k,e,d)')) {
            let packRegex = /eval\(function\(p,a,c,k,e,d\).*?\.split\('\|'\)\)\)/g;
            let packMatches = html.match(packRegex);
            if (packMatches) {
                for (let packed of packMatches) {
                    let argsMatch = packed.match(/}\s*\(\s*(['"])(.*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])(.*?)\5\.split\('\|'\)/);
                    if (argsMatch) {
                        let p = argsMatch[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
                        let a = parseInt(argsMatch[3], 10);
                        let c = parseInt(argsMatch[4], 10);
                        let k = argsMatch[6].split('|');
                        let e = function(c) {
                            return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
                        };
                        while (c--) if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
                        let unpackedMatch = p.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
                        if (unpackedMatch) { videoUrl = unpackedMatch[1]; break; }
                    }
                }
            }
        }
        return videoUrl ? videoUrl.replace(/\\\//g, "/").trim() : null;
    } catch (e) { return null; }
}