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

        return domains.length > 0 ? domains : ["anime-sama.fr"];
    } catch (err) {
        return ["anime-sama.fr"];
    }
}

// --- 2. RECHERCHE (Sécurisée) ---
async function searchResults(keyword) {
    try {
        const domains = await getDomainsList();

        for (let domain of domains) {
            const results = await trySearch(domain, keyword);
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

        if (!html || html.toLowerCase().includes("<!doctype html>")) {
            return [];
        }

        const results = [];
        const cards = html.split('href="'); 
        
        for (let i = 1; i < cards.length; i++) {
            let card = cards[i];
            
            let hrefEnd = card.indexOf('"');
            if (hrefEnd === -1) continue;
            let href = card.substring(0, hrefEnd).trim();
            
            let imgMatch = card.match(/src="([^"]+)"/i);
            let titleMatch = card.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i) || card.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>(.*?)<\/p>/i);
            
            if (imgMatch && titleMatch) {
                let image = imgMatch[1].trim();
                let title = titleMatch[1].replace(/<[^>]+>/g, '').trim(); 
                
                if (href.startsWith('/')) href = `https://${domain}${href}`;
                else if (!href.startsWith('http')) href = `https://${domain}/${href}`;

                if (image.startsWith('/')) image = `https://${domain}${image}`;
                else if (!image.startsWith('http')) image = `https://${domain}/${image}`;

                results.push({ title, image, href });
            }
        }
        return results;
    } catch (err) {
        return [];
    }
}

// --- 3. DÉTAILS ---
async function extractDetails(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        const regex = /<p class="text-sm text-gray-400 mt-2">(.*?)<\/p>/is;
        const match = regex.exec(html);

        const description = match ? match[1].trim() : "Aucune description.";

        return JSON.stringify([{
            description: description,
            aliases: "N/A",
            airdate: "N/A"
        }]);
    } catch (err) {
        return JSON.stringify([{ description: "Erreur", aliases: "Erreur", airdate: "Erreur" }]);
    }
}

