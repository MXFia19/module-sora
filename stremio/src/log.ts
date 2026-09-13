import { config } from './config';
import { record } from './trace';
import { pushLog } from './livelog';

/** Secrets à ne jamais laisser sortir dans un journal.
 *
 *  Les logs se partagent : on les colle dans un ticket, dans une discussion,
 *  dans une capture d'écran. La clé TMDB voyage en clair dans la query de
 *  chaque appel, donc dans chaque ligne de trace HTTP. La masquer ici plutôt
 *  qu'à l'affichage protège aussi `docker compose logs`, qui est l'endroit
 *  d'où on la copie le plus souvent. */
const SECRETS = [
  /\b(api_key|apikey|api-key)=([^&\s"']+)/gi,
  /\b(Bearer)\s+([A-Za-z0-9._-]{16,})/gi,
];

export function redact(message: string): string {
  let out = message;
  for (const re of SECRETS) out = out.replace(re, (_m, name: string) => `${name}=***`);
  return out;
}

function inspect(v: unknown): string {
  if (v instanceof Error) return v.message;
  try { return JSON.stringify(v); } catch { return String(v); }
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function enabled(level: Level): boolean {
  return LEVELS[level] >= (LEVELS[config.logLevel] ?? LEVELS.info);
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

/** Logger à préfixe. Les modules Sora traçaient déjà tout avec `[Aether][Search]` ;
 *  on garde la convention, elle rend les logs grep-ables par source. */
export function logger(scope: string) {
  const emit = (level: Level, args: unknown[]) => {
    // La capture ignore le niveau configuré : la page de diagnostic doit
    // pouvoir montrer le détail même quand la console est en mode silencieux.
    const message = redact(args.map(a => typeof a === 'string' ? a : inspect(a)).join(' '));
    record(level, scope, message);
    pushLog(level, scope, message);

    if (!enabled(level)) return;
    const line = `${ts()} [${scope}] ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (...a: unknown[]) => emit('debug', a),
    info: (...a: unknown[]) => emit('info', a),
    warn: (...a: unknown[]) => emit('warn', a),
    error: (...a: unknown[]) => emit('error', a),
    /** Sous-logger : logger('Movix').child('Filemoon') -> [Movix/Filemoon] */
    child: (sub: string) => logger(`${scope}/${sub}`),
  };
}

export type Logger = ReturnType<typeof logger>;
