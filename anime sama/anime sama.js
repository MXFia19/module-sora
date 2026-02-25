// --- 1. GESTION DES DOMAINES ---
async function getDomainsList() {
    try {
        const response = await fetchv2("https://anime-sama.pw/");
        const html = await response.text();

        const domains = [];
        const domainRegex = /name:\s*'([^']+)'/g;
        let match;
        
        while ((match = domainRegex.exec(html)) !== null) {
            domains.push(match[1].trim());
        }

        // Par défaut, on met .fr qui est leur domaine principal actuel
        return domains.length > 0 ? domains : ["anime-sama.fr"];
    } catch (err) {
        return ["anime-sama.fr"];
    }
}

// --- 2. RECHERCHE (Sécurisée contre le spam réseau) ---
async function searchResults(keyword) {
    try {
        const domains = await getDomainsList();

        // On teste les domaines UN PAR UN pour ne pas faire crasher le réseau de l'appli
        for (let domain of domains) {
            const results = await trySearch(domain, keyword);
            
            // Dès qu'on a trouvé des résultats, on s'arrête et on affiche !
            if (results && results.length > 0) {
                return JSON.stringify(results);
            }
        }

        return JSON.stringify([]);
    } catch (e) {
        console.log('[AnimeSama] Erreur searchResults : ' + e);
        return JSON.stringify([]);
    }
}

// --- 3. EXTRACTION (Anti-Crash CPU) ---
async function trySearch(domain, keyword) {
    try {
        const response = await fetchv2(
            `https://${domain}/template-php/defaut/fetch.php`,
            {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": `https://${domain}/`
            },
            "POST",
            `query=${encodeURIComponent(keyword)}`
        );
        
        const html = await response.text();

        // Si Cloudflare nous bloque, on reçoit une page HTML d'erreur
        if (!html || html.toLowerCase().includes("<!doctype html>")) {
            return [];
        }

        const results = [];
        
        // ASTUCE ANTI-CRASH : On coupe le texte en morceaux via le lien 'href="'
        // C'est instantané et ça ne plantera jamais, contrairement au Regex.
        const cards = html.split('href="'); 
        
        // On ignore la case 0 car c'est le texte avant le premier lien
        for (let i = 1; i < cards.length; i++) {
            let card = cards[i];
            
            // 1. Récupération du lien
            let hrefEnd = card.indexOf('"');
            if (hrefEnd === -1) continue;
            let href = card.substring(0, hrefEnd).trim();
            
            // 2. Récupération de l'image
            let imgMatch = card.match(/src="([^"]+)"/i);
            
            // 3. Récupération du titre (dans un h1, h2, h3, ou p)
            let titleMatch = card.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i) || card.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>(.*?)<\/p>/i);
            
            if (imgMatch && titleMatch) {
                let image = imgMatch[1].trim();
                let title = titleMatch[1].replace(/<[^>]+>/g, '').trim(); // Nettoie le titre
                
                // Formater les liens pour éviter que l'iPhone panique
                if (href.startsWith('/')) href = `https://${domain}${href}`;
                else if (!href.startsWith('http')) href = `https://${domain}/${href}`;

                if (image.startsWith('/')) image = `https://${domain}${image}`;
                else if (!image.startsWith('http')) image = `https://${domain}/${image}`;

                results.push({ title, image, href });
            }
        }
        
        return results;
    } catch (err) {
        console.log(`[AnimeSama] Échec sur le domaine ${domain}`);
        return [];
    }
}
async function extractDetails(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        const regex = /<p class="text-sm text-gray-400 mt-2">(.*?)<\/p>/is;
        const match = regex.exec(html);

        const description = match ? match[1].trim() : "N/A";

        return JSON.stringify([{
            description: description,
            aliases: "N/A",
            airdate: "N/A"
        }]);
    } catch (err) {
        return JSON.stringify([{
            description: "Error",
            aliases: "Error",
            airdate: "Error"
        }]);
    }
}

