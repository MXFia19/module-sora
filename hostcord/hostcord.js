```javascript
// ==========================================
// 🔓 SORA MODULE — ZXCSTREAM (CATALOGUE TMDB + CRACK)
// ==========================================

const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c"; // Clé publique TMDB
const ZXC_BASE_URL = "https://embed.zxcstream.xyz";

// ==========================================
// 🛠️ HELPERS (Analyse des URLs personnalisées)
// ==========================================
function parseQuery(queryString) {
    const params = {};
    const pairs = queryString.split('&');
    for (let pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const key = decodeURIComponent(pair.slice(0, idx));
        const val = decodeURIComponent(pair.slice(idx + 1));
        params[key] = val;
    }
    return params;
}

// ==========================================
// 🔍 1. RECHERCHE (Via TMDB)
// ==========================================
async function searchResults(keyword) {
    console.log(`[ZXC] 🔍 Recherche sur TMDB : "${keyword}"`);
    try {
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(keyword)}&page=1&include_adult=false&language=fr-FR`;
        const res = await soraFetch(url);
        if (!res) return JSON.stringify([]);

        const data = JSON.parse(await res.text());
        const results = [];

        for (let item of (data.results || [])) {
            if (item.media_type !== 'movie' && item.media_type !== 'tv') continue;

            const title = item.title || item.name || "Titre inconnu";
            const year = (item.release_date || item.first_air_date || '').split('-')[0];
            const image = item.poster_path
                ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                : 'https://via.placeholder.com/500x750?text=Pas+d+image';

            // On fabrique une URL interne "zxc://" pour passer les infos à la suite
            const href = `zxc://${item.media_type}/${item.id}?title=${encodeURIComponent(title)}&year=${year}`;

            results.push({
                title: year ? `${title} (${year})` : title,
                image,
                href
            });
        }

        console.log(`[ZXC] ✅ ${results.length} résultats trouvés.`);
        return JSON.stringify(results);
    } catch (e) {
        console.error(`[ZXC] ❌ Erreur Recherche: ${e.message}`);
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 2. DÉTAILS (Via TMDB)
// ==========================================
async function extractDetails(url) {
    console.log(`[ZXC] 📖 Chargement des détails...`);
    try {
        const match = url.match(/zxc:\/\/([^/]+)\/([^?]+)/);
        if (!match) throw new Error("URL interne invalide");

        const [, type, id] = match;
        const res = await soraFetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=fr-FR`);
        if (!res) throw new Error("Échec réseau TMDB");

        const data = JSON.parse(await res.text());

        return JSON.stringify([{
            description: data.overview || "Aucune description disponible.",
            aliases: `Note: ${data.vote_average ? data.vote_average.toFixed(1) + '/10' : 'N/A'}`,
            airdate: `Date: ${data.release_date || data.first_air_date || 'Inconnue'}`
        }]);
    } catch (e) {
        console.error(`[ZXC] ❌ Erreur Détails: ${e.message}`);
        return JSON.stringify([{ description: "Erreur de chargement." }]);
    }
}

// ==========================================
// 📂 3. ÉPISODES (Via TMDB)
// ==========================================
async function extractEpisodes(url) {
    console.log(`[ZXC] 📂 Chargement des épisodes...`);
    try {
        const match = url.match(/zxc:\/\/([^/]+)\/([^?]+)\?(.+)/);
        if (!match) throw new Error("URL interne invalide");

        const type = match[1];
        const id   = match[2];
        const params = parseQuery(match[3]);
        const title = params['title'] || "";
        const year  = params['year']  || "";

        // CAS A : C'est un Film
        if (type === 'movie') {
            return JSON.stringify([{
                href: `zxc-play://movie/${id}?title=${encodeURIComponent(title)}&year=${year}`,
                title: "Film Complet",
                number: 1,
                season: 1
            }]);
        }

        // CAS B : C'est une Série
        const res = await soraFetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&language=fr-FR`);
        if (!res) throw new Error("Échec réseau TMDB");
        const data = JSON.parse(await res.text());

        let episodes = [];
        const seasonPromises = (data.seasons || []).map(async (season) => {
            if (season.season_number === 0) return; // Ignorer les épisodes spéciaux

            const sRes = await soraFetch(
                `https://api.themoviedb.org/3/tv/${id}/season/${season.season_number}?api_key=${TMDB_API_KEY}&language=fr-FR`
            );
            if (!sRes) return;

            const sData = JSON.parse(await sRes.text());
            for (let ep of (sData.episodes || [])) {
                episodes.push({
                    href: `zxc-play://tv/${id}?title=${encodeURIComponent(title)}&year=${year}&s=${season.season_number}&e=${ep.episode_number}`,
                    title: ep.name || `Épisode ${ep.episode_number}`,
                    number: ep.episode_number,
                    season: season.season_number
                });
            }
        });

        await Promise.all(seasonPromises);
        episodes.sort((a, b) => a.season !== b.season ? a.season - b.season : a.number - b.number);

        console.log(`[ZXC] ✅ ${episodes.length} épisodes chargés.`);
        return JSON.stringify(episodes);

    } catch (e) {
        console.error(`[ZXC] ❌ Erreur Épisodes: ${e.message}`);
        return JSON.stringify([]);
    }
}

