// ==========================================
// ⚙️ SORA MODULE -- TWITCH (Live + VODs + Link Tracker)
// ==========================================

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
  'Client-ID': CLIENT_ID,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Referer': 'https://www.twitch.tv/',
  'Origin': 'https://www.twitch.tv',
  'Content-Type': 'application/json'
};

// ==========================================
// 🗄️ SUPABASE TRACKER
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
    if (typeof fetchv2 !== 'undefined') {
      await fetchv2(`${SUPABASE_URL}/rest/v1/app_logs`, headers, "POST", JSON.stringify(payload));
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/app_logs`, { method: "POST", headers: headers, body: JSON.stringify(payload) });
    }
  } catch (e) { console.log(`[Tracker] 🚨 Supabase error: ${e.message}`); }
}

// ==========================================
// 🛠️ UTILS
// ==========================================

function safeText(str) {
  if (!str) return "";
  return str.replace(/"/g, "'").replace(/[\r\n]+/g, " ").trim();
}

function formatDateISO(isoString) {
  if (!isoString) return "0000-00-00";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "0000-00-00";
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${day}/${month}/${year}`;
}

// ==========================================
// 🔧 TWITCH HELPERS (GQL + CloudFront + DVR)
// ==========================================

const VOD_QUALITIES = ['chunked', '1080p60', '720p60', '720p30', '480p30', '360p30', '160p30'];

const QUALITY_LABELS = {
  'chunked':  'Source',
  '1080p60':  '1080p60',
  '720p60':   '720p60',
  '720p30':   '720p30',
  '480p30':   '480p30',
  '360p30':   '360p30',
  '160p30':   '160p'
};

async function gql(query) {
  try {
    const resp = await soraFetch(GQL_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ query })
    });
    return await resp.json();
  } catch (e) {
    console.log(`[GQL] 🚨 Error: ${e.message}`);
    return null;
  }
}

async function isM3u8Valid(url) {
  try {
    const resp = await soraFetch(url, {
      method: 'GET',
      headers: { 'Referer': 'https://www.twitch.tv/' }
    });
    if (!resp) return false;
    const text = await resp.text();
    return text.includes('.ts') || text.includes('.mp4');
  } catch (e) {
    return false;
  }
}

async function getVodCloudFrontVariants(videoId) {
  const result = [];
  try {
    const json = await gql(`query { video(id: "${videoId}") { seekPreviewsURL broadcastType } }`);
    const video = json?.data?.video;
    if (!video || !video.seekPreviewsURL) return result;

    const base = video.seekPreviewsURL.split('/storyboards/')[0];
    const isHighlight = video.broadcastType && video.broadcastType.toLowerCase() === 'highlight';

    const checks = await Promise.all(
      VOD_QUALITIES.map(async (quality) => {
        const url = isHighlight
          ? `${base}/${quality}/highlight-${videoId}.m3u8`
          : `${base}/${quality}/index-dvr.m3u8`;
        const valid = await isM3u8Valid(url);
        return { quality, url, valid };
      })
    );

    for (const item of checks) {
      if (item.valid) {
        result.push({ quality: item.quality, url: item.url });
      }
    }
  } catch (e) {
    console.log(`[VOD CloudFront] 🚨 Error: ${e.message}`);
  }
  return result;
}

async function getLiveDvrVariants(login) {
  const result = [];
  try {
    const json = await gql(`query {
      user(login: "${login}") {
        videos(first: 1, type: ARCHIVE, sort: TIME) {
          edges { node { id seekPreviewsURL } }
        }
      }
    }`);
    const edges = json?.data?.user?.videos?.edges;
    if (!edges || edges.length === 0) return result;

    const vodNode = edges[0].node;
    if (!vodNode.seekPreviewsURL) return result;

    const base = vodNode.seekPreviewsURL.split('/storyboards/')[0];

    const checks = await Promise.all(
      VOD_QUALITIES.map(async (quality) => {
        const url = `${base}/${quality}/index-dvr.m3u8`;
        const valid = await isM3u8Valid(url);
        return { quality, url, valid };
      })
    );

    for (const item of checks) {
      if (item.valid) {
        result.push({ quality: item.quality, url: item.url });
      }
    }
  } catch (e) {
    console.log(`[DVR Live] 🚨 Error: ${e.message}`);
  }
  return result;
}

