// ==========================================
// ⚙️ MODULE MOVIX (Interface TMDB + Super Agrégateur Movix + Télémétrie)
// ==========================================

const TMDB_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";

// ==========================================
// 🗄️ TRACKER SUPABASE (Statistiques)
// ==========================================
const SUPABASE_URL = "https://qyeisgowjisqbatrmqta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F68CBjFVPh71U0SdD9BQJg_UJgL9-Fj";

async function sendSupabaseLog(moduleName, actionType, dataPayload) {
    try {
        const payload = { module: moduleName, action: actionType, data: dataPayload };
        const headers = { 
            "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Prefer": "return=minimal" 
        };
        if (typeof fetchv2 !== 'undefined') {
            await fetchv2(`${SUPABASE_URL}/rest/v1/app_logs`, headers, "POST", JSON.stringify(payload));
        } else {
            await fetch(`${SUPABASE_URL}/rest/v1/app_logs`, { method: "POST", headers: headers, body: JSON.stringify(payload) });
        }
    } catch (e) { }
}

// --- GESTIONNAIRE DE REQUÊTES ROBUSTE (soraFetch) ---
async function soraFetch(url, options = {}) {
    let finalHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...(options.headers || {})
    };

    if (url.includes('movix.cash')) {
        if (!finalHeaders["Accept"]) finalHeaders["Accept"] = "application/json";
        if (!finalHeaders["Referer"]) finalHeaders["Referer"] = "https://movix.cash/";
        if (!finalHeaders["Origin"]) finalHeaders["Origin"] = "https://movix.cash";
    } else {
        if (!finalHeaders["Accept"]) finalHeaders["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
    }

    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, finalHeaders, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'UTF-8');
        } else {
            return await fetch(url, { headers: finalHeaders, method: options.method ?? 'GET' });
        }
    } catch(e) {
        try {
            return await fetch(url, { headers: finalHeaders, method: options.method ?? 'GET' });
        } catch(error) {
            console.log(`[soraFetch] Erreur fatale sur ${url} : ${error}`);
            return null;
        }
    }
}

// ==========================================
// 1. RECHERCHE (100% TMDB)
// ==========================================
async function searchResults(keyword) {
    console.log(`\n=========================================================`);
    console.log(`[Movix | 🔍 Recherche] Lancement pour : "${keyword}"`);
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
                allResults.push({
                    title: item.name, 
                    image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                    href: `movix/tv/${item.id}`,
                    popularity: item.popularity + (item.original_language === 'ja' ? 1000 : 0)
                });
            }
        });

        (movieData.results || []).forEach(item => {
            if (item.poster_path) {
                allResults.push({
                    title: item.title,
                    image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                    href: `movix/movie/${item.id}`,
                    popularity: item.popularity
                });
            }
        });

        allResults.sort((a, b) => b.popularity - a.popularity);
        
        console.log(`[Movix | 🔍 Recherche] ✅ ${allResults.length} résultats trouvés pour "${keyword}".`);
        sendSupabaseLog("Movix", "SEARCH", { 
            keyword: keyword, results_count: allResults.length, top_results: allResults.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(allResults);
    } catch (e) {
        console.log(`[Movix | 🚨 Erreur] Recherche TMDB : ${e.message}`);
        return JSON.stringify([]);
    }
}

// ==========================================
// 2. DÉTAILS (100% TMDB)
// ==========================================
async function extractDetails(href) {
    try {
        href = decodeURIComponent(href);
        const parts = href.split('/');
        const type = parts[1]; 
        const id = parts[2];

        console.log(`[Movix | 📂 TMDB] Chargement des détails pour l'ID ${id}...`);
        const detailsUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR`;
        const res = await soraFetch(detailsUrl);
        if (!res) throw new Error("Réponse vide de TMDB");
        
        const text = typeof res === "string" ? res : await res.text();
        const details = JSON.parse(text);

        console.log(`[Movix | 📂 TMDB] ✅ Détails chargés : ${details.title || details.name}`);
        sendSupabaseLog("Movix", "DETAILS", { tmdb_id: id, type: type, title: details.title || details.name });

        return JSON.stringify([{
            description: details.overview || "Aucune description disponible pour ce contenu.",
            aliases: `Type: ${type === 'movie' ? 'Film' : 'Série'}`,
            airdate: `Date: ${details.release_date || details.first_air_date || 'N/A'}`
        }]);
    } catch (e) {
        console.log(`[Movix | 🚨 Erreur] Détails TMDB : ${e.message}`);
        return JSON.stringify([{ description: "Erreur lors du chargement des détails.", aliases: "", airdate: "" }]);
    }
}

// ==========================================
// 3. ÉPISODES (100% TMDB pour les miniatures)
// ==========================================
async function extractEpisodes(href) {
    try {
        href = decodeURIComponent(href);
        const parts = href.split('/');
        const type = parts[1]; 
        const id = parts[2];
        let episodes = [];

        console.log(`[Movix | 📺 TMDB] Génération des épisodes pour l'ID ${id}...`);
        const detailsUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=fr-FR`;
        const res = await soraFetch(detailsUrl);
        if (!res) return JSON.stringify([]);
        
        const text = typeof res === "string" ? res : await res.text();
        const details = JSON.parse(text);

        if (type === 'movie') {
            episodes.push({
                number: 1,
                title: details.title || "Le Film",
                image: details.backdrop_path ? `https://image.tmdb.org/t/p/w500${details.backdrop_path}` : "",
                href: `stream/movie/${id}`
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
                                    season: sNum,
                                    title: ep.name ? `S${sNum}E${ep.episode_number} - ${ep.name}` : `Épisode ${ep.episode_number}`,
                                    image: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : "",
                                    href: `stream/tv/${id}/${sNum}/${ep.episode_number}`
                                });
                            });
                        }
                    } catch (err) { }
                }
            }
        }
        
        console.log(`[Movix | 📺 TMDB] ✅ ${episodes.length} épisodes générés avec succès.`);
        return JSON.stringify(episodes);
    } catch (e) {
        console.log(`[Movix | 🚨 Erreur] Épisodes TMDB : ${e.message}`);
        return JSON.stringify([]);
    }
}