// --- 4. LISTE DES ÉPISODES (Fusion totale Langues + Lecteurs) ---
async function extractEpisodes(url) {
    const results = [];
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        
        const seasonRegex = /panneauAnime\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
        let match;
        
        const seasonsMap = {};
        const seasonNamesOrder = [];
        
        while ((match = seasonRegex.exec(html)) !== null) {
            let name = match[1].trim();
            let path = match[2].trim();
            
            if (!seasonsMap[name]) {
                seasonsMap[name] = { vostfr: null, vf: null };
                seasonNamesOrder.push(name);
            }
            
            if (path.includes('vostfr')) {
                seasonsMap[name].vostfr = `${url}/${path}`;
                if (!seasonsMap[name].vf) {
                    seasonsMap[name].vf = `${url}/${path.replace('vostfr', 'vf')}`;
                }
            } else if (path.includes('vf')) {
                seasonsMap[name].vf = `${url}/${path}`;
            } else {
                seasonsMap[name].vostfr = `${url}/${path}`;
            }
        }
        
        function getPlayersFromJs(js) {
            if (!js) return [];
            const arrays = [];
            const arrayRegex = /\[(.*?)\]/gs;
            let m;
            while ((m = arrayRegex.exec(js)) !== null) {
                const inner = m[1];
                if (!inner.includes('http')) continue;
                
                const urls = [];
                const stringRegex = /(?:'|")([^'"]+)(?:'|")/g;
                let strMatch;
                while ((strMatch = stringRegex.exec(inner)) !== null) {
                    urls.push(strMatch[1]);
                }
                if (urls.length > 0) arrays.push(urls); 
            }
            return arrays;
        }

        for (let i = 0; i < seasonNamesOrder.length; i++) {
            const seasonName = seasonNamesOrder[i];
            const seasonLinks = seasonsMap[seasonName];
            const logicalSeasonNumber = i + 1;
            
            const [vostfrRes, vfRes] = await Promise.all([
                seasonLinks.vostfr ? fetchv2(seasonLinks.vostfr).catch(() => null) : Promise.resolve(null),
                seasonLinks.vf ? fetchv2(seasonLinks.vf).catch(() => null) : Promise.resolve(null)
            ]);
            
            const scriptRegex = /<script[^>]+src=['"]([^'"]*episodes\.js[^'"]*?)['"][^>]*>/;
            let vostfrEpsJsUrl = null;
            let vfEpsJsUrl = null;
            
            if (vostfrRes) {
                const m = scriptRegex.exec(await vostfrRes.text());
                if (m) vostfrEpsJsUrl = seasonLinks.vostfr + '/' + m[1].trim();
            }
            if (vfRes) {
                const m = scriptRegex.exec(await vfRes.text());
                if (m) vfEpsJsUrl = seasonLinks.vf + '/' + m[1].trim();
            }
            
            const [vostfrJsRes, vfJsRes] = await Promise.all([
                vostfrEpsJsUrl ? fetchv2(vostfrEpsJsUrl).catch(() => null) : Promise.resolve(null),
                vfEpsJsUrl ? fetchv2(vfEpsJsUrl).catch(() => null) : Promise.resolve(null)
            ]);
            
            const vostfrPlayers = getPlayersFromJs(vostfrJsRes ? await vostfrJsRes.text() : "");
            const vfPlayers = getPlayersFromJs(vfJsRes ? await vfJsRes.text() : "");
            
            let maxEps = 0;
            vostfrPlayers.forEach(p => maxEps = Math.max(maxEps, p.length));
            vfPlayers.forEach(p => maxEps = Math.max(maxEps, p.length));
            
            for (let e = 0; e < maxEps; e++) {
                const epVostfrUrls = vostfrPlayers.map(p => p[e]).filter(Boolean);
                const epVfUrls = vfPlayers.map(p => p[e]).filter(Boolean);
                
                if (epVostfrUrls.length === 0 && epVfUrls.length === 0) continue;
                
                const payload = { vostfr: epVostfrUrls, vf: epVfUrls };
                
                let epTitle = `[${seasonName}] Épisode ${e + 1}`;
                if (maxEps === 1 && seasonName.toLowerCase().includes('film')) epTitle = seasonName;
                
                results.push({
                    href: encodeURIComponent(JSON.stringify(payload)), 
                    number: e + 1,
                    season: logicalSeasonNumber,
                    title: epTitle
                });
            }
        }
        
        return JSON.stringify(results);
    } catch (err) {
        return JSON.stringify([]);
    }
}

