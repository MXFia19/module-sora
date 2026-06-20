// ==========================================
// 🔓 SORA MODULE — ZXCSTREAM (FIX 403 / WORKER PROXY)
// ==========================================

const TMDB_API_KEY = "f5b2cdde0b678e87f5c68b61b43c688c";
const ZXC_BASE_URL = "https://v.zxcstream.xyz";
const ZXC_SERVERS = ["icarus", "atlas_v2", "orion", "zeus", "daedalus", "athena"];

// 🔥 HEADERS FANTÔMES (Copie exacte de Safari iPhone)
const SPOOF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Origin": ZXC_BASE_URL,
    "Referer": `${ZXC_BASE_URL}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Connection": "keep-alive"
};

// 🔥 LE DICTIONNAIRE DE TRADUCTION EXACT
const ZXC_KEYS = {
    mid: "rgrwsdsdfgwrwrwwr",
    rt:  "rdghhdghhfssft",
    sig: "ZDDVHJFGHYRHG",
    xt:  "xfgdfgdsffgrwgrwyjhkjt",
    q:   "TUKTHFSSFGDGHJS",
    p:   "53653TRFG647GF",
    ref: "564745ygtuy5yi75yuy",
    sx:  "adkljfhdahfladhfjahfjlahfhfljkadfdf", 
    ex:  "546745ygy46ytfgty"                    
};

// ==========================================
// 🔐 POLYFILL : PURE JS SHA-512
// ==========================================
const SHA512 = function(str) {
    function int64(msint_32, lsint_32) { return {h: msint_32, l: lsint_32}; }
    function add(x, y) {
        let l = (x.l & 0xffff) + (y.l & 0xffff);
        let m = (x.l >>> 16) + (y.l >>> 16) + (l >>> 16);
        let h = (x.h & 0xffff) + (y.h & 0xffff) + (m >>> 16);
        let k = (x.h >>> 16) + (y.h >>> 16) + (h >>> 16);
        return {h: (k << 16) | (h & 0xffff), l: (m << 16) | (l & 0xffff)};
    }
    function add4(a, b, c, d) { return add(add(a, b), add(c, d)); }
    function add5(a, b, c, d, e) { return add(add4(a, b, c, d), e); }
    function rotr(x, n) {
        if (n < 32) return {h: (x.h >>> n) | (x.l << (32 - n)), l: (x.l >>> n) | (x.h << (32 - n))};
        else if (n === 32) return {h: x.l, l: x.h};
        else return {h: (x.l >>> (n - 32)) | (x.h << (64 - n)), l: (x.h >>> (n - 32)) | (x.l << (64 - n))};
    }
    function shr(x, n) {
        if (n < 32) return {h: x.h >>> n, l: (x.l >>> n) | (x.h << (32 - n))};
        else if (n === 32) return {h: 0, l: x.h};
        else return {h: 0, l: x.h >>> (n - 32)};
    }
    function xor(x, y) { return {h: x.h ^ y.h, l: x.l ^ y.l}; }
    function ch(x, y, z) { return {h: (x.h & y.h) ^ (~x.h & z.h), l: (x.l & y.l) ^ (~x.l & z.l)}; }
    function maj(x, y, z) { return {h: (x.h & y.h) ^ (x.h & z.h) ^ (y.h & z.h), l: (x.l & y.l) ^ (x.l & z.l) ^ (y.l & z.l)}; }
    function sigma0(x) { return xor(xor(rotr(x, 28), rotr(x, 34)), rotr(x, 39)); }
    function sigma1(x) { return xor(xor(rotr(x, 14), rotr(x, 18)), rotr(x, 41)); }
    function gamma0(x) { return xor(xor(rotr(x, 1), rotr(x, 8)), shr(x, 7)); }
    function gamma1(x) { return xor(xor(rotr(x, 19), rotr(x, 61)), shr(x, 6)); }

    let K = [
        int64(0x428a2f98, 0xd728ae22), int64(0x71374491, 0x23ef65cd), int64(0xb5c0fbcf, 0xec4d3b2f), int64(0xe9b5dba5, 0x8189dbbc),
        int64(0x3956c25b, 0xf348b538), int64(0x59f111f1, 0xb605d019), int64(0x923f82a4, 0xaf194f9b), int64(0xab1c5ed5, 0xda6d8118),
        int64(0xd807aa98, 0xa3030242), int64(0x12835b01, 0x45706fbe), int64(0x243185be, 0x4ee4b28c), int64(0x550c7dc3, 0xd5ffb4e2),
        int64(0x72be5d74, 0xf27b896f), int64(0x80deb1fe, 0x3b1696b1), int64(0x9bdc06a7, 0x25c71235), int64(0xc19bf174, 0xcf692694),
        int64(0xe49b69c1, 0x9ef14ad2), int64(0xefbe4786, 0x384f25e3), int64(0x0fc19dc6, 0x8b8cd5b5), int64(0x240ca1cc, 0x77ac9c65),
        int64(0x2de92c6f, 0x592b0275), int64(0x4a7484aa, 0x6ea6e483), int64(0x5cb0a9dc, 0xbd41fbd4), int64(0x76f988da, 0x831153b5),
        int64(0x983e5152, 0xee66dfab), int64(0xa831c66d, 0x2db43210), int64(0xb00327c8, 0x98fb213f), int64(0xbf597fc7, 0xbeef0ee4),
        int64(0xc6e00bf3, 0x3da88fc2), int64(0xd5a79147, 0x930aa725), int64(0x06ca6351, 0xe003826f), int64(0x14292967, 0x0a0e6e70),
        int64(0x27b70a85, 0x46d22ffc), int64(0x2e1b2138, 0x5c26c926), int64(0x4d2c6dfc, 0x5ac42aed), int64(0x53380d13, 0x9d95b3df),
        int64(0x650a7354, 0x8baf63de), int64(0x766a0abb, 0x3c77b2a8), int64(0x81c2c92e, 0x47edaee6), int64(0x92722c85, 0x1482353b),
        int64(0xa2bfe8a1, 0x4cf10364), int64(0xa81a664b, 0xbc423001), int64(0xc24b8b70, 0xd0f89791), int64(0xc76c51a3, 0x0654be30),
        int64(0xd192e819, 0xd6ef5218), int64(0xd6990624, 0x5565a910), int64(0xf40e3585, 0x5771202a), int64(0x106aa070, 0x32bbd1b8),
        int64(0x19a4c116, 0xb8d2d0c8), int64(0x1e376c08, 0x5141ab53), int64(0x2748774c, 0xdf8eeb99), int64(0x34b0bcb5, 0xe19b48a8),
        int64(0x391c0cb3, 0xc5c95a63), int64(0x4ed8aa4a, 0xe3418acb), int64(0x5b9cca4f, 0x7763e373), int64(0x682e6ff3, 0xd6b2b8a3),
        int64(0x748f82ee, 0x5defb2fc), int64(0x78a5636f, 0x43172f60), int64(0x84c87814, 0xa1f0ab72), int64(0x8cc70208, 0x1a6439ec),
        int64(0x90befffa, 0x23631e28), int64(0xa4506ceb, 0xde82bde9), int64(0xbef9a3f7, 0xb2c67915), int64(0xc67178f2, 0xe372532b),
        int64(0xca273ece, 0xea26619c), int64(0xd186b8c7, 0x21c0c207), int64(0xeada7dd6, 0xcde0eb1e), int64(0xf57d4f7f, 0xee6ed178),
        int64(0x06f067aa, 0x72176fba), int64(0x0a637dc5, 0xa2c898a6), int64(0x113f9804, 0xbef90dae), int64(0x1b710b35, 0x131c471b),
        int64(0x28db77f5, 0x23047d84), int64(0x32caab7b, 0x40c72493), int64(0x3c9ebe0a, 0x15c9bebc), int64(0x431d67c4, 0x9c100d4c),
        int64(0x4cc5d4be, 0xcb3e42b6), int64(0x597f299c, 0xfc657e2a), int64(0x5fcb6fab, 0x3ad6faec), int64(0x6c44198c, 0x4a475817)
    ];

    let H = [
        int64(0x6a09e667, 0xf3bcc908), int64(0xbb67ae85, 0x84caa73b), int64(0x3c6ef372, 0xfe94f82b), int64(0xa54ff53a, 0x5f1d36f1),
        int64(0x510e527f, 0xade682d1), int64(0x9b05688c, 0x2b3e6c1f), int64(0x1f83d9ab, 0xfb41bd6b), int64(0x5be0cd19, 0x137e2179)
    ];

    str = unescape(encodeURIComponent(str));
    let m = [];
    for (let i = 0; i < str.length; i++) m[i] = str.charCodeAt(i);
    m[str.length] = 0x80;
    let len = str.length * 8;
    let blocks = Math.ceil((m.length + 16) / 128);

    for (let i = m.length; i < blocks * 128; i++) m[i] = 0;
    m[blocks * 128 - 4] = (len >>> 24) & 0xff;
    m[blocks * 128 - 3] = (len >>> 16) & 0xff;
    m[blocks * 128 - 2] = (len >>> 8) & 0xff;
    m[blocks * 128 - 1] = (len) & 0xff;

    let W = new Array(80);
    for (let i = 0; i < blocks; i++) {
        for (let j = 0; j < 16; j++) {
            W[j] = int64(
                (m[i * 128 + j * 8] << 24) | (m[i * 128 + j * 8 + 1] << 16) | (m[i * 128 + j * 8 + 2] << 8) | m[i * 128 + j * 8 + 3],
                (m[i * 128 + j * 8 + 4] << 24) | (m[i * 128 + j * 8 + 5] << 16) | (m[i * 128 + j * 8 + 6] << 8) | m[i * 128 + j * 8 + 7]
            );
        }
        for (let j = 16; j < 80; j++) {
            W[j] = add4(gamma1(W[j - 2]), W[j - 7], gamma0(W[j - 15]), W[j - 16]);
        }
        let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (let j = 0; j < 80; j++) {
            let T1 = add5(h, sigma1(e), ch(e, f, g), K[j], W[j]);
            let T2 = add(sigma0(a), maj(a, b, c));
            h = g; g = f; f = e; e = add(d, T1); d = c; c = b; b = a; a = add(T1, T2);
        }
        H[0] = add(H[0], a); H[1] = add(H[1], b); H[2] = add(H[2], c); H[3] = add(H[3], d);
        H[4] = add(H[4], e); H[5] = add(H[5], f); H[6] = add(H[6], g); H[7] = add(H[7], h);
    }
    
    let toHex = (n) => {
        let hex = (n >>> 0).toString(16);
        return "00000000".substring(hex.length) + hex;
    };
    
    let hash = "";
    for (let i = 0; i < 8; i++) {
        hash += toHex(H[i].h) + toHex(H[i].l);
    }
    return hash;
};

// ==========================================
// 🛠️ HELPERS
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

// 🔥 Modifié : Garde le Worker ! Assure juste que le lien est absolu
function getCleanUrl(rawUrl) {
    if (!rawUrl) return "";
    if (rawUrl.startsWith('//')) return 'https:' + rawUrl;
    if (rawUrl.startsWith('/')) return ZXC_BASE_URL + rawUrl;
    return rawUrl;
}

// ==========================================
// 🔍 1. RECHERCHE
// ==========================================
async function searchResults(keyword) {
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
            const image = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://via.placeholder.com/500x750?text=Pas+d+image';
            
            const href = `zxc://${item.media_type}/${item.id}?title=${encodeURIComponent(title)}&year=${year}`;
            results.push({ title: year ? `${title} (${year})` : title, image, href });
        }
        return JSON.stringify(results);
    } catch (e) {
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 2. DÉTAILS
// ==========================================
async function extractDetails(url) {
    try {
        const match = url.match(/zxc:\/\/([^/]+)\/([^?]+)/);
        const [, type, id] = match;
        const res = await soraFetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=fr-FR`);
        const data = JSON.parse(await res.text());
        return JSON.stringify([{
            description: data.overview || "Aucune description.",
            aliases: `Note: ${data.vote_average ? data.vote_average.toFixed(1) + '/10' : 'N/A'}`,
            airdate: `Date: ${data.release_date || data.first_air_date || 'Inconnue'}`
        }]);
    } catch (e) {
        return JSON.stringify([{ description: "Erreur." }]);
    }
}

// ==========================================
// 📂 3. ÉPISODES
// ==========================================
async function extractEpisodes(url) {
    try {
        const match = url.match(/zxc:\/\/([^/]+)\/([^?]+)\?(.+)/);
        const type = match[1];
        const id   = match[2];
        const params = parseQuery(match[3]);
        const title = params['title'] || "";
        const year  = params['year']  || "";

        if (type === 'movie') {
            const mRes = await soraFetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}`);
            const mData = JSON.parse(await mRes.text());
            const ref = mData.imdb_id || "";
            const date = mData.release_date || "";

            return JSON.stringify([{
                href: `zxc-play://movie/${id}?title=${encodeURIComponent(title)}&year=${year}&ref=${ref}&date=${date}`,
                title: "Film Complet",
                number: 1,
                season: 1
            }]);
        }

        const res = await soraFetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&language=fr-FR`);
        const data = JSON.parse(await res.text());

        const extRes = await soraFetch(`https://api.themoviedb.org/3/tv/${id}/external_ids?api_key=${TMDB_API_KEY}`);
        const extData = JSON.parse(await extRes.text());
        const ref = extData.imdb_id || "";

        let episodes = [];
        const seasonPromises = (data.seasons || []).map(async (season) => {
            if (season.season_number === 0) return; 

            const sRes = await soraFetch(`https://api.themoviedb.org/3/tv/${id}/season/${season.season_number}?api_key=${TMDB_API_KEY}&language=fr-FR`);
            if (!sRes) return;

            const sData = JSON.parse(await sRes.text());
            for (let ep of (sData.episodes || [])) {
                const date = ep.air_date || "";
                episodes.push({
                    href: `zxc-play://tv/${id}?title=${encodeURIComponent(title)}&year=${year}&s=${season.season_number}&e=${ep.episode_number}&ref=${ref}&date=${date}`,
                    title: ep.name || `Épisode ${ep.episode_number}`,
                    number: ep.episode_number,
                    season: season.season_number
                });
            }
        });

        await Promise.all(seasonPromises);
        episodes.sort((a, b) => a.season !== b.season ? a.season - b.season : a.number - b.number);
        return JSON.stringify(episodes);

    } catch (e) {
        return JSON.stringify([]);
    }
}