// ==========================================
// 🔓 4. LECTEUR VIDÉO (LE CRAQUAGE ZXCSTREAM)
// ==========================================
async function generateZxcToken(mid) {
    const t = Date.now().toString(); 
    const nc = "23432423"; // Le mot de passe volé
    const textToHash = `${nc}:${t}:${mid}`;

    // SHA-512 natif
    const encoder = new TextEncoder();
    const data = encoder.encode(textToHash);
    const hashBuffer = await crypto.subtle.digest('SHA-512', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fullHashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Découpage à 64 caractères
    const xt = fullHashHex.slice(0, 64);
    console.log(`[ZXC] 🪄 Jeton XT généré : ${xt}`);
    return { xt, rt: t };
}

async function extractStreamUrl(url) {
    console.log(`[ZXC] 🚀 DÉMARRAGE DU PIRATAGE DU FLUX...`);
    try {
        const match = url.match(/zxc-play:\/\/([^/]+)\/([^?]+)\?(.+)/);
        if (!match) throw new Error("URL Play invalide");

        const type   = match[1]; // movie ou tv
        const mid    = match[2]; // TMDB ID
        const params = parseQuery(match[3]);
        const title  = params['title'] || "";
        const year   = params['year']  || "";
        const s      = params['s'];
        const e      = params['e'];

        // --- ÉTAPE 1 : GÉNÉRATION CLÉS SECRÈTES ---
        const { xt, rt } = await generateZxcToken(mid);

        // --- ÉTAPE 2 : VOLER LE 'SIG' ---
        console.log(`[ZXC] 📡 Vol du jeton 'sig' à l'API /backend/token...`);
        const tokenRes = await soraFetch(`${ZXC_BASE_URL}/backend/token`, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                "Referer": `${ZXC_BASE_URL}/`,
                "Origin": ZXC_BASE_URL
            },
            body: JSON.stringify({ mid: String(mid), xt: xt, rt: rt })
        });

        const tokenData = JSON.parse(await tokenRes.text());
        const sig = tokenData.sig;
        const new_rt = tokenData.rt;
        
        if (!sig) throw new Error("Le serveur a refusé nos jetons !");
        console.log(`[ZXC] ✅ Jeton 'sig' obtenu : ${sig}`);

        // --- ÉTAPE 3 : RÉCUPÉRATION LIEN VIDÉO (ICARUS) ---
        console.log(`[ZXC] 🛸 Connexion au serveur Icarus...`);
        let icarusUrl = `${ZXC_BASE_URL}/backend/servers/icarus?mid=${mid}&b=${type}&rt=${new_rt}&sig=${sig}&xt=${xt}&q=${encodeURIComponent(title)}&p=${year}`;
        if (type === 'tv' && s && e) {
            icarusUrl += `&s=${s}&e=${e}`;
        }
        
        const icarusRes = await soraFetch(icarusUrl, {
            headers: { "Referer": `${ZXC_BASE_URL}/` }
        });

        const icarusData = JSON.parse(await icarusRes.text());
        
        // --- ÉTAPE 4 : FORMATAGE SORA ---
        if (icarusData && icarusData.data && icarusData.data.playlist) {
            console.log(`[ZXC] 🎉 VICTOIRE ! Lien vidéo (M3U8) trouvé !`);
            
            return JSON.stringify({
                type: "servers",
                streams: [{
                    title: "Serveur Icarus (1080p)",
                    streamUrl: icarusData.data.playlist,
                    headers: { "Referer": `${ZXC_BASE_URL}/` }
                }],
                subtitles: ""
            });
        }

        console.log(`[ZXC] ❌ Échec, pas de playlist.`);
        return JSON.stringify({ type: "none" });

    } catch (e) {
        console.error(`[ZXC] ❌ Erreur fatale : ${e.message}`);
        return JSON.stringify({ type: "none" });
    }
}

// ==========================================
// 🛠️ OUTIL RÉSEAU (Fetch)
// ==========================================
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
        }
        return await fetch(url, options);
    } catch(e) {
        try { return await fetch(url, options); } catch { return null; }
    }
}

```
