// ==========================================
// ⚙️ MODULE SORA — ANIME-SAMA (Supabase Edition + Sibnet Fix)test update
// ==========================================

// ==========================================
// 🗄️ TRACKER SUPABASE (Base de données)
// ==========================================
const SUPABASE_URL = "https://qyeisgowjisqbatrmqta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F68CBjFVPh71U0SdD9BQJg_UJgL9-Fj";

async function sendSupabaseLog(moduleName, actionType, dataPayload) {
    try {
        const payload = { module: moduleName, action: actionType, data: dataPayload };
        const headers = { 
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            "Prefer": "return=minimal" 
        };
        await fetchv2(`${SUPABASE_URL}/rest/v1/app_logs`, headers, "POST", JSON.stringify(payload));
    } catch (e) { 
        console.log(`[Tracker] 🚨 Erreur d'envoi vers Supabase : ${e.message}`); 
    }
}

// ==========================================
// ⚙️ LOGIQUE DU MODULE ANIME-SAMA
// ==========================================

async function getDomainsList() {
    console.log(`[Domaines] 🌐 Récupération des domaines actifs...`);
    try {
        const response = await fetchv2("https://anime-sama.pw/");
        const html = await response.text();

        const domainRegex = /{ name: '([^']+)' }/g;
        const domains = [];
        let match;
        while ((match = domainRegex.exec(html)) !== null) {
            domains.push(match[1]);
        }
        
        console.log(`[Domaines] ✅ Domaines trouvés : ${domains.join(', ')}`);
        return domains.length > 0 ? domains : ["anime-sama.to"];
    } catch (err) {
        console.log(`[Domaines] 🚨 Erreur, fallback sur anime-sama.to`);
        return ["anime-sama.to"];
    }
}

async function trySearch(domain, keyword) {
    console.log(`[Recherche AS] 🔍 Tentative sur : ${domain} pour "${keyword}"`);
    try {
        const headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `https://${domain}/`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        };

        const fetchUrl = `https://${domain}/template-php/defaut/fetch.php`;
        const response = await fetchv2(fetchUrl, headers, "POST", `query=${encodeURIComponent(keyword)}`);
        const html = await response.text();
        const results = [];
        
        const regex = /<a[^>]+href=["']([^"']+)["'][\s\S]*?<img[^>]+src=["']([^"']+)["'][\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            let href = match[1].trim();
            let image = match[2].trim();
            let title = match[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&#8211;/g, "-").trim();
            
            if (href.startsWith('/')) href = `https://${domain}${href}`;
            if (image.startsWith('/')) image = `https://${domain}${image}`;

            if (!results.find(r => r.href === href)) {
                results.push({ title, image, href });
            }
        }
        
        return { results: results };
    } catch (e) {
        console.log(`[Recherche AS] 🚨 Erreur sur ${domain} : ${e}`);
        return { results: [] };
    }
}