// --- 5. EXTRACTION VIDÉO (AVEC LE GLOBAL EXTRACTOR) ---
async function extractStreamUrl(url) {
    try {
        let streams = [];

        // Sous-fonction qui utilise le Global Extractor de JMcrafter26
        async function resolveStream(link, langLabel, playerIndex) {
            if (!link) return;
            try {
                let label = `${langLabel} - Lecteur ${playerIndex}`;
                
                // Si c'est un lien direct (MP4/MKV), pas besoin d'extracteur
                if (/\.(mp4|mkv|avi|mov|webm)(\?.*)?$/i.test(link)) {
                    streams.push({ title: `${label} (Direct)`, streamUrl: link });
                    return;
                }

                // 🌟 L'APPEL AU GLOBAL EXTRACTOR 🌟
                // On met le lien dans un objet (comme l'exige l'extracteur global)
                let providerTest = {};
                // On détecte le domaine pour aider l'extracteur
                let domain = link.match(/https?:\/\/(?:www\.)?([^/]+)/i);
                let providerName = domain ? domain[1].split('.')[0] : "direct";
                
                // On masque "sendvid", "smoothpre", etc. via le dictionnaire
                providerTest[link] = providerName; 

                // On lance la machine (multiExtractor vient du code collé en bas)
                const extracted = await multiExtractor(providerTest);
                
                if (extracted && extracted.length > 0) {
                    extracted.forEach(ext => {
                        streams.push({
                            title: `${label} (${ext.title || 'Auto'})`,
                            streamUrl: ext.streamUrl,
                            headers: ext.headers || {}
                        });
                    });
                } else {
                    // Si l'extracteur échoue ou ne connaît pas le lecteur (ex: Sibnet), 
                    // on le passe en mode "Webview" pour que Sora ouvre la page web.
                    streams.push({ title: `${label} (Lecteur Web)`, streamUrl: `webview://${link}` });
                }
            } catch (err) {
                console.log(`[AnimeSama] Echec résolution ${langLabel} lecteur ${playerIndex} : ` + err);
            }
        }

        let data;
        try {
            data = JSON.parse(decodeURIComponent(url));
        } catch (e) {
            data = { vostfr: [url], vf: [] };
        }

        const promises = [];
        
        if (data.vostfr && Array.isArray(data.vostfr)) {
            data.vostfr.forEach((link, idx) => promises.push(resolveStream(link, "VOSTFR", idx + 1)));
        }
        if (data.vf && Array.isArray(data.vf)) {
            data.vf.forEach((link, idx) => promises.push(resolveStream(link, "VF", idx + 1)));
        }

        await Promise.all(promises);
        return JSON.stringify({ streams: streams, subtitles: "" });

    } catch (err) {
        console.log('[AnimeSama] Erreur extractStreamUrl: ' + err);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}


// =========================================================================
// ==================== GLOBAL EXTRACTOR (JMcrafter26) =====================
// =========================================================================

async function soraFetch(url, options = { headers: {}, method: "GET", body: null }) {
  try {
    return await fetchv2(url, options.headers ?? {}, options.method ?? "GET", options.body ?? null);
  } catch (e) {
    try {
      return await fetch(url, options);
    } catch (error) {
      return null;
    }
  }
}

function globalExtractor(providers) {
  for (const [url, provider] of Object.entries(providers)) {
    try {
      const streamUrl = extractStreamUrlByProvider(url, provider);
      if (streamUrl && typeof streamUrl === "object" && !Array.isArray(streamUrl) && streamUrl.streamUrl) {
        return streamUrl.streamUrl;
      }
      if (streamUrl && typeof streamUrl === "string" && streamUrl.startsWith("http")) {
        return streamUrl;
      } else if (Array.isArray(streamUrl)) {
        const httpStream = streamUrl.find(stream => typeof stream.streamUrl === "string" && stream.streamUrl.startsWith("http"));
        if (httpStream) {
          return httpStream.streamUrl;
        }
      }
    } catch (e) {
      console.log(`Failed to extract for provider ${provider}: ${e.message}`);
    }
  }
  return null;
}

async function multiExtractor(providers) {
  let streams = [];
  for (const [url, provider] of Object.entries(providers)) {
    try {
      const streamUrl = await extractStreamUrlByProvider(url, provider);
      if (streamUrl && typeof streamUrl === "object" && !Array.isArray(streamUrl) && streamUrl.streamUrl) {
        streams.push(streamUrl);
      } else if (streamUrl && typeof streamUrl === "string" && streamUrl.startsWith("http")) {
        streams.push({
          title: provider,
          streamUrl: streamUrl
        });
      } else if (Array.isArray(streamUrl)) {
        streams.push(...streamUrl);
      }
    } catch (e) {
      console.log(`Failed to extract for provider ${provider}: ${e.message}`);
    }
  }
  return streams;
}

async function extractStreamUrlByProvider(url, provider) {
  switch (provider) {
    case "doodstream":
      return await doodExtractor(url);
    case "streamtape":
      return await streamtapeExtractor(url);
    case "mixdrop":
      return await mixdropExtractor(url);
    case "vidmoly":
      return await vidmolyExtractor(url);
    case "uqload":
      return await uqloadExtractor(url);
    case "voe":
      return await voeExtractor(url);
    case "upvid":
      return await upvidExtractor(url);
    case "filemoon":
      return await filemoonExtractor(url);
    case "streamwish":
      return await streamwishExtractor(url);
    case "sendvid":
      return await sendvidExtractor(url);
    case "smoothpre":
      return await smoothpreExtractor(url);
    default:
      throw new Error("Provider not supported: " + provider);
  }
}

// ==================== EXTRACTEURS SPÉCIFIQUES ====================

async function sendvidExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const match = html.match(/var\s+video_source\s*=\s*"([^"]+)"/);
  return match ? { title: "Sendvid", streamUrl: match[1] } : null;
}

