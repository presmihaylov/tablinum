/** Minimal logging surface so the store never hard-depends on a logging library. */
export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, message: string, meta?: unknown): void {
  const line = `[gitdocs:core] ${message}`;
  if (meta === undefined) {
    console[level](line);
    return;
  }
  console[level](line, meta);
}

export const consoleLogger: Logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
