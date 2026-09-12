import { cached } from '../cache';
import { request, getText, absolute } from '../http';
import { logger } from '../log';
import { pickBest } from '../match';
import { extractAll } from '../extractors';
import type { MediaRequest, RawStream, Scraper } from '../types';

/** anime-sama — catalogue d'anime en VOSTFR/VF, sans API : tout se lit dans
 *  le HTML et dans un `episodes.js` par saison, qui contient un tableau de
 *  liens d'embed par hébergeur. L'index dans ces tableaux EST le numéro
 *  d'épisode (base 0).
 *
 *  Le domaine tourne souvent ; anime-sama.pw publie la liste des miroirs
 *  actifs et un endpoint de vérification. */

const log = logger('AnimeSama');

const RADAR = 'https://anime-sama.pw';
const FALLBACK_DOMAIN = 'anime-sama.fr';
const DOMAIN_TTL_MS = 30 * 60 * 1000;
const SEARCH_TTL_MS = 30 * 60 * 1000;
const PAGE_TTL_MS = 60 * 60 * 1000;

/** Miroirs annoncés par le radar, dans l'ordre, le premier qui répond gagne. */
async function workingDomain(): Promise<string> {
  return cached('animesama:domain', async () => {
    const html = await getText(`${RADAR}/`);
    const domains = [...html.matchAll(/\{\s*name:\s*'([^']+)'\s*\}/g)].map(m => m[1]!);
    if (domains.length === 0) {
      log.warn(`radar muet, repli sur ${FALLBACK_DOMAIN}`);
      return FALLBACK_DOMAIN;
    }

    for (const domain of domains) {
      const check = await request(`${RADAR}/?check=${domain}`);
      const code = check.json<any>()?.code;
      if (code === 200) {
        log.debug(`miroir actif: ${domain}`);
        return domain;
      }
      log.debug(`miroir écarté: ${domain} (code ${code ?? '?'})`);
    }

    log.warn(`aucun miroir validé, repli sur ${domains[0]}`);
    return domains[0]!;
  }, { ttlMs: DOMAIN_TTL_MS });
}

interface Hit { title: string; href: string }

/** La recherche passe par un endpoint PHP qui rend un fragment HTML. */
async function search(domain: string, keyword: string): Promise<Hit[]> {
  return cached(`animesama:search:${domain}:${keyword.toLowerCase()}`, async () => {
    const res = await request(`https://${domain}/template-php/defaut/fetch.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `https://${domain}/`,
      },
      body: `query=${encodeURIComponent(keyword)}`,
    });

    const hits: Hit[] = [];
    const re = /<a[^>]+href=["']([^"']+)["'][\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    for (const m of res.text.matchAll(re)) {
      const href = absolute(m[1]!.trim(), `https://${domain}/`);
      const title = decodeEntities(m[2]!.replace(/<[^>]+>/g, '')).trim();
      if (title && !hits.some(h => h.href === href)) hits.push({ title, href });
    }
    log.debug(`« ${keyword} » -> ${hits.length} résultat(s)`);
    return hits;
  }, { ttlMs: SEARCH_TTL_MS });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8211;/g, '-')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

interface Tab { name: string; url: string }

/** Onglets déclarés sur la fiche : saisons, films, OAV. Ils sont poussés par
 *  des appels `panneauAnime('Saison 2', 'saison2/vostfr')` dans la page. */
async function seasonTabs(animeUrl: string): Promise<Tab[]> {
  return cached(`animesama:tabs:${animeUrl}`, async () => {
    const base = animeUrl.endsWith('/') ? animeUrl : `${animeUrl}/`;
    const html = await getText(base, { headers: { Referer: base } });

    const tabs: Tab[] = [];
    const re = /panneauAnime\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gi;
    for (const m of html.matchAll(re)) {
      const name = m[1]!.trim();
      const path = m[2]!.trim();
      // Le site laisse un appel-modèle ('nom', 'url') dans la page.
      if (name.toLowerCase() === 'nom' || path.toLowerCase() === 'url') continue;
      tabs.push({ name, url: absolute(path, base) });
    }

    if (tabs.length === 0) tabs.push({ name: 'Saison 1', url: `${base}saison1/vostfr` });
    log.debug(`${tabs.length} onglet(s) sur ${animeUrl}`);
    return tabs;
  }, { ttlMs: PAGE_TTL_MS });
}

/** Numéro de saison porté par un nom d'onglet. Les films et OAV ne sont pas
 *  des saisons : on les marque 0 pour ne jamais les servir à la place d'un
 *  épisode réel. */
function tabSeason(name: string): number | null {
  const clean = name.replace(/\(?(vostfr|vf|va)\)?/gi, '').trim();
  if (/\b(film|oav|ova|special)\b/i.test(clean)) return 0;
  const m = clean.match(/saison\s*(\d+)/i);
  return m?.[1] ? Number(m[1]) : null;
}

