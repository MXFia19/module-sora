import { config } from './config';

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
    if (!enabled(level)) return;
    const line = `${ts()} [${scope}]`;
    if (level === 'error') console.error(line, ...args);
    else if (level === 'warn') console.warn(line, ...args);
    else console.log(line, ...args);
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
