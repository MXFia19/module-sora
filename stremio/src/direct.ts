import { config } from './config';
import { cached } from './cache';
import { logger } from './log';
import { hasMeaningfulHeaders } from './display';
import type { RawStream } from './types';

const log = logger('Direct');

/** Vérifie lesquels des flux se lisent SANS passer par le proxy.
 *
 *  Les scrapers attachent le `Referer` du site source à l'URL de lecture,
 *  parce que c'est ce qu'il fallait pour aller chercher la page d'embed. Mais
 *  l'URL finale du CDN, elle, ne l'exige presque jamais : mesuré sur une
 *  dizaine d'hébergeurs, aucun ne réclamait de Referer, et un seul refusait
 *  l'absence totale de User-Agent — que tout lecteur envoie de toute façon.
 *
 *  L'enjeu n'est pas cosmétique. Un flux proxifié fait transiter chaque octet
 *  de la vidéo par le serveur ; un flux direct ne lui coûte rien. Sur une
 *  instance ouverte au public, c'est la différence entre saturer un uplink et
 *  ne servir que des réponses JSON.
 *
 *  Le test coûte une requête d'un octet par flux, toutes en parallèle. En cas
 *  de doute — timeout, refus, erreur — on garde le proxy : se tromper dans ce
 *  sens ne coûte que de la bande passante, l'inverse casse la lecture. */

const PROBE_TIMEOUT_MS = 4000;
/** Le verdict est une propriété du CDN, pas du lien : une fois qu'on sait que
 *  `strm4.uqload.vc` se passe de Referer, ça vaut pour tous ses liens. On ne
 *  sonde donc qu'une fois par hôte, et les requêtes suivantes sont gratuites. */
const VERDICT_TTL_MS = 6 * 60 * 60 * 1000;

async function probe(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        // Un lecteur en envoie toujours un ; c'est le seul header qu'on
        // suppose présent côté client.
        'User-Agent': config.userAgent,
        Range: 'bytes=0-1',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    // On ne lit pas le corps : annuler tout de suite évite de télécharger le
    // flux pour rien quand le serveur ignore le Range.
    await res.body?.cancel();
    return res.ok || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Verdict pour l'hôte d'une URL, mémoïsé. Un hôte inconnu est sondé une
 *  fois ; ensuite la réponse est immédiate. */
async function hostPlaysDirect(url: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  return cached(`direct:${host}`, () => probe(url), {
    ttlMs: VERDICT_TTL_MS,
    // Un échec ponctuel (CDN lent, réseau) ne doit pas condamner l'hôte pour
    // six heures : on ne retient longuement que les verdicts positifs.
    shouldCache: v => v === true,
    negativeTtlMs: 10 * 60 * 1000,
  });
}

/** Retire les headers des flux qui s'en passent, ce qui les fait servir en
 *  direct. Ne jette jamais. */
export async function relaxHeaders(streams: RawStream[]): Promise<RawStream[]> {
  if (!config.probeDirect) return streams;

  const out = await Promise.all(streams.map(async s => {
    if (!hasMeaningfulHeaders(s.headers)) return s;
    if (!(await hostPlaysDirect(s.url))) return s;
    return { ...s, headers: undefined };
  }));

  const freed = out.filter(s => !hasMeaningfulHeaders(s.headers)).length;
  log.debug(`${freed}/${streams.length} flux servis en direct (hors proxy)`);
  return out;
}
