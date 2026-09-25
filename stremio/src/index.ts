import express from 'express';
import type { Request, Response } from 'express';
import { config, publicBase } from './config';
import { logger } from './log';
import { cached, cacheSet, cacheClear, cacheStats } from './cache';
import { buildRequest } from './tmdb';
import { handleProxy, handleSubPlaylist } from './proxy';
import { enabledScrapers, allScrapers } from './scrapers';
import { dedupe, sortStreams, toStremio } from './display';
import { relaxHeaders } from './direct';
import { decodeConfig, applyConfig, DEFAULT_CONFIG } from './userconfig';
import type { UserConfig } from './userconfig';
import { configurePage } from './configure';
import { debugPage } from './debugpage';
import { search, trending } from './catalog';
import { catalog as buildCatalog, meta as buildMeta } from './meta';
import * as history from './history';
import { livePage } from './livepage';
import { runDiagnostic } from './debug';
import { pushRequest, purge, restore, snapshot, subscribe, subscriberCount } from './livelog';
import { rateLimit, concurrencyGuard, activeStreams } from './ratelimit';
import type { MediaType, RawStream } from './types';

const log = logger('Addon');
const app = express();

app.disable('x-powered-by');

// Derrière un reverse-proxy, req.ip doit être l'IP du client et non celle du
// proxy, sinon la limite par IP s'applique à tout le monde en bloc.
if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

/** Stremio (web et desktop) appelle l'addon depuis une autre origine. */
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', '*');
  next();
});

function manifest(c: UserConfig) {
  const configured = c !== DEFAULT_CONFIG;
  return {
    id: 'community.mxfia19.sora',
    version: '0.3.0',
    name: 'Sora',
    description: [
      'Agrégateur de flux — portage Stremio des modules Sora',
      '(movix, anime-sama, nakanime, purstream, voiranime).',
      configured ? `Mode ${c.mode}, langues ${c.languages.join(' > ')}.` : '',
    ].filter(Boolean).join(' '),
    logo: 'https://i.pinimg.com/1200x/89/78/33/89783349d3270e4ab071db9a038db8ea.jpg',
    // 'catalog' et 'meta' rendent l'addon autonome : ses catalogues peuplent
    // les bibliothèques (dans Stremio comme dans une façade Jellyfin telle
    // qu'AIOStreams), 'meta' fournit fiches et épisodes, 'stream' les flux.
    // Sans eux, l'addon ne servait que des flux et dépendait de Cinemeta.
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'] as MediaType[],
    // Deux catalogues typés, chacun avec une recherche. `extra` déclare la
    // recherche optionnelle ; Stremio appelle alors /catalog/.../search=....json
    catalogs: [
      { type: 'movie', id: 'sora-movie', name: 'Sora — Films', extra: [{ name: 'search', isRequired: false }] },
      { type: 'series', id: 'sora-series', name: 'Sora — Séries', extra: [{ name: 'search', isRequired: false }] },
    ],
    /** Ce que l'addon sait traiter : IMDb (ce que donne Cinemeta) et TMDB. */
    idPrefixes: ['tt', 'tmdb:'],
    // `configurable` fait apparaître le bouton « Configurer » dans Stremio,
    // qui renvoie vers /configure.
    behaviorHints: { configurable: true, configurationRequired: false, p2p: false },
  };
}

// La configuration voyage dans le chemin, avant /manifest.json : c'est la
// convention Stremio pour un addon configurable, et elle permet à une seule
// instance de servir des réglages différents à chaque utilisateur.
app.get('/manifest.json', (_req, res) => res.json(manifest(DEFAULT_CONFIG)));
app.get('/c/:config/manifest.json', (req, res) =>
  res.json(manifest(decodeConfig(req.params.config))));

app.get('/configure', (_req, res) =>
  res.type('html').send(configurePage(publicBase(), allScrapers(), undefined)));
