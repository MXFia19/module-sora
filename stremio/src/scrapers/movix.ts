import { cached } from '../cache';
import { getJson, getText } from '../http';
import { logger } from '../log';
import { audioLabel } from '../lang';
import { pickBest, pickByKeywords } from '../match';
import { extractEmbed } from '../extractors';
import type { MediaRequest, RawStream, Scraper } from '../types';

/** movix — agrégateur keyé TMDB : son API expose une dizaine de sondes qui
 *  interrogent chacune un site tiers (french-stream, wiflix, purstream,
 *  cpasmal…) et rendent des liens de lecteurs. C'est la source la plus
 *  rentable du lot, et la seule qui n'a besoin d'aucun rapprochement par
 *  titre : l'identifiant Stremio suffit.
 *
 *  Le domaine tourne ; movix.online publie l'adresse courante. */

const log = logger('Movix');

const DISCOVERY_URL = 'https://movix.online/';
const FALLBACK_DOMAIN = 'movix.chat';
const DOMAIN_TTL_MS = 60 * 60 * 1000;

/** Hébergeurs qu'aucun extracteur ne sait ouvrir, ou qui coûtent plus cher en
 *  temps qu'ils ne rapportent. Les écarter tôt évite d'user le budget du
 *  scraper sur des liens qui n'aboutiront pas. */
const UNSUPPORTED = /waaw|younetu|netu|hqq|veev|listeamed|up4fun|coflix|kakaflix|fembed|sandratable/i;

