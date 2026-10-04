// ==========================================
// ⚙️ SORA MODULE — INTERNET ARCHIVE (public domain films & classic TV)
// ==========================================
// archive.org hosts thousands of public-domain feature films (collection
// "feature_films") and classic TV episodes (collection "classic_tv"). Fully
// legal, no key, no signature: two public JSON APIs do everything.
//
//   Search   : GET /advancedsearch.php?q=title:(…) AND collection:(…)&fl[]=…&output=json
//   Metadata : GET /metadata/<identifier>  -> {metadata:{title, description, year…},
//                                              files:[{name, format, source, original,
//                                                      length, height, size}, …]}
//   Files    : GET /download/<identifier>/<name>  (302 to the storage node, range OK)
//
// An item is a folder of files: the uploaded original(s) plus the derivatives
// archive.org generates ("h.264" / "512Kb MPEG4" mp4s, ogv, thumbnails…).
// Only mp4/m4v/mov files are offered, since those play natively everywhere.
//
// Episodes:
//   - films  : the same film is often uploaded in several encodes (1080p,
//              DVD, iPod…). Files whose durations match within 2% are one
//              video; distinct durations (double features, serial chapters)
//              become separate entries. Trailers/menus are dropped.
//   - TV     : one entry per uploaded original (each episode is a file);
//              its derivatives are the qualities of that entry.
// Subtitles: the item's .srt/.vtt files (often an automatic "asr" track).

const IA_BASE = "https://archive.org";
const IA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IA_COLLECTIONS = ["feature_films", "classic_tv"];

// ==========================================
// 🗄️ SUPABASE TRACKER
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
    } catch (e) {
        console.log(`[Tracker] 🚨 Failed to send to Supabase: ${e.message}`);
    }
}

// ==========================================
// 🌐 NETWORK
// ==========================================

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    const headers = options.headers || {};
    if (!headers["User-Agent"]) headers["User-Agent"] = IA_UA;
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, headers, options.method ?? 'GET', options.body ?? null);
        } else {
            return await fetch(url, { ...options, headers: headers });
        }
    } catch (e) {
        try { return await fetch(url, { ...options, headers: headers }); } catch (error) { return null; }
    }
}

async function readBody(response) {
    if (!response) return "";
    if (typeof response.text === 'function') return await response.text();
    if (typeof response.data === 'string') return response.data;
    return "";
}

async function iaJson(url) {
    const response = await soraFetch(url, { method: 'GET', headers: { "Accept": "application/json" } });
    const body = await readBody(response);
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
}

async function iaMetadata(identifier) {
    return await iaJson(`${IA_BASE}/metadata/${encodeURIComponent(identifier)}`);
}

// ==========================================
// 🧰 HELPERS
// ==========================================

// archive.org metadata fields are a string or an array of strings.
function firstValue(value) {
    if (Array.isArray(value)) return value.length ? String(value[0]) : "";
    return value === undefined || value === null ? "" : String(value);
}

