async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const responseText = await soraFetch(`https://api.themoviedb.org/3/search/multi?api_key=f3d757824f08ea2cff45eb8f47ca3a1e&query=${encodedKeyword}&language=fr-FR&page=1&include_adult=false&sort_by=popularity.desc`);
        const data = await responseText.json();

        const transformedResults = data.results.map(result => {
            if(result.media_type === "movie" || result.title) {
                return {
                    title: result.title || result.name,
                    image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
                    href: `https://movix.blog/movie/${result.id}`
                };
            }
            else if(result.media_type === "tv" || result.name) {
                return {
                    title: result.name || result.title,
                    image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
                    href: `https://movix.blog/tv/${result.id}`
                };
            }
        });


        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log('Fetch error in searchResults: ' + error);
        return JSON.stringify([{ title: 'Error', image: '', href: '' }]);
    }
}

async function extractDetails(url) {
    try {
        if(url.includes('movie')) {
            const match = url.match(/https:\/\/movix\.blog\/movie\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];
            const responseText = await soraFetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=f3d757824f08ea2cff45eb8f47ca3a1e&language=fr-FR&append_to_response=videos,credits`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.runtime ? data.runtime + " minutes" : 'Unknown'}`,
                airdate: `Released: ${data.release_date ? data.release_date : 'Unknown'}`
            }];

            return JSON.stringify(transformedResults);
        } else if(url.includes('tv')) {
            const match = url.match(/https:\/\/movix\.blog\/tv\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];
            const responseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}?api_key=f3d757824f08ea2cff45eb8f47ca3a1e&language=fr-FR&append_to_response=seasons`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.episode_run_time && data.episode_run_time.length ? data.episode_run_time.join(', ') : 'Unknown'}`,
                airdate: `Aired: ${data.first_air_date ? data.first_air_date : 'Unknown'}`
            }];

            return JSON.stringify(transformedResults);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Duration: Unknown',
            airdate: 'Aired/Released: Unknown'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        if(url.includes('movie')) {
            const match = url.match(/https:\/\/movix\.blog\/movie\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");
            const movieId = match[1];
            return JSON.stringify([
                { href: `${movieId}/movie`, number: 1, title: "Full Movie" }
            ]);
        } else if(url.includes('tv')) {
            const match = url.match(/https:\/\/movix\.blog\/tv\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");
            const showId = match[1];
            
            const showResponseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}?api_key=f3d757824f08ea2cff45eb8f47ca3a1e&language=fr-FR`);
            const showData = await showResponseText.json();
            
            let allEpisodes = [];
            for (const season of showData.seasons) {
                const seasonNumber = season.season_number;

                if(seasonNumber === 0) continue;
                
                const seasonResponseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}/season/${seasonNumber}?api_key=f3d757824f08ea2cff45eb8f47ca3a1e&language=fr-FR`);
                const seasonData = await seasonResponseText.json();
                
                if (seasonData.episodes && seasonData.episodes.length) {
                    const episodes = seasonData.episodes.map(episode => ({
                        href: `${showId}/${seasonNumber}/${episode.episode_number}`,
                        number: episode.episode_number,
                        title: episode.name || ""
                    }));
                    allEpisodes = allEpisodes.concat(episodes);
                }
            }
            
            return JSON.stringify(allEpisodes);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Fetch error in extractEpisodes: ' + error);
        return JSON.stringify([]);
    }    
}

// searchResults("breaking bad");