/** Les tableaux d'`episodes.js` : un par hébergeur, tous alignés sur le même
 *  index d'épisode. On rend, pour l'index demandé, un lien par tableau. */
function embedsAt(js: string, index: number): string[] {
  if (!js || js.includes('<html') || js.length < 50) return [];

  const out: string[] = [];
  const re = /(?:var|let|const)\s+[a-zA-Z0-9_]+\s*=\s*\[([\s\S]*?)\]\s*;/gm;
  for (const m of js.matchAll(re)) {
    const urls = m[1]!.match(/['"]([^'"]+)['"]/g) ?? [];
    const raw = urls[index]?.replace(/['"]/g, '').trim();
    if (raw?.startsWith('http')) out.push(raw);
  }
  return out;
}

/** Récupère l'episodes.js d'un onglet, en suivant le <script src> de la page
 *  quand le fichier n'est pas à l'emplacement attendu. */
async function episodesJs(tabUrl: string, referer: string): Promise<string> {
  const base = tabUrl.endsWith('/') ? tabUrl : `${tabUrl}/`;
  const direct = await getText(`${base}episodes.js`, { headers: { Referer: referer } });
  if (direct && !direct.includes('<html') && direct.length >= 50) return direct;

  const page = await getText(tabUrl, { headers: { Referer: referer } });
  const src = page.match(/<script[^>]+src=['"]([^'"]*episodes\.js[^'"]*)['"]/i)?.[1];
  if (!src) return '';
  return getText(absolute(src.trim(), base), { headers: { Referer: referer } });
}

async function resolve(req: MediaRequest): Promise<RawStream[]> {
  if (req.type !== 'series' || !req.season || !req.episode) return [];

  const domain = await workingDomain();

  // 1) Trouver la fiche. On essaie les titres connus dans l'ordre : le titre
  //    original passe souvent mieux que le titre FR sur un catalogue anime.
  let animeUrl: string | null = null;
  for (const alias of req.aliases.slice(0, 4)) {
    const hits = await search(domain, alias);
    const best = pickBest(hits.map(h => ({ title: h.title, href: h.href })), { aliases: req.aliases });
    if (best) {
      animeUrl = best.item.href;
      log.debug(`fiche: ${animeUrl} (score ${best.score.toFixed(2)})`);
      break;
    }
  }
  if (!animeUrl) {
    log.debug(`aucune fiche pour « ${req.title} »`);
    return [];
  }

  // 2) Choisir l'onglet de saison, et l'index de l'épisode dans cet onglet.
  const tabs = await seasonTabs(animeUrl);
  const seasonTab = tabs.find(t => tabSeason(t.name) === req.season);

  let tab: Tab | undefined = seasonTab;
  let index = req.episode - 1;

  if (!tab) {
    // anime-sama regroupe parfois toute la série sous « Saison 1 » avec une
    // numérotation continue : l'épisode absolu retombe alors sur le bon index.
    const first = tabs.find(t => tabSeason(t.name) === 1) ?? tabs[0];
    if (!first || !req.absoluteEpisode) {
      log.debug(`saison ${req.season} absente et pas de numéro absolu`);
      return [];
    }
    tab = first;
    index = req.absoluteEpisode - 1;
    log.debug(`saison ${req.season} absente -> repli sur « ${first.name} » index ${index}`);
  }

  // 3) Les trois pistes linguistiques partagent la même arborescence.
  const langs = ['vostfr', 'vf', 'va'];
  const current = tab.url.match(/\/(vostfr|vf|va)\/?$/i)?.[1]?.toLowerCase();
  const variants = current
    ? langs.map(l => ({ lang: l.toUpperCase(), url: tab!.url.replace(new RegExp(`/${current}/?$`, 'i'), `/${l}`) }))
    : [{ lang: 'VOSTFR', url: tab.url }];

  const referer = `https://${domain}/`;
  const perLang = await Promise.all(variants.map(async v => {
    const js = await episodesJs(v.url, referer);
    return embedsAt(js, index).map(url => ({ url, lang: v.lang }));
  }));

  const embeds = perLang.flat();
  if (embeds.length === 0) {
    log.debug(`aucun embed à l'index ${index}`);
    return [];
  }
  log.debug(`${embeds.length} embed(s) à résoudre`);

  const extracted = await extractAll(embeds, referer);
  return extracted.map(e => ({
    url: e.url,
    quality: 'HD',
    language: e.lang === 'VA' ? 'VO' : e.lang,
    server: e.server,
    headers: e.headers,
    container: e.url.includes('.m3u8') ? 'hls' : 'mp4',
  }));
}

export const animesama: Scraper = {
  id: 'animesama',
  name: 'Anime-Sama',
  language: 'French',
  supports: ['series'],
  animeOnly: true,
  resolve,
};