async function extractEpisodes(url) {
    const results = [];
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        
        const seasonRegex = /panneauAnime\("([^"]+)",\s*"([^"]+)"\);/g;
        let match;
        
        const seasonUrls = [];
        while ((match = seasonRegex.exec(html)) !== null) {
            const seasonHref = match[2].trim();
            const fullSeasonUrl = url + '/' + seasonHref;
            
            seasonUrls.push(fullSeasonUrl);
        }
        
        const seasonPromises = seasonUrls.map(seasonUrl => fetchv2(seasonUrl));
        const seasonResponses = await Promise.all(seasonPromises);
        
        for (let i = 0; i < seasonResponses.length; i++) {
            const seasonResponse = seasonResponses[i];
            const seasonHtml = await seasonResponse.text();
            const seasonUrl = seasonUrls[i];
            
            const episodeScriptRegex = /<script[^>]+src=['"]([^'"]*episodes\.js[^'"]*?)['"][^>]*>/;
            const scriptMatch = episodeScriptRegex.exec(seasonHtml);
            
            if (scriptMatch) {
                const episodesSrc = scriptMatch[1].trim();
                const fullEpisodesUrl = seasonUrl + '/' + episodesSrc;
                                
                const episodesResponse = await fetchv2(fullEpisodesUrl);
                const episodesJs = await episodesResponse.text();

                let episodeNumber = 1;
                
                const oneuploadRegex = /'(https:\/\/oneupload\.to\/[^']+)'/g;
                let episodeMatch;
                let foundEpisodes = false;
                
                while ((episodeMatch = oneuploadRegex.exec(episodesJs)) !== null) {
                    const oneuploadUrl = episodeMatch[1].trim();
                    results.push({
                        href: oneuploadUrl,
                        number: episodeNumber
                    });
                    episodeNumber++;
                    foundEpisodes = true;
                }
                
                if (!foundEpisodes) {
                    episodeNumber = 1;
                    const sendvidRegex = /'(https:\/\/sendvid\.com\/[^']+)'/g;
                    
                    while ((episodeMatch = sendvidRegex.exec(episodesJs)) !== null) {
                        const sendvidUrl = episodeMatch[1].trim();
                        results.push({
                            href: sendvidUrl,
                            number: episodeNumber
                        });
                        episodeNumber++;
                        foundEpisodes = true;
                    }
                }
                
                if (!foundEpisodes) {
                    episodeNumber = 1;
                    const smoothpreRegex = /'(https:\/\/smoothpre\.com\/[^']+)'/gi;
                    
                    while ((episodeMatch = smoothpreRegex.exec(episodesJs)) !== null) {
                        const smoothpreUrl = episodeMatch[1].trim();
                        results.push({
                            href: smoothpreUrl,
                            number: episodeNumber
                        });
                        episodeNumber++;
                        foundEpisodes = true;
                    }
                }
                
                if (!foundEpisodes) {
                    episodeNumber = 1;
                    const mp4Regex = /'([^']+\.mp4[^']*)'/g;
                    
                    while ((episodeMatch = mp4Regex.exec(episodesJs)) !== null) {
                        const mp4Url = episodeMatch[1].trim();
                        results.push({
                            href: mp4Url,
                            number: episodeNumber
                        });
                        episodeNumber++;
                        foundEpisodes = true;
                    }
                }
                
                if (!foundEpisodes && seasonUrl.includes('film')) {
                    episodeNumber = 1;
                    const allVideoRegex = /'(https:\/\/[^']+\.(mp4|mkv|avi|mov|webm)[^']*)'/gi;
                    
                    while ((episodeMatch = allVideoRegex.exec(episodesJs)) !== null) {
                        const videoUrl = episodeMatch[1].trim();
                        results.push({
                            href: videoUrl,
                            number: 1 
                        });
                        foundEpisodes = true;
                        break; 
                    }
                }
            }
        }
        
        return JSON.stringify(results);
    } catch (err) {
        console.error(err);
        return JSON.stringify([{
            href: "Error",
            number: "Error"
        }]);
    }
}