async function currentDomain(): Promise<string> {
  return cached('movix:domain', async () => {
    const html = await getText(DISCOVERY_URL);

    // 1) Le canonical est la source la plus fiable — sauf quand il pointe la
    //    page de redirection elle-même.
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']https?:\/\/([^/"']+)/i)?.[1]
      ?? html.match(/<link[^>]+href=["']https?:\/\/([^/"']+)[^>]+rel=["']canonical["']/i)?.[1];
    if (canonical && !canonical.includes('movix.online')) {
      log.debug(`domaine via canonical: ${canonical}`);
      return canonical;
    }

    // 2) Sinon, le premier lien movix.<tld> de la page qui n'est ni la page
    //    de redirection ni un lien Telegram.
    for (const m of html.matchAll(/href=["']https?:\/\/(movix\.[a-z0-9.-]+)\//gi)) {
      const candidate = m[1]!;
      if (candidate !== 'movix.online' && !/telegram|t\.me/.test(candidate)) {
        log.debug(`domaine via lien: ${candidate}`);
        return candidate;
      }
    }

    log.warn(`domaine introuvable, repli sur ${FALLBACK_DOMAIN}`);
    return FALLBACK_DOMAIN;
  }, { ttlMs: DOMAIN_TTL_MS });
}

interface Link {
  url: string;
  language: string;
  quality: string;
  /** Site qui a fourni le lien — affiché pour situer la provenance. */
  via: string;
}

/** Accumulateur de liens : normalise la langue et la qualité, et
 *  dédoublonne. Les sondes rendent des formes très différentes, c'est ici
 *  qu'elles se rejoignent. */
class LinkSet {
  private readonly seen = new Set<string>();
  readonly links: Link[] = [];
  readonly countByVia: Record<string, number> = {};

  add(url: unknown, language?: unknown, quality?: unknown, via = 'movix'): void {
    if (typeof url !== 'string' || !url.startsWith('http')) return;
    // Marqueur d'épisode absent côté movix : un lecteur qui ne lira rien.
    if (url.includes('void.mp4')) return;
    if (this.seen.has(url)) return;

    this.seen.add(url);
    this.links.push({
      url,
      language: audioLabel(String(language ?? '')),
      quality: normalizeQuality(String(quality ?? '')),
      via,
    });
    this.countByVia[via] = (this.countByVia[via] ?? 0) + 1;
  }
}

function normalizeQuality(raw: string): string {
  const q = raw.toUpperCase();
  if (q.includes('4K') || q.includes('2160')) return '4K';
  if (q.includes('1080')) return '1080p';
  if (q.includes('720')) return '720p';
  if (q.includes('480')) return '480p';
  return 'HD';
}

/** Identifiant interne movix, nécessaire à la sonde « Direct ». Les autres
 *  sondes travaillent directement avec l'id TMDB. */
async function internalId(domain: string, tmdbId: string, title: string): Promise<string | null> {
  return cached(`movix:id:${tmdbId}`, async () => {
    const data = await getJson<any>(`https://api.${domain}/api/search?title=${encodeURIComponent(title)}`);
    const hit = (data?.results ?? []).find((r: any) => String(r?.tmdb_id) === String(tmdbId));
    return hit ? String(hit.id) : null;
  }, { shouldCache: v => v !== null });
}

interface Probe {
  name: string;
  /** null = la sonde ne couvre pas ce type de contenu. */
  url(): string | null;
  collect(json: any, out: LinkSet): void;
}

/** Les sondes de l'API movix. Chacune parle le dialecte du site qu'elle
 *  interroge : la forme des réponses n'est pas homogène, d'où un `collect`
 *  par sonde plutôt qu'un parseur unique. */
function probes(domain: string, req: MediaRequest, movixId: string | null): Probe[] {
  const api = (p: string) => `https://api.${domain}${p}`;
  const isTv = req.type === 'series';
  const id = req.tmdbId;
  const s = req.season ?? 1;
  const e = req.episode ?? 1;

  return [
    {
      name: 'Direct',
      url: () => !movixId ? null : isTv
        ? api(`/api/series/download/${movixId}/season/${s}/episode/${e}`)
        : api(`/api/movies/download/${movixId}`),
      collect: (j, out) => (j?.sources ?? []).forEach((x: any) =>
        out.add(x?.m3u8 ?? x?.src, x?.language, x?.quality, 'movix')),
    },
    {
      name: 'TMDB',
      url: () => isTv ? api(`/api/tmdb/tv/${id}?season=${s}&episode=${e}`) : api(`/api/tmdb/movie/${id}`),
      collect: (j, out) => {
        const links = isTv ? j?.current_episode?.player_links : j?.player_links;
        (links ?? []).forEach((p: any) => out.add(p?.decoded_url, p?.language, p?.quality, 'tmdb'));
      },
    },
    {
      name: 'Purstream',
      url: () => isTv ? api(`/api/purstream/tv/${id}/stream?season=${s}&episode=${e}`) : api(`/api/purstream/movie/${id}/stream`),
      collect: (j, out) => (j?.sources ?? []).forEach((x: any) => out.add(x?.url, x?.name, null, 'purstream')),
    },
    {
      name: 'Fstream',
      url: () => isTv ? api(`/api/fstream/tv/${id}/season/${s}`) : api(`/api/fstream/movie/${id}`),
      collect: (j, out) => {
        if (isTv) {
          const ep = j?.episodes?.[String(e)];
          forEachLangGroup(ep?.languages, (lang, p) => out.add(p?.url, lang, p?.quality, 'french-stream'));
        } else {
          forEachLangGroup(j?.players ?? j?.languages, (lang, p) =>
            out.add(p?.url, lang === 'Default' ? 'VF' : lang, p?.quality, 'french-stream'));
        }
      },
    },
    {
      name: 'Wiflix',
      url: () => isTv ? api(`/api/wiflix/tv/${id}/${s}`) : api(`/api/wiflix/movie/${id}`),
      collect: (j, out) => {
        if (isTv) {
          forEachLangGroup(j?.episodes?.[String(e)], (lang, p) => out.add(p?.url, lang, null, 'wiflix'));
        } else {
          (j?.players?.vf ?? []).forEach((p: any) => out.add(p?.url, 'VF', null, 'wiflix'));
          (j?.players?.vostfr ?? []).forEach((p: any) => out.add(p?.url, 'VOSTFR', null, 'wiflix'));
          forEachLangGroup(j?.links, (lang, p) => out.add(p?.url, lang, null, 'wiflix'));
        }
      },
    },
    {
      name: 'Cpasmal',
      url: () => isTv ? api(`/api/cpasmal/tv/${id}/${s}/${e}`) : api(`/api/cpasmal/movie/${id}`),
      collect: (j, out) => forEachLangGroup(j?.links, (lang, p) => out.add(p?.url, lang, null, 'cpasmal')),
    },
    {
      name: 'Links',
      url: () => isTv ? api(`/api/links/tv/${id}?season=${s}&episode=${e}`) : api(`/api/links/movie/${id}`),
      collect: (j, out) => {
        if (!j?.success) return;
        const rows = Array.isArray(j.data) ? j.data : j.data ? [j.data] : [];
        for (const row of rows) {
          for (const link of row?.links ?? []) {
            out.add(typeof link === 'string' ? link : link?.url, 'VF', null, 'movix');
          }
        }
      },
    },
    {
      name: '1jour1film',
      url: () => isTv ? null : api(`/api/j1f/movie/${id}`),
      collect: (j, out) => {
        (j?.players?.vf ?? []).forEach((p: any) => out.add(p?.url, 'VF', null, '1jour1film'));
        (j?.players?.vostfr ?? []).forEach((p: any) => out.add(p?.url, 'VOSTFR', null, '1jour1film'));
      },
    },
    {
      name: 'SwiftFlow',
      url: () => isTv ? null : api(`/api/swiftflow/movie/${id}`),
      collect: (j, out) => {
        (j?.players?.vf ?? []).forEach((p: any) => out.add(p?.url, 'VF', null, 'swiftflow'));
        (j?.players?.vostfr ?? []).forEach((p: any) => out.add(p?.url, 'VOSTFR', null, 'swiftflow'));
      },
    },
    {
      name: 'IMDB',
      url: () => isTv ? api(`/api/imdb/tv/${id}`) : null,
      collect: (j, out) => {
        const season = j?.series?.[0]?.seasons?.find((x: any) => String(x?.number) === String(s));
        const ep = season?.episodes?.find((x: any) => String(x?.number) === String(e));
        forEachLangGroup(ep?.versions, (lang, v) => {
          (v?.players ?? []).forEach((p: any) => out.add(p?.link, lang, null, 'imdb'));
        });
      },
    },
  ];
}

/** Parcourt un objet { langue: [entrées] } sans supposer sa forme exacte —
 *  les sondes renvoient tantôt un tableau, tantôt un objet par langue. */
function forEachLangGroup(obj: any, fn: (lang: string, item: any) => void): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [lang, value] of Object.entries(obj)) {
    if (Array.isArray(value)) value.forEach(item => fn(lang, item));
    else if (value && typeof value === 'object') fn(lang, value);
  }
}

