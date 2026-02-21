const TMDB_API_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";

async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const responseText = await soraFetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodedKeyword}&language=fr-FR&page=1&include_adult=false&sort_by=popularity.desc`);
        const data = await responseText.json();

        const transformedResults = data.results.map(result => {
            if(result.media_type === "movie" || result.title) {
                return {
                    title: result.title || result.name,
                    image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
                    href: `https://nakios.site/movie/${result.id}`
                };
            }
            else if(result.media_type === "tv" || result.name) {
                return {
                    title: result.name || result.title,
                    image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
                    href: `https://nakios.site/tv/${result.id}`
                };
            }
        });

        return JSON.stringify(transformedResults.filter(Boolean));
    } catch (error) {
        console.log('Fetch error in searchResults: ' + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        if(url.includes('movie')) {
            const match = url.match(/movie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];
            const responseText = await soraFetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&language=fr-FR`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'Aucune description disponible.',
                aliases: `Durée : ${data.runtime ? data.runtime + " minutes" : 'Inconnue'}`,
                airdate: `Date de sortie : ${data.release_date ? data.release_date : 'Inconnue'}`
            }];

            return JSON.stringify(transformedResults);
        } else if(url.includes('tv')) {
            const match = url.match(/tv\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];
            const responseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}?api_key=${TMDB_API_KEY}&language=fr-FR`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'Aucune description disponible.',
                aliases: `Durée : ${data.episode_run_time && data.episode_run_time.length ? data.episode_run_time[0] + " minutes" : 'Inconnue'}`,
                airdate: `Première diffusion : ${data.first_air_date ? data.first_air_date : 'Inconnue'}`
            }];

            return JSON.stringify(transformedResults);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Erreur lors du chargement de la description',
            aliases: 'Durée : Inconnue',
            airdate: 'Date : Inconnue'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        if(url.includes('movie')) {
            const match = url.match(/movie\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");
            const movieId = match[1];
            
            return JSON.stringify([
                { href: `${movieId}/movie`, number: 1, title: "Film Complet" }
            ]);
        } else if(url.includes('tv')) {
            const match = url.match(/tv\/(\d+)/);
            if (!match) throw new Error("Invalid URL format");
            const showId = match[1];
            
            const showResponseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}?api_key=${TMDB_API_KEY}&language=fr-FR`);
            const showData = await showResponseText.json();
            
            let allEpisodes = [];
            for (const season of showData.seasons) {
                const seasonNumber = season.season_number;

                if(seasonNumber === 0) continue; 
                
                const seasonResponseText = await soraFetch(`https://api.themoviedb.org/3/tv/${showId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=fr-FR`);
                const seasonData = await seasonResponseText.json();
                
                if (seasonData.episodes && seasonData.episodes.length) {
                    const episodes = seasonData.episodes.map(episode => ({
                        href: `${showId}/${seasonNumber}/${episode.episode_number}`,
                        number: episode.episode_number,
                        title: episode.name || `Épisode ${episode.episode_number}`
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

async function extractStreamUrl(url) {
    try {
        let streams = [];
        let showId = "";
        let seasonNumber = "";
        let episodeNumber = "";
        let isMovie = url.includes('movie');

        if (isMovie) {
            const parts = url.split('/');
            showId = parts[0]; 
        } else {
            const parts = url.split('/');
            showId = parts[0];         
            seasonNumber = parts[1];   
            episodeNumber = parts[2];  
        }

        let apiUrl = "";
        if (isMovie) {
            apiUrl = `https://api.nakios.site/api/sources/movie/${showId}`;
        } else {
            apiUrl = `https://api.nakios.site/api/sources/tv/${showId}/${seasonNumber}/${episodeNumber}`;
        }

        const response = await soraFetch(apiUrl, {
            headers: {
                "Origin": "https://nakios.site",
                "Referer": "https://nakios.site/"
            }
        });
        
        let data = {};
        try {
            data = await response.json();
        } catch(e) {
            console.log("[Nakios] L'API n'a pas renvoyé de JSON valide.");
            return JSON.stringify({ streams: [], subtitles: "" });
        }
        
        let rawStreams = [];
        
        function findStreams(obj, currentName = "Serveur Nakios") {
            if (obj === null || typeof obj !== 'object') return;
            
            if (Array.isArray(obj)) {
                obj.forEach(item => findStreams(item, currentName));
                return;
            }
            
            let name = obj.name || obj.title || obj.server || obj.language || obj.lang || currentName;
            
            for (const [key, value] of Object.entries(obj)) {
                let passName = name;

                if (["VF", "VOSTFR", "VFF", "VFQ", "FRENCH", "ENGLISH"].includes(key.toUpperCase())) {
                    passName = key.toUpperCase();
                }
                
                if (typeof value === 'string') {
                    let isVideoUrl = value.includes('.m3u8') || value.includes('.mp4') || value.includes('fsvid.lol');
                    let isApiUrl = value.startsWith('http') && ['url', 'link', 'file', 'src'].includes(key.toLowerCase());
                    
                    if (isVideoUrl || isApiUrl) {
                        let finalName = passName;
                        if (obj.quality) finalName += ` - ${obj.quality}`;
                        
                        rawStreams.push({ url: value, name: finalName });
                    }
                } else if (typeof value === 'object') {
                    findStreams(value, passName);
                }
            }
        }

        findStreams(data);

        let uniqueStreams = [];
        let seenUrls = new Set();
        for (let item of rawStreams) {
            if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                uniqueStreams.push(item);
            }
        }
        
        for (let item of uniqueStreams) {
            let finalUrl = item.url;
            
            if (item.url.startsWith('/')) {
                finalUrl = `https://api.nakios.site${item.url}`;
            } else if (!item.url.includes('nakios.site')) {
                finalUrl = `https://api.nakios.site/api/sources/proxy?url=${encodeURIComponent(item.url)}`;
            }

            streams.push({
                title: item.name, 
                streamUrl: finalUrl,
                headers: {
                    "Origin": "https://nakios.site",
                    "Referer": "https://nakios.site/"
                }
            });
        }

        return JSON.stringify({ streams, subtitles: "" });

    } catch (error) {
        console.log('[Nakios] Erreur extractStreamUrl: ' + error);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}

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
            return null;
        }
    }
}