async function getLiveOfficialStream(login, playerType) {
  try {
    const json = await gql(`query {
      streamPlaybackAccessToken(channelName: "${login}", params: {
        platform: "web", playerBackend: "mediaplayer", playerType: "${playerType}"
      }) { value signature }
    }`);
    const tokenData = json?.data?.streamPlaybackAccessToken;
    if (!tokenData) return null;
    const safeToken = encodeURIComponent(tokenData.value);
    const safeSig = encodeURIComponent(tokenData.signature);
    return `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?allow_source=true&sig=${safeSig}&token=${safeToken}&player_backend=mediaplayer`;
  } catch (e) {
    return null;
  }
}

// ==========================================
// ⚙️ MODULE LOGIC
// ==========================================

// --- 1. SEARCH ---
async function searchResults(keyword) {
  console.log(`[Twitch] 🔍 Searching Live & VODs for: ${keyword}`);
  try {
    const cleanKeyword = keyword.trim().toLowerCase();
    
    const parts = cleanKeyword.split(/\s+/);
    const login = parts[0];
    const searchTerm = parts.slice(1).join(" "); 

    const limit = searchTerm ? 100 : 15;

    const query = {
      query: `query {
        user(login: "${login}") {
          displayName
          stream {
            id title viewersCount
            previewImageURL(width: 640, height: 360)
          }
          videos(first: ${limit}, type: ARCHIVE, sort: TIME) {
            edges {
              node {
                id title publishedAt lengthSeconds
                previewThumbnailURL(height: 360, width: 640)
              }
            }
          }
        }
      }`
    };

    const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
    const json = await responseText.json();
    const user = json.data?.user;

    if (!user) {
      console.log(`[Twitch] 🚨 Streamer ${login} not found.`);
      return JSON.stringify([]);
    }

    const results = [];
    const stream = user.stream;
    let edges = user.videos?.edges || [];

    if (searchTerm) {
      if (stream && stream.title.toLowerCase().includes(searchTerm)) {
        let streamImg = stream.previewImageURL || "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
        results.push({
          title: `🔴 [LIVE] ${safeText(stream.title)}`,
          image: streamImg,
          href: `https://www.twitch.tv/${login}`
        });
      }

      edges = edges.filter(edge => {
         const v = edge.node;
         const titleMatch = v.title && v.title.toLowerCase().includes(searchTerm);
         const dateMatch = v.publishedAt && formatDateISO(v.publishedAt).includes(searchTerm);
         return titleMatch || dateMatch;
      });
    } else {
      if (stream) {
        let streamImg = stream.previewImageURL || "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
        results.push({
          title: `🔴 [LIVE] ${safeText(stream.title)}`,
          image: streamImg,
          href: `https://www.twitch.tv/${login}`
        });
      }
    }

    edges.forEach((edge) => {
      const video = edge.node;
      const mins = Math.floor(video.lengthSeconds / 60);
      const hours = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      const durationLabel = hours > 0 ? `${hours}h${remainingMins.toString().padStart(2, '0')}` : `${mins} min`;

      let img = video.previewThumbnailURL;
      if (img && !img.includes("404_preview")) {
        img = img.replace("{width}", "640").replace("{height}", "360");
      } else {
        img = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
      }

      results.push({
        title: `🟣 [${durationLabel}] ${safeText(video.title) || "Untitled VOD"}`,
        image: img,
        href: `https://www.twitch.tv/videos/${video.id}`
      });
    });

    sendSupabaseLog("Twitch", "SEARCH", {
      keyword: keyword, results_count: results.length, top_results: results.slice(0, 3).map(r => r.title)
    });

    return JSON.stringify(results);

  } catch (error) {
    console.log(`[Twitch] 🚨 Search error: ${error}`);
    return JSON.stringify([]);
  }
}

