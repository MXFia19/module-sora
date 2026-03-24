// ==========================================
// ⚙️ MODULE SORA — ANIME-KAMI.COM (Avec Logs Détaillés)
// ==========================================

const BASE_URL = "https://anime-kami.com";

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    console.log(`[Anime-Kami] 🔍 Recherche API pour : "${keyword}"`);
    try {
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": BASE_URL + "/"
        };

        const payload = JSON.stringify({
            search: keyword,
            year: null,
            season: null,
            format: null,
            genres: [],
            sort: "ID_DESC",
            status: null,
            page: 1,
            perPage: 30,
            language: null,
            contentType: "anime"
        });

        const response = await fetchv2(BASE_URL + "/api/catalog", headers, "POST", payload);
        const json = JSON.parse(await response.text());
        const data = json.data || json;

        const results = [];

        for (const item of data) {
            results.push({
                title: item.title?.userPreferred || item.title?.normal || "Sans titre",
                image: item.coverImage?.large || item.coverImage?.medium || "",
                href: BASE_URL + "/anime/" + item.id + "-" + item.url
            });
        }

        console.log(`[Anime-Kami] ✅ ${results.length} résultats trouvés.`);
        return JSON.stringify(results);
    } catch (e) {
        console.log(`[Anime-Kami] 🚨 Erreur recherche : ${e.message}`);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    console.log(`[Anime-Kami] 📖 Chargement des détails pour : ${url}`);
    try {
        // 🛠️ CORRECTION : On utilise fetchv2 car soraFetch n'existe pas ici !
        const headers = {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://anime-kami.com/"
        };
        
        const res = await fetchv2(url, headers, "GET");
        const html = await res.text();

        let description = "Pas de description disponible.";
        
        // 🎯 VISEUR 1 : La nouvelle méthode HTML pour les films (le fameux h3 Synopsis)
        let movieDescMatch = html.match(/<h3[^>]*>Synopsis<\/h3>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
        
        // 🎯 VISEUR 2 : Paragraphe classique
        let descMatch = html.match(/<p class=["']text-sm[^>]*>([\s\S]*?)<\/p>/i);

        // Application du meilleur viseur
        if (movieDescMatch && movieDescMatch[1]) {
            description = movieDescMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
        } else if (descMatch && descMatch[1]) {
            description = descMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
        } else {
            // 🎯 VISEUR 3 : Ultime roue de secours via l'API Catalog
            const match = url.match(/\/anime\/([\d]+)-([^/?#]+)/);
            if (match) {
                const slug = match[2];
                const payload = JSON.stringify({ search: slug.replace(/-/g, " "), page: 1, perPage: 1, contentType: "both" });
                const apiRes = await fetchv2("https://anime-kami.com/api/catalog", { "Content-Type": "application/json" }, "POST", payload);
                const apiJson = JSON.parse(await apiRes.text());
                const data = apiJson.data || apiJson;
                const anime = data.find(a => String(a.id) === match[1]) || data[0];
                if (anime && (anime.description?.fr || anime.description?.en)) {
                    description = (anime.description.fr || anime.description.en).replace(/<[^>]+>/g, '').trim();
                }
            }
        }

        // Récupération de l'année (adapté au HTML de Anime-Kami)
        let airdate = "N/A";
        let dateMatch = html.match(/<span[^>]*>Année<\/span>[\s\S]*?<span[^>]*>([\d]{4})<\/span>/i);
        if (dateMatch) {
            airdate = dateMatch[1].trim();
        }

        console.log(`[Anime-Kami] ✅ Détails extraits avec succès.`);
        return JSON.stringify([{ description, aliases: "Anime-Kami", airdate }]);
        
    } catch (e) {
        console.log(`[Anime-Kami] 🚨 Erreur détails : ${e.message}`);
        return JSON.stringify([{ description: "Erreur de chargement.", aliases: "Anime-Kami", airdate: "N/A" }]);
    }
}

// --- 3. ÉPISODES (Unifiés VF + VOSTFR) ---
async function extractEpisodes(url) {
    console.log(`[Anime-Kami] 📂 Chargement des épisodes pour : ${url}`);
    try {
        const match = url.match(/\/anime\/([\d]+)-([^/?#]+)/);
        if (!match) return JSON.stringify([]);

        const id = match[1];
        const slug = match[2];

        const headers = { "User-Agent": "Mozilla/5.0", "Referer": BASE_URL + "/" };
        const apiUrl = BASE_URL + "/api/episode/" + id + "-" + slug + "?releasing=false&refresh=true";
        
        const response = await fetchv2(apiUrl, headers, "GET");
        const json = JSON.parse(await response.text());
        const provider = json[0];
        
        if (!provider) {
            console.log(`[Anime-Kami] ❌ Aucun provider trouvé dans l'API.`);
            return JSON.stringify([]);
        }

        // On utilise un Map pour éviter les doublons (si l'épisode 1 est dans les deux listes, on ne le crée qu'une fois)
        const episodeMap = new Map();

        const addEpisodesToMap = (epList) => {
            if (!epList) return;
            for (const ep of epList) {
                if (!episodeMap.has(ep.number)) {
                    let titleText = ep.title ? ` - ${ep.title}` : "";
                    // Nettoyage pour les films (souvent nommés "Complete Movie")
                    if (titleText.toLowerCase().includes("movie")) titleText = " - Film";
                    
                    episodeMap.set(ep.number, {
                        title: `Épisode ${ep.number}${titleText}`,
                        href: `${apiUrl}&ep=${ep.number}&lang=all`, // 🎯 Le paramètre secret : lang=all !
                        number: ep.number,
                        season: 1
                    });
                }
            }
        };

        // On fusionne les deux listes
        addEpisodesToMap(provider.episodes);   // Ajout des VOSTFR
        addEpisodesToMap(provider.episodesVF); // Ajout des VF

        // On convertit le Map en tableau et on trie par numéro d'épisode (1, 2, 3...)
        const results = Array.from(episodeMap.values()).sort((a, b) => a.number - b.number);

        console.log(`[Anime-Kami] ✅ ${results.length} épisodes unifiés extraits.`);
        return JSON.stringify(results);
    } catch (e) {
        console.log(`[Anime-Kami] 🚨 Erreur épisodes : ${e.message}`);
        return JSON.stringify([]);
    }
}

// --- 4. LECTEUR (Analyse combinée VF + VOSTFR) ---
async function extractStreamUrl(url) {
    console.log(`[Anime-Kami] 🎬 Analyse du lecteur pour : ${url}`);
    try {
        const epMatch = url.match(/[?&]ep=(\d+)/);
        const langMatch = url.match(/[?&]lang=([^&]+)/);
        const epNumber = epMatch ? parseInt(epMatch[1]) : 1;
        const lang = langMatch ? langMatch[1] : "all";

        console.log(`[Anime-Kami] 🧠 Cible -> Langue: ${lang.toUpperCase()} | Épisode: ${epNumber}`);

        const apiUrl = url.split("&ep=")[0];
        const headers = { "User-Agent": "Mozilla/5.0", "Referer": BASE_URL + "/" };

        const response = await fetchv2(apiUrl, headers, "GET");
        const json = JSON.parse(await response.text());
        const provider = json[0];

        if (!provider) return JSON.stringify({ type: "none" });

        // 🎯 Préparation de la liste globale des serveurs à extraire
        let serversToProcess = [];

        // Si on demande VOSTFR ou ALL, on ajoute les serveurs VOSTFR
        if ((lang === "vostfr" || lang === "all") && provider.episodes) {
            let ep = provider.episodes.find(e => e.number === epNumber);
            if (ep && ep.servers) {
                for (let k in ep.servers) serversToProcess.push({ ...ep.servers[k], langTag: "VOSTFR", serverKey: k });
            }
        }

        // Si on demande VF ou ALL, on ajoute les serveurs VF
        if ((lang === "vf" || lang === "all") && provider.episodesVF) {
            let ep = provider.episodesVF.find(e => e.number === epNumber);
            if (ep && ep.servers) {
                for (let k in ep.servers) serversToProcess.push({ ...ep.servers[k], langTag: "VF", serverKey: k });
            }
        }

        if (serversToProcess.length === 0) {
            console.log(`[Anime-Kami] ❌ Aucun serveur trouvé pour cet épisode.`);
            return JSON.stringify({ type: "none" });
        }

        const streams = [];
        console.log(`[Anime-Kami] ⚡ Extraction sur ${serversToProcess.length} lecteurs unifiés...`);

        // On boucle sur notre super-liste combinée
        for (const server of serversToProcess) {
            const serverUrl = server.server_url;
            const serverName = server.server_name || "Serveur " + server.serverKey;
            const quality = server.quality || "720";
            const prefix = `[${server.langTag}] `; // Va générer [VOSTFR] ou [VF] dynamiquement
            
            console.log(`[Lecteur] ⏳ Tentative sur ${serverName} ${prefix} -> ${serverUrl}`);

            // 1. LECTEUR SENDVID
            if (serverUrl.includes("sendvid")) {
                try {
                    const req = await fetchv2(serverUrl, { "Referer": BASE_URL + "/" }, "GET");
                    const html = await req.text();
                    const mp4Match = html.match(/<source[^>]+src=["']([^"']+\.mp4)["']/i) || html.match(/video_source\s*=\s*["']([^"']+)["']/i);
                    if (mp4Match) {
                        streams.push({ title: prefix + serverName + " (" + quality + "p)", streamUrl: mp4Match[1], headers: { "Referer": serverUrl } });
                        console.log(`[Lecteur] ✅ Succès Sendvid`);
                    }
                } catch (e) {}

           // 2. LECTEUR SIBNET
            } else if (serverUrl.includes("sibnet.ru")) {
                try {
                    // 🛠️ L'astuce windows-1251 appliquée directement sur fetchv2 !
                    // fetchv2(url, headers, method, body, true, encoding)
                    const req = await fetchv2(
                        serverUrl, 
                        { "Referer": BASE_URL + "/" }, 
                        "GET", 
                        null, 
                        true, 
                        "windows-1251"
                    );
                    const html = await req.text();
                    
                    const srcMatch = html.match(/src:\s*["'](\/v\/[^"']+\.mp4)["']/i);
                    if (srcMatch) {
                        let streamUrl = "https://video.sibnet.ru" + srcMatch[1];
                        
                        // 🚀 Correction anti-écran noir (Résolution de la redirection)
                        try {
                            const redirectReq = await fetchv2(streamUrl, { "Referer": serverUrl, "User-Agent": "Mozilla/5.0" }, "HEAD"); 
                            if (redirectReq && redirectReq.url && redirectReq.url !== streamUrl) {
                                streamUrl = redirectReq.url;
                            }
                        } catch(e) {}
                        
                        streams.push({ 
                            title: prefix + serverName + " (" + quality + "p)", 
                            streamUrl: streamUrl, 
                            headers: { "Referer": serverUrl, "User-Agent": "Mozilla/5.0" } 
                        });
                        console.log(`[Lecteur] ✅ Succès Sibnet (encodage 1251)`);
                    } else {
                        console.log(`[Lecteur] ❌ Échec Sibnet : Source mp4 introuvable.`);
                    }
                } catch (e) {
                    console.log(`[Lecteur] 🚨 Erreur Sibnet : ${e.message}`);
                }

            // 3. LECTEUR VIDMOLY
            } else if (serverUrl.includes("vidmoly")) {
                try {
                    let fixedVidUrl = serverUrl.replace(/vidmoly\.(to|me|net|ru|is)/i, "vidmoly.biz");
                    const vidRes = await fetchv2(fixedVidUrl, { "Referer": "https://vidmoly.biz/" }, "GET");
                    let finalHtml = await vidRes.text();
                    if (typeof unpack === 'function' && finalHtml.includes('eval(function')) finalHtml = unpack(finalHtml);
                    
                    const fileMatch = finalHtml.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || finalHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                    if (fileMatch) {
                        streams.push({ title: prefix + serverName + " (" + quality + "p)", streamUrl: fileMatch[1], headers: { "Referer": "https://vidmoly.biz/" } });
                        console.log(`[Lecteur] ✅ Succès Vidmoly`);
                    }
                } catch (e) {}

            // 4. LECTEUR VOE
            } else if (serverUrl.includes("voe")) {
                try {
                    const voeRes = await fetchv2(serverUrl, { "Referer": BASE_URL + "/" }, "GET");
                    const streamUrl = voeExtractor(await voeRes.text());
                    if (streamUrl) {
                        streams.push({ title: prefix + serverName + " (" + quality + "p)", streamUrl: streamUrl, headers: { "Referer": serverUrl } });
                        console.log(`[Lecteur] ✅ Succès VOE`);
                    }
                } catch (e) {}

            // 5. LECTEUR DOODSTREAM
            } else if (serverUrl.includes("dood") || serverUrl.includes("doply") || serverUrl.includes("myvidplay")) {
                try {
                    let res = await fetchv2(serverUrl, { headers: { "Referer": BASE_URL + "/" }, method: "GET" });
                    if (res) {
                        let html = await res.text();
                        const passMd5Match = html.match(/\/pass_md5\/([^"']+)/i);
                        const tokenMatch = html.match(/[?&]token=([a-z0-9]+)[&'"]/i);
                        if (passMd5Match && tokenMatch) {
                            const domain = serverUrl.match(/^https?:\/\/[^\/]+/)[0]; 
                            const md5Url = domain + '/pass_md5/' + passMd5Match[1];
                            let md5Res = await fetchv2(md5Url, { headers: { "Referer": serverUrl }, method: "GET" });
                            if (md5Res) {
                                let videoBaseUrl = await md5Res.text();
                                videoBaseUrl = videoBaseUrl.trim(); 
                                const makeId = (length) => {
                                    let result = '';
                                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                                    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
                                    return result;
                                };
                                let finalUrl = `${videoBaseUrl}${makeId(10)}?token=${tokenMatch[1]}&expiry=${Date.now()}`;
                                streams.push({ title: prefix + serverName + " (" + quality + "p)", streamUrl: finalUrl, headers: { "Referer": domain + "/", "User-Agent": "Mozilla/5.0" } });
                                console.log(`[Lecteur] ✅ Succès Doodstream`);
                            }
                        }
                    }
                } catch(e) {}

            // 6. LECTEUR DAISUKI (API)
            } else if (serverUrl.includes("daisukianime.xyz")) {
                try {
                    let directUrl = null;
                    const idMatch = serverUrl.match(/[?&]id=([^&]+)/);
                    if (idMatch) {
                        const vidId = idMatch[1];
                        let apiUrl = null;

                        if (serverUrl.includes("embeds.html")) apiUrl = `https://cdn2.daisukianime.xyz/sib/${vidId}?epid=null`;
                        else if (serverUrl.includes("embedsen.html")) apiUrl = `https://cdn2.daisukianime.xyz/azz/${vidId}?epid=null`;

                        if (apiUrl) {
                            const apiRes = await fetchv2(apiUrl, { "Referer": serverUrl }, "GET");
                            const apiData = JSON.parse(await apiRes.text());
                            if (apiData.sources && apiData.sources.length > 0) directUrl = apiData.sources[0].file;
                        }
                    }

                    if (!directUrl) {
                        const req = await fetchv2(serverUrl, { "Referer": BASE_URL + "/" }, "GET");
                        const html = await req.text();
                        const match = html.match(/sources:\s*\[\s*{\s*file:\s*['"]([^'"]+)['"]/i) 
                                   || html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) 
                                   || html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
                        if (match) directUrl = match[1];
                    }

                    if (directUrl) {
                        streams.push({ title: prefix + serverName + " (" + quality + "p)", streamUrl: directUrl, headers: { "Referer": serverUrl } });
                        console.log(`[Lecteur] ✅ Succès Daisuki`);
                    }
                } catch (e) {}
            }
        }

        let safeStreams = streams.filter(s => s.streamUrl.includes('.mp4') || s.streamUrl.includes('.m3u8') || s.streamUrl.includes('token='));

        let uniqueStreams = [];
        let seenUrls = new Set();
        for (let s of safeStreams) {
            if (!seenUrls.has(s.streamUrl)) { 
                seenUrls.add(s.streamUrl); 
                uniqueStreams.push(s); 
            }
        }

        // --- 🏆 RÉCAPITULATIF FINAL ---
        console.log(`\n======================================`);
        console.log(`🍿 FIN DE L'EXTRACTION : ${uniqueStreams.length} LIEN(S) VALIDE(S)`);
        console.log(`======================================`);
        
        if (uniqueStreams.length > 0) {
            uniqueStreams.forEach((stream, index) => {
                console.log(`✅ [${index + 1}] ${stream.title}`);
                console.log(`🔗 URL : ${stream.streamUrl}\n`);
            });
        }
        console.log(`======================================\n`);

        return JSON.stringify(uniqueStreams.length > 0 ? { type: "servers", streams: uniqueStreams } : { type: "none" });

    } catch (e) {
        console.log("[Anime-Kami] Erreur globale extractStreamUrl : " + e);
        return JSON.stringify({ type: "none" });
    }
}

// ==========================================
// 🛠️ DÉCRYPTEURS UTILITAIRES
// ==========================================
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
