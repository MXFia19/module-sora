// ==========================================
// MODULE MOVIX (Recherche TMDB -> Streams Hybrides)
// ==========================================

const TMDB_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";

// --- GESTIONNAIRE DE REQUÊTES ROBUSTE (soraFetch) ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(
                url,
                options.headers ?? {},
                options.method ?? 'GET',
                options.body ?? null,
                true,
                options.encoding ?? 'utf-8'
            );
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            console.log(`[soraFetch] Erreur fatale sur ${url} : ${error}`);
            return null;
        }
    }
}

// --- 1. RECHERCHE (100% TMDB pour la fiabilité) ---
async function searchResults(keyword) {
    console.log(`[Movix] 🔍 Recherche TMDB pour : "${keyword}"`);
    try {
        const types = ['movie', 'tv'];
        let allResults = [];

        const promises = types.map(async (type) => {
            const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(keyword)}&language=fr-FR`;
            const res = await soraFetch(url);
            if (!res) return { results: [] };
            
            const text = typeof res === "string" ? res : await res.text();
            return JSON.parse(text);
        });

        const [movieData, tvData] = await Promise.all(promises);

        (tvData.results || []).forEach(item => {
            if (item.poster_path) {
                const prefix = item.original_language === 'ja' ? '[Anime]' : '[Série]';
                allResults.push({
                    title: `${prefix} ${item.name}`,
                    image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                    href: `movix/tv/${item.id}`,
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
                    href: `movix/movie/${item.id}`,
                    popularity: item.popularity
                });
            }
        });

        allResults.sort((a, b) => b.popularity - a.popularity);
        return JSON.stringify(allResults);
    } catch (e) {
        console.log(`[Movix] 🚨 Erreur searchResults : ${e.message}`);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(href) {
    try {
        href = decodeURIComponent(href);
        console.log(`[Movix] 📂 Détails pour : ${href}`);
        
        const parts = href.split('/');
        const type = parts[1]; 
        const id = parts[2];

        const detailsUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR`;
        const res = await soraFetch(detailsUrl);
        if (!res) throw new Error("Réponse vide de TMDB");
        
        const text = typeof res === "string" ? res : await res.text();
        const details = JSON.parse(text);

        return JSON.stringify([{
            description: details.overview || "Aucune description disponible pour ce contenu.",
            aliases: `Type: ${type === 'movie' ? 'Film' : 'Série'}`,
            airdate: `Date: ${details.release_date || details.first_air_date || 'N/A'}`
        }]);
    } catch (e) {
        console.log(`[Movix] 🚨 Erreur extractDetails : ${e.message}`);
        return JSON.stringify([{ description: "Erreur lors du chargement des détails.", aliases: "", airdate: "" }]);
    }
}

// --- 3. ÉPISODES (100% TMDB pour les miniatures) ---
async function extractEpisodes(href) {
    try {
        href = decodeURIComponent(href);
        console.log(`[Movix] 📺 Épisodes pour : ${href}`);
        
        const parts = href.split('/');
        const type = parts[1]; 
        const id = parts[2];
        let episodes = [];

        const detailsUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR`;
        const res = await soraFetch(detailsUrl);
        if (!res) return JSON.stringify([]);
        
        const text = typeof res === "string" ? res : await res.text();
        const details = JSON.parse(text);

        if (type === 'movie') {
            episodes.push({
                number: 1,
                episode: 1, 
                season: 1,  
                title: details.title || "Le Film",
                description: details.overview || "",
                image: details.backdrop_path ? `https://image.tmdb.org/t/p/w500${details.backdrop_path}` : "",
                href: `stream/movie/${id}`,
                url: `stream/movie/${id}` 
            });
        } else if (type === 'tv') {
            if (details.seasons) {
                for (const season of details.seasons) {
                    const sNum = season.season_number;
                    if (sNum === 0) continue; 

                    const seasonUrl = `https://api.themoviedb.org/3/tv/${id}/season/${sNum}?api_key=${TMDB_KEY}&language=fr-FR`;
                    try {
                        const sRes = await soraFetch(seasonUrl);
                        if (!sRes) continue;
                        
                        const sText = typeof sRes === "string" ? sRes : await sRes.text();
                        const sData = JSON.parse(sText);

                        if (sData.episodes) {
                            sData.episodes.forEach(ep => {
                                episodes.push({
                                    number: ep.episode_number,
                                    episode: ep.episode_number, 
                                    season: sNum,
                                    title: `S${sNum}E${ep.episode_number} - ${ep.name}`,
                                    description: ep.overview || "",
                                    image: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : "",
                                    href: `stream/tv/${id}/${sNum}/${ep.episode_number}`,
                                    url: `stream/tv/${id}/${sNum}/${ep.episode_number}` 
                                });
                            });
                        }
                    } catch (err) {
                        console.log(`[Movix] ⚠️ Erreur lors du chargement de la saison ${sNum}: ${err.message}`);
                    }
                }
            }
        }
        return JSON.stringify(episodes);
    } catch (e) {
        console.log(`[Movix] 🚨 Erreur extractEpisodes : ${e.message}`);
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

    try {
        // 🌟 Détection Vidhide / Vidmoly / Movearnpre / FILEMOON
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
            
            let res = await soraFetch(fetchUrl, { headers, method: "GET" });
            if (!res) throw new Error("Fetch échoué");
            let html = typeof res === "string" ? res : await res.text();
            
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
        // 🌟 Détection Uqload
        else if (urlLower.includes('uqload.') || sourceLower === 'uqload') {
            let res = await soraFetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://uqload.is/" } });
            if (res) {
                let html = typeof res === "string" ? res : await res.text();
                const match = html.match(/sources\s*:\s*\[\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
                if (match) { finalUrl = match[1]; isDirect = true; headers = { "Referer": url, "User-Agent": "Mozilla/5.0" }; }
            }
        }
        // 🌟 Détection Vidoza
        else if (urlLower.includes('vidoza.') || sourceLower === 'vidoza') {
            let res = await soraFetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
            if (res) {
                let html = typeof res === "string" ? res : await res.text();
                const match = html.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i) || html.match(/(https?:\/\/[^"']+\.mp4)/i);
                if (match) { finalUrl = match[1]; isDirect = true; headers = { "Referer": url, "User-Agent": "Mozilla/5.0" }; }
            }
        }
        // 🌟 Détection Sendvid
        else if (urlLower.includes('sendvid.') || sourceLower === 'sendvid') {
            const embedUrl = url.includes('/embed/') ? url : url.replace(/sendvid\.com\/([a-z0-9]+)/i, 'sendvid.com/embed/$1');
            headers = { 'Referer': 'https://sendvid.com/' };
            let res = await soraFetch(embedUrl, { headers });
            if (res) {
                let html = typeof res === "string" ? res : await res.text();
                const match = html.match(/video_source\s*:\s*["']([^"']+\.mp4[^"']*)["|']/) || html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/);
                if (match) { finalUrl = match[1]; isDirect = true; }
            }
        }
        // 🌟 Détection Doodstream
        else if (urlLower.includes('dood') || urlLower.includes('doply') || urlLower.includes('myvidplay') || sourceLower.includes('dood')) {
            let res = await soraFetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": url } });
            if (res) {
                let html = typeof res === "string" ? res : await res.text();
                const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                if (iframeMatch && (iframeMatch[1].includes('dood') || iframeMatch[1].includes('myvidplay'))) {
                    url = iframeMatch[1].startsWith('http') ? iframeMatch[1] : 'https:' + iframeMatch[1];
                    res = await soraFetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": url } });
                    if (res) html = typeof res === "string" ? res : await res.text();
                }
                const passMd5Match = html.match(/\/pass_md5\/([^"']+)/i);
                const tokenMatch = html.match(/[?&]token=([a-z0-9]+)[&'"]/i);
                if (passMd5Match && tokenMatch) {
                    const md5Url = url.match(/^https?:\/\/[^\/]+/)[0] + '/pass_md5/' + passMd5Match[1];
                    let md5Res = await soraFetch(md5Url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": url } });
                    if (md5Res) {
                        let videoBaseUrl = typeof md5Res === "string" ? md5Res : await md5Res.text();
                        finalUrl = `${videoBaseUrl}${Math.random().toString(36).substring(2, 12)}?token=${tokenMatch[1]}&expiry=${Date.now()}`;
                        isDirect = true;
                        headers = { "Referer": url.match(/^https?:\/\/[^\/]+/)[0] + "/", "User-Agent": "Mozilla/5.0" };
                    }
                }
            }
        }
        // 🌟 Détection Voe
        else if ((urlLower.includes('voe.') || urlLower.includes('dingtezuni') || urlLower.includes('ralphysuccessfull') || sourceLower === 'voe') && !sourceLower.includes('vidhide')) { 
            let voeHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": url, "x-Requested-With": "XMLHttpRequest" };
            let currentUrl = url;
            let res = await soraFetch(currentUrl, { headers: voeHeaders });
            if (res) {
                let html = typeof res === "string" ? res : await res.text();
                const titleMatch = html.match(/<title>(.*?)<\/title>/i);
                if (titleMatch && titleMatch[1].toLowerCase().includes("redirect")) {
                    const match = html.match(/window\.location\.href\s*=\s*["'](.*?)["']/i);
                    if (match && match[1]) {
                        currentUrl = match[1];
                        voeHeaders['Referer'] = currentUrl;
                        let res2 = await soraFetch(currentUrl, { headers: voeHeaders });
                        if (res2) html = typeof res2 === "string" ? res2 : await res2.text();
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
        }
        // 🌟 Détection Sibnet
        else if (urlLower.includes('sibnet.') || sourceLower === 'sibnet') {
            let res = await soraFetch(url, { headers: { "Referer": "https://video.sibnet.ru/" } });
            if (res) {
                let html = typeof res === "string" ? res : await res.text();
                const match = html.match(/src\s*:\s*["']([^"']*\.mp4[^"']*)['"]/i) || html.match(/["']((?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i);
                if (match && match[1]) {
                    let videoUrl = match[1].startsWith('//') ? "https:" + match[1] : (match[1].startsWith('/') ? "https://video.sibnet.ru" + match[1] : match[1]);
                    finalUrl = videoUrl; isDirect = true; headers = { "Referer": url, "User-Agent": "Mozilla/5.0" }; 

                    try {
                        const resolveOptions = Object.assign({}, headers, { redirect: "manual" });
                        const resolveRes = await fetchv2(finalUrl, resolveOptions, "GET"); 
                        
                        let locationHeader = null;
                        if (resolveRes && resolveRes.headers) {
                            if (typeof resolveRes.headers.get === 'function') locationHeader = resolveRes.headers.get('location') || resolveRes.headers.get('Location');
                            else locationHeader = resolveRes.headers['location'] || resolveRes.headers['Location'];
                        }

                        if (locationHeader) {
                            finalUrl = locationHeader.startsWith('//') ? 'https:' + locationHeader : locationHeader;
                        } else if (resolveRes && resolveRes.url && resolveRes.url !== finalUrl) {
                            finalUrl = resolveRes.url;
                        } 
                    } catch (e) { }
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
    try {
        href = decodeURIComponent(href);
        console.log(`[Movix] 🎬 Lancement de l'extraction pour : ${href}`);
        
        const parts = href.split('/');
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
        const resTmdb = await soraFetch(tmdbUrl);
        if (!resTmdb) throw new Error("TMDB injoignable");
        
        const tmdbDetails = JSON.parse(typeof resTmdb === "string" ? resTmdb : await resTmdb.text());
        const isAnime = type === 'tv' && tmdbDetails.original_language === 'ja';

        if (isAnime) {
            console.log(`[Movix] 🌸 Anime détecté ! Lancement de l'algorithme intelligent...`);
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
                    const aRes = await soraFetch(searchUrl, { headers: movixHeaders });
                    if (!aRes) continue;
                    
                    const parsed = JSON.parse(typeof aRes === "string" ? aRes : await aRes.text());
                    if (Array.isArray(parsed) && parsed.length > 0) { 
                        const withSeasons = parsed.filter(item => item.seasons && item.seasons.length > 0);
                        
                        let bestMatch = null;
                        const searchStr = t.trim().toLowerCase();

                        // 🎯 1. On cherche d'abord la correspondance EXACTE
                        bestMatch = withSeasons.find(item => item.title && item.title.trim().toLowerCase() === searchStr);
                        
                        // 🎯 2. Si on ne trouve pas l'exactitude, on prend le PLUS COURT qui contient le mot.
                        // (Cela évite de prendre "Sword Art Online Alternative: Gun Gale" quand on cherche juste "Sword Art Online")
                        if (!bestMatch) {
                            let matching = withSeasons.filter(item => item.title && item.title.toLowerCase().includes(searchStr));
                            matching.sort((a, b) => a.title.length - b.title.length);
                            if (matching.length > 0) bestMatch = matching[0];
                        }

                        if (!bestMatch && withSeasons.length > 0) bestMatch = withSeasons[0];

                        if (bestMatch) { 
                            animeDataFound = bestMatch; 
                            console.log(`[Movix] 📚 Fichier Anime trouvé : ${animeDataFound.title}`);
                            break; 
                        }
                    }
                } catch (err) {}
            }

            if (animeDataFound && animeDataFound.seasons) {
                let seasonObj = null;
                const searchNameLower = searchName.toLowerCase();
                const isSpinOff = searchNameLower.includes(':') || searchNameLower.includes('-');
                
                // A. Spin-off ? On fouille dans les saisons pour trouver le nom du spin-off
                if (isSpinOff) {
                    const keywords = searchNameLower.split(/[:\-]/).map(k => k.trim()).filter(k => k.length > 3);
                    for (const sea of animeDataFound.seasons) {
                        const seaNameLower = sea.name.toLowerCase();
                        if (keywords.some(k => seaNameLower.includes(k) && k !== searchNameLower)) {
                            seasonObj = sea;
                            break;
                        }
                    }
                } 
                
                // B. Saison Classique ? On force la recherche stricte "Saison X" ou "Season X"
                if (!seasonObj) {
                    seasonObj = animeDataFound.seasons.find(sea => {
                        const sn = sea.name.toLowerCase().trim();
                        return sn.includes(`saison ${s}`) || sn.includes(`saison 0${s}`) || sn.includes(`season ${s}`) || sn === `s${s}` || sn === s.toString();
                    });
                }

                // C. Fallback logique : On prend l'index de la saison (en évitant de tomber sur un spin-off)
                if (!seasonObj) {
                    const cleanSeasons = animeDataFound.seasons.filter(sea => {
                        const sn = sea.name.toLowerCase();
                        return sn.includes('saison') || sn.includes('season') || sn.length < 15; 
                    });
                    seasonObj = cleanSeasons[s - 1] || animeDataFound.seasons[s - 1];
                }

                if (seasonObj && seasonObj.episodes) {
                    console.log(`[Movix] 🎯 Saison ciblée : ${seasonObj.name}`);
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

        // 🌟 L'API UNIQUE POUR TOUT LE RESTE
        if (!isAnime || rawLinks.length === 0) {
            try {
                let apiUrl = type === 'movie' 
                    ? `https://api.movix.blog/api/tmdb/movie/${id}` 
                    : `https://api.movix.blog/api/tmdb/tv/${id}?season=${s}&episode=${e}`;
                    
                const resApi = await soraFetch(apiUrl, { headers: movixHeaders });
                if (resApi) {
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
                    }
                }
            } catch (err) { }
        }

        console.log(`[Movix] ⚡ Lancement du Super Resolveur sur ${rawLinks.length} liens bruts...`);
        for (const raw of rawLinks) {
            const resolvedStream = await resolveAnyLink(raw.url, raw.server, raw.lang);
            streams.push(resolvedStream);
        }

        console.log(`[Movix] 🍿 Fin de l'extraction. Total des liens récupérés : ${streams.length}`);
        return JSON.stringify({ streams: streams, subtitles: "" });

    } catch (err) {
        console.log(`[Movix] 🚨 Crash global dans extractStreamUrl : ${err}`);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}
