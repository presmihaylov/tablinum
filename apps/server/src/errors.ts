import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, isAppError, type ErrorBody, type ErrorCode } from '@gitdocs/shared';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION',
  401: 'UNAUTHORIZED',
  403: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  405: 'VALIDATION',
  409: 'CONFLICT',
  413: 'VALIDATION',
  415: 'VALIDATION',
  422: 'VALIDATION',
};

/** Multipart and content-type-parser failures are all bad client input. */
const CLIENT_ERROR_CODES = new Set([
  'FST_REQ_FILE_TOO_LARGE',
  'FST_FILES_LIMIT',
  'FST_FIELDS_LIMIT',
  'FST_PARTS_LIMIT',
  'FST_INVALID_MULTIPART_CONTENT_TYPE',
  'FST_PROTO_VIOLATION',
]);

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.join('.');
      return at.length === 0 ? issue.message : `${at}: ${issue.message}`;
    })
    .join('; ');
}

function fastifyErrorCode(err: FastifyError): string {
  return typeof err.code === 'string' ? err.code : '';
}

/** Normalize anything thrown by a route into the wire format plus an HTTP status. */
export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (isAppError(err)) return { status: err.status, body: err.toJSON() };

  if (err instanceof ZodError) {
    const appError = new AppError('VALIDATION', `Invalid request - ${formatZodError(err)}`);
    return { status: appError.status, body: appError.toJSON() };
  }

  if (err instanceof Error) {
    const fastifyError = err as FastifyError;

    if (fastifyError.validation !== undefined) {
      const detail = fastifyError.validation
        .map((issue) => `${issue.instancePath || issue.schemaPath}: ${issue.message ?? 'invalid'}`)
        .join('; ');
      return {
        status: 400,
        body: { error: { code: 'VALIDATION', message: `Invalid request - ${detail}` } },
      };
    }

    const code = fastifyErrorCode(fastifyError);
    if (code.startsWith('FST_ERR_CTP_') || CLIENT_ERROR_CODES.has(code)) {
      return { status: 400, body: { error: { code: 'VALIDATION', message: err.message } } };
    }

    const status = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
    const mapped = CODE_BY_STATUS[status];
    if (mapped !== undefined) {
      return { status, body: { error: { code: mapped, message: err.message } } };
    }
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'Internal error' } },
  };
}

/** True when the response leaks nothing useful and the stack belongs in the log. */
function shouldLogStack(status: number): boolean {
  return status >= 500;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const { status, body } = toErrorResponse(err);

    if (shouldLogStack(status)) {
      request.log.error({ err, url: request.url, method: request.method }, 'request failed');
    } else {
      request.log.debug(
        { code: body.error.code, url: request.url, method: request.method, msg: body.error.message },
        'request rejected',
      );
    }

    void reply.status(status).type('application/json').send(body);
  });
}