async function extractStreamUrl(url) {
    try {
        if (/^https?:\/\/smoothpre\.com/i.test(url)) {
            const response = await fetchv2(url);
            const html = await response.text();
            const obfuscatedScript = html.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d.*?\)[\s\S]*?)<\/script>/);
            const unpackedScript = unpack(obfuscatedScript[1]);

            const hls2Match = unpackedScript.match(/"hls2"\s*:\s*"([^"]+)"/);
            const hls2Url = hls2Match ? hls2Match[1] : null;

            return hls2Url;
        } else if (/^https?:\/\/sendvid\.com/i.test(url)) {
            const response = await fetchv2(url);
            const html = await response.text();
            const match = html.match(/var\s+video_source\s*=\s*"([^"]+)"/);
            const videoUrl = match ? match[1] : null;

            return videoUrl;
        } else if (/^https?:\/\/oneupload\.to/i.test(url)) {
            const response = await fetchv2(url);
            const html = await response.text();
            const match = html.match(/sources:\s*\[\{file:"([^"]+)"\}\]/);
            const fileUrl = match ? match[1] : null;

            return fileUrl;
        } else if (/\.mp4$/i.test(url)) {

            return url;
        } else {
            return "https://error.org/";
        }
    } catch (err) {
        return "https://error.org/";
    }
}

/***********************************************************
 * UNPACKER MODULE
 * Credit to GitHub user "mnsrulz" for Unpacker Node library
 * https://github.com/mnsrulz/unpacker
 ***********************************************************/
class Unbaser {
    constructor(base) {
        /* Functor for a given base. Will efficiently convert
          strings to natural numbers. */
        this.ALPHABET = {
            62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            95: "' !\"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'",
        };
        this.dictionary = {};
        this.base = base;
        // fill elements 37...61, if necessary
        if (36 < base && base < 62) {
            this.ALPHABET[base] = this.ALPHABET[base] ||
                this.ALPHABET[62].substr(0, base);
        }
        // If base can be handled by int() builtin, let it do it for us
        if (2 <= base && base <= 36) {
            this.unbase = (value) => parseInt(value, base);
        }
        else {
            // Build conversion dictionary cache
            try {
                [...this.ALPHABET[base]].forEach((cipher, index) => {
                    this.dictionary[cipher] = index;
                });
            }
            catch (er) {
                throw Error("Unsupported base encoding.");
            }
            this.unbase = this._dictunbaser;
        }
    }
    _dictunbaser(value) {
        /* Decodes a value to an integer. */
        let ret = 0;
        [...value].reverse().forEach((cipher, index) => {
            ret = ret + ((Math.pow(this.base, index)) * this.dictionary[cipher]);
        });
        return ret;
    }
}

function detect(source) {
    /* Detects whether `source` is P.A.C.K.E.R. coded. */
    return source.replace(" ", "").startsWith("eval(function(p,a,c,k,e,");
}

function unpack(source) {
    /* Unpacks P.A.C.K.E.R. packed js code. */
    let { payload, symtab, radix, count } = _filterargs(source);
    if (count != symtab.length) {
        throw Error("Malformed p.a.c.k.e.r. symtab.");
    }
    let unbase;
    try {
        unbase = new Unbaser(radix);
    }
    catch (e) {
        throw Error("Unknown p.a.c.k.e.r. encoding.");
    }
    function lookup(match) {
        /* Look up symbols in the synthetic symtab. */
        const word = match;
        let word2;
        if (radix == 1) {
            //throw Error("symtab unknown");
            word2 = symtab[parseInt(word)];
        }
        else {
            word2 = symtab[unbase.unbase(word)];
        }
        return word2 || word;
    }
    source = payload.replace(/\b\w+\b/g, lookup);
    return _replacestrings(source);
    function _filterargs(source) {
        /* Juice from a source file the four args needed by decoder. */
        const juicers = [
            /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
            /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/,
        ];
        for (const juicer of juicers) {
            //const args = re.search(juicer, source, re.DOTALL);
            const args = juicer.exec(source);
            if (args) {
                let a = args;
                if (a[2] == "[]") {
                    //don't know what it is
                    // a = list(a);
                    // a[1] = 62;
                    // a = tuple(a);
                }
                try {
                    return {
                        payload: a[1],
                        symtab: a[4].split("|"),
                        radix: parseInt(a[2]),
                        count: parseInt(a[3]),
                    };
                }
                catch (ValueError) {
                    throw Error("Corrupted p.a.c.k.e.r. data.");
                }
            }
        }
        throw Error("Could not make sense of p.a.c.k.e.r data (unexpected code structure)");
    }
    function _replacestrings(source) {
        /* Strip string lookup table (list) and replace values in source. */
        /* Need to work on this. */
        return source;
    }
}
