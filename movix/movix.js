// ==========================================
// MODULE MOVIX (Recherche TMDB -> Streams Hybrides)
// ==========================================

const TMDB_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";

// --- NOUVEAU : FONCTION DE FETCH SÉCURISÉE SORA ---
async function soraFetchText(url, headers = {}, method = 'GET') {
    console.log(`[Movix Network] 🌐 Requete : ${url}`);
    try {
        let res;
        if (typeof fetchv2 !== 'undefined') {
            res = await fetchv2(url, headers, method);
        } else {
            res = await fetch(url, { method, headers });
        }
        let text = typeof res === "string" ? res : await res.text();
        return text;
    } catch (error) {
        console.log(`[Movix Network] 🚨 Erreur sur ${url} : ${error.message}`);
        throw error;
    }
}

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    console.log(`[Movix] 🔍 Recherche TMDB pour : "${keyword}"`);
    try {
        const types = ['movie', 'tv'];
        let allResults = [];

        const promises = types.map(async type => {
            const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(keyword)}&language=fr-FR`;
            const text = await soraFetchText(url);
            return JSON.parse(text);
        });

        const results = await Promise.allSettled(promises);
        const movieData = results[0].status === 'fulfilled' ? results[0].value : { results: [] };
        const tvData = results[1].status === 'fulfilled' ? results[1].value : { results: [] };

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
        console.log(`[Movix] ✅ Recherche terminée. ${allResults.length} résultats trouvés.`);
        return JSON.stringify(allResults);
    } catch (e) {
        console.log(`[Movix] 🚨 Erreur critique dans searchResults: ${e.message}`);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(rawHref) {
    // ⚠️ CORRECTIF CRUCIAL: Décoder l'URL car Sora encode les | en %7C
    const href = decodeURIComponent(rawHref);
    console.log(`[Movix] 📂 Détails demandés pour : ${href} (Brut: ${rawHref})`);
    
    try {
        const parts = href.split('|');
        if (parts.length < 3) {
            console.log(`[Movix] 🚨 Erreur de découpage de l'URL des détails! Href: ${href}`);
            throw new Error("Lien malformé");
        }

        const type = parts[1]; 
        const id = parts[2];
        console.log(`[Movix] 📂 Type: ${type}, ID: ${id}`);

        const detailsUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR`;
        const text = await soraFetchText(detailsUrl);
        const details = JSON.parse(text);

        console.log(`[Movix] ✅ Détails récupérés avec succès.`);
        
        // ⚠️ CORRECTIF CRUCIAL: Sora attend un TABLEAU [...] pour les détails
        return JSON.stringify([{
            description: details.overview || "Aucune description disponible pour ce contenu.",
            aliases: type === "movie" ? `Durée: ${details.runtime || '?'} min` : `Saisons: ${details.number_of_seasons || '?'}`,
            airdate: `Date de sortie: ${details.release_date || details.first_air_date || 'Inconnue'}`
        }]);
    } catch (e) {
        console.log(`[Movix] 🚨 Erreur dans extractDetails: ${e.message}`);
        return JSON.stringify([{ description: "Erreur lors du chargement des détails." }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(rawHref) {
    // ⚠️ CORRECTIF CRUCIAL: Décoder l'URL
    const href = decodeURIComponent(rawHref);
    console.log(`[Movix] 📺 Épisodes demandés pour : ${href}`);
    
    try {
        const parts = href.split('|');
        const type = parts[1]; 
        const id = parts[2];
        let episodes = [];

        const detailsUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR`;
        const text = await soraFetchText(detailsUrl);
        const details = JSON.parse(text);

        if (type === 'movie') {
            console.log(`[Movix] 📺 Mode Film activé`);
            episodes.push({
                number: 1,
                episode: 1, 
                season: 1,  
                title: details.title || "Le Film",
                description: details.overview || "",
                image: details.backdrop_path ? `https://image.tmdb.org/t/p/w500${details.backdrop_path}` : "",
                href: `stream|movie|${id}`,
                url: `stream|movie|${id}` 
            });
        } else if (type === 'tv') {
            console.log(`[Movix] 📺 Mode Série activé. Nombre de saisons: ${details.seasons ? details.seasons.length : 0}`);
            for (const season of details.seasons) {
                const sNum = season.season_number;
                if (sNum === 0) continue; 

                const seasonUrl = `https://api.themoviedb.org/3/tv/${id}/season/${sNum}?api_key=${TMDB_KEY}&language=fr-FR`;
                try {
                    const sText = await soraFetchText(seasonUrl);
                    const sData = JSON.parse(sText);

                    sData.episodes.forEach(ep => {
                        episodes.push({
                            number: ep.episode_number,
                            episode: ep.episode_number, 
                            season: sNum,
                            title: `S${sNum}E${ep.episode_number} - ${ep.name}`,
                            description: ep.overview || "",
                            image: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : "",
                            href: `stream|tv|${id}|${sNum}|${ep.episode_number}`,
                            url: `stream|tv|${id}|${sNum}|${ep.episode_number}` 
                        });
                    });
                } catch (err) {
                    console.log(`[Movix] ⚠️ Erreur récupération saison ${sNum} : ${err.message}`);
                }
            }
        }
        
        console.log(`[Movix] ✅ Extraction épisodes terminée : ${episodes.length} épisodes trouvés.`);
        return JSON.stringify(episodes);
    } catch (e) {
        console.log(`[Movix] 🚨 Erreur critique dans extractEpisodes: ${e.message}`);
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
            let block = match[0];
            const splitRegex = /,\s*(\d+|\[\])\s*,\s*(\d+)\s*,\s*['"]([^'"]*?)['"]\.split\(['"]\|['"]\)/;
            const endMatch = block.match(splitRegex);
            if (!endMatch) continue;
            let radix = parseInt(endMatch[1]);
            if (isNaN(radix)) radix = 62;
            let count = parseInt(endMatch[2]);
            let symtab = endMatch[3].split('|');
            let pre = block.substring(0, endMatch.index);
            const payloadStartRegex = /\}\s*\(\s*['"]/;
            const startMatch = pre.match(payloadStartRegex);
            if (!startMatch) continue;
            let payloadStartIndex = startMatch.index + startMatch[0].length;
            let payloadStr = pre.substring(payloadStartIndex);
            payloadStr = payloadStr.replace(/['"]\s*$/, ''); 
            let payload = payloadStr.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
            let unbase;
            try { unbase = new Unbaser(radix); } catch(e) { continue; }
            function lookup(word) {
                let word2;
                if (radix == 1) word2 = symtab[parseInt(word)];
                else word2 = symtab[unbase.unbase(word)];
                return word2 || word;
            }
            const unpacked = payload.replace(/\b\w+\b/g, lookup);
            result = result.replace(block, unpacked);
        }
    } catch (err) {}
    return result;
}

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

    console.log(`[Movix] ⚙️ Tentative de résolution : [${lang}] ${sourceName} -> ${url}`);

    try {
        if (urlLower.includes('vidmoly.') || urlLower.includes('vidhide') || urlLower.includes('movearnpre') || urlLower.includes('smoothpre') || urlLower.includes('filemoon') || urlLower.includes('lukefirst') || sourceLower.includes('vidmoly') || sourceLower.includes('vidhide') || sourceLower.includes('filemoon')) {
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
            
            let html = await soraFetchText(fetchUrl, headers, "GET");
            
            let unpackCount = 0;
            while (html.match(/eval\s*\(\s*function/i) && unpackCount < 3) {
                let unpackedHtml = unpack(html);
                if (unpackedHtml === html) break;
                html = unpackedHtml;
                unpackCount++;
            }
            
            const match = html.match(/(?:["']?(?:file|hls|hls2|hls3|hls4|src|url)["']?)\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || 
                          html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i) ||
                          html.match(/(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*)/i);
                          
            if (match) { finalUrl = match[1]; isDirect = true; }
        } 
        else if (urlLower.includes('uqload.') || sourceLower === 'uqload') {
            let html = await soraFetchText(url, { "User-Agent": "Mozilla/5.0", "Referer": "https://uqload.is/" }, "GET");
            const match = html.match(/sources\s*:\s*\[\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
            if (match) { finalUrl = match[1]; isDirect = true; headers = { "Referer": url, "User-Agent": "Mozilla/5.0" }; }
        }
        else if (urlLower.includes('vidoza.') || sourceLower === 'vidoza') {
            let html = await soraFetchText(url, { "User-Agent": "Mozilla/5.0" }, "GET");
            const match = html.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i) || html.match(/(https?:\/\/[^"']+\.mp4)/i);
            if (match) { finalUrl = match[1]; isDirect = true; headers = { "Referer": url, "User-Agent": "Mozilla/5.0" }; }
        }
        else if (urlLower.includes('sendvid.') || sourceLower === 'sendvid') {
            const embedUrl = url.includes('/embed/') ? url : url.replace(/sendvid\.com\/([a-z0-9]+)/i, 'sendvid.com/embed/$1');
            let html = await soraFetchText(embedUrl, { 'Referer': 'https://sendvid.com/' }, "GET");
            const match = html.match(/video_source\s*:\s*["']([^"']+\.mp4[^"']*)["|']/) || html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/);
            if (match) { finalUrl = match[1]; isDirect = true; headers = { 'Referer': 'https://sendvid.com/' }; }
        }
        else if (urlLower.includes('dood') || urlLower.includes('doply') || urlLower.includes('myvidplay') || sourceLower.includes('dood')) {
            let html = await soraFetchText(url, { "User-Agent": "Mozilla/5.0", "Referer": url }, "GET");
            const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (iframeMatch && (iframeMatch[1].includes('dood') || iframeMatch[1].includes('myvidplay'))) {
                url = iframeMatch[1].startsWith('http') ? iframeMatch[1] : 'https:' + iframeMatch[1];
                html = await soraFetchText(url, { "User-Agent": "Mozilla/5.0", "Referer": url }, "GET");
            }
            const passMd5Match = html.match(/\/pass_md5\/([^"']+)/i);
            const tokenMatch = html.match(/[?&]token=([a-z0-9]+)[&'"]/i);
            if (passMd5Match && tokenMatch) {
                const md5Url = url.match(/^https?:\/\/[^\/]+/)[0] + '/pass_md5/' + passMd5Match[1];
                let videoBaseUrl = await soraFetchText(md5Url, { "User-Agent": "Mozilla/5.0", "Referer": url }, "GET");
                finalUrl = `${videoBaseUrl}${Math.random().toString(36).substring(2, 12)}?token=${tokenMatch[1]}&expiry=${Date.now()}`;
                isDirect = true;
                headers = { "Referer": url.match(/^https?:\/\/[^\/]+/)[0] + "/", "User-Agent": "Mozilla/5.0" };
            }
        }
        else if ((urlLower.includes('voe.') || urlLower.includes('dingtezuni') || urlLower.includes('ralphysuccessfull') || sourceLower === 'voe') && !sourceLower.includes('vidhide')) { 
            let voeHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": url, "x-Requested-With": "XMLHttpRequest" };
            let currentUrl = url;
            let html = await soraFetchText(currentUrl, voeHeaders, "GET");
            
            const titleMatch = html.match(/<title>(.*?)<\/title>/i);
            if (titleMatch && titleMatch[1].toLowerCase().includes("redirect")) {
                const match = html.match(/window\.location\.href\s*=\s*["'](.*?)["']/i);
                if (match && match[1]) {
                    currentUrl = match[1];
                    voeHeaders['Referer'] = currentUrl;
                    html = await soraFetchText(currentUrl, voeHeaders, "GET");
                }
            }
            let extractedVoeUrl = voeExtractor(html);
            if (extractedVoeUrl) {
                finalUrl = extractedVoeUrl; headers = voeHeaders; isDirect = true;
            } else {
                let unpackedHtml = unpack(html);
                const fbMatch = unpackedHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
                if (fbMatch) { finalUrl = fbMatch[1]; headers = voeHeaders; isDirect = true; }
            }
        }
        else if (urlLower.includes('sibnet.') || sourceLower === 'sibnet') {
            let html = await soraFetchText(url, { "Referer": "https://video.sibnet.ru/" }, "GET");
            const match = html.match(/src\s*:\s*["']([^"']*\.mp4[^"']*)['"]/i) || html.match(/["']((?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i);
            if (match && match[1]) {
                let videoUrl = match[1].startsWith('//') ? "https:" + match[1] : (match[1].startsWith('/') ? "https://video.sibnet.ru" + match[1] : match[1]);
                finalUrl = videoUrl; 
                isDirect = true; 
                headers = { "Referer": url, "User-Agent": "Mozilla/5.0" }; 
                try {
                    const resolveOptions = Object.assign({}, headers, { redirect: "manual" });
                    const resolveRes = await soraFetchText(finalUrl, resolveOptions, "GET"); // Sera attrapé par fetch
                } catch (e) {
                    // Ignoré, gestion très complexe des headers manuels dans un wrapper web
                }
            }
        }
        else if (urlLower.includes('.mp4') || urlLower.includes('.m3u8')) {
            isDirect = true;
        }

        console.log(`[Movix] ⚡ Terminé : ${isDirect ? '(Direct)' : '(Web)'} ${finalUrl.substring(0, 30)}...`);
        return { title: `[${lang}] ${sourceName} ${isDirect ? '(Direct ⚡)' : '(Web)'}`, streamUrl: finalUrl, headers: headers };
    } catch (e) {
        console.log(`[Movix] ⚠️ Echec résolution ResolveAnyLink: ${e.message}`);
        return { title: `[${lang}] ${sourceName} (Web)`, streamUrl: url, headers: headers };
    }
}

// --- 4. EXTRACTION DES LIENS (L'Intelligence Hybride 🧠) ---
async function extractStreamUrl(rawHref) {
    // ⚠️ CORRECTIF CRUCIAL: Décoder l'URL
    const href = decodeURIComponent(rawHref);
    console.log(`[Movix] 🎬 Lancement de l'extraction Stream pour : ${href}`);
    
    try {
        const parts = href.split('|');
        const type = parts[1]; const id = parts[2]; const s = parts[3]; const e = parts[4]; 
        const streams = [];
        let rawLinks = []; 

        const movixHeaders = { 
            "Origin": "https://movix.blog",
            "Referer": "https://movix.blog/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
        };

        const tmdbUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR&append_to_response=alternative_titles,external_ids`;
        const tmdbText = await soraFetchText(tmdbUrl);
        const tmdbDetails = JSON.parse(tmdbText);
        
        const isAnime = type === 'tv' && tmdbDetails.original_language === 'ja';

        if (isAnime) {
            console.log(`[Movix] 🌸 Logiciel Anime activé`);
            let searchName = tmdbDetails.name;
            let titlesToTry = [searchName]; 
            if (tmdbDetails.original_name) titlesToTry.push(tmdbDetails.original_name);
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
                    const aText = await soraFetchText(searchUrl, movixHeaders, "GET");
                    const parsed = JSON.parse(aText);
                    
                    if (Array.isArray(parsed) && parsed.length > 0) { 
                        const withSeasons = parsed.filter(item => item.seasons && item.seasons.length > 0);
                        let bestMatch = withSeasons.find(item => item.title && item.title.toLowerCase() === t.toLowerCase());
                        if (!bestMatch) bestMatch = withSeasons.find(item => item.title && item.title.toLowerCase().includes(t.toLowerCase()));
                        if (!bestMatch && withSeasons.length > 0) bestMatch = withSeasons[0];

                        if (bestMatch) { 
                            animeDataFound = bestMatch; 
                            console.log(`[Movix] 📚 Correspondance Anime trouvée : ${animeDataFound.title}`);
                            break; 
                        }
                    }
                } catch (err) {
                    console.log(`[Movix] ⚠️ Erreur scan anime: ${err.message}`);
                }
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
                            break;
                        }
                    }
                } else {
                    for (const sea of animeDataFound.seasons) {
                        if (sea.name.toLowerCase().includes(searchNameLower) && searchNameLower !== animeDataFound.title.toLowerCase()) {
                            seasonObj = sea;
                            break;
                        }
                    }
                }

                if (!seasonObj) seasonObj = animeDataFound.seasons.find(sea => sea.name.toLowerCase() === `saison ${s}` || sea.name.toLowerCase() === `season ${s}`);
                if (!seasonObj) seasonObj = animeDataFound.seasons[s - 1];

                if (seasonObj && seasonObj.episodes) {
                    const epObj = seasonObj.episodes.find(ep => ep.index === parseInt(e)) || seasonObj.episodes[parseInt(e) - 1];
                    if (epObj && epObj.streaming_links) {
                        epObj.streaming_links.forEach(linkObj => {
                            const lang = (linkObj.language || "vostfr").toUpperCase();
                            linkObj.players.forEach(url => {
                                if (url.includes("anime-sama.fr/videos") || url.includes("s22.anime-sama.fr")) return;
                                let server = "Inconnu";
                                const uLower = url.toLowerCase();
                                if (uLower.includes("sibnet")) server = "Sibnet";
                                else if (uLower.includes("sendvid")) server = "Sendvid";
                                else if (uLower.includes("vidmoly")) server = "Vidmoly";
                                else if (uLower.includes("movearnpre") || uLower.includes("vidhide") || uLower.includes("smoothpre")) server = "Vidhide";
                                else if (uLower.includes("voe") || uLower.includes("dingtezuni")) server = "Voe";
                                else if (uLower.includes("dood") || uLower.includes("doply")) server = "Doodstream";
                                rawLinks.push({ url, server, lang });
                            });
                        });
                    }
                }
            }
        }

        if (!isAnime || rawLinks.length === 0) {
            console.log(`[Movix] 🎬 Lancement de l'API Globale TMDB...`);
            try {
                let apiUrl = type === 'movie' 
                    ? `https://api.movix.blog/api/tmdb/movie/${id}` 
                    : `https://api.movix.blog/api/tmdb/tv/${id}?season=${s}&episode=${e}`;
                    
                const apiText = await soraFetchText(apiUrl, movixHeaders, "GET");
                const dataApi = JSON.parse(apiText);

                let targetLinks = [];
                if (dataApi.player_links && Array.isArray(dataApi.player_links)) targetLinks = dataApi.player_links;
                else if (dataApi.current_episode && dataApi.current_episode.player_links && Array.isArray(dataApi.current_episode.player_links)) targetLinks = dataApi.current_episode.player_links;

                targetLinks.forEach(link => {
                    if (link.decoded_url) {
                        let serverName = link.quality ? link.quality.split('/')[0].trim() : "Inconnu";
                        let langStr = (link.language || "").toLowerCase();
                        let formattedLang = langStr.includes('vost') ? 'VOSTFR' : 'VF';
                        rawLinks.push({ url: link.decoded_url, server: serverName, lang: formattedLang });
                    }
                });
            } catch (err) {
                console.log(`[Movix] 🚨 Erreur API Globale : ${err.message}`);
            }
        }

        console.log(`[Movix] ⚡ Lancement du Resolveur sur ${rawLinks.length} liens...`);
        for (const raw of rawLinks) {
            const resolvedStream = await resolveAnyLink(raw.url, raw.server, raw.lang);
            streams.push(resolvedStream);
        }

        console.log(`[Movix] 🍿 Fin de l'extraction. ${streams.length} Flux finaux.`);
        return JSON.stringify({ streams });
    } catch (err) {
        console.log(`[Movix] 🚨 Crash total Stream : ${err.message}`);
        return JSON.stringify({ streams: [] });
    }
}