// ==========================================
// 🔓 4. LECTEUR VIDÉO
// ==========================================
async function generateZxcToken(mid) {
    const t = Date.now(); 
    const nc = "23424533224232234252524523254"; // Le bon mdp secret
    const textToHash = `${nc}:${t}:${mid}`;
    const fullHashHex = SHA512(textToHash);
    const xt = fullHashHex.slice(0, 64);
    
    console.log(`[ÉTAPE 2] 🔐 Algorithme SHA-512 ok : XT = ${xt}`);
    
    return { xt, rt: t };
}

async function extractStreamUrl(url) {
    console.log(`\n======================================================`);
    console.log(`[ZXC-SUPER-DEBUG] 🚀 DÉMARRAGE DU SCRIPT`);
    console.log(`======================================================`);
    
    try {
        const match = url.match(/zxc-play:\/\/([^/]+)\/([^?]+)\?(.+)/);
        if (!match) throw new Error("URL Play invalide");

        const type   = match[1]; 
        const mid    = match[2]; 
        const params = parseQuery(match[3]);
        const title  = params['title'] || "";
        const year   = params['year']  || "";
        const s      = params['s'];
        const e      = params['e'];
        const ref    = params['ref'] || "";
        const date   = params['date'] || "";

        const { xt, rt } = await generateZxcToken(mid);

        let tokenPayload = {};
        tokenPayload[ZXC_KEYS.mid] = String(mid);
        tokenPayload[ZXC_KEYS.xt] = xt;
        tokenPayload[ZXC_KEYS.rt] = rt;

        console.log(`[ÉTAPE 3] 📡 POST vers /backend/token...`);
        const tokenRes = await soraFetch(`${ZXC_BASE_URL}/backend/token`, {
            method: 'POST',
            headers: SPOOF_HEADERS,
            body: JSON.stringify(tokenPayload)
        });

        const rawTokenText = await tokenRes.text();
        const tokenData = JSON.parse(rawTokenText);
        
        if (tokenData.error) {
            console.error(`[🚨 ERREUR FATALE] L'API a bloqué la requête : ${tokenData.error}`);
            throw new Error(tokenData.error);
        }

        const sig = tokenData[ZXC_KEYS.sig] || tokenData.sig;
        const new_rt = tokenData[ZXC_KEYS.rt] || tokenData.rt;
        
        if (!sig) throw new Error("Pas de SIG dans la réponse JSON !");
        console.log(`[ÉTAPE 5] ✅ SIG Extrait : ${sig}`);
        
        let finalStreams = [];
        let subtitlesMap = new Map();

        console.log(`[ÉTAPE 6] 🔄 Interrogation des serveurs ZXC...`);
        for (const serverName of ZXC_SERVERS) {
            let serverUrl = `${ZXC_BASE_URL}/backend/servers/${serverName}?${ZXC_KEYS.mid}=${mid}&b=${type}&${ZXC_KEYS.rt}=${new_rt}&${ZXC_KEYS.sig}=${sig}&${ZXC_KEYS.xt}=${xt}&${ZXC_KEYS.q}=${encodeURIComponent(title)}&${ZXC_KEYS.p}=${encodeURIComponent(year)}`;
            if (date) serverUrl += `&date=${encodeURIComponent(date)}`;
            if (ref) serverUrl += `&${ZXC_KEYS.ref}=${encodeURIComponent(ref)}`;
            if (type === 'tv' && s && e) serverUrl += `&${ZXC_KEYS.sx}=${s}&${ZXC_KEYS.ex}=${e}`;
            
            try {
                const serverRes = await soraFetch(serverUrl, { headers: SPOOF_HEADERS });
                const serverDataText = await serverRes.text();
                
                const serverData = JSON.parse(serverDataText);
                
                if (serverData && serverData.success && serverData.links && serverData.links.length > 0) {
                    console.log(`   🎉 Vidéo trouvée sur ${serverName} !`);
                    for (const linkObj of serverData.links) {
                        if (!linkObj.link) continue;
                        
                        // 🔥 MODIFICATION : ON GARDE LE WORKER INTACT
                        const safeUrl = getCleanUrl(linkObj.link); 
                        console.log(`      🎬 Lien avec Proxy: ${safeUrl}`);
                        
                        finalStreams.push({
                            title: `ZXC ${serverName.toUpperCase()} (${linkObj.resolution || 'Auto'}p)`,
                            streamUrl: safeUrl,
                            headers: SPOOF_HEADERS
                        });
                    }
                    
                    if (serverData.subtitles && Array.isArray(serverData.subtitles)) {
                        for (const sub of serverData.subtitles) {
                            if (!sub.file) continue;
                            const safeSubUrl = getCleanUrl(sub.file);
                            const subId = sub.id || "unknown";
                            if (!subtitlesMap.has(subId)) {
                                subtitlesMap.set(subId, { url: safeSubUrl, label: sub.display || sub.id || "SUB", language: subId, kind: "subtitles" });
                            }
                        }
                    }
                }
            } catch (err) {
                // Erreur serveur ignorée silencieusement
            }
        }

        if (finalStreams.length > 0) {
            console.log(`[ÉTAPE 7] 🏁 Envoi à Sora (${finalStreams.length} flux)`);
            finalStreams.sort((a, b) => {
                const resA = parseInt(a.title.match(/(\d+)p/)?.[1]) || 0;
                const resB = parseInt(b.title.match(/(\d+)p/)?.[1]) || 0;
                return resB - resA;
            });

            let allSubtitles = Array.from(subtitlesMap.values());
            let defaultSubtitle = "";
            const frSub = allSubtitles.find(s => s.language === "fr" || s.language === "fre");
            const enSub = allSubtitles.find(s => s.language === "en" || s.language === "eng");
            if (frSub) defaultSubtitle = frSub.url;
            else if (enSub) defaultSubtitle = enSub.url;
            else if (allSubtitles.length > 0) defaultSubtitle = allSubtitles[0].url;

            return JSON.stringify({
                type: "servers",
                streams: finalStreams,
                subtitles: defaultSubtitle,
                allSubtitles: allSubtitles
            });
        }

        return JSON.stringify({ type: "none" });

    } catch (e) {
        return JSON.stringify({ type: "none" });
    }
}

// ==========================================
// 🛠️ OUTIL RÉSEAU (Fetch)
// ==========================================
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            const finalHeaders = { ...options.headers };
            return await fetchv2(url, finalHeaders, options.method ?? 'GET', options.body ?? null);
        }
        return await fetch(url, options);
    } catch(e) {
        try { return await fetch(url, options); } catch { return null; }
    }
}

