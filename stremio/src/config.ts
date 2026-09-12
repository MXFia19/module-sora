/** Toute la configuration passe par l'environnement : rien de codé en dur qui
 *  puisse périmer, et un `docker compose up` suffit à changer un comportement.
 *
 *  Chaque valeur est un accesseur, donc relue à l'usage plutôt que figée au
 *  premier `require`. Figer imposerait que l'environnement soit complet avant
 *  le tout premier import — une contrainte d'ordre invisible, que la sonde en
 *  ligne de commande et les tests violent naturellement. Le coût est nul à
 *  l'échelle d'une requête HTTP. */

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

export const config = {
  get port(): number { return num('PORT', 7000); },

  /** URL publique de l'addon, telle que Stremio la voit. Indispensable : les
   *  liens proxifiés sont absolus, un client distant ne peut pas deviner
   *  localhost. Sans elle on retombe sur http://127.0.0.1:PORT (usage local). */
  get publicUrl(): string { return str('PUBLIC_URL', '').replace(/\/+$/, ''); },

  /** Clé TMDB — le seul secret réellement requis. */
  get tmdbApiKey(): string { return str('TMDB_API_KEY', ''); },
  get tmdbLanguage(): string { return str('TMDB_LANGUAGE', 'fr-FR'); },

  /** Scrapers actifs. Vide = tous ceux enregistrés. */
  get enabledScrapers(): string[] { return list('SCRAPERS', []); },

  /** Budget temps d'un scraper. Stremio laisse le handler tourner, mais
   *  au-delà l'utilisateur a déjà quitté l'écran. */
  get scraperTimeoutMs(): number { return num('SCRAPER_TIMEOUT_MS', 25_000); },
  /** Budget d'une requête HTTP unitaire à l'intérieur d'un scraper. */
  get httpTimeoutMs(): number { return num('HTTP_TIMEOUT_MS', 12_000); },

  /** Durées de cache. Le cache négatif évite de re-taper un site mort à
   *  chaque ouverture de fiche. */
  get cacheTtlMs(): number { return num('CACHE_TTL_MS', 20 * 60 * 1000); },
  get cacheNegativeTtlMs(): number { return num('CACHE_NEGATIVE_TTL_MS', 3 * 60 * 1000); },
  get cacheMaxEntries(): number { return num('CACHE_MAX_ENTRIES', 2000); },

  /** Proxy intégré : réinjecte les headers que Stremio ne transmet pas. */
  get proxyEnabled(): boolean { return bool('PROXY_ENABLED', true); },
  /** Secret de signature des URLs proxifiées. Généré au démarrage s'il est
   *  absent — mais alors les liens ne survivent pas à un redémarrage. */
  get proxySecret(): string { return str('PROXY_SECRET', ''); },
  /** Durée de validité d'un lien proxifié. */
  get proxyTtlMs(): number { return num('PROXY_TTL_MS', 6 * 60 * 60 * 1000); },

  /** Garde-fous pour une instance publique. 0 = désactivé, ce qui convient
   *  à un usage personnel où le seul client est soi-même. */
  get rateLimitStreamPerMin(): number { return num('RATE_LIMIT_STREAM_PER_MIN', 0); },
  get proxyMaxConcurrent(): number { return num('PROXY_MAX_CONCURRENT', 0); },
  /** Teste chaque flux sans headers et ne proxifie que ceux qui en ont
   *  vraiment besoin. Coûte une requête d'un octet par flux, économise la
   *  bande passante de tous les autres. Recommandé dès qu'on héberge pour
   *  plus d'une personne. */
  get probeDirect(): boolean { return bool('PROBE_DIRECT', false); },
  /** Nombre de reverse-proxies devant l'addon. Sans ça, toutes les requêtes
   *  semblent venir de Caddy et la limite par IP punit tout le monde d'un
   *  coup. Ne jamais le laisser à 0 derrière un reverse-proxy, ni le monter
   *  sans en avoir un : ce serait croire un X-Forwarded-For envoyé par le
   *  client lui-même. */
  get trustProxy(): number { return num('TRUST_PROXY', 0); },

  /** Verbosité. 'debug' trace chaque requête HTTP sortante. */
  get logLevel(): 'debug' | 'info' | 'warn' | 'error' {
    return str('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error';
  },

  get userAgent(): string {
    return str(
      'USER_AGENT',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );
  },
};

/** Base publique pour fabriquer les URLs proxifiées. */
export function publicBase(): string {
  return config.publicUrl || `http://127.0.0.1:${config.port}`;
}
