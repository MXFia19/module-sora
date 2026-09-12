import { cached } from '../cache';
import { request, getText, absolute } from '../http';
import { logger } from '../log';
import { pickBest, pickByKeywords, franchiseRoot } from '../match';
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

interface Hit { title: string; href: string; extraTitles?: string[] }

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
    // Chaque carte porte le titre en <h3> et, juste après, le titre original
    // en sous-titre (« Your Name » / « Kimi no Na wa »). Le second est souvent
    // le seul à correspondre à ce que TMDB appelle le titre original.
    const re = /<a[^>]+href=["']([^"']+)["'][\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>(?:[\s\S]{0,200}?<p[^>]*subtitle[^>]*>([\s\S]*?)<\/p>)?/gi;
    for (const m of res.text.matchAll(re)) {
      const href = absolute(m[1]!.trim(), `https://${domain}/`);
      const title = decodeEntities(m[2]!.replace(/<[^>]+>/g, '')).trim();
      const sub = decodeEntities((m[3] ?? '').replace(/<[^>]+>/g, '')).trim();
      const extraTitles = sub ? sub.split(',').map(t => t.trim()).filter(Boolean) : undefined;
      if (title && !hits.some(h => h.href === href)) hits.push({ title, href, extraTitles });
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
    // Le guillemet ouvrant est capturé et réutilisé en référence arrière : un
    // nom d'onglet contient très souvent une apostrophe (« Film - Train de
    // l'infini »), et une classe [^'"] s'y arrêtait — l'onglet disparaissait
    // sans un mot, et avec lui le film qu'il portait.
    const re = /panneauAnime\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(['"])([\s\S]*?)\3\s*\)/g;
    for (const m of html.matchAll(re)) {
      const name = m[2]!.trim();
      const path = m[4]!.trim();
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

/** Onglet qui contient des films. anime-sama les nomme soit génériquement
 *  (« Film », « Films »), soit avec le titre du film quand la fiche en porte
 *  plusieurs (« Film - Train de l'infini »). Les OAV sont exclus : ce sont des
 *  épisodes bonus, pas des longs métrages, et les servir sur une fiche de film
 *  rendrait le mauvais contenu. */
function isFilmTab(name: string): boolean {
  return /\bfilms?\b/i.test(name.replace(/\(?(vostfr|vf|va)\)?/gi, ' '));
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

/** Titres des entrées d'un onglet, quand la page les déclare. Un onglet
 *  « Films » qui en regroupe dix-sept les nomme un par un via `newSPF(...)`,
 *  dans l'ordre des tableaux d'`episodes.js` : c'est le seul moyen de savoir
 *  lequel des dix-sept est celui qu'on cherche. */
async function entryNames(tabUrl: string, referer: string): Promise<string[]> {
  return cached(`animesama:names:${tabUrl}`, async () => {
    const html = await getText(tabUrl, { headers: { Referer: referer } });
    // Même piège d'apostrophe qu'au-dessus, en pire : ici l'ordre des noms EST
    // l'index dans `episodes.js`. En perdre un décale tous les suivants et
    // fait servir un autre film que celui demandé.
    return [...html.matchAll(/newSPF\s*\(\s*(['"])([\s\S]*?)\1\s*\)/g)]
      .map(m => decodeEntities(m[2]!).trim());
  }, { ttlMs: PAGE_TTL_MS });
}

/** Résout un couple (onglet, index) en flux, sur les trois pistes de langue.
 *  L'arborescence est identique d'une langue à l'autre : /vostfr, /vf, /va. */
async function streamsAt(tab: Tab, index: number, domain: string): Promise<RawStream[]> {
  const langs = ['vostfr', 'vf', 'va'];
  const current = tab.url.match(/\/(vostfr|vf|va)\/?$/i)?.[1]?.toLowerCase();
  const variants = current
    ? langs.map(l => ({ lang: l.toUpperCase(), url: tab.url.replace(new RegExp(`/${current}/?$`, 'i'), `/${l}`) }))
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
    container: e.url.includes('.m3u8') ? ('hls' as const) : ('mp4' as const),
  }));
}

/** Trouve la fiche du contenu. Le titre original passe souvent mieux que le
 *  titre FR sur un catalogue anime, d'où l'essai des alias dans l'ordre. */
async function findAnime(req: MediaRequest, domain: string): Promise<string | null> {
  const queries: string[] = [];
  for (const alias of req.aliases.slice(0, 4)) {
    queries.push(alias);
    // Pour un film, le titre complet est presque toujours trop long ; sa
    // racine ramène la fiche de la franchise, qui est celle qu'on veut.
    const root = req.type === 'movie' ? franchiseRoot(alias) : null;
    if (root) queries.push(root);
  }

  for (const query of [...new Set(queries)].slice(0, 6)) {
    const hits = await search(domain, query);
    const best = pickBest(hits, { aliases: req.aliases });
    if (best) {
      log.debug(`fiche: ${best.item.href} (score ${best.score.toFixed(2)}, via « ${query} »)`);
      return best.item.href;
    }
  }
  log.debug(`aucune fiche pour « ${req.title} »`);
  return null;
}

async function resolveSeries(req: MediaRequest, animeUrl: string, domain: string): Promise<RawStream[]> {
  const tabs = await seasonTabs(animeUrl);
  const seasonTab = tabs.find(t => tabSeason(t.name) === req.season);

  let tab: Tab | undefined = seasonTab;
  let index = req.episode! - 1;

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

  return streamsAt(tab, index, domain);
}

async function resolveMovie(req: MediaRequest, animeUrl: string, domain: string): Promise<RawStream[]> {
  const tabs = await seasonTabs(animeUrl);
  const filmTabs = tabs.filter(t => isFilmTab(t.name));
  if (filmTabs.length === 0) {
    log.debug(`fiche sans onglet film: ${animeUrl}`);
    return [];
  }

  // Un film = un couple (onglet, index). Une fiche peut en porter plusieurs,
  // soit en onglets séparés (« Film - Train de l'infini »), soit en un seul
  // onglet « Films » de onze entrées nommées par `newSPF(...)`.
  const referer = `https://${domain}/`;
  const perTab = await Promise.all(filmTabs.map(async tab => {
    const names = await entryNames(tab.url, referer);
    if (names.length === 0) return [{ tab, index: 0, label: tab.name }];
    return names.map((label, index) => ({ tab, index, label }));
  }));
  const candidates = perTab.flat();

  // Un seul film sur la fiche : le rapprochement de titre a déjà été fait au
  // moment de choisir la fiche, il n'y a rien à trancher de plus.
  if (candidates.length === 1) {
    const only = candidates[0]!;
    log.debug(`film unique: « ${only.label} » (${only.tab.name})`);
    return streamsAt(only.tab, only.index, domain);
  }

  // Plusieurs films : on cherche celui dont le libellé est entièrement
  // contenu, mot à mot, dans un des titres connus. Un seul doit ressortir —
  // sinon on préfère ne rien rendre à rendre le mauvais film.
  const byWords = pickByKeywords(
    candidates.map(c => ({ title: c.label, raw: c })),
    req.aliases,
  );
  let chosen: { tab: Tab; index: number; label: string } | undefined = byWords?.item.raw;

  if (!chosen) {
    // Aucun mot distinctif ne tranche : reste la comparaison de chaînes, sur
    // le libellé préfixé du nom de la fiche (« One Piece » + « Le Film »).
    const fiche = decodeURIComponent(animeUrl.replace(/\/+$/, '').split('/').pop() ?? '').replace(/-/g, ' ');
    const best = pickBest(
      candidates.map(c => ({ title: `${fiche} ${c.label}`, extraTitles: [c.label], raw: c })),
      { aliases: req.aliases },
    );
    chosen = best?.item.raw;
  }

  if (!chosen) {
    log.debug(`${candidates.length} films sur la fiche, aucun ne correspond à « ${req.title} »: ${candidates.map(c => c.label).join(' | ')}`);
    return [];
  }

  log.debug(`film « ${chosen.label} » (${chosen.tab.name} index ${chosen.index})`);
  return streamsAt(chosen.tab, chosen.index, domain);
}

async function resolve(req: MediaRequest): Promise<RawStream[]> {
  if (req.type === 'series' && (!req.season || !req.episode)) return [];

  const domain = await workingDomain();
  const animeUrl = await findAnime(req, domain);
  if (!animeUrl) return [];

  return req.type === 'movie'
    ? resolveMovie(req, animeUrl, domain)
    : resolveSeries(req, animeUrl, domain);
}

export const animesama: Scraper = {
  id: 'animesama',
  name: 'Anime-Sama',
  language: 'French',
  supports: ['movie', 'series'],
  animeOnly: true,
  resolve,
};
