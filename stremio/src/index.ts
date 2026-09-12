import express from 'express';
import { config, publicBase } from './config';
import { logger } from './log';
import { cached, cacheClear, cacheStats } from './cache';
import { buildRequest } from './tmdb';
import { handleProxy } from './proxy';
import { enabledScrapers } from './scrapers';
import { dedupe, sortStreams, toStremio } from './display';
import { relaxHeaders } from './direct';
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

const MANIFEST = {
  id: 'community.mxfia19.sora',
  version: '0.1.0',
  name: 'Sora',
  description: 'Agrégateur de flux — portage Stremio des modules Sora (movix, anime-sama, nakanime, purstream, voiranime).',
  logo: 'https://i.pinimg.com/1200x/89/78/33/89783349d3270e4ab071db9a038db8ea.jpg',
  resources: ['stream'],
  types: ['movie', 'series'] as MediaType[],
  catalogs: [] as unknown[],
  /** Ce que l'addon sait traiter : IMDb (ce que donne Cinemeta) et TMDB. */
  idPrefixes: ['tt', 'tmdb:'],
  behaviorHints: { configurable: false, p2p: false },
};

app.get('/manifest.json', (_req, res) => {
  res.json(MANIFEST);
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8">
<title>Sora — addon Stremio</title>
<style>body{font:14px system-ui;margin:40px auto;max-width:40rem;padding:0 1rem}code{background:#eee;padding:2px 6px;border-radius:4px}</style>
<h1>Sora</h1>
<p>Addon actif. Sources : ${enabledScrapers().map(s => s.name).join(', ') || '<em>aucune</em>'}.</p>
<p>À installer dans Stremio : <code>${publicBase()}/manifest.json</code></p>`);
});

/** Le seul endpoint qui compte. Stremio appelle
 *  /stream/movie/tt0816692.json ou /stream/series/tt0944947:1:1.json */
app.get('/stream/:type/:id.json', rateLimit, async (req, res) => {
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
    const streams = await cached(
      `streams:${type}:${rawId}`,
      () => resolveStreams(type, id, season, episode),
    );
    log.info(`${type} ${rawId} -> ${streams.length} flux en ${Date.now() - started}ms`);
    res.json({ streams: streams.map(toStremio) });
  } catch (e) {
    log.error(`échec sur ${type} ${rawId}:`, e);
    res.json({ streams: [] });
  }
});

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
): Promise<RawStream[]> {
  const req = await buildRequest(id, type, season, episode);
  if (!req) {
    log.warn(`identifiant non résolu: ${id}`);
    return [];
  }
  log.info(`« ${req.title} »${req.year ? ` (${req.year})` : ''} tmdb=${req.tmdbId}${req.anime ? ' [anime]' : ''}${season ? ` s${season}e${episode}` : ''}`);

  const scrapers = enabledScrapers().filter(s => {
    if (!s.supports.includes(type)) return false;
    // Une source anime-only n'a rien à dire sur un film live : l'appeler
    // coûte une requête et ne peut rendre qu'un faux positif.
    if (s.animeOnly && !req.anime) return false;
    return true;
  });

  // Chaque scraper est isolé : un plantage ou un dépassement de budget ne
  // retire que sa propre contribution.
  const results = await Promise.all(scrapers.map(async s => {
    const t0 = Date.now();
    try {
      const out = await withTimeout(s.resolve(req), config.scraperTimeoutMs);
      log.info(`  ${s.name}: ${out.length} flux (${Date.now() - t0}ms)`);
      return out.map(x => ({ ...x, source: x.source ?? s.name }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`  ${s.name}: échec — ${msg} (${Date.now() - t0}ms)`);
      return [];
    }
  }));

  return relaxHeaders(dedupe(sortStreams(results.flat())));
}

function withTimeout<T>(p: Promise<T[]>, ms: number): Promise<T[]> {
  return Promise.race([
    p,
    new Promise<T[]>((_, reject) =>
      setTimeout(() => reject(new Error(`budget de ${ms}ms dépassé`)), ms)),
  ]);
}

// Le suffixe est libre (/proxy/s, /proxy/s.m3u8, /proxy/s.mp4) : il ne sert
// qu'à renseigner les players qui devinent le type depuis l'extension.
app.get('/proxy/s*', concurrencyGuard, handleProxy);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    cache: cacheStats(),
    scrapers: enabledScrapers().map(s => s.id),
    activeStreams: activeStreams(),
  });
});

app.post('/admin/cache/clear', (_req, res) => {
  res.json({ cleared: cacheClear() });
});

if (require.main === module) {
  if (!config.tmdbApiKey) {
    log.error('TMDB_API_KEY manquante — l\'addon ne peut résoudre aucun identifiant. Voir .env.example.');
  }
  app.listen(config.port, () => {
    log.info(`en écoute sur ${publicBase()}/manifest.json`);
    log.info(`sources actives: ${enabledScrapers().map(s => s.id).join(', ') || 'aucune'}`);
    if (!config.publicUrl) {
      log.warn('PUBLIC_URL non définie — les liens proxifiés pointeront sur 127.0.0.1 (usage local uniquement).');
    }
    if (config.rateLimitStreamPerMin > 0 || config.proxyMaxConcurrent > 0) {
      log.info(`garde-fous: ${config.rateLimitStreamPerMin || '∞'} req/min par IP, ${config.proxyMaxConcurrent || '∞'} flux simultanés`);
    }
  });
}

export { app, resolveStreams };