/** Sonde anime : movix indexe l'anime à part, par titre, avec une
 *  numérotation qui peut être absolue. */
async function collectAnime(domain: string, req: MediaRequest, out: LinkSet): Promise<void> {
  // Variantes de titre : movix indexe l'anime sous des orthographes
  // inconstantes (avec/sans espaces, titre avant le deux-points).
  const base = req.title.trim();
  const candidates = [...new Set([
    base,
    req.originalTitle?.trim(),
    base.replace(/\s+/g, ''),
    base.includes(':') ? base.split(':')[0]!.trim() : undefined,
  ].filter((x): x is string => Boolean(x)))];

  let animes: any[] = [];
  for (const title of candidates) {
    const url = `https://api.${domain}/anime/search/${encodeURIComponent(title)}?includeSeasons=true&includeEpisodes=true`;
    const parsed = await getJson<any>(url);
    const data = Array.isArray(parsed) ? parsed : (parsed?.data ?? parsed?.results ?? []);
    if (Array.isArray(data) && data.length > 0) {
      animes = data;
      log.debug(`anime trouvé sous « ${title} »`);
      break;
    }
  }
  if (animes.length === 0) return;

  // L'index anime est cherché par titre, donc il peut rendre autre chose que
  // ce qu'on demande. Prendre le premier résultat sans rien vérifier, c'est
  // exactement le travers que `match.ts` existe pour éviter.
  const named = animes.map(a => ({
    title: String(a?.name ?? ''),
    extraTitles: String(a?.alternative_names_string ?? '')
      .split(',').map(t => t.trim()).filter(Boolean),
    raw: a,
  }));
  const picked = pickBest(named, { aliases: req.aliases })
    ?? pickByKeywords(named, req.aliases);

  if (!picked) {
    log.debug(`index anime: aucun des ${animes.length} résultats ne correspond à « ${req.title} »`);
    return;
  }
  const anime = picked.item.raw;

  const links = req.type === 'movie'
    ? movieLinks(anime, req)
    : episodeLinks(anime, req);

  for (const group of links ?? []) {
    for (const player of group?.players ?? []) {
      out.add(player, group?.language, null, 'movix-anime');
    }
  }
}

/** Un film est rangé dans une saison nommée « Film », avec un unique épisode
 *  d'index 1. Le rapprochement saison+épisode ne peut donc rien en tirer : il
 *  cherche la saison 1 et un numéro d'épisode qu'une demande de film n'a pas,
 *  et l'anime était trouvé pour rien. */
