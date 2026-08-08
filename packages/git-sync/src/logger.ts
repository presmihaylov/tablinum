/** Structured log sink. The server passes its own; tests pass a silent or capturing one. */
export interface GitLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const PREFIX = '[git-sync]';

function emit(
  write: (message?: unknown, ...rest: unknown[]) => void,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (meta === undefined) {
    write(`${PREFIX} ${message}`);
    return;
  }
  write(`${PREFIX} ${message}`, meta);
}

/** Default logger: writes to the process console. */
export const consoleLogger: GitLogger = {
  info: (message, meta) => emit(console.info, message, meta),
  warn: (message, meta) => emit(console.warn, message, meta),
  error: (message, meta) => emit(console.error, message, meta),
};

/** Drops everything. */
export const silentLogger: GitLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
