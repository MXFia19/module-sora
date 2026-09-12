import { config } from './config';
import { buildRequest } from './tmdb';
import { enabledScrapers } from './scrapers';
import { hasMeaningfulHeaders } from './display';
import { relaxHeaders } from './direct';
import { traced } from './trace';
import type { TraceLine } from './trace';
import type { MediaRequest, MediaType, RawStream } from './types';

/** Diagnostic : que fait chaque source, et ses flux se lisent-ils vraiment ?
 *
 *  La sonde en ligne de commande répond déjà à la question, mais en faisant
 *  défiler du texte. Ici chaque source est exécutée ISOLÉMENT, avec ses
 *  propres logs capturés, et chaque flux est réellement sollicité — parce
 *  qu'une source peut très bien rendre dix liens dont aucun ne répond, et
 *  c'est ce cas-là qu'on cherche à voir. */

export type Status = 'ok' | 'vide' | 'erreur' | 'timeout' | 'ignorée';

export interface StreamCheck {
  language: string;
  quality: string;
  server: string;
  host: string;
  /** Comment le flux sera RÉELLEMENT servi au lecteur. */
  proxied: boolean;
  /** Le scraper réclamait des headers, mais PROBE_DIRECT a jugé l'hôte
   *  capable de s'en passer. Distinguer les deux évite la contradiction qui
   *  faisait dire à cette page « à proxifier » pendant que l'addon servait le
   *  même flux en direct. */
  relaxed?: boolean;
  url: string;
  /** Résultat de la sollicitation réelle : code HTTP, ou 0 si injoignable. */
  httpStatus?: number;
  playable?: boolean;
  checkMs?: number;
}

export interface ScraperReport {
  id: string;
  name: string;
  status: Status;
  ms: number;
  streamCount: number;
  streams: StreamCheck[];
  logs: TraceLine[];
  error?: string;
}

export interface DebugReport {
  /** Ce que TMDB a résolu — la première chose à vérifier quand tout est vide. */
  media?: {
    title: string;
    year?: number;
    tmdbId: string;
    anime: boolean;
    season?: number;
    episode?: number;
    absoluteEpisode?: number;
    aliases: string[];
  };
  resolveLogs: TraceLine[];
  scrapers: ScraperReport[];
  totalMs: number;
  error?: string;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return '?'; }
}

/** Sollicite un flux comme le ferait un lecteur : un octet suffit à savoir si
 *  l'hébergeur accepte ou refuse. */
async function checkStream(s: RawStream): Promise<StreamCheck> {
  const base: StreamCheck = {
    language: s.language,
    quality: s.quality,
    server: s.server,
    host: hostOf(s.url),
    proxied: hasMeaningfulHeaders(s.headers),
    url: s.url,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const t0 = Date.now();
  try {
    const res = await fetch(s.url, {
      headers: { 'User-Agent': config.userAgent, Range: 'bytes=0-1', ...(s.headers ?? {}) },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    await res.body?.cancel();
    return {
      ...base,
      httpStatus: res.status,
      playable: res.ok || res.status === 206,
      checkMs: Date.now() - t0,
    };
  } catch {
    return { ...base, httpStatus: 0, playable: false, checkMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Exécute une source seule, avec ses logs à elle. */
async function runScraper(
  scraper: ReturnType<typeof enabledScrapers>[number],
  req: MediaRequest,
  check: boolean,
): Promise<ScraperReport> {
  const skeleton = { id: scraper.id, name: scraper.name };

  if (!scraper.supports.includes(req.type)) {
    return { ...skeleton, status: 'ignorée', ms: 0, streamCount: 0, streams: [], logs: [],
      error: `ne traite pas les ${req.type === 'movie' ? 'films' : 'séries'}` };
  }
  if (scraper.animeOnly && !req.anime) {
    return { ...skeleton, status: 'ignorée', ms: 0, streamCount: 0, streams: [], logs: [],
      error: 'source anime, contenu non identifié comme anime par TMDB' };
  }

  const t0 = Date.now();
  const { value, lines } = await traced(async () => {
    try {
      const streams = await Promise.race([
        scraper.resolve(req),
        new Promise<RawStream[]>((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), config.scraperTimeoutMs)),
      ]);
      return { streams, error: undefined as string | undefined };
    } catch (e) {
      return { streams: [] as RawStream[], error: e instanceof Error ? e.message : String(e) };
    }
  });

  const ms = Date.now() - t0;

  if (value.error) {
    return {
      ...skeleton,
      status: value.error === 'timeout' ? 'timeout' : 'erreur',
      ms, streamCount: 0, streams: [], logs: lines, error: value.error,
    };
  }

  // Les vérifications sont plafonnées : au-delà on saurait déjà à quoi s'en
  // tenir, et chacune coûte une requête sortante.
  const toCheck = value.streams.slice(0, 12);

  // Le même traitement que sur le chemin réel : sans lui, cette page décrit
  // un état que l'addon ne sert jamais.
  const asked = toCheck.map(s => hasMeaningfulHeaders(s.headers));
  const served = await relaxHeaders(toCheck);

  const streams: StreamCheck[] = check
    ? await Promise.all(served.map(checkStream))
    : served.map(s => ({
        language: s.language, quality: s.quality, server: s.server,
        host: hostOf(s.url), proxied: hasMeaningfulHeaders(s.headers), url: s.url,
      }));

  streams.forEach((s, i) => {
    if (asked[i] && !s.proxied) s.relaxed = true;
  });

  return {
    ...skeleton,
    status: value.streams.length > 0 ? 'ok' : 'vide',
    ms,
    streamCount: value.streams.length,
    streams,
    logs: lines,
  };
}

export async function runDiagnostic(
  type: MediaType,
  id: string,
  season: number | undefined,
  episode: number | undefined,
  check: boolean,
): Promise<DebugReport> {
  const t0 = Date.now();

  const { value: req, lines: resolveLogs } = await traced(() =>
    buildRequest(id, type, season, episode));

  if (!req) {
    return {
      resolveLogs, scrapers: [], totalMs: Date.now() - t0,
      error: "TMDB n'a pas résolu cet identifiant. Clé absente ou invalide, ou id inconnu.",
    };
  }

  const scrapers = await Promise.all(
    enabledScrapers().map(s => runScraper(s, req, check)));

  return {
    media: {
      title: req.title,
      year: req.year,
      tmdbId: req.tmdbId,
      anime: req.anime,
      season: req.season,
      episode: req.episode,
      absoluteEpisode: req.absoluteEpisode,
      aliases: req.aliases,
    },
    resolveLogs,
    scrapers,
    totalMs: Date.now() - t0,
  };
}