function stripHtml(text) {
    return String(text || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// A download URL, each path segment encoded (names can sit in sub-folders).
function downloadUrl(identifier, name) {
    return `${IA_BASE}/download/${encodeURIComponent(identifier)}/${name.split('/').map(encodeURIComponent).join('/')}`;
}

function isPlayableVideo(file) {
    const name = String(file.name || "").toLowerCase();
    return /\.(mp4|m4v|mov)$/.test(name) && file.format !== "Thumbnail";
}

function lengthSeconds(file) {
    const raw = String(file.length || "");
    if (!raw) return 0;
    // Either seconds ("5731.83") or a clock ("95:17" / "1:35:17").
    if (raw.indexOf(':') !== -1) {
        return raw.split(':').reduce((acc, part) => acc * 60 + (parseFloat(part) || 0), 0);
    }
    return parseFloat(raw) || 0;
}

function stemOf(name) {
    const base = String(name).split('/').pop();
    return base.replace(/\.[^.]+$/, "").replace(/_512kb$/i, "").replace(/\.ia$/i, "");
}

// Natural order ("Part 2" before "Part 10") without relying on Intl.
function naturalCompare(a, b) {
    const ax = String(a).toLowerCase().match(/\d+|\D+/g) || [];
    const bx = String(b).toLowerCase().match(/\d+|\D+/g) || [];
    for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
        const an = /^\d/.test(ax[i]), bn = /^\d/.test(bx[i]);
        if (an && bn) {
            const d = parseInt(ax[i], 10) - parseInt(bx[i], 10);
            if (d !== 0) return d;
        } else if (ax[i] !== bx[i]) {
            return ax[i] < bx[i] ? -1 : 1;
        }
    }
    return ax.length - bx.length;
}

function prettyName(name) {
    return stemOf(name).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatDuration(seconds) {
    if (!seconds) return "";
    const minutes = Math.round(seconds / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
}

function isTvItem(metadata) {
    const collections = metadata && metadata.collection;
    const list = Array.isArray(collections) ? collections : [collections];
    return list.indexOf("classic_tv") !== -1 && list.indexOf("feature_films") === -1;
}

// ==========================================
// 🧩 GROUPING FILES INTO VIDEOS
// ==========================================
// Returns [{key, title, length, files:[playable files]}] in display order.

function groupVideos(item) {
    const files = Array.isArray(item.files) ? item.files : [];
    const playable = files.filter(isPlayableVideo);
    if (playable.length === 0) return [];

    let groups = [];

    if (isTvItem(item.metadata)) {
        // One group per source: a derivative points at its original.
        const byRoot = {};
        for (const file of playable) {
            const root = file.source === 'derivative' && file.original ? file.original : file.name;
            (byRoot[root] = byRoot[root] || []).push(file);
        }
        for (const root of Object.keys(byRoot)) {
            const list = byRoot[root];
            groups.push({ key: root, title: prettyName(root), length: Math.max(...list.map(lengthSeconds)), files: list });
        }
        groups.sort((a, b) => naturalCompare(a.key, b.key));
    } else {
        // Films: cluster by duration (2% tolerance), unknown durations by stem.
        const known = playable.filter(f => lengthSeconds(f) > 0).sort((a, b) => lengthSeconds(a) - lengthSeconds(b));
        let current = null;
        for (const file of known) {
            const len = lengthSeconds(file);
            if (current && Math.abs(len - current.length) <= current.length * 0.02) {
                current.files.push(file);
            } else {
                current = { length: len, files: [file] };
                groups.push(current);
            }
        }
        const byStem = {};
        for (const file of playable.filter(f => lengthSeconds(f) === 0)) {
            const stem = stemOf(file.name);
            (byStem[stem] = byStem[stem] || { length: 0, files: [] }).files.push(file);
        }
        groups = groups.concat(Object.values(byStem));
        for (const group of groups) {
            group.files.sort((a, b) => naturalCompare(a.name, b.name));
            group.key = group.files[0].name;
            group.title = prettyName(group.key);
        }
        groups.sort((a, b) => naturalCompare(a.key, b.key));
    }

    // Drop trailers and DVD menus when real-length videos exist. For films,
    // also drop pieces under half the feature (per-VOB parts of a DVD rip),
    // which keeps double features but not their chapters.
    const longest = Math.max(...groups.map(g => g.length || 0));
    let floor = longest >= 2400 ? 600 : 60;
    if (longest >= 2400 && !isTvItem(item.metadata)) floor = Math.max(floor, longest * 0.5);
    const kept = groups.filter(g => !g.length || g.length >= floor);
    return kept.length ? kept : groups;
}

function findGroup(item, key) {
    const groups = groupVideos(item);
    return groups.find(g => g.key === key || g.files.some(f => f.name === key)) || groups[0] || null;
}

// ==========================================
// 🔍 SEARCH
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Internet Archive — searching for "${keyword}"`);
    try {
        const cleaned = String(keyword || "").replace(/[():"\\]/g, " ").trim();
        if (!cleaned) return JSON.stringify([]);

        const query = `title:(${cleaned}) AND collection:(${IA_COLLECTIONS.join(' OR ')}) AND mediatype:(movies)`;
        const fields = ["identifier", "title", "year", "collection"].map(f => `fl[]=${f}`).join('&');
        const url = `${IA_BASE}/advancedsearch.php?q=${encodeURIComponent(query)}&${fields}&sort[]=downloads+desc&rows=50&page=1&output=json`;
        const data = await iaJson(url);
        const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];

        const results = [];
        for (const doc of docs) {
            if (!doc || !doc.identifier) continue;
            const title = firstValue(doc.title) || doc.identifier;
            const year = firstValue(doc.year);
            const collections = Array.isArray(doc.collection) ? doc.collection : [doc.collection];
            const badge = collections.indexOf("feature_films") !== -1 ? "Film" : "TV";
            results.push({
                title: year ? `${title} (${year}) · ${badge}` : `${title} · ${badge}`,
                image: `${IA_BASE}/services/img/${encodeURIComponent(doc.identifier)}`,
                href: `internet-archive://item/${doc.identifier}`
            });
        }

        console.log(`[Search] ✅ ${results.length} result(s)`);
        sendSupabaseLog("Internet Archive", "SEARCH", {
            keyword: keyword,
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        return JSON.stringify(results);
    } catch (error) {
        sendSupabaseLog("Internet Archive", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 📖 DETAILS
// ==========================================

function parseHref(url) {
    // internet-archive://item/<identifier>
    // internet-archive-play://<identifier>/<file key>
    const play = String(url).match(/^internet-archive-play:\/\/([^/]+)\/(.+)$/);
    if (play) return { identifier: decodeURIComponent(play[1]), key: decodeURIComponent(play[2]) };
    const item = String(url).match(/^internet-archive:\/\/item\/(.+)$/);
    if (item) return { identifier: decodeURIComponent(item[1]), key: "" };
    const web = String(url).match(/archive\.org\/(?:details|download)\/([^/?#]+)/);
    return { identifier: web ? decodeURIComponent(web[1]) : String(url), key: "" };
}

async function extractDetails(url) {
    const ref = parseHref(url);
    console.log(`[Details] 📖 Internet Archive — ${ref.identifier}`);
    sendSupabaseLog("Internet Archive", "DETAILS", { media_url: `${IA_BASE}/details/${ref.identifier}` });

    try {
        const item = await iaMetadata(ref.identifier);
        const meta = item && item.metadata;
        if (!meta) {
            return JSON.stringify([{ description: 'Item not found on archive.org.', aliases: '', airdate: '' }]);
        }

        const description = stripHtml(firstValue(meta.description)) || "No description available.";

        const aliasParts = [];
        const creator = firstValue(meta.creator);
        if (creator) aliasParts.push(creator);
        const subject = Array.isArray(meta.subject) ? meta.subject.join(', ') : firstValue(meta.subject);
        if (subject) aliasParts.push(subject.slice(0, 120));
        const runtime = firstValue(meta.runtime);
        if (runtime) aliasParts.push(runtime);
        const license = firstValue(meta.licenseurl);
        aliasParts.push(license ? `License: ${license}` : "Public domain");

        return JSON.stringify([{
            description: description,
            aliases: aliasParts.join(' | '),
            airdate: firstValue(meta.date) || firstValue(meta.year)
        }]);
    } catch (error) {
        sendSupabaseLog("Internet Archive", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]);
    }
}

// ==========================================
// 📂 EPISODES
// ==========================================

async function extractEpisodes(url) {
    const ref = parseHref(url);
    console.log(`[Episodes] 📂 Internet Archive — ${ref.identifier}`);

    try {
        const item = await iaMetadata(ref.identifier);
        if (!item || !item.metadata) return JSON.stringify([]);

        const groups = groupVideos(item);
        const single = groups.length === 1;
        // Uploaders often name episodes "Show s01e19": use those numbers when
        // every file carries them, the running order otherwise.
        const tagged = groups.map(g => g.key.match(/s(\d{1,2})\s*e(\d{1,3})/i));
        const useTags = groups.length > 1 && tagged.every(Boolean);
        const episodes = groups.map((group, index) => {
            const duration = formatDuration(group.length);
            const label = single ? (isTvItem(item.metadata) ? group.title : "Full movie") : group.title;
            return {
                href: `internet-archive-play://${encodeURIComponent(ref.identifier)}/${encodeURIComponent(group.key)}`,
                number: useTags ? parseInt(tagged[index][2], 10) : index + 1,
                season: useTags ? parseInt(tagged[index][1], 10) : 1,
                title: duration ? `${label} (${duration})` : label
            };
        });

        console.log(`[Episodes] ✅ ${episodes.length} video(s)`);
        return JSON.stringify(episodes);
    } catch (error) {
        sendSupabaseLog("Internet Archive", "ERROR", { media_url: url, error_message: String(error) });
        return JSON.stringify([]);
    }
}

// ==========================================
// 🎬 PLAYBACK
// ==========================================

function qualityLabel(file) {
    const height = parseInt(file.height, 10);
    return height > 0 ? `${height}p` : (String(file.format || "").indexOf("512Kb") !== -1 ? "240p" : "SD");
}

async function extractStreamUrl(url) {
    const startTime = Date.now();
    const ref = parseHref(url);
    const mediaUrl = `${IA_BASE}/details/${ref.identifier}`;
    console.log(`[Player] 🎬 Internet Archive — ${ref.identifier} / ${ref.key}`);

    const streams = [];
    const allSubtitles = [];
    const failedLinks = [];
    let bestSubtitle = "";
    const subHeaders = { "User-Agent": IA_UA, "Referer": `${IA_BASE}/` };

    try {
        const item = await iaMetadata(ref.identifier);
        if (!item || !Array.isArray(item.files)) {
            failedLinks.push({ server_name: "archive.org", url: mediaUrl, reason: "Metadata unavailable" });
            sendSupabaseLog("Internet Archive", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: "1", ep_number: "1",
                failed_count: failedLinks.length, failed_links: failedLinks
            });
            return JSON.stringify({ type: "none" });
        }

        const group = findGroup(item, ref.key);
        if (!group) {
            failedLinks.push({ server_name: "archive.org", url: mediaUrl, reason: "No mp4 file in this item" });
        } else {
            // Best first: tallest picture, then the archive's own derivatives
            // (fast-start mp4s) before the uploader's originals.
            const files = group.files.slice().sort((a, b) => {
                const dh = (parseInt(b.height, 10) || 0) - (parseInt(a.height, 10) || 0);
                if (dh !== 0) return dh;
                return (a.source === 'derivative' ? 0 : 1) - (b.source === 'derivative' ? 0 : 1);
            });
            // Several encodes often share a resolution: keep the best one of each.
            const seen = {};
            for (const file of files) {
                const streamUrl = downloadUrl(ref.identifier, file.name);
                const quality = qualityLabel(file);
                if (seen[quality]) continue;
                seen[quality] = true;
                const sizeMb = file.size ? ` · ${Math.round(Number(file.size) / 1048576)} MB` : "";
                streams.push({
                    title: `Archive ${qualityLabel(file)} · ${file.format || 'MP4'}${sizeMb} (${String(file.name).split('/').pop()})`,
                    streamUrl: streamUrl,
                    headers: { "User-Agent": IA_UA, "Referer": `${IA_BASE}/` }
                });
            }
        }

        // Subtitles: prefer the tracks named after a file of this video.
        const stems = {};
        if (group) {
            for (const file of item.files) {
                const root = file.source === 'derivative' && file.original ? file.original : file.name;
                if (group.files.some(f => f.name === file.name || f.original === root || f.name === root)) stems[stemOf(root).toLowerCase()] = true;
                if (group.files.some(f => f.name === file.name)) stems[stemOf(file.name).toLowerCase()] = true;
            }
        }
        const subtitleFiles = item.files.filter(f => /\.(srt|vtt)$/i.test(String(f.name || "")));
        const matching = subtitleFiles.filter(f => stems[String(f.name).split('/').pop().replace(/\.(asr\.)?(srt|vtt)$/i, "").replace(/\.[a-z]{2,3}$/i, "").toLowerCase()]);
        const chosen = matching.length ? matching : (groupVideos(item).length === 1 ? subtitleFiles : []);
        for (const file of chosen) {
            const name = String(file.name);
            const subUrl = downloadUrl(ref.identifier, name);
            const auto = /\.asr\.(srt|vtt)$/i.test(name);
            const lang = (name.match(/\.([a-z]{2,3})\.(srt|vtt)$/i) || [])[1];
            const label = auto ? "English (auto)" : (lang && !/^asr$/i.test(lang) ? lang.toUpperCase() : prettyName(name));
            allSubtitles.push({ url: subUrl, label: label, kind: "captions", headers: subHeaders });
            if (!bestSubtitle || (!auto && /\.vtt$/i.test(name))) bestSubtitle = subUrl;
        }

        console.log(`-----------------------------------------------------`);
        console.log(`[Player] 📊 Summary: ${streams.length} link(s), ${allSubtitles.length} subtitle track(s).`);

        sendSupabaseLog("Internet Archive", "PLAYER", {
            media_url: mediaUrl,
            season_number: "1",
            ep_number: String(ref.key || "1"),
            streams_found: streams.length,
            subtitles_found: bestSubtitle !== "",
            allSubtitles_count: allSubtitles.length,
            execution_time_ms: Date.now() - startTime,
            servers: streams.map(s => ({ nom: s.title, lien: s.streamUrl }))
        });

        if (failedLinks.length > 0) {
            sendSupabaseLog("Internet Archive", "UNSUPPORTED_HOSTS", {
                media_url: mediaUrl, season_number: "1", ep_number: String(ref.key || "1"),
                failed_count: failedLinks.length, failed_links: failedLinks
            });
        }

        if (streams.length === 0) return JSON.stringify({ type: "none" });

        return JSON.stringify({
            type: "servers",
            streams: streams,
            subtitles: bestSubtitle,
            subtitlesHeaders: bestSubtitle ? subHeaders : {},
            allSubtitles: allSubtitles
        });
    } catch (error) {
        sendSupabaseLog("Internet Archive", "ERROR", { media_url: mediaUrl, error_message: String(error) });
        return JSON.stringify({ type: "none" });
    }
}
