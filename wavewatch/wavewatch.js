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
                    href: `https://beta.wavewatch.xyz/movies/${result.id}`
                };
            }
            else if(result.media_type === "tv" || result.name) {
                return {
                    title: result.name || result.title,
                    image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
                    href: `https://beta.wavewatch.xyz/tv-shows/${result.id}`
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
            const match = url.match(/https:\/\/beta.wavewatch.xyz\/movies\/([^\/]+)/);
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
            const match = url.match(/https:\/\/beta.wavewatch.xyz\/tv-shows\/([^\/]+)/);
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
            const match = url.match(/https:\/\/beta.wavewatch.xyz\/movies\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");
            const movieId = match[1];
            return JSON.stringify([
                { href: `${movieId}/movie`, number: 1, title: "Full Movie" }
            ]);
        } else if(url.includes('tv')) {
            const match = url.match(/https:\/\/beta.wavewatch.xyz\/tv-shows\/([^\/]+)/);
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


// searchResults("breaking bad").then(console.log);
// extractDetails("https://movix.blog/tv/1396").then(console.log);
// extractEpisodes("https://movix.blog/tv/1396").then(console.log);
// extractStreamUrl("https://movix.blog/watch/tv/1396/s/1/e/1").then(console.log);

async function extractStreamUrl(url) {
    try {
        let streams = [];

        let showId = "";
        let seasonNumber = "";
        let episodeNumber = "";

        if (url.includes('movie')) {
            const [showIdTemp, episodeNumberTemp] = url.split('/');

            showId = showIdTemp;
            episodeNumber = episodeNumberTemp;
        } else {
            const [showIdTemp, seasonNumberTemp, episodeNumberTemp] = url.split('/');

            showId = showIdTemp;
            seasonNumber = seasonNumberTemp;
            episodeNumber = episodeNumberTemp;
        }

        if (episodeNumber === "movie") {
            const response = await soraFetch(`https://nakios.site/api/purstream/${showId}`, {
                headers: {
                    "Origin": "https://apis.wavewatch.xyz"
                }
            });
            const data = await response.json();
    
            for (const source of data.sources) {
                streams.push({
                    title: "PurStream - " + source.quality,
                    streamUrl: source.url,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15"
                    }
                });
            }
        } else {
            const response = await soraFetch(`https://nakios.site/api/purstream/tv/${showId}?season=${seasonNumber}&episode=${episodeNumber}&idType=tmdb`, {
                headers: {
                    "Origin": "https://apis.wavewatch.xyz"
                }
            });
            const data = await response.json();

            for (const source of data.sources) {
                streams.push({
                    title: "PurStream - " + source.name,
                    streamUrl: source.url,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15"
                    }
                });
            }
        }

        if (episodeNumber === "movie") {
            const response = await soraFetch(`https://apis.wavewatch.xyz/darkapi.php?tmdbId=${showId}`, {
                headers: {
                    "Referer": "https://wwembed.wavewatch.xyz/",
                }
            });
            const html = await response.text();
    
            const match = html.match(/\{\s*"label"\s*:\s*"([^"]+)"\s*,\s*"url"\s*:\s*"([^"]+)"\s*\}/);

            if (match) {
                const label = match[1];
                const streamUrl = match[2];

                console.log({ label, streamUrl });

                streams.push({
                    title: "DarkApi - " + label,
                    streamUrl,
                    headers: {}
                });
            }
        } else {
            const response = await soraFetch(`https://apis.wavewatch.xyz/darkapi.php?tmdbId=${showId}&season=${seasonNumber}&episode=${episodeNumber}`, {
                headers: {
                    "Referer": "https://wwembed.wavewatch.xyz/",
                }
            });
            const html = await response.text();

            const match = html.match(/\{\s*"label"\s*:\s*"([^"]+)"\s*,\s*"url"\s*:\s*"([^"]+)"\s*\}/);

            if (match) {
                const label = match[1];
                const streamUrl = match[2];

                console.log({ label, streamUrl });

                streams.push({
                    title: "DarkApi - " + label,
                    streamUrl,
                    headers: {
                        "Referer": "https://apis.wavewatch.xyz/",
                        "Origin": "https://apis.wavewatch.xyz"
                    }
                });
            }
        }

        const results = {
            streams,
            subtitles: ""
        };

        console.log(JSON.stringify(results));
        return JSON.stringify(results);
    } catch (error) {
        console.log('Fetch error in extractStreamUrl: ' + error);

        const result = {
            streams: [],
            subtitles: ""
        };

        console.log(result);
        return JSON.stringify(result);
    }
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