async function smoothpreExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const obfuscatedScript = html.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d.*?\)[\s\S]*?)<\/script>/);
  if (obfuscatedScript) {
    const unpackedScript = unpack(obfuscatedScript[1]);
    const hls2Match = unpackedScript.match(/"hls2"\s*:\s*"([^"]+)"/);
    if (hls2Match) {
      return { title: "Smoothpre", streamUrl: hls2Match[1] };
    }
  }
  return null;
}

async function doodExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const md5Match = html.match(/\/pass_md5\/([a-zA-Z0-9_-]+)/);
  if (!md5Match) return null;
  const md5 = md5Match[1];
  const tokenMatch = html.match(/makePlay\('([^']+)'/);
  if (!tokenMatch) return null;
  const token = tokenMatch[1];
  const passUrl = `https://${url.split("/")[2]}/pass_md5/${md5}`;
  const passResponse = await soraFetch(passUrl, { headers: { Referer: url } });
  const passText = await passResponse.text();
  const streamUrl = `${passText}zUEJeL3mUN?token=${token}&expiry=${Date.now()}`;
  return { title: "Doodstream", streamUrl: streamUrl, headers: { Referer: url } };
}

async function streamtapeExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const scriptMatch = html.match(/document\.getElementById\('robotlink'\)\.innerHTML\s*=\s*(.*);/);
  if (!scriptMatch) return null;
  const parts = scriptMatch[1].split("+");
  let finalUrl = "https:";
  for (let part of parts) {
    part = part.trim();
    if (part.startsWith("'") || part.startsWith('"')) {
      finalUrl += part.replace(/['"]/g, "");
    } else if (part.includes("substring")) {
      const subMatch = part.match(/'([^']+)'\.substring\(([^)]+)\)/);
      if (subMatch) {
        finalUrl += subMatch[1].substring(eval(subMatch[2]));
      }
    }
  }
  return { title: "Streamtape", streamUrl: finalUrl };
}

async function mixdropExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\).*?split\('\|'\).*?\)/);
  if (!packedMatch) return null;
  const unpacked = unpack(packedMatch[0]);
  const urlMatch = unpacked.match(/MDCore\.wurl="(.*?)";/);
  if (urlMatch) {
    let stream = urlMatch[1];
    if (stream.startsWith("//")) stream = "https:" + stream;
    return { title: "Mixdrop", streamUrl: stream };
  }
  return null;
}

async function vidmolyExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const m3u8Match = html.match(/file:\s*"([^"]+\.m3u8[^"]*)"/);
  if (m3u8Match) return { title: "Vidmoly", streamUrl: m3u8Match[1] };
  const mp4Match = html.match(/file:\s*"([^"]+\.mp4[^"]*)"/);
  if (mp4Match) return { title: "Vidmoly", streamUrl: mp4Match[1] };
  return null;
}

async function uqloadExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const m3u8Match = html.match(/sources:\s*\["([^"]+\.m3u8)"\]/);
  if (m3u8Match) return { title: "Uqload", streamUrl: m3u8Match[1], headers: { Referer: url } };
  const mp4Match = html.match(/sources:\s*\["([^"]+\.mp4)"\]/);
  if (mp4Match) return { title: "Uqload", streamUrl: mp4Match[1], headers: { Referer: url } };
  return null;
}

