import type { ErrorBody, ErrorCode } from './types.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  GIT_ERROR: 502,
  INTERNAL: 500,
};

/** An error that maps directly onto a REST response. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Optional machine-readable context, echoed in logs but not in the response body. */
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON(): ErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export const notFound = (message = 'Not found', details?: unknown): AppError =>
  new AppError('NOT_FOUND', message, details);

export const conflict = (message = 'Conflict', details?: unknown): AppError =>
  new AppError('CONFLICT', message, details);

export const validation = (message = 'Invalid request', details?: unknown): AppError =>
  new AppError('VALIDATION', message, details);

export const unauthorized = (message = 'Unauthorized', details?: unknown): AppError =>
  new AppError('UNAUTHORIZED', message, details);

export const gitError = (message = 'Git operation failed', details?: unknown): AppError =>
  new AppError('GIT_ERROR', message, details);

export const internal = (message = 'Internal error', details?: unknown): AppError =>
  new AppError('INTERNAL', message, details);

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;

/** Normalize any thrown value into an AppError so handlers never leak stack traces. */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof Error) return new AppError('INTERNAL', err.message, err);
  return new AppError('INTERNAL', String(err), err);
}

/** Build the wire-format error envelope for any thrown value. */
export function errorBody(err: unknown): ErrorBody {
  return toAppError(err).toJSON();
}

/** HTTP status to use for any thrown value. */
export function errorStatus(err: unknown): number {
  return toAppError(err).status;
}

export const httpStatusForCode = (code: ErrorCode): number => STATUS_BY_CODE[code];
