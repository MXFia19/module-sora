import { cached } from '../cache';
import { getText, absolute } from '../http';
import { logger } from '../log';
import { pickBest, pickByKeywords, scoreCandidate, franchiseRoot } from '../match';
import { audioLabel } from '../lang';
import { extractAll } from '../extractors';
import type { MediaRequest, RawStream, Scraper } from '../types';

/** voir-anime — WordPress avec le thème Madara (le même que les sites de
 *  scans) : la recherche passe par `?s=…&post_type=wp-manga`, et les épisodes
 *  sont des « chapitres ». La page d'un épisode porte les lecteurs, soit en
 *  iframe directe, soit derrière un `data-redirect` à résoudre.
 *
 *  Particularité : la numérotation est ABSOLUE (pas de saisons), d'où l'usage
 *  systématique de `absoluteEpisode`. */

const log = logger('VoirAnime');

const BASE = 'https://voir-anime.to';
const SEARCH_TTL_MS = 30 * 60 * 1000;
const PAGE_TTL_MS = 60 * 60 * 1000;

interface Hit { title: string; href: string; year?: number }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&#8217;/g, "'")
    .replace(/&#8211;/g, '-')
    .replace(/&quot;|&#822[01];/g, '"')
    .replace(/&#8230;/g, '…')
    .replace(/&nbsp;/g, ' ');
}

/** Cloudflare sert parfois un défi à la place de la page. Le reconnaître
 *  évite de parser du vide et de conclure « aucun résultat », qui enverrait
 *  le diagnostic sur une fausse piste. */
function isChallenge(html: string): boolean {
  return html.includes('Just a moment...') || html.includes('cf-browser-verification');
}

async function search(keyword: string): Promise<Hit[]> {
  return cached(`voiranime:search:${keyword.toLowerCase()}`, async () => {
    const url = `${BASE}/?s=${encodeURIComponent(keyword)}&post_type=wp-manga`;
    const html = await getText(url, { headers: { Referer: `${BASE}/` } });

    if (isChallenge(html)) {
      log.warn('défi Cloudflare — recherche impossible depuis ce serveur');
      return [];
    }

    // Madara rend une grille de fiches ; on découpe sur les marqueurs de
    // carte plutôt que de tenter une regex unique sur toute la page.
    const hits: Hit[] = [];
    const blocks = html.split(/c-tabs-item__content|page-item-detail|class=["']c-image["']/i);

    for (const block of blocks.slice(1)) {
      const href = block.match(/href=["']([^"']+)["']/i)?.[1];
      const rawTitle = block.match(/title=["']([^"']+)["']/i)?.[1]
        ?? block.match(/alt=["']([^"']+)["']/i)?.[1];
      if (!href || !rawTitle) continue;

      // Les blocs contiennent aussi des assets et des liens WordPress.
      if (/\.(css|js)|\/wp-/.test(href) || !href.startsWith(BASE)) continue;

      const title = decodeEntities(rawTitle.replace(/<[^>]+>/g, '')).trim();
      const year = Number(block.match(/release-year[^>]*>\s*<a[^>]*>(\d{4})<\/a>/i)?.[1]);

      if (title && !hits.some(h => h.href === href)) {
        hits.push({ title, href, year: Number.isFinite(year) ? year : undefined });
      }
    }

    log.debug(`« ${keyword} » -> ${hits.length} résultat(s)`);
    return hits;
  }, { ttlMs: SEARCH_TTL_MS });
}

interface Episode { href: string; number: number; title: string }

/** Liste des épisodes d'une fiche. Le thème les rend en <li class="…
 *  wp-manga-chapter …"> ; le numéro est dans le libellé ou dans le slug. */
async function episodes(animeUrl: string): Promise<Episode[]> {
  return cached(`voiranime:eps:${animeUrl}`, async () => {
    const html = await getText(animeUrl, { headers: { Referer: `${BASE}/` } });
    if (isChallenge(html)) return [];

    const out: Episode[] = [];
    const re = /<li class=["'][^"']*wp-manga-chapter[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    for (const m of html.matchAll(re)) {
      const href = absolute(m[1]!, BASE);
      const title = decodeEntities(m[2]!.replace(/<[^>]+>/g, '')).trim();
      const num = title.match(/(?:Épisode|Episode|Ep|OAV)\s*(\d+)/i)?.[1]
        ?? href.match(/-(\d+)(?:-(?:vostfr|vf|va))?\/?$/i)?.[1];
      out.push({ href, title, number: num ? Number(num) : out.length + 1 });
    }

    out.sort((a, b) => a.number - b.number);
    log.debug(`${out.length} épisode(s) sur ${animeUrl}`);
    return out;
  }, { ttlMs: PAGE_TTL_MS });
}

/** Liens de lecteurs présents sur la page d'un épisode : iframes directes,
 *  plus celles cachées derrière un `data-redirect` qu'il faut aller chercher. */
async function embedsOf(episodeUrl: string): Promise<string[]> {
  const html = await getText(episodeUrl, { headers: { Referer: `${BASE}/` } });
  if (isChallenge(html)) return [];

  const found = new Set<string>();

  const addFrame = (raw: string) => {
    const url = raw.startsWith('//') ? `https:${raw}` : raw;
    if (url.startsWith('http')) found.add(url);
  };

  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) addFrame(m[1]!);

  // La page déclare chaque lecteur deux fois (mise en page bureau et mobile).
  // Sans dédoublonnage on télécharge quatorze fois 180 Ko pour huit lecteurs.
  const redirects = [...new Set(
    [...html.matchAll(/data-redirect=["']([^"']+\?host=[^"']+)["']/gi)]
      .map(m => absolute(m[1]!.replace(/&amp;/g, '&'), BASE)),
  )];

  if (redirects.length > 0) {
    log.debug(`${redirects.length} lien(s) data-redirect à résoudre`);
    const pages = await Promise.all(
      redirects.map(p => getText(p, { headers: { Referer: episodeUrl } })),
    );
    for (const page of pages) {
      const frame = page.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
      if (frame) addFrame(frame);
    }
  }

  return [...found];
}

/** Fiches correspondant au contenu cherché.
 *
 *  Pour une série on n'en garde qu'une : c'est elle qui porte la liste des
 *  épisodes. Pour un film on garde toutes celles qui passent le seuil, parce
 *  que voir-anime publie la VF et la VOSTFR d'un même film sous deux fiches
 *  distinctes (« Kimi no Na wa. » et « Kimi no Na wa. (VF) ») : n'en prendre
 *  qu'une revient à perdre la moitié des langues. */
async function findAnime(req: MediaRequest, all: boolean): Promise<string[]> {
  const queries: string[] = [];
  for (const alias of req.aliases.slice(0, 4)) {
    queries.push(alias);
    const root = req.type === 'movie' ? franchiseRoot(alias) : null;
    if (root) queries.push(root);
  }

  for (const query of [...new Set(queries)].slice(0, 6)) {
    const hits = await search(query);
    if (!all) {
      const best = pickBest(hits, { aliases: req.aliases, year: req.year });
      if (best) {
        log.debug(`fiche: ${best.item.href} (score ${best.score.toFixed(2)}, via « ${query} »)`);
        return [best.item.href];
      }
      continue;
    }

    let matches = hits
      .map(h => ({ h, s: scoreCandidate(h, { aliases: req.aliases, year: req.year }) }))
      .filter(x => x.s.score >= 0.82)
      .sort((a, b) => b.s.score - a.s.score)
      .slice(0, 3);

    // Rien par similarité : reste le repêchage par mots-clés, pour les fiches
    // qui préfixent le nom de la franchise au titre du film.
    if (matches.length === 0) {
      const byWords = pickByKeywords(hits, req.aliases);
      if (byWords) matches = [{ h: byWords.item, s: byWords }];
    }

    if (matches.length > 0) {
      log.debug(`${matches.length} fiche(s) via « ${query} »: ${matches.map(m => `${m.h.title} (${m.s.score.toFixed(2)})`).join(', ')}`);
      return matches.map(m => m.h.href);
    }
  }

  log.debug(`aucune fiche pour « ${req.title} »`);
  return [];
}

/** Résout une page d'épisode (ou de film) en flux jouables. */
async function streamsOf(episodeUrl: string): Promise<RawStream[]> {
  const embeds = await embedsOf(episodeUrl);
  if (embeds.length === 0) {
    log.debug(`aucun lecteur sur ${episodeUrl}`);
    return [];
  }
  log.debug(`${embeds.length} lecteur(s) sur ${episodeUrl}`);

  // La langue n'est pas annoncée par lecteur : elle est dans le slug de
  // l'épisode quand elle l'est.
  const lang = audioLabel(episodeUrl);
  const extracted = await extractAll(embeds.map(url => ({ url, lang })), `${BASE}/`);

  return extracted.map(e => ({
    url: e.url,
    quality: 'HD',
    language: e.lang,
    server: e.server,
    headers: e.headers,
    container: e.url.includes('.m3u8') ? ('hls' as const) : ('mp4' as const),
  }));
}

async function resolveSeries(req: MediaRequest, animeUrl: string): Promise<RawStream[]> {
  // La liste est en numérotation absolue : pour une saison > 1, le numéro
  // Stremio ne correspond à rien ici, seul le numéro absolu a un sens.
  const list = await episodes(animeUrl);
  if (list.length === 0) return [];

  const wanted = (req.season ?? 1) > 1 ? req.absoluteEpisode : req.episode;
  if (!wanted) {
    log.debug(`saison ${req.season} sans numéro absolu calculable`);
    return [];
  }

  const episode = list.find(e => e.number === wanted);
  if (!episode) {
    log.debug(`épisode ${wanted} absent (${list.length} listés)`);
    return [];
  }

  return streamsOf(episode.href);
}

async function resolveMovie(req: MediaRequest, animeUrl: string): Promise<RawStream[]> {
  const list = await episodes(animeUrl);
  if (list.length === 0) {
    log.debug(`fiche sans entrée: ${animeUrl}`);
    return [];
  }

  // Un film a sa propre fiche, avec une entrée unique : le rapprochement de
  // titre a déjà été fait en choisissant la fiche.
  if (list.length === 1) return streamsOf(list[0]!.href);

  // Plusieurs entrées : c'est une fiche de série, ou une fiche qui regroupe
  // les films d'une franchise. Seul un rapprochement sur le libellé permet de
  // trancher, et à défaut on ne rend rien plutôt que le mauvais film.
  const best = pickBest(
    list.map(e => ({ title: e.title, raw: e })),
    { aliases: req.aliases },
  );
  if (!best) {
    log.debug(`${list.length} entrées sur ${animeUrl}, aucune ne correspond à « ${req.title} »`);
    return [];
  }

  log.debug(`entrée « ${best.item.raw.title} » (score ${best.score.toFixed(2)})`);
  return streamsOf(best.item.raw.href);
}

async function resolve(req: MediaRequest): Promise<RawStream[]> {
  if (req.type === 'series' && !req.episode) return [];

  const fiches = await findAnime(req, req.type === 'movie');
  if (fiches.length === 0) return [];

  if (req.type === 'series') return resolveSeries(req, fiches[0]!);

  // Les fiches d'un film sont indépendantes (VOSTFR d'un côté, VF de l'autre) :
  // une qui tombe ne doit pas emporter les autres.
  const perFiche = await Promise.all(fiches.map(async url => {
    try {
      return await resolveMovie(req, url);
    } catch (e) {
      log.debug(`${url}: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }));

  const streams = perFiche.flat();
  const seen = new Set<string>();
  return streams.filter(s => !seen.has(s.url) && seen.add(s.url));
}

export const voiranime: Scraper = {
  id: 'voiranime',
  name: 'VoirAnime',
  language: 'French',
  supports: ['movie', 'series'],
  animeOnly: true,
  resolve,
};