async function searchResults(keyword) {
    try {
        const domains = await getDomainsList();
        console.log(`[Recherche AS] 🔍 Démarrage de la recherche sur ${domains.length} domaines.`);
        
        let finalResults = [];

        for (let i = 0; i < domains.length; i++) {
            let currentDomain = domains[i];
            console.log(`[Recherche AS] 📡 Vérification du radar pour : ${currentDomain}...`);
            
            try {
                const checkRes = await fetchv2(`https://anime-sama.pw/?check=${currentDomain}`, { "User-Agent": "Mozilla/5.0" }, "GET");
                const checkData = JSON.parse(await checkRes.text());
                if (checkData.code !== 200) {
                    console.log(`[Recherche AS] ⏭️ ${currentDomain} ignoré.`);
                    continue; 
                }
            } catch (e) {}

            try {
                let searchAttempt = await trySearch(currentDomain, keyword);
                if (searchAttempt.results && searchAttempt.results.length > 0) {
                    console.log(`[Recherche AS] 🚀 Succès sur ${currentDomain} ! ${searchAttempt.results.length} résultats extraits.`);
                    finalResults = searchAttempt.results;
                    break; 
                }
            } catch (err) {}
        }

        sendSupabaseLog("Anime-Sama", "SEARCH", { 
            keyword: keyword, 
            results_count: finalResults.length,
            top_results: finalResults.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(finalResults);
    } catch (globalErr) {
        console.log(`[Recherche AS] 🚨 Crash global : ${globalErr}`);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    console.log(`[Détails AS] 📖 Chargement des infos pour : ${url}`);
    sendSupabaseLog("Anime-Sama", "DETAILS", { anime_url: url });

    try {
        const response = await fetchv2(url);
        const html = await response.text();

        let description = "Pas de description disponible.";
        let descMatch = html.match(/id=["']synopsis["'][^>]*>([\s\S]*?)<\//i) || 
                          html.match(/class=["']synopsis["'][^>]*>([\s\S]*?)<\//i) || 
                          html.match(/<p class=["']text-sm[^>]*>([\s\S]*?)<\/p>/i);

        if (descMatch && descMatch[1]) {
            description = descMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
        }

        return JSON.stringify([{ description, aliases: "Anime-Sama" }]);
    } catch (e) { 
        return JSON.stringify([{ description: "Erreur de chargement", aliases: "Anime-Sama" }]); 
    }
}

// --- 3. ÉPISODES ---
// Saisons de l'œuvre : ses appels panneauAnime("nom", "chemin"), dans l'ordre du site, lus ligne par ligne comme le
// fait la page elle-même. Ignorés : les modèles ("nom", "url"), les lignes en commentaire (// ou <!-- -->, saison
// masquée « Bientôt de retour ») et une même saison dans une autre langue (le lecteur propose déjà VOSTFR, VF et VA).
function seasonTabs(html, url) {
    const re = /panneauAnime\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*,\s*(["'])((?:\\.|(?!\3).)*)\3\s*\)/g;
    const tabs = [];
    const seen = new Set();
    let bloc = false;
    for (let line of String(html || "").split(/\r?\n/)) {
        line = line.trim();
        const cachee = bloc || /^(<!--|\/\/)/.test(line) || line.includes("-->");
        if (/^<!--/.test(line) && !line.includes("-->")) bloc = true;
        if (line.includes("-->")) bloc = false;
        if (cachee || /^\/\*/.test(line)) continue;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
            const name = m[2].replace(/\\(.)/g, "$1").trim();
            const path = m[4].replace(/\\(.)/g, "$1").trim();
            if (!name || !path || /^(nom|name)$/i.test(name) || /^url$/i.test(path)) continue;
            // Sans URL() : absent du moteur JavaScript de certaines applis.
            const origin = (url.match(/^https?:\/\/[^/]+/) || [""])[0];
            const full = /^https?:\/\//i.test(path) ? path : path.startsWith("/") ? origin + path : url + path;
            const key = full.replace(/\/(vostfr|vf|va)(\/|$)/i, "/lang$2").replace(/\/$/, "");
            if (seen.has(key)) continue;
            seen.add(key);
            tabs.push({ name, url: full });
        }
    }
    return tabs;
}

// Noms des épisodes d'une page de saison, comme sa liste déroulante : la dernière liste écrite par la page
// (resetListe(); creerListe(1, 12); newSP(12.5); newSPF("Memory Snow"); finirListe(13);), hors commentaires : la
// page garde un modèle « resetListe(); creerListe(debut, fin)… » en commentaire. Sans liste : [].
function episodeNames(html, count) {
    const scripts = String(html || "").match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
    let block = "";
    for (const script of scripts) {
        const code = script.replace(/\/\*[\s\S]*?\*\//g, "")
            .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
        const at = code.lastIndexOf("resetListe(");
        if (at !== -1) block = code.slice(at);
    }
    if (!block) return [];
    const names = [];
    let retards = 0;
    const call = /\b(creerListe|finirListe|newSPF|newSP)\s*\(/g;
    let m;
    while ((m = call.exec(block)) !== null && names.length < 5000) {
        const args = callArgs(block, call.lastIndex);
        if (m[1] === "creerListe") {
            const debut = parseInt(args[0], 10), fin = parseInt(args[1], 10);
            if (isNaN(debut) || isNaN(fin)) continue;
            for (let i = debut; i <= fin && names.length < 5000; i++) names.push(`Épisode ${i}`);
        } else if (m[1] === "finirListe") {
            const debut = parseInt(args[0], 10);
            if (isNaN(debut)) continue;
            for (let i = debut; i <= count - retards && names.length < 5000; i++) names.push(`Épisode ${i}`);
        } else if (m[1] === "newSP") {
            names.push(`Épisode ${args[0]}`);
            retards++;
        } else {
            names.push(args[0] || `Épisode ${names.length + 1}`);
            retards++;
        }
    }
    return names;
}

// Arguments d'un appel (chaînes sans leurs guillemets), lus jusqu'à sa parenthèse fermante.
function callArgs(code, from) {
    const args = [];
    let current = "", quote = null;
    for (let i = from; i < code.length; i++) {
        const c = code[i];
        if (quote) {
            if (c === "\\") { current += code[++i] || ""; continue; }
            if (c === quote) { quote = null; continue; }
            current += c;
            continue;
        }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === ",") { args.push(current.trim()); current = ""; continue; }
        if (c === ")") { args.push(current.trim()); break; }
        current += c;
    }
    return args;
}

async function extractEpisodes(url) {
    console.log(`[Episodes AS] 📂 Analyse multi-saisons : ${url}`);
    try {
        if (!url.endsWith('/')) url += '/';

        const headers = { "User-Agent": "Mozilla/5.0", "Referer": url };
        const response = await fetchv2(url, headers, "GET");
        const html = await response.text();

        let tabs = seasonTabs(html, url);
        if (tabs.length === 0) tabs.push({ name: "Saison 1", url: url + "saison1/vostfr" });

        let results = [];

        for (let tab of tabs) {
            try {
                let pageUrl = tab.url.endsWith('/') ? tab.url : tab.url + '/';
                let jsUrl = pageUrl + "episodes.js";
                let pageHtml = "";

                let jsRes = await fetchv2(jsUrl, headers, "GET");
                let jsContent = await jsRes.text();

                if (!jsContent || jsContent.includes("<html") || jsContent.length < 50) {
                    let tabRes = await fetchv2(tab.url, headers, "GET");
                    let tabText = await tabRes.text();
                    pageHtml = tabText;
                    // Nouveau format (nov. 2026) : plus d'episodes.js, les tableaux
                    // eps1, eps2… sont écrits dans la page de saison elle-même.
                    let inPage = epsArraysOnly(tabText);
                    if (inPage) {
                        jsContent = inPage;
                        jsUrl = pageUrl;
                    }
                    let scriptMatch = inPage ? null : tabText.match(/<script[^>]+src=['"]([^'"]*episodes\.js[^'"]*)['"]/i);
                    if (scriptMatch) {
                        let scriptSrc = scriptMatch[1].trim();
                        let baseFolder = tab.url.endsWith('/') ? tab.url : tab.url + '/';
                        jsUrl = scriptSrc.startsWith('http') ? scriptSrc : (scriptSrc.startsWith('/') ? (url.match(/^https?:\/\/[^/]+/) || [""])[0] + scriptSrc : baseFolder + scriptSrc);
                        jsRes = await fetchv2(jsUrl, headers, "GET");
                        jsContent = await jsRes.text();
                    }
                }

                if (!jsContent || jsContent.includes("<html") || jsContent.length < 50) continue;

                const arrayRegex = /(?:var|let|const)\s+[a-zA-Z0-9_]+\s*=\s*\[([\s\S]*?)\]/gm;
                let arrMatch;
                let maxEpisodes = 0;
                let firstCount = -1;

                while ((arrMatch = arrayRegex.exec(jsContent)) !== null) {
                    let urls = arrMatch[1].match(/['"]([^'"]+)['"]/g) || [];
                    if (firstCount < 0) firstCount = urls.length;
                    if (urls.length > maxEpisodes) maxEpisodes = urls.length;
                }

                if (maxEpisodes > 0) {
                    let cleanTabName = tab.name.replace(/\(?(VOSTFR|VF)\)?/i, '').trim();
                    // `season` : le numéro de saison pour les titres reliés (TMDB S2E3 -> « Saison 2 », épisode 3),
                    // 0 pour les films et OAV, absent pour le reste (Kai, Director's Cut…). `seasonTitle` : le nom
                    // du site, que Tsumi affiche dans son choix de saison.
                    let seasonMatch = cleanTabName.match(/saison\s*(\d+)/i);
                    let currentSeason = seasonMatch ? parseInt(seasonMatch[1], 10)
                        : /film|oav|ova/i.test(cleanTabName) ? 0 : null;
                    // Noms de la liste déroulante du site (« Épisode 12.5 », « Memory Snow »…). Le numéro reste la
                    // place dans la liste (entier, comme l'attendent les applis).
                    let names = episodeNames(pageHtml, firstCount > 0 ? firstCount : maxEpisodes);

                    for (let i = 0; i < maxEpisodes; i++) {
                        let separator = jsUrl.includes('?') ? '&' : '?';
                        let epHref = `${jsUrl}${separator}episode_index=${i}`;
                        let siteName = names[i] || "";
                        let epTitle = maxEpisodes === 1
                            ? (siteName && !/^épisode\s/i.test(siteName) ? siteName : cleanTabName)
                            : (siteName || `Épisode ${i + 1}`);

                        let episode = {
                            title: epTitle, name: epTitle, href: epHref,
                            number: i + 1, seasonTitle: cleanTabName
                        };
                        if (currentSeason !== null) episode.season = currentSeason;
                        results.push(episode);
                    }
                }
            } catch (e) { }
        }
        return JSON.stringify(results);
    } catch (e) { return JSON.stringify([]); }
}

// Les seuls tableaux d'épisodes d'une page de saison (var eps1 = […]; …).
// La page contient d'autres tableaux (domaines, publicités) : les prendre
// fausserait le nombre d'épisodes. "" si la page n'en a aucun.
function epsArraysOnly(html) {
    const blocks = String(html || "").match(/var\s+eps\d+\s*=\s*\[[\s\S]*?\]/g) || [];
    return blocks.map(b => b + ";").join("\n");
}

// Une entrée « lien:<id> » ne donne l'adresse du lecteur qu'à la demande :
// /api/lien.php?j=<jeton de la page>&l=<id> -> {"u": "https://…"}.
async function resolveLien(origin, jeton, id, referer) {
    try {
        const res = await fetchv2(`${origin}/api/lien.php?j=${encodeURIComponent(jeton)}&l=${encodeURIComponent(id)}`,
            { "User-Agent": "Mozilla/5.0", "Referer": referer, "Accept": "application/json" }, "GET");
        const data = JSON.parse(await res.text());
        return data && typeof data.u === "string" && data.u.startsWith("http") ? data.u : null;
    } catch (e) { return null; }
}

// --- 4. LECTEUR ---
async function extractStreamUrl(url) {
    console.log(`[Lecteur AS] 🎬 Démarrage pour : ${url}`);
    
    try {
        let epIndex = 0;
        let jsUrl1 = url;
        
        if (url.includes('episode_index=')) {
            let parts = url.split('episode_index=');
            epIndex = parseInt(parts[1]) || 0;
            jsUrl1 = parts[0];
            if (jsUrl1.endsWith('?') || jsUrl1.endsWith('&')) jsUrl1 = jsUrl1.slice(0, -1);
        }

        let langsToFetch = [];
        let langMatch = jsUrl1.match(/\/(vostfr|vf|va)\//i);

        if (langMatch) {
            let currentLang = langMatch[1].toLowerCase();
            langsToFetch = [
                { lang: "VOSTFR", url: jsUrl1.replace(`/${currentLang}/`, '/vostfr/') },
                { lang: "VF", url: jsUrl1.replace(`/${currentLang}/`, '/vf/') },
                { lang: "VA", url: jsUrl1.replace(`/${currentLang}/`, '/va/') }
            ];
        } else {
            langsToFetch = [{ lang: "VOSTFR", url: jsUrl1 }]; 
        }

        const headers = { "User-Agent": "Mozilla/5.0", "Referer": "https://anime-sama.to/" };

        let fetchPromises = langsToFetch.map(l => fetchv2(l.url, headers, "GET").then(r => r.text()).catch(() => ""));
        let contents = await Promise.all(fetchPromises);
        
        let allEmbeds = [];
        let pending = [];
        const origin = (url.match(/^https?:\/\/[^/]+/) || ["https://anime-sama.to"])[0];

        function parseJsContent(jsText, langTag, pageUrl) {
            if (!jsText || jsText.length < 50) return;
            // Nouveau format : la page de saison elle-même, avec son jeton.
            let jeton = null;
            if (jsText.includes("<html")) {
                jeton = (jsText.match(/epsJeton\s*=\s*["']([^"']+)["']/) || [])[1] || null;
                jsText = epsArraysOnly(jsText);
                if (!jsText) return;
            }
            const arrayRegex = /(?:var|let|const)\s+([a-zA-Z0-9_]+)\s*=\s*\[([\s\S]*?)\];/gm;
            let match;
            while ((match = arrayRegex.exec(jsText)) !== null) {
                let urls = match[2].match(/['"]([^'"]+)['"]/g) || [];
                if (epIndex < urls.length) {
                    let rawUrl = urls[epIndex].replace(/['"]/g, '').trim();
                    if (rawUrl.startsWith('http')) {
                        allEmbeds.push({ url: rawUrl, lang: langTag });
                    } else if (rawUrl.startsWith('lien:') && jeton) {
                        pending.push({ id: rawUrl.slice(5), lang: langTag, jeton: jeton, referer: pageUrl });
                    }
                }
            }
        }

        for (let i = 0; i < contents.length; i++) {
            if (contents[i]) parseJsContent(contents[i], langsToFetch[i].lang, langsToFetch[i].url);
        }

        // Les « lien:<id> » se résolvent un par un auprès du site : en parallèle.
        if (pending.length > 0) {
            console.log(`[Lecteur AS] 🔑 ${pending.length} lien(s) à résoudre via /api/lien.php`);
            const resolved = await Promise.all(pending.map(p => resolveLien(origin, p.jeton, p.id, p.referer)));
            resolved.forEach((u, i) => { if (u) allEmbeds.push({ url: u, lang: pending[i].lang }); });
        }

        let streams = [];
        let extractedNames = [];
        let failedLinks = [];

        for (let embed of allEmbeds) {
            let embedUrl = embed.url;
            let urlLower = embedUrl.toLowerCase();
            let prefix = `[${embed.lang}]`;
            let streamCountBefore = streams.length;

            // ansembed.net (1er lecteur de chaque épisode) et voembed.net sont des domaines Vidmoly.
            const isVidmoly = urlLower.includes("vidmoly") || urlLower.includes("ansembed") || urlLower.includes("voembed");

            // 1. LECTEUR VOE
            if (!isVidmoly && (urlLower.includes("voe.sx") || urlLower.includes("voe.network") || urlLower.includes("voe") || urlLower.includes("lancewhosedifficult"))) {
                console.log(`[Lecteur] 🕵️ Extraction VOE en cours sur : ${embedUrl}`);
                try {
                    let voeRes = await fetchv2(embedUrl, { "Referer": "https://anime-sama.to/" }, "GET");
                    if (voeRes) {
                        let voeHtml = await voeRes.text();
                        
                        // Fix Redirection VOE (Domain Hopping)
                        const redirectMatch = voeHtml.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
                        if (redirectMatch && redirectMatch[1]) {
                            console.log(`[Lecteur] 🔄 VOE : Redirection détectée -> ${redirectMatch[1]}`);
                            voeRes = await fetchv2(redirectMatch[1], { "Referer": "https://anime-sama.to/" }, "GET");
                            voeHtml = await voeRes.text();
                        }

                        const streamUrl = voeExtractor(voeHtml);
                        if (streamUrl) {
                            const typeStr = streamUrl.includes(".m3u8") ? "HLS" : "MP4";
                            streams.push({ title: `${prefix} VOE (${typeStr})`, streamUrl: streamUrl, headers: { "Referer": embedUrl } });
                            extractedNames.push(`${prefix} VOE`);
                        }
                    }
                } catch(e) {}
            }
            // 2. LECTEUR STREAMTAPE
            else if (urlLower.includes("streamtape")) {
                try {
                    const stRes = await fetchv2(embedUrl, { "Referer": "https://anime-sama.to/" }, "GET");
                    const stHtml = await stRes.text();
                    const robotMatch = stHtml.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*[^;]+\(['"]([^'"]+)['"]\)/i);
                    if (robotMatch) {
                        let tokenStr = robotMatch[1];
                        let directUrl = "https://streamtape.com" + tokenStr.substring(tokenStr.indexOf('/get_video')) + "&dl=1";
                        streams.push({ title: `${prefix} Streamtape`, streamUrl: directUrl, headers: { "Referer": "https://streamtape.com/" } });
                        extractedNames.push(`${prefix} Streamtape`);
                    }
                } catch (e) {}
            } 
            // 4. LECTEUR VIDMOLY
            else if (isVidmoly) {
                try {
                    let fixedVidUrl = embedUrl.replace(/vidmoly\.(to|me|net|ru|is)/i, "vidmoly.biz");
                    const vidRef = urlLower.includes("vidmoly") ? "https://vidmoly.biz/" : "https://anime-sama.to/";
                    const vidRes = await fetchv2(fixedVidUrl, { "Referer": vidRef }, "GET");
                    const vidHtml = await vidRes.text();
                    const fileMatch = vidHtml.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || vidHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                    if (fileMatch) {
                        streams.push({ title: `${prefix} Vidmoly`, streamUrl: fileMatch[1], headers: { "Referer": "https://vidmoly.biz/" } });
                        extractedNames.push(`${prefix} Vidmoly`);
                    }
                } catch (e) {}
            }
            // 5. LECTEUR SENDVID
            else if (urlLower.includes("sendvid")) {
                try {
                    const req = await fetchv2(embedUrl, { "Referer": "https://anime-sama.to/" }, "GET");
                    const sendHtml = await req.text();
                    const mp4Match = sendHtml.match(/<source[^>]+src=["']([^"']+\.mp4)["']/i) || sendHtml.match(/video_source\s*=\s*["']([^"']+)["']/i);
                    if (mp4Match) {
                        streams.push({ title: `${prefix} Sendvid`, streamUrl: mp4Match[1], headers: { "Referer": embedUrl } });
                        extractedNames.push(`${prefix} Sendvid`);
                    }
                } catch (e) {}
            }
            // 6. LECTEUR SIBNET (AVEC DIAGNOSTIC iOS)
            else if (urlLower.includes("sibnet.ru")) {
                console.log(`[Sibnet] 🔍 1/4 - Démarrage extraction sur : ${embedUrl}`);
                try {
                    // 🌟 CORRECTION 1 : On force un User-Agent Desktop pour éviter la version mobile de Sibnet sur iOS
                    const sibnetHeaders = { 
                        "Referer": "https://anime-sama.to/",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    };
                    const req = await fetchv2(embedUrl, sibnetHeaders, "GET", null, true, "windows-1251");
                    
                    if (!req) {
                        console.log(`[Sibnet] 🚨 1/4 - ERREUR FATALE : La requête (fetchv2) a renvoyé NULL. (Problème de fetch réseau sur iOS ?)`);
                        continue;
                    }
                    
                    const html = await req.text();
                    
                    if (!html || html.length < 100) {
                         console.log(`[Sibnet] 🚨 2/4 - ERREUR : HTML reçu vide ou trop court (Taille: ${html ? html.length : 0}).`);
                         continue;
                    } else {
                         console.log(`[Sibnet] ✅ 2/4 - HTML téléchargé avec succès. (Taille: ${html.length} chars)`);
                    }

                    // 🌟 CORRECTION 2 : Regex plus robuste (Supporte les .m3u8 et les URLs absolues)
                    const srcMatch = html.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i) || 
                                     html.match(/src:\s*["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i) || 
                                     html.match(/["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
                    
                    if (srcMatch) {
                        let streamUrl = srcMatch[1].startsWith("http") ? srcMatch[1] : "https://video.sibnet.ru" + srcMatch[1];
                        console.log(`[Sibnet] ✅ 3/4 - SRC trouvée par le Regex : ${streamUrl}`);
                        
                        try {
                            console.log(`[Sibnet] 📡 4/4 - Tentative de résolution de la redirection (HEAD)...`);
                            const redirectReq = await fetchv2(streamUrl, {
                                "Referer": embedUrl,
                                // Certains iOS WKWebview bloquent si le User-Agent n'est pas "Mobile"
                                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
                            }, "HEAD");
                            
                            if (redirectReq && redirectReq.url && redirectReq.url !== streamUrl) {
                                console.log(`[Sibnet] 🔄 Redirection confirmée vers : ${redirectReq.url}`);
                                streamUrl = redirectReq.url;
                            } else {
                                console.log(`[Sibnet] ⚠️ Pas de redirection détectée (URL identique ou échec HEAD). On garde le lien d'origine.`);
                            }
                        } catch(redErr) {
                            console.log(`[Sibnet] 🚨 Erreur lors de la redirection HEAD (Typique sur iOS) : ${redErr.message}. On force le lien d'origine.`);
                        }

                        streams.push({ 
                            title: `${prefix} Sibnet`, 
                            streamUrl: streamUrl, 
                            headers: { "Referer": embedUrl, "User-Agent": "Mozilla/5.0" } 
                        });
                        extractedNames.push(`${prefix} Sibnet`);
                        console.log(`[Sibnet] 🎉 SUCCÈS TOTAL : Sibnet ajouté aux flux.`);

                    } else {
                        console.log(`[Sibnet] 🚨 3/4 - ERREUR : Le Regex n'a rien trouvé. Extrait du HTML : ${html.substring(0, 500)}...`);
                    }
                } catch(globalSibErr) {
                    console.log(`[Sibnet] 💥 CRASH GÉNERAL DANS LE TRY/CATCH SIBNET : ${globalSibErr.message}`);
                }
            }
            // 6.5 LECTEUR EMBED4ME / LPLAYER (famille embedseek, API /api/v1/video chiffrée AES-128-CBC)
            else if (urlLower.includes("lplayer") || urlLower.includes("embed4me") || urlLower.includes("embedseek") || urlLower.includes("neocine") || urlLower.includes("seekplayer") || urlLower.includes("flemmix") || urlLower.includes("p2pstream")) {
                console.log(`[Lecteur] 🕵️ Extraction Embed4me/lplayer : ${embedUrl}`);
                try {
                    const r = await embed4meExtractor(embedUrl);
                    if (r && r.streamUrl) {
                        streams.push({ title: `${prefix} Lplayer (HLS)`, streamUrl: r.streamUrl, headers: r.headers });
                        extractedNames.push(`${prefix} Lplayer`);
                    }
                } catch (e) {}
            }
            // 7. DETECTEUR UNIVERSEL (Vidhide / Famille Packer)
            else {
                try {
                    const req = await fetchv2(embedUrl, { "Referer": "https://anime-sama.to/" }, "GET");
                    const html = await req.text();

                    // VOE sous un domaine sans « voe » (derricknationtop.com, megankiddifference.com…) :
                    // une page « Redirecting… » qui renvoie vers le vrai lecteur VOE.
                    let voeHtml = html;
                    const voeRedirect = /<title>\s*Redirecting/i.test(html) ? html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i) : null;
                    if (voeRedirect && voeRedirect[1] && voeRedirect[1].startsWith("http")) {
                        const vr = await fetchv2(voeRedirect[1], { "Referer": "https://anime-sama.to/" }, "GET");
                        voeHtml = vr ? await vr.text() : "";
                    }
                    const voeUrl = voeExtractor(voeHtml);

                    if (voeUrl) {
                        const typeStr = voeUrl.includes(".m3u8") ? "HLS" : "MP4";
                        streams.push({ title: `${prefix} VOE (${typeStr})`, streamUrl: voeUrl, headers: { "Referer": embedUrl } });
                        extractedNames.push(`${prefix} VOE`);
                    }
                    else if (html.includes('/vidhide/') || html.includes('eval(function(p,a,c,k,e,d)')) {
                        let streamUrl = vidhideExtractor(html);
                        if (streamUrl) {
                            let originMatch = embedUrl.match(/^(https?:\/\/[^\/]+)/i);
                            let originUrl = originMatch ? originMatch[1] + "/" : "https://vidhide.com/";
                            // uqload.vc sert la même page packée : on le nomme pour ce qu'il est.
                            const hostName = urlLower.includes("uqload") ? "Uqload" : "Vidhide";
                            streams.push({
                                title: `${prefix} ${hostName}`,
                                streamUrl: streamUrl,
                                headers: { "Referer": originUrl, "User-Agent": "Mozilla/5.0" }
                            });
                            extractedNames.push(`${prefix} ${hostName}`);
                        }
                    }
                } catch(e) {}
            }

            if (streams.length === streamCountBefore) {
                let domainMatch = embedUrl.match(/https?:\/\/(?:www\.)?([^/]+)/i);
                let serverFallbackName = domainMatch ? domainMatch[1] : "Inconnu";
                failedLinks.push({ server_name: `${prefix} ${serverFallbackName}`, url: embedUrl });
            }
        }

        let safeStreams = streams.filter(s => s.streamUrl.includes('.mp4') || s.streamUrl.includes('.m3u8'));
        let uniqueStreams = [];
        let seenUrls = new Set();
        for (let s of safeStreams) {
            if (!seenUrls.has(s.streamUrl)) { seenUrls.add(s.streamUrl); uniqueStreams.push(s); }
        }

        sendSupabaseLog("Anime-Sama", "PLAYER", { 
            media_url: url, ep_number: epIndex + 1, streams_found: uniqueStreams.length, servers: extractedNames
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("Anime-Sama", "UNSUPPORTED_HOSTS", {
                media_url: url, ep_number: epIndex + 1, failed_count: failedLinks.length, failed_links: failedLinks
            });
        }

        return JSON.stringify(uniqueStreams.length > 0 ? { type: "servers", streams: uniqueStreams } : { type: "none" });

    } catch (e) {
        return JSON.stringify({ type: "none" });
    }
}

// ==========================================
// 🛠️ FONCTIONS UTILITAIRES & DÉCRYPTEURS
// ==========================================

// ==========================================
// 🔓 EMBED4ME / LPLAYER (embedseek) — AES-128-CBC pur JS (porté de movix)
// L'API /api/v1/video?id=... renvoie un blob hex chiffré. Clé/IV statiques.
// ==========================================
const _EMBED4ME_KEY = "kiemtienmua911ca";
const _EMBED4ME_IV  = "1234567890oiuytr";

// --- AES-128 pur JS (déchiffrement CBC) ---
const _AES = (function () {
    const sbox = [], invSbox = [], rcon = [0x01];
    (function init() {
        const p = new Uint8Array(256), q = new Uint8Array(256);
        let x = 1, xi = 1;
        for (let i = 0; i < 256; i++) {
            p[i] = x;
            x ^= (x << 1) ^ ((x & 0x80) ? 0x11b : 0);
            xi ^= xi << 1; xi ^= xi << 2; xi ^= xi << 4;
            if (xi & 0x80) xi ^= 0x09;
            q[x & 0xff === 0 ? 0 : x] = 0; // placeholder, real inverse below
        }
        // table de log/antilog correcte
        const log = new Uint8Array(256), alog = new Uint8Array(256);
        let a = 1;
        for (let i = 0; i < 255; i++) {
            alog[i] = a; log[a] = i;
            a ^= (a << 1) ^ ((a & 0x80) ? 0x11b : 0); a &= 0xff;
        }
        const inv = (g) => g === 0 ? 0 : alog[(255 - log[g]) % 255];
        for (let i = 0; i < 256; i++) {
            let s = inv(i), xf = s;
            for (let k = 0; k < 4; k++) { xf = ((xf << 1) | (xf >> 7)) & 0xff; s ^= xf; }
            s ^= 0x63;
            sbox[i] = s; invSbox[s] = i;
        }
        for (let i = 1; i < 10; i++) {
            rcon[i] = (rcon[i - 1] << 1) ^ ((rcon[i - 1] & 0x80) ? 0x11b : 0);
            rcon[i] &= 0xff;
        }
    })();

    function expandKey(key) { // key: 16 bytes
        const w = new Array(44);
        for (let i = 0; i < 4; i++)
            w[i] = [key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]];
        for (let i = 4; i < 44; i++) {
            let t = w[i - 1].slice();
            if (i % 4 === 0) {
                t = [t[1], t[2], t[3], t[0]].map(b => sbox[b]);
                t[0] ^= rcon[i / 4 - 1];
            }
            w[i] = w[i - 4].map((b, j) => b ^ t[j]);
        }
        return w;
    }

    function xtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x11b : 0)) & 0xff; }
    function mul(a, b) {
        let r = 0;
        for (let i = 0; i < 8; i++) {
            if (b & 1) r ^= a;
            const hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b;
            b >>= 1;
        }
        return r & 0xff;
    }

    function decryptBlock(inp, w) {
        let s = [[], [], [], []];
        for (let i = 0; i < 16; i++) s[i % 4][(i / 4) | 0] = inp[i];

        const addRound = (rnd) => {
            for (let c = 0; c < 4; c++)
                for (let r = 0; r < 4; r++)
                    s[r][c] ^= w[rnd * 4 + c][r];
        };
        const invSub = () => {
            for (let r = 0; r < 4; r++)
                for (let c = 0; c < 4; c++) s[r][c] = invSbox[s[r][c]];
        };
        const invShift = () => {
            for (let r = 1; r < 4; r++) {
                const row = s[r].slice();
                for (let c = 0; c < 4; c++) s[r][c] = row[(c - r + 4) % 4];
            }
        };
        const invMix = () => {
            for (let c = 0; c < 4; c++) {
                const a0 = s[0][c], a1 = s[1][c], a2 = s[2][c], a3 = s[3][c];
                s[0][c] = mul(a0,14)^mul(a1,11)^mul(a2,13)^mul(a3,9);
                s[1][c] = mul(a0,9)^mul(a1,14)^mul(a2,11)^mul(a3,13);
                s[2][c] = mul(a0,13)^mul(a1,9)^mul(a2,14)^mul(a3,11);
                s[3][c] = mul(a0,11)^mul(a1,13)^mul(a2,9)^mul(a3,14);
            }
        };

        addRound(10);
        for (let rnd = 9; rnd >= 1; rnd--) {
            invShift(); invSub(); addRound(rnd); invMix();
        }
        invShift(); invSub(); addRound(0);

        const out = new Uint8Array(16);
        for (let i = 0; i < 16; i++) out[i] = s[i % 4][(i / 4) | 0];
        return out;
    }

    function cbcDecrypt(cipher, key, iv) {
        const w = expandKey(key);
        const out = new Uint8Array(cipher.length);
        let prev = iv;
        for (let off = 0; off < cipher.length; off += 16) {
            const block = cipher.subarray(off, off + 16);
            const dec = decryptBlock(block, w);
            for (let i = 0; i < 16; i++) out[off + i] = dec[i] ^ prev[i];
            prev = block;
        }
        // retire le padding PKCS#7
        const pad = out[out.length - 1];
        return (pad > 0 && pad <= 16) ? out.subarray(0, out.length - pad) : out;
    }

    return { cbcDecrypt };
})();

function _hexToBytes(hex) {
    hex = hex.trim();
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}
function _strToBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
}

async function embed4meExtractor(embedUrl) {
    try {
        const host = (embedUrl.match(/https?:\/\/([^/]+)/i) || [])[1];
        const id = (embedUrl.match(/#([a-zA-Z0-9]+)/) || [])[1] || (embedUrl.match(/[?&]id=([a-zA-Z0-9]+)/) || [])[1];
        if (!host || !id) return null;
        const apiUrl = `https://${host}/api/v1/video?id=${id}&w=1680&h=1050&r=`;
        // ⚠️ N'envoyer QUE le User-Agent (Origin/Referer -> 400 sur cette famille).
        // Sans suivre les redirections : lpayer.embed4me.com renvoie depuis nov. 2026 un 308 vers
        // lui-même à l'infini (≈ 25 s perdues par épisode avant l'échec). L'API répond en direct.
        const res = await fetchv2(apiUrl, { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Accept": "*/*" }, "GET", null, false);
        if (!res || typeof res.text !== "function") return null;
        const hex = (await res.text()).trim();
        if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
        const cipher = _hexToBytes(hex);
        const plain = _AES.cbcDecrypt(cipher, _strToBytes(_EMBED4ME_KEY), _strToBytes(_EMBED4ME_IV));
        let txt = ""; for (let i = 0; i < plain.length; i++) txt += String.fromCharCode(plain[i]);
        try { txt = decodeURIComponent(escape(txt)); } catch (e) {}
        const data = JSON.parse(txt);
        let streamUrl = data.source || (data.hlsVideoTiktok ? `https://${host}${data.hlsVideoTiktok}` : null);
        if (!streamUrl) return null;
        return { streamUrl: streamUrl, headers: { "Referer": `https://${host}/`, "Origin": `https://${host}` } };
    } catch (e) { return null; }
}

// Décodeur VOE (Mise à jour avec safeAtob pour corriger l'erreur Buffer)
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
        let videoUrl = null;

        let directMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
        if (directMatch) {
            videoUrl = directMatch[1];
        } 
        else if (html.includes('eval(function(p,a,c,k,e,d)')) {
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
                        
                        let e = function(c) {
                            return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
                        };
                        
                        while (c--) {
                            if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
                        }
                        
                        let unpackedMatch = p.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
                        if (unpackedMatch) {
                            videoUrl = unpackedMatch[1];
                            break;
                        }
                    }
                }
            }
        }

        if (videoUrl) {
            return videoUrl.replace(/\\\//g, "/").trim();
        }
        return null;
    } catch (e) {
        return null;
    }
}