async function extractStreamUrl(url) {
    let streams = [];
    let showId = "";
    let seasonNumber = "";
    let episodeNumber = "";

    // 1. Découpage de l'URL
    if (url.includes('movie')) {
        const parts = url.split('/');
        showId = parts[0];
        episodeNumber = parts[1];
    } else {
        const parts = url.split('/');
        showId = parts[0];
        seasonNumber = parts[1];
        episodeNumber = parts[2];
    }

    const uas = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1.1 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Mobile Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.2 Safari/605.1.15"
    ];
    const randomUA = uas[url.length % uas.length];

    // ==========================================
    // BLOC 1 : RECHERCHE SUR FREMBED.BUZZ
    // ==========================================
    try {
        console.log("[Movix] Appel API Frembed...");
        const frembedUrl = episodeNumber === "movie" 
            ? `https://frembed.buzz/api/films?id=${showId}&idType=tmdb`
            : `https://frembed.buzz/api/series?id=${showId}&sa=${seasonNumber}&epi=${episodeNumber}&idType=tmdb`;

        const resFrembed = await soraFetch(frembedUrl, {
            headers: { "Referer": "https://frembed.buzz/", "Origin": "https://frembed.buzz" }
        });
        const textFrembed = await resFrembed.text();
        
        let dataFrembed = null;
        try { 
            dataFrembed = JSON.parse(textFrembed); 
        } catch(e) { 
            console.log("[Movix] Frembed n'a pas renvoyé de JSON valide."); 
        }

        if (dataFrembed) {
            const links = Object.entries(dataFrembed)
                .filter(([key, value]) => typeof value === "string" && value.startsWith("http") && key.startsWith("link"))
                .map(([key, value]) => ({
                    type: key.includes("vostfr") ? "VOSTFR" : key.includes("vo") ? "VO" : "VF",
                    name: key,
                    url: value
                }));

            console.log(`[Movix] ${links.length} liens trouvés sur Frembed.`);

            for (const playerLink of links) {
                try {
                    if (playerLink.name.includes("link7") || playerLink.name.includes("link4")) {
                        const res = await soraFetch(playerLink.url, {
                            headers: { "User-Agent": randomUA, "Referer": playerLink.url }
                        });
                        const text = await res.text();
                        const match = text.match(/sources:\s*\[\s*"([^"]+)"\s*\]/);
                        if (match && match[1]) {
                            streams.push({
                                title: `${playerLink.type} - Uqload (Frembed)`,
                                streamUrl: match[1],
                                headers: { Referer: "https://uqload.bz/" }
                            });
                        }
                    } else if (playerLink.name.includes("link3")) {
                        const res = await soraFetch(playerLink.url, {
                            headers: { "User-Agent": randomUA, "Referer": playerLink.url }
                        });
                        let text = await res.text();

                        // Gestion des redirections pour VOE
                        const redirectMatch = text.match(/<meta http-equiv="refresh" content="0;url=(.*?)"/);
                        if (redirectMatch && redirectMatch[1]) {
                            text = await soraFetch(redirectMatch[1], {
                                headers: { "User-Agent": randomUA, "Referer": redirectMatch[1] }
                            }).then(r => r.text());
                        }

                        const streamUrl = voeExtractor(text);
                        if (streamUrl) {
                            streams.push({
                                title: `${playerLink.type} - Voe (Frembed)`,
                                streamUrl,
                                headers: { Referer: "https://crystaltreatmenteast.com/", Origin: "https://crystaltreatmenteast.com" }
                            });
                        }
                    }
                } catch(err) {
                    console.log(`[Movix] Erreur extraction lien Frembed ${playerLink.name}: ` + err);
                }
            }
        }
    } catch (e) {
        console.log("[Movix] Erreur globale API Frembed: " + e);
    }

    // ==========================================
    // BLOC 2 : RECHERCHE SUR LA NOUVELLE API (.BLOG)
    // ==========================================
    try {
        console.log("[Movix] Appel API Movix Blog...");
        // On a remplacé api.movix.club par api.movix.blog !
        const movixUrl = episodeNumber === "movie"
            ? `https://api.movix.blog/api/fstream/movie/${showId}`
            : `https://api.movix.blog/api/fstream/tv/${showId}/season/${seasonNumber}`;

        const resMovix = await soraFetch(movixUrl, {
            headers: { 
                "Referer": "https://movix.blog/",
                "Accept": "application/json, text/plain, */*",
                "User-Agent": randomUA
            }
        });
        
        const textMovix = await resMovix.text();
        let dataMovix = null;
        try { 
            dataMovix = JSON.parse(textMovix); 
        } catch(e) { 
            console.log("[Movix] L'API Movix Blog n'a pas renvoyé de JSON valide. Extrait : " + textMovix.substring(0, 80)); 
        }

        if (dataMovix) {
            let playerLinks = {};
            if (episodeNumber === "movie") {
                playerLinks = dataMovix.players || {};
            } else {
                const episodeData = dataMovix?.episodes?.[episodeNumber];
                playerLinks = episodeData?.languages || {};
            }

            const categories = ["VF", "VFQ", "VFF", "VOSTFR"];
            for (const cat of categories) {
                const links = playerLinks[cat] || [];
                for (const playerLink of links) {
                    try {
                        if (playerLink.url && playerLink.player.toLowerCase().includes("vidzy")) {
                            const res = await soraFetch(playerLink.url, {
                                headers: { "User-Agent": randomUA, "Referer": playerLink.url }
                            });
                            const text = await res.text();
                            
                            const packedMatch = text.match(/(eval\(function\(p,a,c,k,e,d[\s\S]*?)<\/script>/);
                            if (packedMatch) {
                                const unpacked = unpack(packedMatch[1]);
                                const urlMatch = unpacked.match(/sources\s*:\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/);
                                if (urlMatch && urlMatch[1]) {
                                    streams.push({
                                        title: `${cat} - ${playerLink.quality || 'Auto'} - Vidzy`,
                                        streamUrl: urlMatch[1],
                                        headers: { Referer: "https://vidzy.org/", Origin: "https://vidzy.org" }
                                    });
                                }
                            }
                        }
                    } catch (err) {
                        console.log(`[Movix] Erreur extraction lien Movix ${cat}: ` + err);
                    }
                }
            }
        }
    } catch (e) {
        console.log("[Movix] Erreur globale API Movix Blog: " + e);
    }

    console.log(`[Movix] Résultat final : ${streams.length} flux trouvés.`);
    return JSON.stringify({ streams, subtitles: "" });
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? 'GET',
            options.body ?? null,
            true,
            options.encoding ?? 'utf-8'
        );
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}

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