// ==========================================
// 4. LECTEUR (SUPER AGRÉGATEUR D'APIs)
// ==========================================
async function extractStreamUrl(href) {
    const startTime = Date.now();
    let mediaTitle = "Inconnu";
    let failedLinks = [];
    let skippedLinksCount = 0;
    
    try {
        const parts = href.split('/');
        const type = parts[1]; 
        const tmdbId = parts[2];
        const seasonNum = type === 'tv' ? parseInt(parts[3]) : 1;
        const episodeNum = type === 'tv' ? parseInt(parts[4]) : 1;

        console.log(`\n=========================================================`);
        console.log(`[Movix | 🚀 Agrégateur] 🎬 Lancement pour TMDB ID: ${tmdbId} (S${seasonNum} E${episodeNum})`);

        const tmdbUrl = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=fr-FR`;
        const tmdbRes = await soraFetch(tmdbUrl);
        if (!tmdbRes) throw new Error("Impossible de joindre TMDB");
        const tmdbData = JSON.parse(typeof tmdbRes === "string" ? tmdbRes : await tmdbRes.text());
        mediaTitle = type === 'movie' ? tmdbData.title : tmdbData.name;

        // 🍥 NOUVEAU : DÉTECTION ANIME
        const isAnime = tmdbData.original_language === 'ja' || (tmdbData.origin_country && tmdbData.origin_country.includes('JP'));

        // 🌟 TRADUCTEUR D'ID (TMDB -> Interne Movix) - Exécuté par défaut car utile pour les deux flux
        let movixInternalId = null;
        try {
            console.log(`[Movix | 🚀 Agrégateur] 🔄 Recherche de l'ID Interne Movix pour "${mediaTitle}"...`);
            let searchUrl = `https://api.movix.cash/api/search?title=${encodeURIComponent(mediaTitle)}`;
            let searchRes = await soraFetch(searchUrl);
            if (searchRes) {
                let searchJson = JSON.parse(await searchRes.text());
                if (searchJson && searchJson.results) {
                    // On cherche strictement le résultat qui a le même TMDB ID que nous !
                    let match = searchJson.results.find(r => String(r.tmdb_id) === String(tmdbId));
                    if (match) {
                        movixInternalId = match.id;
                        console.log(`[Movix | 🚀 Agrégateur] ✅ ID Interne trouvé : ${movixInternalId}`);
                    }
                }
            }
        } catch(e) {
            console.log(`[Movix | 🚀 Agrégateur] ⚠️ Échec de la traduction d'ID Interne.`);
        }

        let targetLinks = []; 

        // Ajout de la qualité (4K, 1080p...) dans le préfixe
        const addLink = (url, langStr, qualityStr = null) => {
            if (!url || typeof url !== 'string' || url.includes("void.mp4")) return;
            let l = (langStr || "").toUpperCase();
            let prefix = "[VF]";
            if (l.includes("VOSTFR") || l.includes("SUB")) prefix = "[VOSTFR]";
            else if (l.includes("VA") || l.includes("ENG")) prefix = "[VA]";
            else if (l.includes("VF") || l.includes("FRENCH") || l.includes("MULTI")) prefix = "[VF]";
            else if (l.length > 0 && l.length < 10) prefix = `[${l}]`;

            if (qualityStr) {
                let q = qualityStr.toUpperCase();
                if (q.includes("4K")) prefix += " 4K";
                else if (q.includes("1080")) prefix += " 1080p";
                else if (q.includes("720")) prefix += " 720p";
            }

            if (!targetLinks.find(t => t.url === url)) {
                targetLinks.push({ url, prefix });
            }
        };

        // --- DÉFINITION DES BLOCS DE RECHERCHE ---

        const runStandardAPIs = async () => {
            let fetchPromises = [];
            if (type === 'tv') {
                
                if (movixInternalId) {
                    let urlDL = `https://api.movix.cash/api/series/download/${movixInternalId}/season/${seasonNum}/episode/${episodeNum}`;
                    console.log(`   📡 [Sonde] Direct (Interne) : ${urlDL}`);
                    fetchPromises.push(soraFetch(urlDL).then(async r => {
                        if(!r) return;
                        const j = JSON.parse(await r.text());
                        if(j?.sources) j.sources.forEach(src => {
                            if (src.m3u8) addLink(src.m3u8, src.language, src.quality);
                            else addLink(src.src, src.language, src.quality);
                        });
                    }).catch(()=>{}));
                }

                let urlTMDB = `https://api.movix.cash/api/tmdb/tv/${tmdbId}?season=${seasonNum}&episode=${episodeNum}`;
                console.log(`   📡 [Sonde] TMDB : ${urlTMDB}`);
                fetchPromises.push(soraFetch(urlTMDB).then(async r => {
                    if(!r) return;
                    const j = JSON.parse(await r.text());
                    if(j?.current_episode?.player_links) j.current_episode.player_links.forEach(p => addLink(p.decoded_url, p.language, p.quality));
                }).catch(()=>{}));

                let urlPurstream = `https://api.movix.cash/api/purstream/tv/${tmdbId}/stream?season=${seasonNum}&episode=${episodeNum}`;
                console.log(`   📡 [Sonde] Purstream : ${urlPurstream}`);
                fetchPromises.push(soraFetch(urlPurstream).then(async r => {
                    if(!r) return;
                    const j = JSON.parse(await r.text());
                    if(j?.sources) j.sources.forEach(src => addLink(src.url, src.name));
                }).catch(()=>{}));

                let urlFstream = `https://api.movix.cash/api/fstream/tv/${tmdbId}/season/${seasonNum}`;
                console.log(`   📡 [Sonde] Fstream : ${urlFstream}`);
                fetchPromises.push(soraFetch(urlFstream).then(async r => {
                    if(!r) return;
                    const j = JSON.parse(await r.text());
                    const ep = j?.episodes?.[String(episodeNum)];
                    if(ep?.languages) Object.keys(ep.languages).forEach(lang => ep.languages[lang].forEach(p => addLink(p.url, lang, p.quality)));
                }).catch(()=>{}));

                let urlWiflix = `https://api.movix.cash/api/wiflix/tv/${tmdbId}/${seasonNum}`;
                console.log(`   📡 [Sonde] Wiflix : ${urlWiflix}`);
                fetchPromises.push(soraFetch(urlWiflix).then(async r => {
                    if(!r) return;
                    const j = JSON.parse(await r.text());
                    const ep = j?.episodes?.[String(episodeNum)];
                    if(ep) Object.keys(ep).forEach(lang => {
                        if(Array.isArray(ep[lang])) ep[lang].forEach(p => addLink(p.url, lang));
                    });
                }).catch(()=>{}));

                let urlCpasmal = `https://api.movix.cash/api/cpasmal/tv/${tmdbId}/${seasonNum}/${episodeNum}`;
                console.log(`   📡 [Sonde] Cpasmal : ${urlCpasmal}`);
                fetchPromises.push(soraFetch(urlCpasmal).then(async r => {
                    if(!r) return;
                    const j = JSON.parse(await r.text());
                    if(j?.links) Object.keys(j.links).forEach(lang => j.links[lang].forEach(p => addLink(p.url, lang)));
                }).catch(()=>{}));

                // 🌟 NOUVEAU : Sonde "Links" API
                let urlLinks = `https://api.movix.cash/api/links/tv/${tmdbId}?season=${seasonNum}&episode=${episodeNum}`;
                console.log(`   📡 [Sonde] Links : ${urlLinks}`);
                fetchPromises.push(soraFetch(urlLinks).then(async r => {
                    if(!r) return;
                    const j = JSON.parse(await r.text());
                    if(j?.success && j?.data) {
                        j.data.forEach(d => {
                            if(d.links) d.links.forEach(link => addLink(link, "VF")); // On assigne "VF" par défaut
                        });
                    }
                }).catch(()=>{}));

                let urlImdb = `https://api.movix.cash/api/imdb/tv/${tmdbId}`;
                console.log(`   📡 [Sonde] IMDB : ${urlImdb}`);
                fetchPromises.push(soraFetch(urlImdb).then(async r => {
                    if(!r) return;
                    const j = JSON.parse(await r.text());
                    if(j?.series?.[0]?.seasons) {
                        const s = j.series[0].seasons.find(x => String(x.number) === String(seasonNum));
                        if(s && s.episodes) {
                            const ep = s.episodes.find(x => String(x.number) === String(episodeNum));
                            if(ep && ep.versions) {
                                Object.keys(ep.versions).forEach(lang => {
                                    if(ep.versions[lang].players) ep.versions[lang].players.forEach(p => addLink(p.link, lang));
                                });
                            }
                        }
                    }
                }).catch(()=>{}));
            } else {
                
                if (movixInternalId) {
                    let urlDL = `https://api.movix.cash/api/movies/download/${movixInternalId}`;
                    console.log(`   📡 [Sonde] Direct (Interne) : ${urlDL}`);
                    fetchPromises.push(soraFetch(urlDL).then(async r => {
                        if(!r) return;
                        const j = JSON.parse(await r.text());
                        if(j?.sources) j.sources.forEach(src => {
                            if (src.m3u8) addLink(src.m3u8, src.language, src.quality);
                            else addLink(src.src, src.language, src.quality);
                        });
                    }).catch(()=>{}));
                }

                let urlTMDB = `https://api.movix.cash/api/tmdb/movie/${tmdbId}`;
                console.log(`   📡 [Sonde] TMDB : ${urlTMDB}`);
                fetchPromises.push(soraFetch(urlTMDB).then(async r => {
                     if(!r) return;
                     const j = JSON.parse(await r.text());
                     if(j?.player_links) j.player_links.forEach(p => addLink(p.decoded_url, p.language, p.quality));
                }).catch(()=>{}));
                
                let urlPurstream = `https://api.movix.cash/api/purstream/movie/${tmdbId}/stream`;
                console.log(`   📡 [Sonde] Purstream : ${urlPurstream}`);
                fetchPromises.push(soraFetch(urlPurstream).then(async r => {
                     if(!r) return;
                     const j = JSON.parse(await r.text());
                     if(j?.sources) j.sources.forEach(src => addLink(src.url, src.name));
                }).catch(()=>{}));
                
                let urlFstream = `https://api.movix.cash/api/fstream/movie/${tmdbId}`;
                console.log(`   📡 [Sonde] Fstream : ${urlFstream}`);
                fetchPromises.push(soraFetch(urlFstream).then(async r => {
                     if(!r) return;
                     const j = JSON.parse(await r.text());
                     if(j?.languages) Object.keys(j.languages).forEach(lang => j.languages[lang].forEach(p => addLink(p.url, lang, p.quality)));
                }).catch(()=>{}));
                
                let urlWiflix = `https://api.movix.cash/api/wiflix/movie/${tmdbId}`;
                console.log(`   📡 [Sonde] Wiflix : ${urlWiflix}`);
                fetchPromises.push(soraFetch(urlWiflix).then(async r => {
                     if(!r) return;
                     const j = JSON.parse(await r.text());
                     if(j?.links) Object.keys(j.links).forEach(lang => j.links[lang].forEach(p => addLink(p.url, lang)));
                }).catch(()=>{}));
                
                let urlCpasmal = `https://api.movix.cash/api/cpasmal/movie/${tmdbId}`;
                console.log(`   📡 [Sonde] Cpasmal : ${urlCpasmal}`);
                fetchPromises.push(soraFetch(urlCpasmal).then(async r => {
                     if(!r) return;
                     const j = JSON.parse(await r.text());
                     if(j?.links) Object.keys(j.links).forEach(lang => j.links[lang].forEach(p => addLink(p.url, lang)));
                }).catch(()=>{}));

                // 🌟 NOUVEAU : Sonde "Links" API
                let urlLinks = `https://api.movix.cash/api/links/movie/${tmdbId}`;
                console.log(`   📡 [Sonde] Links : ${urlLinks}`);
                fetchPromises.push(soraFetch(urlLinks).then(async r => {
                     if(!r) return;
                     const j = JSON.parse(await r.text());
                     if(j?.success && j?.data) {
                         j.data.forEach(d => {
                             if(d.links) d.links.forEach(link => addLink(link, "VF")); // On assigne "VF" par défaut
                         });
                     }
                }).catch(()=>{}));
            }

            await Promise.all(fetchPromises);
        };

        const runAnimeAPI = async () => {
            let absoluteEpisodeIndex = 0;
            if (tmdbData.seasons) {
                let validSeasons = tmdbData.seasons.filter(s => s.season_number > 0).sort((a, b) => a.season_number - b.season_number);
                for (let s of validSeasons) {
                    if (s.season_number < seasonNum) absoluteEpisodeIndex += s.episode_count;
                }
            }
            absoluteEpisodeIndex += episodeNum;
            console.log(`[Movix | 🚀 Agrégateur] 📊 Index Absolu pour l'Anime : Épisode n°${absoluteEpisodeIndex}`);

            let titlesToTry = [mediaTitle.trim()];
            if (tmdbData.original_name && tmdbData.original_name !== mediaTitle) titlesToTry.push(tmdbData.original_name.trim()); 
            if (mediaTitle.includes(' ')) {
                titlesToTry.push(mediaTitle.replace(/\s+/g, '').trim()); 
                titlesToTry.push(mediaTitle.toLowerCase().replace(/(^\w|\s\w)/g, m => m.toUpperCase()).trim()); 
                titlesToTry.push((mediaTitle.charAt(0).toUpperCase() + mediaTitle.slice(1).toLowerCase().replace(/\s+/g, '')).trim()); 
            }
            if (mediaTitle.includes(':')) titlesToTry.push(mediaTitle.split(':')[0].trim());
            titlesToTry = [...new Set(titlesToTry)];

            let movixData = [];
            for (let t of titlesToTry) {
                let movixUrl = `https://api.movix.cash/anime/search/${encodeURIComponent(t)}?includeSeasons=true&includeEpisodes=true`;
                console.log(`   📡 [Sonde] Secours Anime : ${movixUrl}`);
                let movixRes = await soraFetch(movixUrl);
                if (movixRes) {
                    let movixText = typeof movixRes === "string" ? movixRes : await movixRes.text();
                    try {
                        const parsed = JSON.parse(movixText);
                        let tempData = Array.isArray(parsed) ? parsed : (parsed.data || parsed.results || []);
                        if (tempData.length > 0) {
                            movixData = tempData;
                            break; 
                        }
                    } catch(e) {}
                }
            }

            if (movixData.length > 0) {
                const anime = movixData[0];
                let currentAbsIndex = 0;
                let exactMatch = null;
                let absMatch = null;

                if (anime.seasons) {
                    for (let season of anime.seasons) {
                        let sNumMatch = season.name.match(/\d+/);
                        let sNum = sNumMatch ? parseInt(sNumMatch[0]) : 0; 
                        if (season.episodes) {
                            for (let ep of season.episodes) {
                                currentAbsIndex++;
                                if (sNum === seasonNum && ep.index === episodeNum) exactMatch = ep.streaming_links;
                                if (currentAbsIndex === absoluteEpisodeIndex) absMatch = ep.streaming_links;
                            }
                        }
                    }
                }

                if (exactMatch) console.log(`[Movix | 🚀 Agrégateur] ✅ Correspondance exacte trouvée !`);
                else if (absMatch) console.log(`[Movix | 🚀 Agrégateur] 🔄 Décalage de saisons contourné via l'Index Absolu !`);

                let animeLinks = exactMatch || absMatch || [];
                for (let streamGroup of animeLinks) {
                    for (let playerUrl of streamGroup.players) {
                        addLink(playerUrl, streamGroup.language);
                    }
                }
            }
        };

        // --- GESTION DES FLUX AVEC FALLBACK INTELLIGENT ---

        if (isAnime) {
            console.log(`[Movix | 🚀 Agrégateur] 🍥 Contenu identifié comme ANIME (Japonais). Lancement de la sonde exclusive...`);
            await runAnimeAPI();
            if (targetLinks.length === 0) {
                console.log(`[Movix | 🚀 Agrégateur] ⚠️ Aucun lien Anime trouvé. Fallback sur les serveurs standards...`);
                await runStandardAPIs();
            }
        } else {
            console.log(`[Movix | 🚀 Agrégateur] 📡 Interrogation parallèle des APIs standards...`);
            await runStandardAPIs();
            if (targetLinks.length === 0) {
                console.log(`[Movix | 🚀 Agrégateur] ⚠️ Aucun lien via les réseaux standards. Tentative de secours via l'API Anime...`);
                await runAnimeAPI();
            }
        }

        if (targetLinks.length === 0) throw new Error("Contenu totalement introuvable sur le réseau Movix");

        console.log(`[Movix | 🚀 Agrégateur] 🎯 Bilan brut : ${targetLinks.length} liens récupérés.`);
        console.log(`[Movix | ⚙️ Extracteur] 🛠️ Début du nettoyage et décodage des liens...`);
        console.log(`---------------------------------------------------------`);

        const isHardUnsupported = (url) => {
            const u = url.toLowerCase();
            return u.includes("waaw") || u.includes("younetu") || u.includes("netu") || u.includes("hqq") ||
                   u.includes("veev") || u.includes("listeamed") || u.includes("up4fun") ||
                   u.includes("coflix"); // dingtezuni a été retiré pour pouvoir le décoder via Filemoon !
        };

        let streams = [];
        let extractionTasks = [];

        // ⏱️ NOUVEAU : Coupe-circuit (Timeout) pour éviter qu'un serveur bloque tout
        const withTimeout = (promise, ms, url) => {
            return Promise.race([
                promise,
                new Promise(resolve => setTimeout(() => {
                    console.log(`   ⏱️ [Timeout] Serveur très lent ignoré (>${ms/1000}s) : ${url}`);
                    resolve({ title: "Timeout Serveur", originalUrl: url });
                }, ms))
            ]);
        };

        for (let linkObj of targetLinks) {
            if (isHardUnsupported(linkObj.url)) {
                console.log(`   ⏭️ [Fast-Skip] Ignoré car trop lent/complexe : ${linkObj.url}`);
                failedLinks.push({ server_name: "Non Supporté (Complexe)", url: linkObj.url });
                skippedLinksCount++;
                continue;
            }
            // On accorde un maximum absolu de 10 secondes à chaque décodeur !
            extractionTasks.push(withTimeout(extractDirectVideo(linkObj.url, linkObj.prefix, linkObj.url), 10000, linkObj.url));
        }

        const results = await Promise.all(extractionTasks);
        for (let res of results) {
            if (res && res.streamUrl) {
                if (!streams.find(s => s.streamUrl === res.streamUrl)) streams.push(res);
            } else if (res && res.originalUrl) {
                failedLinks.push({ server_name: res.title || "Inconnu", url: res.originalUrl });
            }
        }

        console.log(`---------------------------------------------------------`);
        console.log(`[Movix | 🏁 Bilan final] 🎬 Titre : ${mediaTitle} (S${seasonNum} E${episodeNum})`);
        console.log(`   ✅ Liens valides et décodés : ${streams.length}`);
        console.log(`   💀 Liens morts / échoués : ${failedLinks.length - skippedLinksCount}`);
        console.log(`   ⏭️ Liens ignorés (Fast-Skip) : ${skippedLinksCount}`);
        console.log(`   ⏱️ Temps total d'exécution : ${Date.now() - startTime}ms`);
        console.log(`=========================================================\n`);

        sendSupabaseLog("Movix", "PLAYER", { 
            media_title: mediaTitle, season_number: seasonNum, ep_number: episodeNum, 
            streams_found: streams.length, hosts_scanned: targetLinks.length, execution_time_ms: Date.now() - startTime
        });
        
        if (failedLinks.length > 0 || streams.length === 0) {
            sendSupabaseLog("Movix", "UNSUPPORTED_HOSTS", { 
                media_title: mediaTitle, season_number: seasonNum, ep_number: episodeNum, 
                failed_count: failedLinks.length, failed_links: failedLinks 
            });
        }

        return JSON.stringify(streams.length > 0 ? { type: "servers", streams: streams } : { type: "none" });

    } catch (e) {
        console.log(`[Movix | 🚨 Erreur] Lecteur : ${e.message}`);
        sendSupabaseLog("Movix", "ERROR", { error_message: String(e) });
        return JSON.stringify({ type: "none" });
    }
}

