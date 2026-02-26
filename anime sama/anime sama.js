const BASE_URL = "https://v6.voiranime.com";

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    try {
        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(keyword)}&post_type=wp-manga`;
        const response = await fetchv2(searchUrl);
        const html = await response.text();

        const results = [];
        const cards = html.split('c-image-hover'); 
        
        for (let i = 1; i < cards.length; i++) {
            let card = cards[i];
            let hrefMatch = card.match(/href="([^"]+)"/i);
            let imgMatch = card.match(/data-src="([^"]+)"/i) || card.match(/src="([^"]+)"/i);
            let titleMatch = card.match(/title="([^"]+)"/i);
            
            if (hrefMatch && imgMatch && titleMatch) {
                let href = hrefMatch[1].trim();
                let image = imgMatch[1].trim();
                let title = titleMatch[1]
                    .replace(/&#8211;/g, "-")
                    .replace(/&#039;/g, "'")
                    .replace(/&amp;/g, "&")
                    .trim();

                let exists = results.find(r => r.href === href);
                if (!exists) results.push({ title, image, href });
            }
        }
        return JSON.stringify(results);
    } catch (error) {
        console.log('[VoirAnime] Erreur searchResults: ' + error);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();
        const descRegex = /<div class="summary__content[^>]*>([\s\S]*?)<\/div>/i;
        let match = descRegex.exec(html);

        let description = "Aucune description disponible.";
        if (match && match[1]) {
            description = match[1].replace(/<[^>]+>/g, '').trim();
        }

        return JSON.stringify([{ description, aliases: "VoirAnime", airdate: "N/A" }]);
    } catch (err) {
        return JSON.stringify([{ description: "Erreur", aliases: "Erreur", airdate: "Erreur" }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        const response = await fetchv2(url);
        let html = await response.text();
        let results = [];
        
        function extractFromHtml(sourceHtml) {
            let extracted = [];
            const liRegex = /<li class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
            let liMatch;
            while ((liMatch = liRegex.exec(sourceHtml)) !== null) {
                let innerHtml = liMatch[1];
                let aMatch = innerHtml.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
                if (aMatch) {
                    let href = aMatch[1].trim();
                    let title = aMatch[2].replace(/<[^>]+>/g, '').trim();
                    if (!href.includes('email-protection') && href.startsWith('http')) {
                        let numMatch = title.match(/\d+/);
                        let number = numMatch ? parseInt(numMatch[0]) : 1;
                        extracted.push({ href, number, season: 1, title });
                    }
                }
            }
            return extracted;
        }

        results = extractFromHtml(html);

        if (results.length === 0) {
            let idMatch = html.match(/(?:manga_id|data-id|data-post|rating-post-id)["']?\s*[:=]\s*["']?(\d+)/i);
            if (idMatch && idMatch[1]) {
                let ajaxResponse = await fetchv2(
                    "https://v6.voiranime.com/wp-admin/admin-ajax.php",
                    {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": url
                    },
                    "POST",
                    `action=manga_get_chapters&manga=${idMatch[1]}`
                );
                let ajaxHtml = await ajaxResponse.text();
                results = extractFromHtml(ajaxHtml);
            }
        }

        results.reverse();
        results.forEach((ep, index) => ep.number = index + 1);

        return JSON.stringify(results);
    } catch (err) {
        console.log('[VoirAnime] Erreur Episodes : ' + err);
        return JSON.stringify([]);
    }
}

// --- 4. VIDÉO (L'Aspirateur Universel) ---
async function extractStreamUrl(url) {
    try {
        let streams = [];
        const response = await fetchv2(url);
        const html = await response.text();

        let lecteursTrouves = [];

        // 1. Chercher les iframes classiques et lazy-loadées
        const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
        let match;
        while ((match = iframeRegex.exec(html)) !== null) {
            lecteursTrouves.push(match[1]);
        }

        // 2. Chercher dans les boutons de serveurs (Spécialité VoirAnime)
        const btnRegex = /(?:data-video|data-src|data-embed)=["']([^"']+)["']/gi;
        while ((match = btnRegex.exec(html)) !== null) {
            let contenuBouton = match[1];
            // Parfois VoirAnime met carrément le code HTML de l'iframe dans le bouton !
            if (contenuBouton.includes('<iframe')) {
                let subMatch = contenuBouton.match(/src=["']([^"']+)["']/i);
                if (subMatch) lecteursTrouves.push(subMatch[1]);
            } else {
                lecteursTrouves.push(contenuBouton);
            }
        }

        // 3. LE FILET DE SÉCURITÉ : On scanne TOUT le code source de la page à la recherche d'hébergeurs connus
        const knownHosts = ['vidmoly', 'sibnet', 'sendvid', 'uqload', 'voe', 'streamtape', 'dood', 'filemoon', 'mixdrop'];
        const allLinksRegex = /https?:\/\/[a-zA-Z0-9.\-]+\/[^"'\s<]+/gi;
        while ((match = allLinksRegex.exec(html)) !== null) {
            let link = match[0];
            if (knownHosts.some(host => link.includes(host))) {
                lecteursTrouves.push(link);
            }
        }

        // 4. Nettoyage : On enlève les doublons et les parasites
        let liensPropres = [];
        for (let lien of lecteursTrouves) {
            lien = lien.replace(/&amp;/g, '&'); // Nettoyage des caractères WordPress
            if (lien.startsWith('//')) lien = 'https:' + lien;
            
            if (lien.startsWith('http') && !liensPropres.includes(lien)) {
                liensPropres.push(lien);
            }
        }

        if (liensPropres.length === 0) {
            console.log("[VoirAnime] Aucun lecteur trouvé sur la page.");
            return JSON.stringify([]);
        }

        console.log(`[VoirAnime] J'ai trouvé ${liensPropres.length} lecteurs uniques ! Envoi au Global Extractor...`);

        // 5. Envoi au Global Extractor
        let providerTest = {};
        liensPropres.forEach((lien) => {
            let domain = lien.match(/https?:\/\/(?:www\.)?([^/]+)/i);
            let providerName = domain ? domain[1].split('.')[0] : "inconnu";
            providerTest[lien] = providerName;
        });

        const extracted = await multiExtractor(providerTest);

        if (extracted && extracted.length > 0) {
            extracted.forEach((ext, index) => {
                streams.push({
                    title: `Lecteur ${index + 1} (${ext.title || 'Auto'})`,
                    streamUrl: ext.streamUrl,
                    headers: ext.headers || {}
                });
            });
        }

        return JSON.stringify(streams);

    } catch (err) {
        console.log('[VoirAnime] Erreur extractStreamUrl: ' + err);
        return JSON.stringify([]);
    }
}

