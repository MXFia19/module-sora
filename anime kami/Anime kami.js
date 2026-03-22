// ==========================================
// ⚙️ MODULE SORA — ANIME-KAMI.COM
// ==========================================

const BASE_URL = "https://anime-kami.com";

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
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
            perPage: 15,
            language: null,
            contentType: "both"
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

        return JSON.stringify(results);
    } catch (e) {
        console.log("[Anime-Kami] Erreur recherche : " + e);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        // Extraire l'ID et le slug depuis l'URL
        // Format: https://anime-kami.com/anime/{id}-{slug}
        const match = url.match(/\/anime\/([\d]+)-([^/?#]+)/);
        if (!match) return JSON.stringify([{ description: "URL invalide", aliases: "Anime-Kami" }]);

        const id = match[1];
        const slug = match[2];

        // On utilise l'API catalog pour récupérer les détails
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
            "Referer": BASE_URL + "/"
        };

        // Recherche par le slug pour retrouver les infos
        const payload = JSON.stringify({
            search: slug.replace(/-/g, " "),
            year: null,
            season: null,
            format: null,
            genres: [],
            sort: "ID_DESC",
            status: null,
            page: 1,
            perPage: 5,
            language: null,
            contentType: "both"
        });

        const response = await fetchv2(BASE_URL + "/api/catalog", headers, "POST", payload);
        const json = JSON.parse(await response.text());
        const data = json.data || json;

        // Trouver l'anime correspondant par ID
        const anime = data.find(a => String(a.id) === id) || data[0];

        if (!anime) return JSON.stringify([{ description: "Anime non trouvé", aliases: "Anime-Kami" }]);

        const description = anime.description?.fr || anime.description?.en || "Pas de description disponible.";
        const aliases = anime.alternativeTitles?.join(", ") || anime.title?.romaji || "";

        return JSON.stringify([{
            description: description,
            aliases: aliases,
            airdate: anime.seasonYear || ""
        }]);
    } catch (e) {
        console.log("[Anime-Kami] Erreur détails : " + e);
        return JSON.stringify([{ description: "Erreur de chargement", aliases: "Anime-Kami" }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        const match = url.match(/\/anime\/([\d]+)-([^/?#]+)/);
        if (!match) return JSON.stringify([]);

        const id = match[1];
        const slug = match[2];

        const headers = {
            "User-Agent": "Mozilla/5.0",
            "Referer": BASE_URL + "/"
        };

        const apiUrl = BASE_URL + "/api/episode/" + id + "-" + slug + "?releasing=false&refresh=true";
        const response = await fetchv2(apiUrl, headers, "GET");
        const json = JSON.parse(await response.text());

        const provider = json[0];
        if (!provider) return JSON.stringify([]);

        const results = [];

        // Épisodes VOSTFR
        if (provider.episodes && provider.episodes.length > 0) {
            for (const ep of provider.episodes) {
                results.push({
                    title: "[VOSTFR] Ep " + ep.number + (ep.title ? " - " + ep.title : ""),
                    name: "[VOSTFR] Ep " + ep.number + (ep.title ? " - " + ep.title : ""),
                    href: apiUrl + "&ep=" + ep.number + "&lang=vostfr",
                    number: ep.number,
                    season: 1
                });
            }
        }

        // Épisodes VF
        if (provider.episodesVF && provider.episodesVF.length > 0) {
            for (const ep of provider.episodesVF) {
                results.push({
                    title: "[VF] Ep " + ep.number + (ep.title ? " - " + ep.title : ""),
                    name: "[VF] Ep " + ep.number + (ep.title ? " - " + ep.title : ""),
                    href: apiUrl + "&ep=" + ep.number + "&lang=vf",
                    number: ep.number,
                    season: 1
                });
            }
        }

        return JSON.stringify(results);
    } catch (e) {
        console.log("[Anime-Kami] Erreur épisodes : " + e);
        return JSON.stringify([]);
    }
}

// --- 4. LECTEUR ---
async function extractStreamUrl(url) {
    try {
        // Parser les params depuis l'URL
        const urlObj = new URL(url);
        const epNumber = parseInt(urlObj.searchParams.get("ep")) || 1;
        const lang = urlObj.searchParams.get("lang") || "vostfr";

        // Reconstruire l'URL de l'API sans nos params custom
        const apiUrl = url.split("&ep=")[0];

        const headers = {
            "User-Agent": "Mozilla/5.0",
            "Referer": BASE_URL + "/"
        };

        const response = await fetchv2(apiUrl, headers, "GET");
        const json = JSON.parse(await response.text());
        const provider = json[0];
        if (!provider) return JSON.stringify([]);

        // Sélectionner la bonne liste d'épisodes
        const episodeList = (lang === "vf") ? provider.episodesVF : provider.episodes;
        const episode = episodeList?.find(ep => ep.number === epNumber);
        if (!episode || !episode.servers) return JSON.stringify([]);

        const streams = [];

        for (const key of Object.keys(episode.servers)) {
            const server = episode.servers[key];
            const serverUrl = server.server_url;
            const serverName = server.server_name || "Serveur " + key;
            const serverType = (server.server_type || "").toUpperCase();
            const quality = server.quality || "720";
            const prefix = "[" + serverType + "] ";

            // Sendvid — extraction du lien MP4 direct
            if (serverUrl.includes("sendvid")) {
                try {
                    const req = await fetchv2(serverUrl, { "Referer": BASE_URL + "/" }, "GET");
                    const html = await req.text();
                    const mp4Match = html.match(/<source[^>]+src=["']([^"']+\.mp4)["']/i)
                                  || html.match(/video_source\s*=\s*["']([^"']+)["']/i);
                    if (mp4Match) {
                        streams.push({
                            title: prefix + serverName + " (" + quality + "p)",
                            streamUrl: mp4Match[1],
                            headers: { "Referer": serverUrl }
                        });
                    }
                } catch (e) {}
            }
            // Sibnet — extraction du lien MP4
            else if (serverUrl.includes("sibnet.ru")) {
                try {
                    const req = await fetchv2(serverUrl, { "Referer": BASE_URL + "/" }, "GET");
                    const html = await req.text();
                    const srcMatch = html.match(/src:\s*["'](\/v\/[^"']+\.mp4)["']/i);
                    if (srcMatch) {
                        let streamUrl = "https://video.sibnet.ru" + srcMatch[1];
                        streams.push({
                            title: prefix + serverName + " (" + quality + "p)",
                            streamUrl: streamUrl,
                            headers: { "Referer": serverUrl }
                        });
                    }
                } catch (e) {}
            }
            // VOE — extraction via voeExtractor
            else if (serverUrl.includes("voe")) {
                try {
                    const voeRes = await fetchv2(serverUrl, { "Referer": BASE_URL + "/" }, "GET");
                    const streamUrl = voeExtractor(await voeRes.text());
                    if (streamUrl) {
                        streams.push({
                            title: prefix + serverName + " (" + quality + "p)",
                            streamUrl: streamUrl,
                            headers: { "Referer": serverUrl }
                        });
                    }
                } catch (e) {}
            }
            // VidCDN / CDN / autres — source iframe directe
            else {
                streams.push({
                    title: prefix + serverName + " (" + quality + "p)",
                    streamUrl: serverUrl,
                    headers: { "Referer": BASE_URL + "/" }
                });
            }
        }

        return JSON.stringify(streams);
    } catch (e) {
        console.log("[Anime-Kami] Erreur lecteur : " + e);
        return JSON.stringify([]);
    }
}