// --- 2. DETAILS ---
async function extractDetails(url) {
  sendSupabaseLog("Twitch", "DETAILS", { anime_url: url });
  try {
    let query;
    let finalDesc = "";
    let aliases = "";
    let airdate = "";

    if (url.includes('/videos/')) {
      const videoId = url.split('/videos/')[1];
      query = { query: `query { video(id: "${videoId}") { description publishedAt viewCount owner { displayName } } }` };
      const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
      const json = await responseText.json();
      const video = json.data?.video;
      
      if (video) {
        finalDesc = safeText(video.description) || "Aucune description pour cette VOD.";
        const views = video.viewCount ? video.viewCount.toLocaleString('en-US') : "0";
        const owner = video.owner?.displayName || "Inconnu";
        aliases = `Chaîne : ${owner} | Vues : ${views}`;
        airdate = formatDateISO(video.publishedAt);
      }
    } else {
      const login = url.split('twitch.tv/')[1].split('/')[0];
      query = { query: `query { user(login: "${login}") { description stream { viewersCount createdAt } } }` };
      const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
      const json = await responseText.json();
      const user = json.data?.user;
      
      if (user && user.stream) {
        finalDesc = safeText(user.description) || "Aucune description.";
        const viewers = user.stream.viewersCount ? user.stream.viewersCount.toLocaleString('en-US') : "0";
        aliases = `🔴 EN DIRECT | Viewers : ${viewers}`;
        airdate = formatDateISO(user.stream.createdAt);
      }
    }

    if (finalDesc === "") {
        return JSON.stringify([{ description: 'Infos indisponibles', aliases: '', airdate: '' }]);
    }

    finalDesc += "\n\n━━━━━━━━━━━━━━━━━━━━\n👾 Rejoins le Discord MXFia pour les mises à jour et requêtes : https://discord.gg/TON_LIEN";

    return JSON.stringify([{ description: finalDesc, aliases: aliases, airdate: airdate }]);

  } catch (error) {
    return JSON.stringify([{ description: 'Erreur de chargement', aliases: '', airdate: '' }]);
  }
}