// =========================================================================
// ==================== GLOBAL EXTRACTOR (JMcrafter26) =====================
// =========================================================================

async function soraFetch(url, options = { headers: {}, method: "GET", body: null }) {
  try { return await fetchv2(url, options.headers ?? {}, options.method ?? "GET", options.body ?? null); } 
  catch (e) { try { return await fetch(url, options); } catch (error) { return null; } }
}

async function multiExtractor(providers) {
  let streams = [];
  for (const [url, provider] of Object.entries(providers)) {
    try {
      const streamUrl = await extractStreamUrlByProvider(url, provider);
      if (streamUrl && typeof streamUrl === "object" && !Array.isArray(streamUrl) && streamUrl.streamUrl) {
        streams.push(streamUrl);
      } else if (streamUrl && typeof streamUrl === "string" && streamUrl.startsWith("http")) {
        streams.push({ title: provider, streamUrl: streamUrl });
      } else if (Array.isArray(streamUrl)) {
        streams.push(...streamUrl);
      }
    } catch (e) { console.log(`Failed to extract for provider ${provider}: ${e.message}`); }
  }
  return streams;
}

async function extractStreamUrlByProvider(url, provider) {
  switch (provider) {
    case "doodstream": case "dood": return await doodExtractor(url);
    case "streamtape": return await streamtapeExtractor(url);
    case "mixdrop": return await mixdropExtractor(url);
    case "vidmoly": return await vidmolyExtractor(url);
    case "video": // Le sous-domaine de Sibnet est video.sibnet.ru
    case "sibnet": return await sibnetExtractor(url);
    case "uqload": return await uqloadExtractor(url);
    case "voe": return await voeExtractor(url);
    case "upvid": return await upvidExtractor(url);
    case "filemoon": return await filemoonExtractor(url);
    case "streamwish": return await streamwishExtractor(url);
    case "sendvid": return await sendvidExtractor(url);
    case "smoothpre": return await smoothpreExtractor(url);
    default: throw new Error("Provider not supported: " + provider);
  }
}

// Nouvelle fonction ultra-puissante pour Vidmoly
async function vidmolyExtractor(url) {
  try {
      const html = await (await soraFetch(url)).text();
      // Test 1 : Lien en clair
      let m3u8Match = html.match(/file:\s*"([^"]+\.m3u8[^"]*)"/);
      if (m3u8Match) return { title: "Vidmoly", streamUrl: m3u8Match[1] };
      
      // Test 2 : Lien caché par l'obfuscateur (Le nouveau piège de Vidmoly !)
      const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\).*?split\('\|'\).*?\)/);
      if (packedMatch) {
          const unpacked = unpack(packedMatch[0]);
          m3u8Match = unpacked.match(/file:\s*"([^"]+\.m3u8[^"]*)"/);
          if (m3u8Match) return { title: "Vidmoly", streamUrl: m3u8Match[1] };
      }
  } catch(e) {}
  return null;
}