async function voeExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const jsonMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!jsonMatch) return null;
  const data = JSON.parse(jsonMatch[1].trim());
  let str = data[0];
  str = str.replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
  ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(p => str = str.split(p).join(""));
  str = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("utf-8");
  str = str.split("").map(c => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
  str = str.split("").reverse().join("");
  str = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("utf-8");
  const result = JSON.parse(str);
  const streamUrl = result.direct_access_url || (result.source && result.source.find(s => s.direct_access_url && s.direct_access_url.startsWith("http"))?.direct_access_url);
  return streamUrl ? { title: "Voe", streamUrl: streamUrl } : null;
}

async function upvidExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const match = html.match(/eval\(function\(p,a,c,k,e,d\).*?split\('\|'\).*?\)/);
  if (match) {
    const unpacked = unpack(match[0]);
    const m3u8 = unpacked.match(/src:\s*"([^"]+\.m3u8[^"]*)"/);
    if (m3u8) return { title: "Upvid", streamUrl: m3u8[1] };
  }
  return null;
}

async function filemoonExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const match = html.match(/eval\(function\(p,a,c,k,e,d\).*?split\('\|'\).*?\)/);
  if (match) {
    const unpacked = unpack(match[0]);
    const m3u8 = unpacked.match(/file:\s*"([^"]+\.m3u8[^"]*)"/);
    if (m3u8) return { title: "Filemoon", streamUrl: m3u8[1] };
  }
  return null;
}

async function streamwishExtractor(url) {
  const response = await soraFetch(url);
  const html = await response.text();
  const match = html.match(/eval\(function\(p,a,c,k,e,d\).*?split\('\|'\).*?\)/);
  if (match) {
    const unpacked = unpack(match[0]);
    const m3u8 = unpacked.match(/file:\s*"([^"]+\.m3u8[^"]*)"/);
    if (m3u8) return { title: "Streamwish", streamUrl: m3u8[1] };
  }
  return null;
}

// ==================== OUTIL DE DECRYPTAGE "UNPACKER" ====================
class Unbaser {
  constructor(base) {
    this.ALPHABET = {
      62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      95: "' !\"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'",
    };
    this.dictionary = {};
    this.base = base;
    if (36 < base && base < 62) {
      this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
    }
    if (2 <= base && base <= 36) {
      this.unbase = (value) => parseInt(value, base);
    } else {
      [...this.ALPHABET[base]].forEach((cipher, index) => {
        this.dictionary[cipher] = index;
      });
      this.unbase = this._dictunbaser;
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

function detect(source) {
  return source.replace(" ", "").startsWith("eval(function(p,a,c,k,e,");
}

function unpack(source) {
  let { payload, symtab, radix, count } = _filterargs(source);
  if (count != symtab.length) throw Error("Malformed p.a.c.k.e.r. symtab.");
  let unbase;
  try {
    unbase = new Unbaser(radix);
  } catch (e) {
    throw Error("Unknown p.a.c.k.e.r. encoding.");
  }
  function lookup(match) {
    const word = match;
    let word2;
    if (radix == 1) {
      word2 = symtab[parseInt(word)];
    } else {
      word2 = symtab[unbase.unbase(word)];
    }
    return word2 || word;
  }
  source = payload.replace(/\b\w+\b/g, lookup);
  return source;
  
  function _filterargs(source) {
    const juicers = [
      /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
      /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/,
    ];
    for (const juicer of juicers) {
      const args = juicer.exec(source);
      if (args) {
        try {
          return {
            payload: args[1],
            symtab: args[4].split("|"),
            radix: parseInt(args[2]),
            count: parseInt(args[3]),
          };
        } catch (e) {
          throw Error("Corrupted p.a.c.k.e.r. data.");
        }
      }
    }
    throw Error("Could not make sense of p.a.c.k.e.r data");
  }
}
