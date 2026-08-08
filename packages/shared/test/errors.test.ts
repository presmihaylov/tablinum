import { describe, expect, it } from 'vitest';
import {
  AppError,
  conflict,
  errorBody,
  errorStatus,
  gitError,
  httpStatusForCode,
  internal,
  isAppError,
  notFound,
  toAppError,
  unauthorized,
  validation,
} from '../src/errors.js';

describe('AppError', () => {
  it('maps every code to its HTTP status', () => {
    expect(notFound().status).toBe(404);
    expect(conflict().status).toBe(409);
    expect(validation().status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(gitError().status).toBe(502);
    expect(internal().status).toBe(500);
    expect(httpStatusForCode('NOT_FOUND')).toBe(404);
  });

  it('serializes to the wire format', () => {
    expect(notFound('No such page').toJSON()).toEqual({
      error: { code: 'NOT_FOUND', message: 'No such page' },
    });
  });

  it('is a real Error', () => {
    const err = conflict('Already exists');
    expect(err).toBeInstanceOf(Error);
    expect(isAppError(err)).toBe(true);
    expect(err.message).toBe('Already exists');
  });
});

describe('toAppError', () => {
  it('passes AppError through', () => {
    const err = notFound();
    expect(toAppError(err)).toBe(err);
  });

  it('wraps a plain Error as INTERNAL', () => {
    const wrapped = toAppError(new Error('boom'));
    expect(wrapped.code).toBe('INTERNAL');
    expect(wrapped.message).toBe('boom');
  });

  it('wraps a thrown non-Error', () => {
    expect(toAppError('boom').code).toBe('INTERNAL');
    expect(toAppError('boom').message).toBe('boom');
  });
});

describe('errorBody / errorStatus', () => {
  it('produces the envelope and status for any thrown value', () => {
    expect(errorBody(validation('bad'))).toEqual({
      error: { code: 'VALIDATION', message: 'bad' },
    });
    expect(errorStatus(new Error('boom'))).toBe(500);
    expect(errorStatus(gitError())).toBe(502);
  });
});