// Nouvelle fonction pour hacker Sibnet
async function sibnetExtractor(url) {
  try {
      const html = await (await soraFetch(url)).text();
      const match = html.match(/player\.src\(\[\{src:\s*"([^"]+)"/);
      if (match) {
          let streamUrl = match[1];
          if (streamUrl.startsWith('/')) streamUrl = "https://video.sibnet.ru" + streamUrl;
          return { title: "Sibnet", streamUrl: streamUrl, headers: { Referer: url } };
      }
  } catch(e) {}
  return null;
}


async function uqloadExtractor(url) {
  const html = await (await soraFetch(url)).text();
  const m3u8Match = html.match(/sources:\s*\["([^"]+\.m3u8)"\]/);
  if (m3u8Match) return { title: "Uqload", streamUrl: m3u8Match[1], headers: { Referer: url } };
  const mp4Match = html.match(/sources:\s*\["([^"]+\.mp4)"\]/);
  return mp4Match ? { title: "Uqload", streamUrl: mp4Match[1], headers: { Referer: url } } : null;
}

async function voeExtractor(url) {
  const html = await (await soraFetch(url)).text();
  const jsonMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!jsonMatch) return null;
  let str = JSON.parse(jsonMatch[1].trim())[0];
  str = str.replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
  ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(p => str = str.split(p).join(""));
  str = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("utf-8");
  str = str.split("").map(c => String.fromCharCode(c.charCodeAt(0) - 3)).join("").split("").reverse().join("");
  str = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("utf-8");
  const result = JSON.parse(str);
  const streamUrl = result.direct_access_url || (result.source && result.source.find(s => s.direct_access_url?.startsWith("http"))?.direct_access_url);
  return streamUrl ? { title: "Voe", streamUrl: streamUrl } : null;
}

async function upvidExtractor(url) {
  const html = await (await soraFetch(url)).text();
  const match = html.match(/eval\(function\(p,a,c,k,e,d\).*?split\('\|'\).*?\)/);
  if (!match) return null;
  const m3u8 = unpack(match[0]).match(/src:\s*"([^"]+\.m3u8[^"]*)"/);
  return m3u8 ? { title: "Upvid", streamUrl: m3u8[1] } : null;
}

async function filemoonExtractor(url) {
  const html = await (await soraFetch(url)).text();
  const match = html.match(/eval\(function\(p,a,c,k,e,d\).*?split\('\|'\).*?\)/);
  if (!match) return null;
  const m3u8 = unpack(match[0]).match(/file:\s*"([^"]+\.m3u8[^"]*)"/);
  return m3u8 ? { title: "Filemoon", streamUrl: m3u8[1] } : null;
}

async function streamwishExtractor(url) {
  const html = await (await soraFetch(url)).text();
  const match = html.match(/eval\(function\(p,a,c,k,e,d\).*?split\('\|'\).*?\)/);
  if (!match) return null;
  const m3u8 = unpack(match[0]).match(/file:\s*"([^"]+\.m3u8[^"]*)"/);
  return m3u8 ? { title: "Streamwish", streamUrl: m3u8[1] } : null;
}

class Unbaser {
  constructor(base) {
    this.ALPHABET = { 62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 95: "' !\"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'" };
    this.dictionary = {}; this.base = base;
    if (36 < base && base < 62) this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
    if (2 <= base && base <= 36) this.unbase = (value) => parseInt(value, base);
    else { [...this.ALPHABET[base]].forEach((cipher, index) => { this.dictionary[cipher] = index; }); this.unbase = this._dictunbaser; }
  }
  _dictunbaser(value) { let ret = 0; [...value].reverse().forEach((cipher, index) => { ret = ret + ((Math.pow(this.base, index)) * this.dictionary[cipher]); }); return ret; }
}

function unpack(source) {
  let { payload, symtab, radix, count } = _filterargs(source);
  if (count != symtab.length) throw Error("Malformed p.a.c.k.e.r. symtab.");
  let unbase = new Unbaser(radix);
  function lookup(match) { return (radix == 1 ? symtab[parseInt(match)] : symtab[unbase.unbase(match)]) || match; }
  return payload.replace(/\b\w+\b/g, lookup);
  function _filterargs(source) {
    const juicers = [ /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/, /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/ ];
    for (const juicer of juicers) {
      const args = juicer.exec(source);
      if (args) return { payload: args[1], symtab: args[4].split("|"), radix: parseInt(args[2]), count: parseInt(args[3]) };
    }
    throw Error("Could not make sense of p.a.c.k.e.r data");
  }
}