app.get('/c/:config/configure', (req, res) =>
  res.type('html').send(configurePage(publicBase(), allScrapers(), req.params.config)));

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8">
<title>Sora — addon Stremio</title>
<style>body{font:14px system-ui;margin:40px auto;max-width:40rem;padding:0 1rem}code{background:#eee;padding:2px 6px;border-radius:4px}</style>
<h1>Sora</h1>
<p>Addon actif. Sources : ${enabledScrapers().map(s => s.name).join(', ') || '<em>aucune</em>'}.</p>
<p><a href="/configure">Configurer et générer mon lien d'installation →</a></p>
${config.debugUi ? '<p><a href="/debug">Diagnostic des sources →</a> · <a href="/debug/live">Console en direct →</a></p>' : ''}
<p>Ou, avec les réglages par défaut : <code>${publicBase()}/manifest.json</code></p>`);
});

/** Catalogue. Stremio appelle /catalog/movie/sora-movie.json, et pour la
 *  recherche /catalog/movie/sora-movie/search=inception.json. Le segment
 *  `extra` porte la requête, sous la forme `search=<texte>`. */
app.get('/catalog/:type/:id.json', (req, res) => handleCatalog(req, res));
app.get('/catalog/:type/:id/:extra.json', (req, res) => handleCatalog(req, res));
app.get('/c/:config/catalog/:type/:id.json', (req, res) => handleCatalog(req, res));
app.get('/c/:config/catalog/:type/:id/:extra.json', (req, res) => handleCatalog(req, res));

async function handleCatalog(req: Request, res: Response): Promise<void> {
  const type = req.params.type as MediaType;
  if (type !== 'movie' && type !== 'series') {
    res.json({ metas: [] });
    return;
  }
  // `extra` arrive tel quel ('search=inception' ou 'skip=100&search=...') ;
  // on n'en lit que la recherche, seul paramètre que le catalogue gère.
  let query: string | undefined;
  const extra = req.params.extra ? decodeURIComponent(req.params.extra) : '';
  const m = extra.match(/(?:^|&)search=([^&]*)/);
  if (m) query = decodeURIComponent(m[1] ?? '');
  else if (typeof req.query.search === 'string') query = req.query.search;

  try {
    const metas = await buildCatalog(type, query);
    res.json({ metas });
  } catch (e) {
    log.error('catalogue en échec:', e);
    res.json({ metas: [] });
  }
}

/** Fiche + épisodes. Stremio appelle /meta/series/tmdb:1396.json. */
app.get('/meta/:type/:id.json', (req, res) => handleMeta(req, res));
app.get('/c/:config/meta/:type/:id.json', (req, res) => handleMeta(req, res));

async function handleMeta(req: Request, res: Response): Promise<void> {
  const type = req.params.type as MediaType;
  const rawId = decodeURIComponent(req.params.id ?? '');
  if (type !== 'movie' && type !== 'series') {
    res.json({ meta: null });
    return;
  }
  try {
    const meta = await buildMeta(type, rawId);
    res.json({ meta });
  } catch (e) {
    log.error('meta en échec:', e);
    res.json({ meta: null });
  }
}

/** Le seul endpoint qui compte. Stremio appelle
 *  /stream/movie/tt0816692.json ou /stream/series/tt0944947:1:1.json */
app.get('/stream/:type/:id.json', rateLimit, (req, res) => handleStream(req, res, DEFAULT_CONFIG));
app.get('/c/:config/stream/:type/:id.json', rateLimit, (req, res) =>
  handleStream(req, res, decodeConfig(req.params.config)));

async function handleStream(req: Request, res: Response, userConfig: UserConfig): Promise<void> {
  const type = req.params.type as MediaType;
  // Avec plusieurs handlers, Express type les params en `string | undefined` :
  // la route les garantit présents, mais le repli évite un cast aveugle.
  const rawId = decodeURIComponent(req.params.id ?? '');

  if (type !== 'movie' && type !== 'series') {
    res.json({ streams: [] });
    return;
  }

  const started = Date.now();
  const { id, season, episode } = parseStremioId(rawId);

  try {
    // Le cache porte sur le résultat BRUT du scraping : deux utilisateurs qui
    // ouvrent le même film partagent le travail, même avec des préférences
    // opposées. Seule la clé TMDB entre dans la clé de cache, parce qu'une
    // clé invalide ne doit pas empoisonner le résultat des autres.
    const keyPart = userConfig.tmdbKey ? `:k${userConfig.tmdbKey.slice(-6)}` : '';
    const cacheKey = `streams:${type}:${rawId}${keyPart}`;
    const summary: SourceSummary = { sources: [] };
    const streams = await cached(
      cacheKey,
      () => resolveStreams(type, id, season, episode, userConfig, cacheKey, summary),
    );

    const shown = applyConfig(streams, userConfig);
    const who = userConfig.nickname ? ` [${userConfig.nickname}]` : '';
    const ms = Date.now() - started;
    log.info(`${type} ${rawId}${who} -> ${shown.length}/${streams.length} flux en ${ms}ms`);

    // Un résumé vide signifie que le cache a répondu sans rien scraper.
    pushRequest({
      client: req.ip ?? '?',
      type, id: rawId,
      title: summary.title,
      nickname: userConfig.nickname,
      ms, total: streams.length, shown: shown.length,
      cached: summary.sources.length === 0,
      sources: summary.sources,
    });

    res.json({ streams: shown.map(toStremio) });
  } catch (e) {
    log.error(`échec sur ${type} ${rawId}:`, e);
    res.json({ streams: [] });
  }
}

/** Rempli au fil de la résolution, pour la console en direct. */
interface SourceSummary {
  title?: string;
  sources: Array<{ name: string; count: number; ms: number }>;
}

interface ParsedId {
  id: string;
  season?: number;
  episode?: number;
}

/** Découpe l'identifiant Stremio : 'tt0816692', 'tt0944947:1:1',
 *  'tmdb:157336' ou 'tmdb:1399:1:1'. Le préfixe `tmdb:` porte lui-même un
 *  ':' qu'il ne faut pas confondre avec le séparateur saison/épisode. */
export function parseStremioId(rawId: string): ParsedId {
  const prefixed = rawId.startsWith('tmdb:');
  const parts = (prefixed ? rawId.slice(5) : rawId).split(':');
  const id = prefixed ? `tmdb:${parts[0]}` : parts[0]!;

  const toNum = (v?: string) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  };
  return { id, season: toNum(parts[1]), episode: toNum(parts[2]) };
}

async function resolveStreams(
  type: MediaType,
  id: string,
  season?: number,
  episode?: number,
  userConfig: UserConfig = DEFAULT_CONFIG,
  cacheKey?: string,
  summary?: SourceSummary,
): Promise<RawStream[]> {
  const req = await buildRequest(id, type, season, episode, userConfig.tmdbKey);
  if (!req) {
    log.warn(`identifiant non résolu: ${id}`);
    return [];
  }
  log.info(`« ${req.title} »${req.year ? ` (${req.year})` : ''} tmdb=${req.tmdbId}${req.anime ? ' [anime]' : ''}${season ? ` s${season}e${episode}` : ''}`);

  const chosen = userConfig.sources.length > 0
    ? enabledScrapers().filter(s => userConfig.sources.includes(s.id))
    : enabledScrapers();

  const scrapers = chosen.filter(s => {
    if (!s.supports.includes(type)) return false;
    // Une source anime-only n'a rien à dire sur un film live : l'appeler
    // coûte une requête et ne peut rendre qu'un faux positif.
    if (s.animeOnly && !req.anime) return false;
    return true;
  });

  // Chaque scraper est isolé : un plantage ou un dépassement de budget ne
  // retire que sa propre contribution. Ces promesses ne rejettent jamais.
  if (summary) summary.title = req.title;

  const tasks = scrapers.map(async s => {
    const t0 = Date.now();
    try {
      const out = await withTimeout(s.resolve(req), config.scraperTimeoutMs);
      log.info(`  ${s.name}: ${out.length} flux (${Date.now() - t0}ms)`);
      summary?.sources.push({ name: s.name, count: out.length, ms: Date.now() - t0 });
      return out.map(x => ({ ...x, source: x.source ?? s.name }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`  ${s.name}: échec — ${msg} (${Date.now() - t0}ms)`);
      summary?.sources.push({ name: s.name, count: -1, ms: Date.now() - t0 });
      return [] as RawStream[];
    }
  });

  const finish = (parts: RawStream[][]) => relaxHeaders(dedupe(sortStreams(parts.flat())));

  if (userConfig.minStreams <= 0) return finish(await Promise.all(tasks));

  const early = await firstEnough(tasks, userConfig.minStreams);

  // Les sources encore en route ne sont pas annulées : elles finissent en
  // arrière-plan et remplacent l'entrée de cache par la liste complète. La
  // prochaine ouverture de la même fiche voit tout, sans avoir attendu.
  if (cacheKey) {
    void Promise.all(tasks)
      .then(finish)
      .then(full => {
        if (full.length > early.length) {
          log.debug(`${cacheKey}: complété en arrière-plan (${early.length} -> ${full.length})`);
          cacheSet(cacheKey, full, config.cacheTtlMs);
        }
      })
      .catch(() => { /* déjà tracé par chaque scraper */ });
  }

  return finish([early]);
}

/** Rend la main dès que `min` flux sont réunis, ou quand tout le monde a
 *  répondu. Une seule source lente ne doit pas faire attendre l'utilisateur
 *  devant un écran vide alors que quatre autres ont déjà livré. */
function firstEnough(tasks: Promise<RawStream[]>[], min: number): Promise<RawStream[]> {
  if (tasks.length === 0) return Promise.resolve([]);

  return new Promise(resolve => {
    const acc: RawStream[] = [];
    let done = 0;
    let settled = false;

    const maybeResolve = () => {
      if (settled) return;
      if (acc.length >= min || done === tasks.length) {
        settled = true;
        resolve([...acc]);
      }
    };

    for (const t of tasks) {
      void t.then(part => {
        acc.push(...part);
        done++;
        maybeResolve();
      });
    }
  });
}

function withTimeout<T>(p: Promise<T[]>, ms: number): Promise<T[]> {
  return Promise.race([
    p,
    new Promise<T[]>((_, reject) =>
      setTimeout(() => reject(new Error(`budget de ${ms}ms dépassé`)), ms)),
  ]);
}

// Playlist de sous-titres synthétique : enveloppe un .vtt brut mal déclaré en
// piste HLS. Déclarée AVANT /proxy/s* (et sur un chemin qui ne commence pas
// par « s ») pour ne pas être captée par le handler de flux. Pas de garde de
// concurrence : elle ne relaie aucune vidéo, elle fabrique quelques lignes.
app.get('/proxy/vtt.m3u8', handleSubPlaylist);

// Le suffixe est libre (/proxy/s, /proxy/s.m3u8, /proxy/s.mp4) : il ne sert
// qu'à renseigner les players qui devinent le type depuis l'extension.
app.get('/proxy/s*', concurrencyGuard, handleProxy);

// Page de diagnostic, volontairement optionnelle (DEBUG_UI=true).
if (config.debugUi) {
  app.get('/debug', (_req, res) => res.type('html').send(debugPage()));
  app.get('/debug/live', (_req, res) => res.type('html').send(livePage()));

  /** Flux d'événements en temps réel (Server-Sent Events).
   *
   *  SSE plutôt que WebSocket : le besoin est unidirectionnel, ça passe les
   *  proxies sans négociation particulière, et le navigateur se reconnecte
   *  tout seul. */
  app.get('/debug/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Sans ça, un reverse-proxy peut tamponner le flux et tout arrive
      // d'un bloc à la fermeture — c'est-à-dire jamais.
      'X-Accel-Buffering': 'no',
    });

    // L'historique d'abord, pour que la page montre déjà quelque chose.
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);

    const unsubscribe = subscribe(e => {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    });

    // Un commentaire périodique garde la connexion ouverte à travers les
    // intermédiaires qui coupent les flux inactifs.
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  /** Catalogue de la page de diagnostic : une grille d'affiches plutôt qu'un
   *  identifiant à taper de mémoire. */
  app.get('/debug/catalog', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    try {
      const items = q
        ? await search(q)
        : await trending(req.query.type === 'series' ? 'series' : 'movie');
      res.json({ items });
    } catch (e) {
      log.error('catalogue en échec:', e);
      res.json({ items: [], error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Historique des diagnostics : la liste, puis un rapport complet à la
   *  demande. Le rapport pèse trop pour être renvoyé avec la liste. */
  /** « Effacer » de la console : en mémoire ET sur disque, sinon tout
   *  reviendrait au redémarrage suivant. */
  app.post('/debug/live/clear', (_req, res) => res.json({ cleared: purge() }));

  // Vider le cache des sources depuis la page de diagnostic. Même modèle que
  // les deux autres boutons de purge : gardé par DEBUG_UI, sans jeton. La route
  // publique /admin/cache/clear, elle, exige ADMIN_TOKEN — mais la page ne peut
  // pas l'envoyer sans exposer le secret, donc le bouton passe par ici.
  app.post('/debug/cache/clear', (_req, res) => res.json({ cleared: cacheClear() }));

  app.get('/debug/history', (_req, res) => res.json({ runs: history.list() }));

  app.get('/debug/history/:id', (req, res) => {
    const entry = history.find(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Exécution inconnue ou expirée.' });
    res.json({ ...entry.report, historyId: entry.id, at: entry.at });
  });

  app.post('/debug/history/clear', (_req, res) => res.json({ cleared: history.clear() }));

  app.get('/debug/run', async (req, res) => {
    const type = req.query.type === 'series' ? 'series' : 'movie';
    const id = String(req.query.id ?? '').trim();
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    };

    if (!id) {
      res.json({ resolveLogs: [], scrapers: [], totalMs: 0, error: 'identifiant vide' });
      return;
    }

    try {
      const season = num(req.query.season);
      const episode = num(req.query.episode);
      const report = await runDiagnostic(type, id, season, episode, req.query.check !== '0');

      // Mémorisé avant d'être rendu : les logs d'une exécution ne sont pas
      // reproductibles — relancer plus tard interroge des sources qui ont
      // changé entre-temps.
      const entry = history.remember(type, id, season, episode, report);
      res.json({ ...report, historyId: entry.id, at: entry.at });
    } catch (e) {
      log.error('diagnostic en échec:', e);
      res.json({
        resolveLogs: [], scrapers: [], totalMs: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    cache: cacheStats(),
    scrapers: enabledScrapers().map(s => s.id),
    activeStreams: activeStreams(),
    liveViewers: subscriberCount(),
  });
});

app.post('/admin/cache/clear', (req, res) => {
  // Vide le cache des sources. Anodin en soi, mais c'est un POST qui mute
  // l'état : sur une instance publique on exige un jeton. En local, sans
  // ADMIN_TOKEN défini, la route reste ouverte pour ne rien casser.
  if (config.adminToken && req.get('X-Admin-Token') !== config.adminToken) {
    res.status(403).json({ error: 'jeton d\'administration requis ou invalide' });
    return;
  }
  res.json({ cleared: cacheClear() });
});

if (require.main === module) {
  if (!config.tmdbApiKey) {
    log.error('TMDB_API_KEY manquante — l\'addon ne peut résoudre aucun identifiant. Voir .env.example.');
  }
  // Avant d'écouter : le journal relit sa fin, pour que /debug/live montre
  // déjà l'avant-redémarrage plutôt qu'une page blanche.
  if (config.debugUi && config.liveLogFile) {
    const repris = restore();
    if (repris) log.info(`journal repris : ${repris} événement(s) depuis ${config.liveLogFile}`);
  }

  app.listen(config.port, () => {
    log.info(`en écoute sur ${publicBase()}/manifest.json`);
    log.info(`sources actives: ${enabledScrapers().map(s => s.id).join(', ') || 'aucune'}`);
    if (!config.publicUrl) {
      log.warn('PUBLIC_URL non définie — les liens proxifiés pointeront sur 127.0.0.1 (usage local uniquement).');
    }
    if (config.debugUi) {
      log.info(`diagnostic : ${publicBase()}/debug`);
      log.info(`console en direct : ${publicBase()}/debug/live`);
    }
    if (config.rateLimitStreamPerMin > 0 || config.proxyMaxConcurrent > 0) {
      log.info(`garde-fous: ${config.rateLimitStreamPerMin || '∞'} req/min par IP, ${config.proxyMaxConcurrent || '∞'} flux simultanés`);
    }
  });
}

export { app, resolveStreams };
