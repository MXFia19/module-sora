// ==========================================
// MODULE MOVIX (Recherche TMDB -> Streams Hybrides)
// ==========================================

const TMDB_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";

// --- 1. RECHERCHE (100% TMDB pour la fiabilité) ---
async function searchResults(keyword) {
    console.log(`[Movix] 🔍 Recherche TMDB pour : "${keyword}"`);
    try {
        const types = ['movie', 'tv'];
        let allResults = [];

        const promises = types.map(type => {
            const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(keyword)}&language=fr-FR`;
            return fetchv2(url, {}, "GET").then(res => typeof res === "string" ? res : res.text()).then(JSON.parse).catch(() => ({ results: [] }));
        });

        const [movieData, tvData] = await Promise.all(promises);

        (tvData.results || []).forEach(item => {
            if (item.poster_path) {
                const prefix = item.original_language === 'ja' ? '[Anime]' : '[Série]';
                allResults.push({
                    title: `${prefix} ${item.name}`,
                    image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                    href: `movix|tv|${item.id}`,
                    popularity: item.popularity + (item.original_language === 'ja' ? 1000 : 0)
                });
            }
        });

        (movieData.results || []).forEach(item => {
            if (item.poster_path) {
                const prefix = item.original_language === 'ja' ? '[Film Anime]' : '[Film]';
                allResults.push({
                    title: `${prefix} ${item.title}`,
                    image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                    href: `movix|movie|${item.id}`,
                    popularity: item.popularity
                });
            }
        });

        allResults.sort((a, b) => b.popularity - a.popularity);
        return JSON.stringify(allResults);
    } catch (e) {
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(href) {
    console.log(`[Movix] 📂 Détails pour : ${href}`);
    try {
        const parts = href.split('|');
        const type = parts[1]; 
        const id = parts[2];

        const detailsUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR`;
        const res = await fetchv2(detailsUrl, {}, "GET");
        const details = JSON.parse(typeof res === "string" ? res : await res.text());

        return JSON.stringify({
            description: details.overview || "Aucune description disponible pour ce contenu."
        });
    } catch (e) {
        return JSON.stringify({ description: "Erreur lors du chargement des détails." });
    }
}

// --- 3. ÉPISODES (100% TMDB pour les miniatures) ---
async function extractEpisodes(href) {
    console.log(`[Movix] 📺 Épisodes pour : ${href}`);
    try {
        const parts = href.split('|');
        const type = parts[1]; 
        const id = parts[2];
        let episodes = [];

        const detailsUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR`;
        const res = await fetchv2(detailsUrl, {}, "GET");
        const details = JSON.parse(typeof res === "string" ? res : await res.text());

        if (type === 'movie') {
            episodes.push({
                number: 1,
                title: details.title || "Le Film",
                description: details.overview || "",
                image: details.backdrop_path ? `https://image.tmdb.org/t/p/w500${details.backdrop_path}` : "",
                href: `stream|movie|${id}`
            });
        } else if (type === 'tv') {
            for (const season of details.seasons) {
                const sNum = season.season_number;
                if (sNum === 0) continue; 

                const seasonUrl = `https://api.themoviedb.org/3/tv/${id}/season/${sNum}?api_key=${TMDB_KEY}&language=fr-FR`;
                try {
                    const sRes = await fetchv2(seasonUrl, {}, "GET");
                    const sData = JSON.parse(typeof sRes === "string" ? sRes : await sRes.text());

                    sData.episodes.forEach(ep => {
                        episodes.push({
                            number: ep.episode_number,
                            season: sNum,
                            title: `S${sNum}E${ep.episode_number} - ${ep.name}`,
                            description: ep.overview || "",
                            image: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : "",
                            href: `stream|tv|${id}|${sNum}|${ep.episode_number}`
                        });
                    });
                } catch (err) {}
            }
        }
        return JSON.stringify(episodes);
    } catch (e) {
        return JSON.stringify([]);
    }
}