// --- 3. EPISODES ---
async function extractEpisodes(url) {
  try {
    let epTitle = url.includes('/videos/') ? "Play VOD" : "Join Live Stream";
    return JSON.stringify([{ href: url, number: 1, season: 1, title: epTitle }]);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// --- 4. STREAM ---
async function extractStreamUrl(url) {
  console.log(`[Twitch Player] 🎬 Stream request for: ${url}`);
  try {
    let streams = [];
    let isVod = url.includes("/videos/");
    let extractedNames = [];
    let failedLinks = [];

    // ==========================================
    // 🟣 VOD
    // ==========================================
    if (isVod) {
      const videoId = url.split('/videos/')[1];

      try {
        const variants = await getVodCloudFrontVariants(videoId);
        for (const v of variants) {
          const label = QUALITY_LABELS[v.quality] || v.quality;
          streams.push({
            title: `☁️ VOD · CloudFront (${label})`,
            streamUrl: v.url,
            headers: { "Referer": "https://www.twitch.tv/" }
          });
          extractedNames.push(`VOD CF ${label}`);
        }
        if (variants.length === 0) {
          failedLinks.push({ server_name: "VOD CloudFront (no quality available)", url });
        }
      } catch (e) {
        console.log(`[Twitch Player] 🚨 CloudFront VOD error: ${e.message}`);
      }

    // ==========================================
    // 🔴 LIVE
    // ==========================================
    } else {
      const login = url.split('twitch.tv/')[1].split('/')[0];

      // 👇 NOUVEAU : Proxy Luminous avec Extraction des Qualités
      try {
          const luminousUrl = `https://as.luminous.dev/live/${login}?allow_source=true&allow_audio_only=true&fast_bread=true`;
          console.log(`[Twitch Player] 📡 Fetching Luminous Master Playlist...`);

          const req = await soraFetch(luminousUrl, { headers: { "Referer": "https://www.twitch.tv/" } });
          const m3u8Text = req ? await req.text() : "";

          if (m3u8Text && m3u8Text.includes('#EXTM3U')) {
              let mediaMap = {};
              let lines = m3u8Text.split('\n');
              let currentVideoId = "Source";

              for (let line of lines) {
                  line = line.trim();
                  
                  // 1. On associe les ID techniques à leurs vrais noms (ex: GROUP-ID="chunked" -> NAME="1080p60 (source)")
                  if (line.startsWith('#EXT-X-MEDIA')) {
                      let groupIdMatch = line.match(/GROUP-ID="([^"]+)"/);
                      let nameMatch = line.match(/NAME="([^"]+)"/);
                      if (groupIdMatch && nameMatch) {
                          mediaMap[groupIdMatch[1]] = nameMatch[1];
                      }
                  }
                  // 2. On lit quelle qualité s'apprête à être annoncée sur la ligne suivante
                  else if (line.startsWith('#EXT-X-STREAM-INF')) {
                      let videoMatch = line.match(/VIDEO="([^"]+)"/);
                      if (videoMatch) {
                          currentVideoId = videoMatch[1];
                      }
                  }
                  // 3. On capture l'URL pure du flux
                  else if (line && !line.startsWith('#')) {
                      let streamUrl = line;
                      // Sécurité : Si Twitch renvoie un lien relatif, on le transforme en lien absolu
                      if (!streamUrl.startsWith('http')) {
                          streamUrl = `https://as.luminous.dev/live/${streamUrl}`;
                      }

                      let rawLabel = mediaMap[currentVideoId] || currentVideoId;
                      // Nettoyage esthétique du nom affiché dans Sora TV
                      let cleanLabel = rawLabel.replace(" (source)", "").replace("chunked", "Source").replace("Audio_Only", "Audio Seulement");

                      streams.push({
                          title: `🌟 Luminous (${cleanLabel})`,
                          streamUrl: streamUrl,
                          headers: { "Referer": "https://www.twitch.tv/" }
                      });
                      extractedNames.push(`Luminous ${cleanLabel}`);
                  }
              }
          } else {
              // PLAN B : Si on n'arrive pas à lire le texte, on met le lien global
              streams.push({
                  title: `🌟 Live · Luminous (Auto)`,
                  streamUrl: luminousUrl,
                  headers: { "Referer": "https://www.twitch.tv/" }
              });
              extractedNames.push(`Live Luminous Proxy`);
          }
      } catch(e) {
          console.log(`[Twitch Player] 🚨 Luminous proxy extraction error: ${e.message}`);
      }

      // --- Official Live servers: embed + popout only ---
      const playerTypes = ['popout'];
      const typeLabels  = { popout: 'Popout' };

      for (const pt of playerTypes) {
        try {
          const streamUrl = await getLiveOfficialStream(login, pt);
          if (streamUrl) {
            streams.push({
              title: `🔴 Live · Officiel (${typeLabels[pt]})`,
              streamUrl,
              headers: { "Referer": "https://www.twitch.tv/" }
            });
            extractedNames.push(`Live Official ${typeLabels[pt]}`);
          } else {
            failedLinks.push({ server_name: `Live Official ${typeLabels[pt]} (Rejected)`, url });
          }
        } catch (e) {}
      }

      // --- DVR servers: Live via last archive VOD ---
      try {
        const dvrVariants = await getLiveDvrVariants(login);
        for (const v of dvrVariants) {
          const label = QUALITY_LABELS[v.quality] || v.quality;
          streams.push({
            title: `⏪ DVR · Anti-Pub (${label})`,
            streamUrl: v.url,
            headers: { "Referer": "https://www.twitch.tv/" }
          });
          extractedNames.push(`DVR ${label}`);
        }
        if (dvrVariants.length === 0) {
          failedLinks.push({ server_name: "DVR Live (no archive available)", url });
        }
      } catch (e) {
        console.log(`[Twitch Player] 🚨 DVR Live error: ${e.message}`);
      }
    }

    // --- Supabase log ---
    sendSupabaseLog("Twitch", "PLAYER", {
      anime_url: url,
      season_number: "1",
      ep_number: "1",
      streams_found: streams.length,
      servers: extractedNames,
      video_links: streams.map(s => s.streamUrl)
    });

    if (failedLinks.length > 0) {
      sendSupabaseLog("Twitch", "UNSUPPORTED_HOSTS", {
        anime_url: url, season_number: "1", ep_number: "1",
        failed_count: failedLinks.length, failed_links: failedLinks
      });
    }

    return JSON.stringify(streams.length > 0
      ? { type: "servers", streams }
      : { type: "none" }
    );

  } catch (error) {
    return JSON.stringify({ type: "none" });
  }
}

// ==========================================
// --- SORA UTILS ---
// ==========================================
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
  try {
    if (typeof fetchv2 !== 'undefined') {
      return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8');
    } else {
      return await fetch(url, options);
    }
  } catch (e) {
    try { return await fetch(url, options); } catch (error) { return null; }
  }
}