function movieLinks(anime: any, req: MediaRequest): any {
  const seasons: any[] = anime?.seasons ?? [];
  const films = seasons.filter(s => /\bfilms?\b/i.test(String(s?.name ?? '')));

  // Chaque épisode d'une saison « Film » est un film ; ailleurs, une fiche qui
  // n'a qu'un seul épisode en tout EST le film.
  const total = seasons.reduce((n, s) => n + (s?.episodes?.length ?? 0), 0);
  const pool = films.length > 0
    ? films.flatMap(s => (s?.episodes ?? []).map((e: any) => ({ season: s, ep: e })))
    : total === 1
      ? seasons.flatMap(s => (s?.episodes ?? []).map((e: any) => ({ season: s, ep: e })))
      : [];

  if (pool.length === 0) {
    log.debug(`index anime: aucun film sur « ${anime?.name} » (${seasons.length} saison(s))`);
    return null;
  }
  if (pool.length === 1) return pool[0]!.ep?.streaming_links ?? null;

  // Plusieurs films sur la fiche : le libellé doit trancher, sinon on ne rend
  // rien plutôt que de servir un autre film de la même franchise.
  const best = pickByKeywords(
    pool.map(x => ({ title: `${x.season?.name ?? ''} ${x.ep?.name ?? ''}`.trim(), raw: x })),
    req.aliases,
  );
  if (!best) {
    log.debug(`index anime: ${pool.length} films, aucun ne correspond à « ${req.title} »`);
    return null;
  }
  return best.item.raw.ep?.streaming_links ?? null;
}

/** Deux rapprochements en un seul passage : saison+épisode d'un côté,
 *  position absolue de l'autre. Le premier prime quand il existe. */
function episodeLinks(anime: any, req: MediaRequest): any {
  let absIndex = 0;
  let exact: any = null;
  let absolute: any = null;

  for (const season of anime?.seasons ?? []) {
    const sNum = Number(String(season?.name ?? '').match(/\d+/)?.[0] ?? 0);
    for (const ep of season?.episodes ?? []) {
      absIndex++;
      if (sNum === (req.season ?? 1) && ep?.index === req.episode) exact = ep?.streaming_links;
      if (req.absoluteEpisode && absIndex === req.absoluteEpisode) absolute = ep?.streaming_links;
    }
  }

  return exact ?? absolute ?? null;
}

async function resolve(req: MediaRequest): Promise<RawStream[]> {
  const domain = await currentDomain();
  const movixId = await internalId(domain, req.tmdbId, req.title);
  const out = new LinkSet();

  // Les sondes sont indépendantes : une qui tombe ne doit pas retenir les
  // autres, d'où le Promise.all sur des tâches qui avalent leurs erreurs.
  const runStandard = async () => {
    await Promise.all(probes(domain, req, movixId).map(async probe => {
      const url = probe.url();
      if (!url) return;
      const before = out.links.length;
      try {
        const json = await getJson<any>(url);
        if (json) probe.collect(json, out);
        log.debug(`sonde ${probe.name}: ${out.links.length - before} lien(s)`);
      } catch (e) {
        log.debug(`sonde ${probe.name}: ${e instanceof Error ? e.message : e}`);
      }
    }));
  };

  if (req.anime === true) {
    // Un anime a des chances des deux côtés : on interroge en parallèle.
    await Promise.all([runStandard(), collectAnime(domain, req, out)]);
  } else {
    await runStandard();
    if (out.links.length === 0) {
      log.debug('aucun lien standard — tentative via l\'index anime');
      await collectAnime(domain, req, out);
    }
  }

  if (out.links.length === 0) {
    log.debug(`aucun lien pour tmdb ${req.tmdbId}`);
    return [];
  }
  log.debug(`${out.links.length} lien(s) bruts: ${JSON.stringify(out.countByVia)}`);

  const usable = out.links.filter(l => {
    if (UNSUPPORTED.test(l.url)) {
      log.debug(`hébergeur écarté: ${l.url}`);
      return false;
    }
    return true;
  });

  const resolved = await Promise.all(usable.map(async link => {
    // Un lien déjà direct n'a pas besoin d'extracteur, ni de headers : il est
    // servi tel quel au lecteur, sans passer par le proxy.
    if (/\.(m3u8|mp4)(\?|$)/i.test(link.url)) {
      return [{
        url: link.url,
        quality: link.quality,
        language: link.language,
        server: `direct (${link.via})`,
        container: link.url.includes('.m3u8') ? ('hls' as const) : ('mp4' as const),
      }];
    }

    const streams = await extractEmbed(link.url, `https://${domain}/`);
    return streams.map(s => ({
      url: s.url,
      quality: link.quality,
      language: link.language,
      server: `${s.server} (${link.via})`,
      headers: s.headers,
      container: s.url.includes('.m3u8') ? ('hls' as const) : ('mp4' as const),
    }));
  }));

  return resolved.flat();
}

export const movix: Scraper = {
  id: 'movix',
  name: 'Movix',
  language: 'French',
  supports: ['movie', 'series'],
  resolve,
};