// ==========================================
// 🛠️ FONCTIONS UTILITAIRES & RESOLVEURS
// ==========================================

const _atob = (str) => {
    try {
        if (typeof atob === 'function') return atob(str);
        return Buffer.from(str, 'base64').toString('binary');
    } catch (e) { return str; }
};

class Unbaser {
    constructor(base) {
        this.ALPHABET = {
            62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            95: " !\"#$%&\\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
        };
        this.dictionary = {};
        this.base = base;
        if (36 < base && base < 62) {
            this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
        }
        if (2 <= base && base <= 36) {
            this.unbase = (value) => parseInt(value, base);
        } else {
            try {
                [...this.ALPHABET[base]].forEach((cipher, index) => {
                    this.dictionary[cipher] = index;
                });
            } catch (er) { }
            this.unbase = this._dictunbaser.bind(this);
        }
    }
    _dictunbaser(value) {
        let ret = 0;
        [...value].reverse().forEach((cipher, index) => {
            ret = ret + ((Math.pow(this.base, index)) * this.dictionary[cipher]);
        });
        return ret;
    }
}

function unpack(code) {
    let result = code;
    try {
        const scriptRegex = /eval\s*\(\s*function\s*\([\s\S]*?split\(['"]\|['"]\).*?\)\s*\)/g;
        let match;
        
        while ((match = scriptRegex.exec(code)) !== null) {
            console.log("[Movix] 📦 Code Packer obfusqué détecté ! Démarrage du décodeur...");
            let block = match[0];
            
            const splitRegex = /,\s*(\d+|\[\])\s*,\s*(\d+)\s*,\s*['"]([^'"]*?)['"]\.split\(['"]\|['"]\)/;
            const endMatch = block.match(splitRegex);
            
            if (!endMatch) {
                console.log("[Movix] ⚠️ Échec de l'extraction des clés du packer.");
                continue;
            }
            
            let radix = parseInt(endMatch[1]);
            if (isNaN(radix)) radix = 62;
            let count = parseInt(endMatch[2]);
            let symtab = endMatch[3].split('|');
            
            let pre = block.substring(0, endMatch.index);
            const payloadStartRegex = /\}\s*\(\s*['"]/;
            const startMatch = pre.match(payloadStartRegex);
            if (!startMatch) {
                console.log("[Movix] ⚠️ Impossible de trouver le début du payload.");
                continue;
            }
            
            let payloadStartIndex = startMatch.index + startMatch[0].length;
            let payloadStr = pre.substring(payloadStartIndex);
            payloadStr = payloadStr.replace(/['"]\s*$/, ''); 
            let payload = payloadStr.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
            
            let unbase;
            try { unbase = new Unbaser(radix); } catch(e) { 
                console.log("[Movix] ⚠️ Erreur lors de l'Unbaser:", e.message);
                continue; 
            }
            
            function lookup(word) {
                let word2;
                if (radix == 1) word2 = symtab[parseInt(word)];
                else word2 = symtab[unbase.unbase(word)];
                return word2 || word;
            }
            
            const unpacked = payload.replace(/\b\w+\b/g, lookup);
            console.log(`[Movix] 🔓 Décompression réussie ! (Radix: ${radix})`);
            result = result.replace(block, unpacked);
        }
    } catch (err) {
        console.log("[Movix] 🚨 Crash de la fonction unpack :", err);
    }
    return result;
}

// ==========================================
// 🔓 LE PERCEUR DE COFFRE-FORT VOE
// ==========================================
function voeRot13(str) {
    return str.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}
function voeRemovePatterns(str) {
    const patterns = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
    let result = str;
    for (const pat of patterns) result = result.split(pat).join("");
    return result;
}
function voeShiftChars(str, shift) {
    return str.split("").map((c) => String.fromCharCode(c.charCodeAt(0) - shift)).join("");
}
function voeExtractor(html) {
    try {
        const jsonScriptMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (!jsonScriptMatch) return null;
        const data = JSON.parse(jsonScriptMatch[1].trim());
        if (!Array.isArray(data) || typeof data[0] !== "string") return null;
        
        let step1 = voeRot13(data[0]);
        let step2 = voeRemovePatterns(step1);
        let step3 = _atob(step2);
        let step4 = voeShiftChars(step3, 3);
        let step5 = step4.split("").reverse().join("");
        let step6 = _atob(step5);
        let result = JSON.parse(step6);
        
        if (result && typeof result === "object") {
            return result.direct_access_url || (result.source && result.source.map(s => s.direct_access_url).find(url => url && url.startsWith("http"))) || null;
        }
    } catch (e) {}
    return null;
}

// ==========================================
// 🚀 LE GRAND RESOLVEUR UNIFIÉ
// ==========================================
async function resolveAnyLink(url, sourceName, lang) {
    const urlLower = url.toLowerCase();
    const sourceLower = (sourceName || "").toLowerCase();
    let finalUrl = url;
    let headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" };
    let isDirect = false;

    console.log(`[Movix] ⚙️ Tentative de résolution pour : [${lang}] ${sourceName} -> ${url}`);

    try {
        // 🌟 Détection Vidhide / Vidmoly / Movearnpre / FILEMOON
        if (urlLower.includes('vidmoly.') || urlLower.includes('vidhide') || urlLower.includes('movearnpre') || urlLower.includes('smoothpre') || urlLower.includes('filemoon') || urlLower.includes('lukefirst') || sourceLower.includes('vidmoly') || sourceLower.includes('vidhide') || sourceLower.includes('filemoon')) {
            console.log(`[Movix] 🛡️ Décodage Vidmoly/Vidhide/Filemoon en cours...`);
            let fetchUrl = url;
            if (url.includes('vidmoly')) fetchUrl = url.replace(/vidmoly\.(net|to|ru|is)/, 'vidmoly.me');
            if (url.includes('filemoon')) fetchUrl = url.replace(/filemoon\.(sx|to|is)/, 'filemoon.sx');
            if (fetchUrl.includes('/embed/')) fetchUrl = fetchUrl.replace('/embed/', '/e/');
            
            headers = { 
                'Referer': url, 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
            };
            
            let res = await fetchv2(fetchUrl, headers, "GET");
            let html = typeof res === "string" ? res : await res.text();
            
            let unpackCount = 0;
            while (html.match(/eval\s*\(\s*function/i) && unpackCount < 3) {
                console.log(`[Movix] 🔄 Lancement de la boucle de décompression (${unpackCount + 1})...`);
                let unpackedHtml = unpack(html);
                if (unpackedHtml === html) {
                    console.log(`[Movix] ℹ️ Le code n'a pas changé, fin de la décompression.`);
                    break;
                }
                html = unpackedHtml;
                unpackCount++;
            }
            
            const match = html.match(/(?:["']?(?:file|hls|hls2|hls3|hls4|src|url)["']?)\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || 
                          html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i) ||
                          html.match(/(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*)/i);
                          
            if (match) { 
                finalUrl = match[1]; 
                isDirect = true; 
                console.log(`[Movix] ⚡ Succès Vidmoly/Vidhide : Lien direct trouvé ! -> ${finalUrl.substring(0, 40)}...`);
            } else {
                console.log(`[Movix] ⚠️ Échec Vidmoly/Vidhide : Aucun lien direct trouvé.`);
            }
        } 
        // 🌟 Détection Uqload
        else if (urlLower.includes('uqload.') || sourceLower === 'uqload') {
            console.log(`[Movix] 🛡️ Décodage Uqload en cours...`);
            let res = await fetchv2(url, { "User-Agent": "Mozilla/5.0", "Referer": "https://uqload.is/" }, "GET");
            let html = typeof res === "string" ? res : await res.text();
            
            const match = html.match(/sources\s*:\s*\[\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
            if (match) {
                finalUrl = match[1]; isDirect = true; 
                headers = { "Referer": url, "User-Agent": "Mozilla/5.0" };
            }
        }
        // 🌟 Détection Vidoza
        else if (urlLower.includes('vidoza.') || sourceLower === 'vidoza') {
            console.log(`[Movix] 🛡️ Décodage Vidoza en cours...`);
            let res = await fetchv2(url, { "User-Agent": "Mozilla/5.0" }, "GET");
            let html = typeof res === "string" ? res : await res.text();
            
            const match = html.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i) || html.match(/(https?:\/\/[^"']+\.mp4)/i);
            if (match) {
                finalUrl = match[1]; isDirect = true; 
                headers = { "Referer": url, "User-Agent": "Mozilla/5.0" };
            }
        }
        // 🌟 Détection Sendvid
        else if (urlLower.includes('sendvid.') || sourceLower === 'sendvid') {
            const embedUrl = url.includes('/embed/') ? url : url.replace(/sendvid\.com\/([a-z0-9]+)/i, 'sendvid.com/embed/$1');
            headers = { 'Referer': 'https://sendvid.com/' };
            let res = await fetchv2(embedUrl, headers, "GET");
            let html = typeof res === "string" ? res : await res.text();
            
            const match = html.match(/video_source\s*:\s*["']([^"']+\.mp4[^"']*)["|']/) || html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/);
            if (match) { finalUrl = match[1]; isDirect = true; }
        }
        // 🌟 Détection Doodstream / Doply
        else if (urlLower.includes('dood') || urlLower.includes('doply') || urlLower.includes('myvidplay') || sourceLower.includes('dood')) {
            console.log(`[Movix] 🛡️ Décodage Doodstream en cours...`);
            let res = await fetchv2(url, { "User-Agent": "Mozilla/5.0", "Referer": url }, "GET");
            let html = typeof res === "string" ? res : await res.text();
            
            const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (iframeMatch && (iframeMatch[1].includes('dood') || iframeMatch[1].includes('myvidplay'))) {
                url = iframeMatch[1].startsWith('http') ? iframeMatch[1] : 'https:' + iframeMatch[1];
                res = await fetchv2(url, { "User-Agent": "Mozilla/5.0", "Referer": url }, "GET");
                html = typeof res === "string" ? res : await res.text();
            }

            const passMd5Match = html.match(/\/pass_md5\/([^"']+)/i);
            const tokenMatch = html.match(/[?&]token=([a-z0-9]+)[&'"]/i);

            if (passMd5Match && tokenMatch) {
                const md5Url = url.match(/^https?:\/\/[^\/]+/)[0] + '/pass_md5/' + passMd5Match[1];
                let md5Res = await fetchv2(md5Url, { "User-Agent": "Mozilla/5.0", "Referer": url }, "GET");
                let videoBaseUrl = typeof md5Res === "string" ? md5Res : await md5Res.text();

                finalUrl = `${videoBaseUrl}${Math.random().toString(36).substring(2, 12)}?token=${tokenMatch[1]}&expiry=${Date.now()}`;
                isDirect = true;
                headers = { "Referer": url.match(/^https?:\/\/[^\/]+/)[0] + "/", "User-Agent": "Mozilla/5.0" };
            }
        }
        // 🌟 Détection Voe
        else if ((urlLower.includes('voe.') || urlLower.includes('dingtezuni') || urlLower.includes('ralphysuccessfull') || sourceLower === 'voe') && !sourceLower.includes('vidhide')) { 
            console.log(`[Movix] 🛡️ Décodage Voe en cours...`);
            let voeHeaders = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": url,
                "x-Requested-With": "XMLHttpRequest"
            };

            let currentUrl = url;
            let res = await fetchv2(currentUrl, voeHeaders, "GET");
            let html = typeof res === "string" ? res : await res.text();
            
            const titleMatch = html.match(/<title>(.*?)<\/title>/i);
            if (titleMatch && titleMatch[1].toLowerCase().includes("redirect")) {
                const match = html.match(/window\.location\.href\s*=\s*["'](.*?)["']/i);
                if (match && match[1]) {
                    currentUrl = match[1];
                    voeHeaders['Referer'] = currentUrl;
                    let res2 = await fetchv2(currentUrl, voeHeaders, "GET");
                    html = typeof res2 === "string" ? res2 : await res2.text();
                }
            }

            let extractedVoeUrl = voeExtractor(html);
            if (extractedVoeUrl) {
                finalUrl = extractedVoeUrl; headers = voeHeaders; isDirect = true;
            } else {
                let unpackedHtml = unpack(html);
                const fbMatch = unpackedHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
                if (fbMatch) {
                    finalUrl = fbMatch[1]; headers = voeHeaders; isDirect = true;
                }
            }
        }
        // 🌟 Détection Sibnet
        else if (urlLower.includes('sibnet.') || sourceLower === 'sibnet') {
            console.log(`[Movix] 📡 Extraction directe Sibnet...`);
            let res = await fetchv2(url, { "Referer": "https://video.sibnet.ru/" }, "GET");
            let html = typeof res === "string" ? res : await res.text();
            
            const match = html.match(/src\s*:\s*["']([^"']*\.mp4[^"']*)['"]/i) || html.match(/["']((?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i);
            
            if (match && match[1]) {
                let videoUrl = match[1].startsWith('//') ? "https:" + match[1] : (match[1].startsWith('/') ? "https://video.sibnet.ru" + match[1] : match[1]);
                
                finalUrl = videoUrl; 
                isDirect = true; 
                headers = { "Referer": url, "User-Agent": "Mozilla/5.0" }; 

                // 🌟 LE CORRECTIF : Résolution manuelle de la redirection anti-hotlink
                try {
                    console.log(`[Movix] 🔄 Suivi de la redirection Sibnet en cours...`);
                    const resolveOptions = Object.assign({}, headers, { redirect: "manual" });
                    const resolveRes = await fetchv2(finalUrl, resolveOptions, "GET");
                    
                    let locationHeader = null;
                    if (resolveRes && resolveRes.headers) {
                        if (typeof resolveRes.headers.get === 'function') {
                            locationHeader = resolveRes.headers.get('location') || resolveRes.headers.get('Location');
                        } else {
                            locationHeader = resolveRes.headers['location'] || resolveRes.headers['Location'];
                        }
                    }

                    if (locationHeader) {
                        finalUrl = locationHeader.startsWith('//') ? 'https:' + locationHeader : locationHeader;
                        console.log(`[Movix] ⚡ Vrai lien Sibnet trouvé (Contournement réussi) !`);
                    } else if (resolveRes && resolveRes.url && resolveRes.url !== finalUrl) {
                        finalUrl = resolveRes.url;
                    } 
                } catch (e) {
                    console.log(`[Movix] ⚠️ Erreur lors de la redirection Sibnet : ${e.message}`);
                }
            }
        }
        else if (urlLower.includes('.mp4') || urlLower.includes('.m3u8')) {
            isDirect = true;
        }

        return { title: `[${lang}] ${sourceName} ${isDirect ? '(Direct ⚡)' : '(Web)'}`, streamUrl: finalUrl, headers: headers };
    } catch (e) {
        return { title: `[${lang}] ${sourceName} (Web)`, streamUrl: url, headers: headers };
    }
}

// --- 4. EXTRACTION DES LIENS (L'Intelligence Hybride 🧠) ---
async function extractStreamUrl(href) {
    console.log(`[Movix] 🎬 Lancement de l'extraction pour : ${href}`);
    try {
        const parts = href.split('|');
        const type = parts[1]; const id = parts[2]; const s = parts[3]; const e = parts[4]; 
        const streams = [];
        let rawLinks = []; 

        // 🌟 LE DÉGUISEMENT PARFAIT POUR L'API MOVIX 🌟
        const movixHeaders = { 
            "Origin": "https://movix.blog",
            "Referer": "https://movix.blog/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
        };

        console.log(`[Movix] 📡 Appel de l'API TMDB pour l'ID: ${id}`);
        const tmdbUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR&append_to_response=alternative_titles,external_ids`;
        const resTmdb = await fetchv2(tmdbUrl, {}, "GET");
        const tmdbDetails = JSON.parse(typeof resTmdb === "string" ? resTmdb : await resTmdb.text());
        
        const isAnime = type === 'tv' && tmdbDetails.original_language === 'ja';

        if (isAnime) {
            console.log(`[Movix] 🌸 Anime détecté ! Lancement de l'algorithme anti-regroupement...`);
            let searchName = tmdbDetails.name;
            let titlesToTry = [searchName]; 
            if (tmdbDetails.original_name) titlesToTry.push(tmdbDetails.original_name);
            
            // 💡 Extraction de la franchise parente (SAO, Naruto...)
            if (searchName.includes(':')) titlesToTry.push(searchName.split(':')[0].trim());
            if (searchName.includes('-')) titlesToTry.push(searchName.split('-')[0].trim());
            
            const words = searchName.split(' ');
            if (words.length >= 3) {
                titlesToTry.push(words.slice(0, 2).join(' ')); 
                titlesToTry.push(words.slice(0, 3).join(' ')); 
            }
            
            if (tmdbDetails.alternative_titles && tmdbDetails.alternative_titles.results) {
                tmdbDetails.alternative_titles.results.forEach(alt => {
                    if (alt.title.match(/^[a-zA-Z0-9\s\-:.,]+$/)) titlesToTry.push(alt.title);
                });
            }
            
            let finalTitles = [...new Set(titlesToTry)];

            let animeDataFound = null;
            for (const t of finalTitles) {
                try {
                    const searchUrl = `https://api.movix.blog/anime/search/${encodeURIComponent(t)}?includeSeasons=true&includeEpisodes=true`;
                    const aRes = await fetchv2(searchUrl, movixHeaders, "GET");
                    const parsed = JSON.parse(typeof aRes === "string" ? aRes : await aRes.text());
                    if (Array.isArray(parsed) && parsed.length > 0) { 
                        const withSeasons = parsed.filter(item => item.seasons && item.seasons.length > 0);
                        
                        let bestMatch = withSeasons.find(item => item.title && item.title.toLowerCase() === t.toLowerCase());
                        if (!bestMatch) bestMatch = withSeasons.find(item => item.title && item.title.toLowerCase().includes(t.toLowerCase()));
                        if (!bestMatch && withSeasons.length > 0) bestMatch = withSeasons[0];

                        if (bestMatch) { 
                            animeDataFound = bestMatch; 
                            console.log(`[Movix] 📚 Fichier Anime global trouvé : ${animeDataFound.title}`);
                            break; 
                        }
                    }
                } catch (err) {}
            }

            if (animeDataFound && animeDataFound.seasons) {
                let seasonObj = null;
                const searchNameLower = searchName.toLowerCase();
                
                if (searchNameLower.includes(':') || searchNameLower.includes('-')) {
                    const keywords = searchNameLower.split(/[:\-]/).map(k => k.trim()).filter(k => k.length > 3);
                    for (const sea of animeDataFound.seasons) {
                        const seaNameLower = sea.name.toLowerCase();
                        if (keywords.some(k => seaNameLower.includes(k) && k !== searchNameLower)) {
                            seasonObj = sea;
                            console.log(`[Movix] 🎯 Spin-off détecté ! Saison trouvée : ${sea.name}`);
                            break;
                        }
                    }
                } else {
                    for (const sea of animeDataFound.seasons) {
                        if (sea.name.toLowerCase().includes(searchNameLower) && searchNameLower !== animeDataFound.title.toLowerCase()) {
                            seasonObj = sea;
                            console.log(`[Movix] 🎯 Suite détectée ! Saison trouvée : ${sea.name}`);
                            break;
                        }
                    }
                }

                if (!seasonObj) {
                    seasonObj = animeDataFound.seasons.find(sea => {
                        const sn = sea.name.toLowerCase();
                        return sn === `saison ${s}` || sn === `season ${s}`;
                    });
                }

                if (!seasonObj) {
                    seasonObj = animeDataFound.seasons[s - 1];
                }

                if (seasonObj && seasonObj.episodes) {
                    const epObj = seasonObj.episodes.find(ep => ep.index === parseInt(e)) || seasonObj.episodes[parseInt(e) - 1];
                    if (epObj && epObj.streaming_links) {
                        epObj.streaming_links.forEach(linkObj => {
                            const lang = (linkObj.language || "vostfr").toUpperCase();
                            linkObj.players.forEach(url => {
                                if (url.includes("anime-sama.fr/videos") || url.includes("s22.anime-sama.fr")) return;

                                let server = "Inconnu";
                                const urlLowerForServer = url.toLowerCase();
                                if (urlLowerForServer.includes("sibnet")) server = "Sibnet";
                                else if (urlLowerForServer.includes("sendvid")) server = "Sendvid";
                                else if (urlLowerForServer.includes("vidmoly")) server = "Vidmoly";
                                else if (urlLowerForServer.includes("movearnpre") || urlLowerForServer.includes("vidhide") || urlLowerForServer.includes("smoothpre")) server = "Vidhide";
                                else if (urlLowerForServer.includes("voe") || urlLowerForServer.includes("dingtezuni")) server = "Voe";
                                else if (urlLowerForServer.includes("dood") || urlLowerForServer.includes("doply")) server = "Doodstream";
                                
                                rawLinks.push({ url, server, lang });
                            });
                        });
                    }
                }
            }
        }

        // 🌟 NOUVEAU BLOC : L'API UNIQUE POUR TOUT LE RESTE
        if (!isAnime || rawLinks.length === 0) {
            console.log(`[Movix] 🎬 Lancement de l'API Globale TMDB...`);
            try {
                let apiUrl = type === 'movie' 
                    ? `https://api.movix.blog/api/tmdb/movie/${id}` 
                    : `https://api.movix.blog/api/tmdb/tv/${id}?season=${s}&episode=${e}`;
                    
                console.log(`[Movix] 🔍 Scan de la source TMDB : ${apiUrl}`);
                const resApi = await fetchv2(apiUrl, movixHeaders, "GET");
                const dataApi = JSON.parse(typeof resApi === "string" ? resApi : await resApi.text());

                let targetLinks = [];
                if (dataApi.player_links && Array.isArray(dataApi.player_links)) {
                    targetLinks = dataApi.player_links;
                } else if (dataApi.current_episode && dataApi.current_episode.player_links && Array.isArray(dataApi.current_episode.player_links)) {
                    targetLinks = dataApi.current_episode.player_links;
                }

                if (targetLinks.length > 0) {
                    targetLinks.forEach(link => {
                        if (link.decoded_url) {
                            let serverName = link.quality ? link.quality.split('/')[0].trim() : "Inconnu";
                            let langStr = (link.language || "").toLowerCase();
                            let formattedLang = langStr.includes('vost') ? 'VOSTFR' : 'VF';
                            
                            rawLinks.push({ 
                                url: link.decoded_url, 
                                server: serverName, 
                                lang: formattedLang 
                            });
                        }
                    });
                } else {
                    console.log(`[Movix] ⚠️ Aucun lien trouvé dans player_links`);
                }
            } catch (err) {
                console.log(`[Movix] 🚨 Erreur API Globale :`, err);
            }
        }

        console.log(`[Movix] ⚡ Lancement du Super Resolveur sur ${rawLinks.length} liens bruts...`);
        for (const raw of rawLinks) {
            const resolvedStream = await resolveAnyLink(raw.url, raw.server, raw.lang);
            streams.push(resolvedStream);
        }

        console.log(`[Movix] 🍿 Fin de l'extraction. Total des liens récupérés : ${streams.length}`);
        return JSON.stringify({ streams });
    } catch (err) {
        console.log(`[Movix] 🚨 Crash global dans extractStreamUrl : ${err}`);
        return JSON.stringify({ streams: [] });
    }
}