function voeExtractor(html, url = null) {
    // Extract the first <script type="application/json">...</script>
    const jsonScriptMatch = html.match(
        /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (!jsonScriptMatch) {
        console.log("No application/json script tag found");
        return null;
    }

    const obfuscatedJson = jsonScriptMatch[1].trim();

    let data;
    try {
        data = JSON.parse(obfuscatedJson);
    } catch (e) {
        throw new Error("Invalid JSON input.");
    }

    if (!Array.isArray(data) || typeof data[0] !== "string") {
        throw new Error("Input doesn't match expected format.");
    }
    let obfuscatedString = data[0];

    // Step 1: ROT13
    let step1 = voeRot13(obfuscatedString);

    // Step 2: Remove patterns
    let step2 = voeRemovePatterns(step1);

    // Step 3: Base64 decode
    let step3 = voeBase64Decode(step2);

    // Step 4: Subtract 3 from each char code
    let step4 = voeShiftChars(step3, 3);

    // Step 5: Reverse string
    let step5 = step4.split("").reverse().join("");

    // Step 6: Base64 decode again
    let step6 = voeBase64Decode(step5);

    // Step 7: Parse as JSON
    let result;
    try {
        result = JSON.parse(step6);
    } catch (e) {
        throw new Error("Final JSON parse error: " + e.message);
    }
    // console.log("Decoded JSON:", result);

    // check if direct_access_url is set, not null and starts with http
    if (result && typeof result === "object") {
        const streamUrl =
            result.direct_access_url ||
            result.source
            .map((source) => source.direct_access_url)
            .find((url) => url && url.startsWith("http"));

        if (streamUrl) {
            console.log("Voe Stream URL: " + streamUrl);
            return streamUrl;
        } else {
            console.log("No stream URL found in the decoded JSON");
        }
    }
    return result;
}

function voeRot13(str) {
    return str.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode(
            (c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13)
                ? c
                : c - 26
        );
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
    // atob is available in browsers and Node >= 16
    if (typeof atob === "function") {
        return atob(str);
    }
    // Node.js fallback
    return Buffer.from(str, "base64").toString("utf-8");
}

function voeShiftChars(str, shift) {
    return str
        .split("")
        .map((c) => String.fromCharCode(c.charCodeAt(0) - shift))
        .join("");
}