// ==========================================
// 🛠️ DÉCODEURS DE LECTEURS (HOSTS)
// ==========================================
async function extractDirectVideo(embedUrl, langPrefix, originalUrl) {
    let urlLower = embedUrl.toLowerCase();
    let hostRecognized = false;
    let isDeleted = false;
    
    // Extraction du nom de domaine pour l'affichage propre dans les logs
    const hostDomain = (embedUrl.match(/https?:\/\/(?:www\.)?([^/]+)/i) || [])[1] || "inconnu";

    const checkIfDeleted = (html) => {
        const h = html.toLowerCase();
        return h.includes("file was deleted") || h.includes("file not found") ||
               h.includes("video not found") || h.includes("video is not found") ||
               h.includes("video deleted") || h.includes("file deleted") ||
               h.includes("404 not found") || h.includes("no longer exists") ||
               h.includes("no longer available") || h.includes("видео недоступно") ||
               h.includes("videostatus"); 
    };

    try {
        // 0. LIENS DIRECTS PURSTREAM/DOWNLOAD API (.m3u8 / .mp4)
        if (urlLower.endsWith(".m3u8") || urlLower.includes("master.m3u8") || urlLower.includes(".m3u8?")) {
            hostRecognized = true;
            console.log(`   ✅ [Serveur Direct] HLS extrait avec succès !`);
            return { title: `${langPrefix} Serveur Direct (HLS)`, streamUrl: embedUrl, headers: { "Referer": "https://movix.cash/" } };
        }
        if (urlLower.endsWith(".mp4") || urlLower.includes(".mp4?")) {
            hostRecognized = true;
            console.log(`   ✅ [Serveur Direct] MP4 extrait avec succès !`);
            return { title: `${langPrefix} Serveur Direct (MP4)`, streamUrl: embedUrl, headers: { "Referer": "https://movix.cash/" } };
        }

        console.log(`   ⏳ [Scan] ${hostDomain}...`);

        // 1. VOE (et clones reconnus comme ralphysuccessfull, jefferycontrolmodel)
        if (urlLower.includes("voe.sx") || urlLower.includes("voe.network") || urlLower.includes("voe") || urlLower.includes("lancewhosedifficult") || urlLower.includes("ralphysuccessfull") || urlLower.includes("voe1/newplayer") || urlLower.includes("jefferycontrolmodel")) {
            hostRecognized = true;
            let voeRes = await soraFetch(embedUrl);
            if (voeRes) {
                let voeHtml = await voeRes.text();
                if (checkIfDeleted(voeHtml)) isDeleted = true;

                const redirectMatch = voeHtml.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
                if (redirectMatch && redirectMatch[1]) {
                    voeRes = await soraFetch(redirectMatch[1]);
                    voeHtml = await voeRes.text();
                    if (checkIfDeleted(voeHtml)) isDeleted = true;
                }

                const streamUrl = voeExtractor(voeHtml);
                if (streamUrl) {
                    console.log(`   ✅ [VOE] Flux extrait avec succès !`);
                    const typeStr = streamUrl.includes(".m3u8") ? "HLS" : "MP4";
                    return { title: `${langPrefix} VOE (${typeStr})`, streamUrl: streamUrl, headers: { "Referer": embedUrl } };
                }
            }
        }
        // 2. STREAMTAPE
        else if (urlLower.includes("streamtape")) {
            hostRecognized = true;
            const stRes = await soraFetch(embedUrl);
            if (stRes) {
                const stHtml = await stRes.text();
                if (checkIfDeleted(stHtml)) isDeleted = true;

                const robotMatch = stHtml.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*[^;]+\(['"]([^'"]+)['"]\)/i);
                if (robotMatch) {
                    let tokenStr = robotMatch[1];
                    let directUrl = "https://streamtape.com" + tokenStr.substring(tokenStr.indexOf('/get_video')) + "&dl=1";
                    console.log(`   ✅ [Streamtape] Flux extrait avec succès !`);
                    return { title: `${langPrefix} Streamtape`, streamUrl: directUrl, headers: { "Referer": "https://streamtape.com/" } };
                }
            }
        }
        // 3. SIBNET
        else if (urlLower.includes("sibnet.ru")) {
            hostRecognized = true;
            const req = await soraFetch(embedUrl, { encoding: "windows-1251", headers: { "Referer": embedUrl } });
            if (req) {
                const html = await req.text();
                if (checkIfDeleted(html)) isDeleted = true;

                const srcMatch = html.match(/src:\s*["'](\/v\/[^"']+\.mp4)["']/i);
                if (srcMatch) {
                    let streamUrl = "https://video.sibnet.ru" + srcMatch[1];
                    try {
                        const redirectReq = await soraFetch(streamUrl, { method: "HEAD", headers: { "Referer": embedUrl } });
                        if (redirectReq && redirectReq.url && redirectReq.url !== streamUrl) streamUrl = redirectReq.url;
                    } catch(e) {}
                    console.log(`   ✅ [Sibnet] Flux extrait avec succès !`);
                    return { title: `${langPrefix} Sibnet`, streamUrl: streamUrl, headers: { "Referer": embedUrl, "User-Agent": "Mozilla/5.0" } };
                }
            }
        }
        // 4. VIDMOLY
        else if (urlLower.includes("vidmoly")) {
            hostRecognized = true;
            let fixedVidUrl = embedUrl.replace(/vidmoly\.(to|me|net|ru|is)/i, "vidmoly.biz");
            const vidRes = await soraFetch(fixedVidUrl, { headers: { "Referer": "https://vidmoly.biz/" } });
            if (vidRes) {
                const vidHtml = await vidRes.text();
                if (checkIfDeleted(vidHtml)) isDeleted = true;

                const fileMatch = vidHtml.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || vidHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                if (fileMatch) {
                    console.log(`   ✅ [Vidmoly] Flux extrait avec succès !`);
                    return { title: `${langPrefix} Vidmoly`, streamUrl: fileMatch[1], headers: { "Referer": "https://vidmoly.biz/" } };
                }
            }
        }
        // 5. VK / VKVIDEO
        else if (urlLower.includes("vk.com") || urlLower.includes("vkvideo.ru")) {
            hostRecognized = true;
            const req = await soraFetch(embedUrl, { headers: { "Referer": "https://vk.com/" } });
            if (req) {
                const html = await req.text();
                if (checkIfDeleted(html) || html.includes("error_msg")) isDeleted = true;
                
                let matches = [...html.matchAll(/"url([0-9]+)"\s*:\s*"([^"]+)"/g)];
                if (matches.length > 0) {
                    matches.sort((a, b) => parseInt(b[1]) - parseInt(a[1])); 
                    let streamUrl = matches[0][2].replace(/\\/g, '');
                    console.log(`   ✅ [VK] Flux ${matches[0][1]}p extrait avec succès !`);
                    return { title: `${langPrefix} VK [${matches[0][1]}p]`, streamUrl: streamUrl, headers: { "Referer": "https://vk.com/" } };
                }
                
                let hlsMatch = html.match(/"hls"\s*:\s*(?:\[[^\]]*"([^"]+\.m3u8[^"]*)"|"([^"]+\.m3u8[^"]*)")/i) || html.match(/"hls"\s*:\s*"([^"]+)"/i);
                if (hlsMatch) {
                    let streamUrl = (hlsMatch[1] || hlsMatch[2] || "").replace(/\\/g, '');
                    if (streamUrl) {
                        console.log(`   ✅ [VK] Flux HLS extrait avec succès !`);
                        return { title: `${langPrefix} VK (HLS)`, streamUrl: streamUrl, headers: { "Referer": "https://vk.com/" } };
                    }
                }
                
                let sourceMatch = html.match(/<source[^>]+src=["']([^"']+)["']/i);
                if (sourceMatch) {
                    console.log(`   ✅ [VK] Flux HTML extrait avec succès !`);
                    return { title: `${langPrefix} VK`, streamUrl: sourceMatch[1].replace(/&amp;/g, '&'), headers: { "Referer": "https://vk.com/" } };
                }
            }
        }
        // 6. UQLOAD
        else if (urlLower.includes("uqload")) {
            hostRecognized = true;
            const req = await soraFetch(embedUrl, { headers: { "Referer": embedUrl } });
            if (req) {
                 const html = await req.text();
                 if (checkIfDeleted(html)) isDeleted = true;
                 const srcMatch = html.match(/sources\s*:\s*\["([^"]+)"\]/i) || html.match(/src\s*:\s*"([^"]+\.mp4)"/i);
                 if (srcMatch) {
                     console.log(`   ✅ [Uqload] Flux extrait avec succès !`);
                     return { title: `${langPrefix} Uqload`, streamUrl: srcMatch[1], headers: { "Referer": "https://uqload.com/" } };
                 }
            }
        }
        // 🌟 7. DOODSTREAM / DOPLY / VIDPLY / PLAYMOGO
        else if (urlLower.includes("dood") || urlLower.includes("doply") || urlLower.includes("vidply") || urlLower.includes("playmogo")) {
            hostRecognized = true;
            console.log(`   🕵️ Extraction Doodstream en cours pour ${hostDomain}...`);
            const req = await soraFetch(embedUrl, { headers: { "Referer": embedUrl } });
            if (req) {
                 const html = await req.text();
                 if (checkIfDeleted(html)) isDeleted = true;
                 else {
                     let streamUrl = await doodstreamExtractor(html, embedUrl);
                     if (streamUrl) {
                         console.log(`   ✅ [Doodstream] Flux extrait avec succès !`);
                         return { title: `${langPrefix} Doodstream`, streamUrl: streamUrl, headers: { "Referer": embedUrl } };
                     }
                 }
            }
        }
        // 🌟 8. EARNVID ET CLONES (dingtezuni, callistanise)
        else if (urlLower.includes("earnvid") || urlLower.includes("dingtezuni") || urlLower.includes("callistanise")) {
            hostRecognized = true;
            console.log(`   🕵️ Extraction Earnvid en cours pour ${hostDomain}...`);
            const req = await soraFetch(embedUrl, { headers: { "Referer": embedUrl } });
            if (req) {
                 const html = await req.text();
                 if (checkIfDeleted(html)) isDeleted = true;
                 else {
                     // Utilisation du décodeur Packer universel pour Earnvid
                     let streamUrl = vidhideExtractor(html);
                     if (!streamUrl) {
                         const fileMatch = html.match(/sources\s*:\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i) || 
                                           html.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || 
                                           html.match(/src\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                         if (fileMatch) streamUrl = fileMatch[1];
                     }
                     if (streamUrl && streamUrl.startsWith("http")) {
                         console.log(`   ✅ [Earnvid] Flux extrait avec succès !`);
                         return { title: `${langPrefix} Earnvid`, streamUrl: streamUrl, headers: { "Referer": embedUrl } };
                     }
                 }
            }
        }
        // 🌟 9. FILEMOON ET CLONES (lukefirst, bysebuho)
        else if (urlLower.includes("filemoon") || urlLower.includes("lukefirst") || urlLower.includes("bysebuho")) {
            hostRecognized = true;
            console.log(`   🕵️ Extraction Filemoon en cours pour ${hostDomain}...`);
            let fmResult = await filemoonExtractor(embedUrl);
            
            if (fmResult && fmResult.url) {
                let qLabel = fmResult.quality ? ` [${fmResult.quality}]` : "";
                console.log(`   ✅ [Filemoon] Flux${qLabel} extrait avec succès !`);
                return { title: `${langPrefix} Filemoon${qLabel}`, streamUrl: fmResult.url, headers: { "Referer": embedUrl } };
            } else if (typeof fmResult === 'string') { // Fallback de sécurité
                console.log(`   ✅ [Filemoon] Flux extrait avec succès !`);
                return { title: `${langPrefix} Filemoon`, streamUrl: fmResult, headers: { "Referer": embedUrl } };
            }
        }
        // 🌟 10. DARKIBOX
        else if (urlLower.includes("darkibox")) {
            hostRecognized = true;
            console.log(`   🕵️ Extraction Darkibox en cours pour ${hostDomain}...`);
            
            // Headers plus robustes pour passer les sécurités (DDoS-Guard / Cloudflare)
            let uas = [
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
            ];
            const headers = { 
                "User-Agent": uas[embedUrl.length % uas.length],
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1"
            };

            let req = await soraFetch(embedUrl, { headers: headers });
            let html = req ? await req.text() : "";

            // Détection de page anti-bot (Cloudflare / DDoS-Guard)
            if (!html || html.includes("Cloudflare") || html.includes("Just a moment") || html.includes("DDoS-Guard")) {
                console.log(`   🛡️ [Darkibox] Protection anti-bot détectée. Tentative de contournement...`);
                // On essaie l'URL alternative /v/ qui est parfois moins protégée que /embed-
                let altUrl = embedUrl.replace('/embed-', '/v/').replace('.html', '');
                let altReq = await soraFetch(altUrl, { headers: headers });
                if (altReq) {
                    let altHtml = await altReq.text();
                    if (!altHtml.includes("Just a moment") && altHtml.length > html.length) {
                        html = altHtml;
                    }
                }
            }

            if (checkIfDeleted(html)) {
                isDeleted = true;
            } else {
                let streamUrl = null;
                
                // 1. Recherche précise VideoJS (nouveau lecteur)
                let srcMatch = html.match(/sources\s*:\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i);
                
                // 2. Recherche large M3U8 (fallback universel très agressif)
                if (!srcMatch) srcMatch = html.match(/(https?:\/\/[a-zA-Z0-9.-]+\.darkibox\.com\/[^"'\s]+\.m3u8[^"'\s]*)/i);
                if (!srcMatch) srcMatch = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);

                if (srcMatch && srcMatch[1]) {
                    streamUrl = srcMatch[1];
                } else {
                    // 3. Dernier espoir si script packer
                    streamUrl = vidhideExtractor(html);
                }

                if (streamUrl) {
                    console.log(`   ✅ [Darkibox] Flux extrait avec succès !`);
                    return { title: `${langPrefix} Darkibox`, streamUrl: streamUrl, headers: { "Referer": "https://darkibox.com/" } };
                } else {
                    console.log(`   ❌ [Darkibox] Échec : Aucun lien vidéo trouvé. (Taille HTML: ${html.length})`);
                    console.log(`   🔍 Code reçu: ${html.substring(0, 150).replace(/\n/g, ' ')}...`);
                }
            }
        }
        // 🌟 11. SAVEFILES ET CLONES (XFileSharing)
        else if (urlLower.includes("savefiles")) {
            hostRecognized = true;
            console.log(`   🕵️ Extraction Savefiles en cours pour ${hostDomain}...`);
            
            // Extraction du file_code depuis l'URL (ex: /e/7fozfy4mljyd ou /embed-7fozfy4mljyd)
            const videoIdMatch = embedUrl.match(/\/(?:e|v|embed)\/([a-zA-Z0-9]+)/i) || embedUrl.match(/embed-([a-zA-Z0-9]+)/i);
            
            if (videoIdMatch) {
                const videoId = videoIdMatch[1];
                const payload = `op=embed&file_code=${videoId}&auto=1&referer=`;
                
                try {
                    // On reproduit exactement le comportement du lecteur officiel
                    const req = await soraFetch(`https://${hostDomain}/dl`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Referer": embedUrl
                        },
                        body: payload
                    });
                    
                    if (req) {
                        const html = await req.text();
                        if (checkIfDeleted(html)) {
                            isDeleted = true;
                        } else {
                            // On cherche le code JWPlayer généré par la réponse POST
                            const srcMatch = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i) || 
                                             html.match(/src\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                            
                            if (srcMatch && srcMatch[1]) {
                                console.log(`   ✅ [Savefiles] Flux extrait avec succès !`);
                                return { title: `${langPrefix} Savefiles`, streamUrl: srcMatch[1], headers: { "Referer": `https://${hostDomain}/` } };
                            } else {
                                console.log(`   ❌ [Savefiles] Échec : Aucun lien trouvé dans le retour POST.`);
                            }
                        }
                    }
                } catch(e) {
                    console.log(`   🚨 [Savefiles] Erreur POST : ${e.message}`);
                }
            } else {
                console.log(`   ❌ [Savefiles] Impossible d'extraire le file_code depuis l'URL.`);
            }
        }
        // 🌟 12. FSVID (French-Stream / Packer)
        else if (urlLower.includes("fsvid")) {
            hostRecognized = true;
            console.log(`   🕵️ Extraction Fsvid en cours pour ${hostDomain}...`);
            
            // Fsvid EXIGE ce referer précis, sinon il renvoie une erreur 403 ou une fausse page
            const req = await soraFetch(embedUrl, { headers: { "Referer": "https://french-stream.one/" } });
            if (req) {
                 const html = await req.text();
                 if (checkIfDeleted(html)) isDeleted = true;
                 else {
                     // On envoie le code obfusqué (eval...) à notre décrypteur Packer
                     let streamUrl = vidhideExtractor(html);
                     
                     // Fallback si jamais ce n'est pas crypté
                     if (!streamUrl) {
                         const fileMatch = html.match(/sources\s*:\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i) || 
                                           html.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                         if (fileMatch) streamUrl = fileMatch[1];
                     }

                     if (streamUrl && streamUrl.startsWith("http")) {
                         console.log(`   ✅ [Fsvid] Flux extrait avec succès !`);
                         // On met french-stream.one en Referer final au cas où la vidéo elle-même soit protégée
                         return { title: `${langPrefix} Fsvid`, streamUrl: streamUrl, headers: { "Referer": "https://french-stream.one/" } };
                     }
                 }
            }
        }
        // 🌟 13. DETECTEUR UNIVERSEL (Pour Sendvid, Vidhide, Upvid, Vidoza, etc.)
        else {
            let hostName = hostDomain.split('.')[0];
            hostName = hostName.charAt(0).toUpperCase() + hostName.slice(1);
            hostRecognized = true; 

            const req = await soraFetch(embedUrl, { headers: { "Referer": embedUrl } });
            if (req) {
                const html = await req.text();
                if (checkIfDeleted(html)) isDeleted = true;
                else {
                    // Essai 1: Scripts cryptés (Packer)
                    let streamUrl = vidhideExtractor(html);
                    
                    // Essai 2: Modèle JWPlayer / VideoJS
                    if (!streamUrl) {
                        const fileMatch = html.match(/sources\s*:\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i) || 
                                          html.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || 
                                          html.match(/src\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                        if (fileMatch) streamUrl = fileMatch[1];
                    }

                    // Essai 3: Modèle HTML5 natif
                    if (!streamUrl) {
                        const sourceMatch = html.match(/<source[^>]+src=["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) ||
                                            html.match(/video_source\s*=\s*["']([^"']+)["']/i);
                        if (sourceMatch) streamUrl = sourceMatch[1];
                    }

                    if (streamUrl && streamUrl.startsWith("http")) {
                        console.log(`   ✅ [Universel] Flux extrait de ${hostName} !`);
                        return { title: `${langPrefix} ${hostName}`, streamUrl: streamUrl, headers: { "Referer": embedUrl } };
                    }
                }
            }
        }
    } catch (e) { 
        console.log(`   🚨 [Erreur] Crash du décodeur sur ${hostDomain} : ${e.message}`);
    }
    
    // --- GESTION INTELLIGENTE DES ÉCHECS ---
    if (!hostRecognized) {
        console.log(`   ❌ [Rejet] Serveur non pris en charge : ${hostDomain} -> ${originalUrl}`);
        return { title: `${langPrefix} Non Supporté`, originalUrl: originalUrl };
    } else if (isDeleted) {
        console.log(`   💀 [Mort] Vidéo supprimée (DMCA/404) sur : ${hostDomain} -> ${originalUrl}`);
        return { title: `${langPrefix} Vidéo Supprimée`, originalUrl: originalUrl };
    } else {
        console.log(`   ❌ [Échec] Format illisible ou protégé sur : ${hostDomain} -> ${originalUrl}`);
        return { title: `${langPrefix} Échec Extraction`, originalUrl: originalUrl };
    }
}

function voeExtractor(html) {
    try {
        const jsonScriptMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (!jsonScriptMatch) return null;
        
        let data = JSON.parse(jsonScriptMatch[1].trim());
        let step1 = data[0].replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
        let step2 = step1; 
        ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(pat => step2 = step2.split(pat).join(""));
        
        const safeAtob = (b64) => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
            let str = String(b64).replace(/=+$/, '');
            let output = '';
            for (let bc = 0, bs, buffer, idx = 0; buffer = str.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
                buffer = chars.indexOf(buffer);
            }
            return output;
        };
        
        let step3 = safeAtob(step2);
        let step4 = step3.split("").map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
        let step5 = step4.split("").reverse().join("");
        let step6 = safeAtob(step5);
        
        let result = JSON.parse(step6);
        return result.direct_access_url || (result.source && result.source.find(s => s.direct_access_url)?.direct_access_url) || null;
    } catch (e) { return null; }
}

function vidhideExtractor(html) {
    try {
        let directMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
        if (directMatch) return directMatch[1];
        
        if (html.includes('eval(function(p,a,c,k,e,d)')) {
            let packRegex = /eval\(function\(p,a,c,k,e,d\).*?\.split\('\|'\)\)\)/g;
            let packMatches = html.match(packRegex);
            if (packMatches) {
                for (let packed of packMatches) {
                    let argsMatch = packed.match(/}\s*\(\s*(['"])(.*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])(.*?)\5\.split\('\|'\)/);
                    if (argsMatch) {
                        let p = argsMatch[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
                        let a = parseInt(argsMatch[3], 10);
                        let c = parseInt(argsMatch[4], 10);
                        let k = argsMatch[6].split('|');
                        let e = function(c) { return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36)); };
                        while (c--) { if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]); }
                        let unpackedMatch = p.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
                        if (unpackedMatch) return unpackedMatch[1].replace(/\\\//g, "/").trim();
                    }
                }
            }
        }
    } catch (e) { }
    return null;
}

async function doodstreamExtractor(html, url) {
    try {
        const domainMatch = url.match(/https?:\/\/(.*?)\//);
        if (!domainMatch) return null;
        const streamDomain = domainMatch[1];
        
        const md5Match = html.match(/'\/pass_md5\/(.*?)'/);
        if (!md5Match) return null;
        
        const md5Path = md5Match[1];
        const token = md5Path.substring(md5Path.lastIndexOf("/") + 1);
        const expiryTimestamp = new Date().valueOf();
        const random = randomStr(10);

        const passResponse = await soraFetch(`https://${streamDomain}/pass_md5/${md5Path}`, {
            headers: { "Referer": url }
        });
        if (!passResponse) return null;
        
        const responseData = await passResponse.text();
        if (responseData && responseData.startsWith('http')) {
            return `${responseData}${random}?token=${token}&expiry=${expiryTimestamp}`;
        }
        return null;
    } catch (e) {
        return null;
    }
}

function randomStr(length) {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

async function filemoonExtractor(url) {
    let uas = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1.1 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Mobile Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.2 Safari/605.1.15",
        "Mozilla/5.0 (Linux; Android 11; Pixel 4 XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Mobile Safari/537.36",
    ];
    let headers = {
        "User-Agent": uas[(url.length) % uas.length],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": url,
        "Connection": "keep-alive",
        "x-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
    };
    
    // Suivre les redirections (bypass des clones)
    if (url && !url.match(/\/[de]\//)) {
        try {
            const response = await soraFetch(url, { headers, method: 'HEAD' });
            if (response && response.url && response.url !== url) {
                url = response.url;
            } else {
                const proxyResponseRaw = await soraFetch('https://passthrough-worker.simplepostrequest.workers.dev/noredirect?url=' + encodeURIComponent(url), { headers });
                if (proxyResponseRaw) {
                    let proxyResponse = JSON.parse(await proxyResponseRaw.text());
                    if (proxyResponse.location) url = proxyResponse.location;
                }
            }
        } catch(e) {}
    }

    const idMatch = url ? url.match(/\/[de]\/([a-zA-Z0-9]+)/) : null;
    const videoId = idMatch ? idMatch[1] : null;
    
    if (!videoId) {
        console.log(`   ❌ [Filemoon] Impossible de trouver l'ID vidéo dans : ${url}`);
        return null;
    }

    // On utilise le VRAI domaine du lien
    const domainMatch = url.match(/https?:\/\/([^/]+)/);
    const currentHost = domainMatch ? domainMatch[1] : "filemoon.to";
    
    const apiUrl = `https://${currentHost}/api/videos/${videoId}/playback`;
    
    try {
        console.log(`   🕵️ [Filemoon] API appelée : ${apiUrl}`);
        const response = await soraFetch(apiUrl, { headers });
        
        if (!response) {
            console.log(`   ❌ [Filemoon] L'API ${currentHost} n'a pas répondu (Code 403/404).`);
            return null;
        }
        
        const responseText = await response.text();
        
        // 🌟 NOUVEAU LOG : Aperçu de la réponse brute
        console.log(`   📥 [Filemoon] Réponse brute reçue : ${responseText.substring(0, 100)}...`);

        if (!responseText.includes("playback")) {
            console.log(`   ❌ [Filemoon] Réponse API inattendue : ${responseText.substring(0, 50)}...`);
            return null;
        }

        const json = JSON.parse(responseText);
        console.log(`   🔐 [Filemoon] Envoi de la clé au décrypteur PHP...`);
        const decryptor = new FileMoonDecryptor(json);
        const decrypted = await decryptor.decrypt();
        
        // 🌟 NOUVEAU LOG : Réponse JSON décryptée
        console.log(`   📄 [Filemoon] Contenu décrypté : ${JSON.stringify(decrypted)}`);
        
        if (decrypted && decrypted.sources && decrypted.sources.length > 0) {
            // Trie les sources par hauteur (height) décroissante pour prendre la meilleure qualité
            let bestSource = decrypted.sources.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
            
            if (bestSource && bestSource.url) {
                return { url: bestSource.url, quality: bestSource.label || "HD" };
            }
        }
        
        console.log(`   ❌ [Filemoon] Décryptage réussi, mais aucun lien final trouvé (Sources vides).`);
        return null;
    } catch (error) {
        console.log(`   🚨 [Filemoon] Crash pendant le processus : ${error.message}`);
        return null;
    }
}

class FileMoonDecryptor {
    constructor(data) { this.d = data.playback; }
    
    b64d(s) {
        const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(b64);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
            bytes[i] = decoded.charCodeAt(i);
        }
        return bytes;
    }
    
    concatBytes(...arrays) {
        const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.length;
        }
        return result;
    }
    
    async decrypt() {
        try {
            const phpEndpoint = 'https://api.jm26.net/decryptAESGCM/';
            const response = await soraFetch(phpEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key_parts: this.d.key_parts,
                    payload: this.d.payload,
                    iv: this.d.iv
                })
            });
            
            if(!response) return null;
            const resultText = await response.text();
            const result = JSON.parse(resultText);
            
            if (!result.success) return null;
            return result.data;
        } catch(e) {
            return null;
        }
    }
}