import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './support/harness.js';

let harness: Harness;
let webDist: string;

beforeEach(async () => {
  webDist = await mkdtemp(join(tmpdir(), 'tablinum-web-'));
  await writeFile(join(webDist, 'index.html'), '<!doctype html><title>the shell</title>');
  harness = await makeHarness({ webDistDir: webDist });
});

afterEach(async () => {
  await harness.close();
  await rm(webDist, { recursive: true, force: true });
});

async function shell(url: string) {
  return harness.app.inject({ method: 'GET', url, headers: harness.authHeaders() });
}

describe('security headers', () => {
  it('sends a content security policy with the app shell', async () => {
    const response = await shell('/eng/deploy');
    expect(response.statusCode).toBe(200);

    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    // No inline script anywhere in the web app, so the shell needs no escape hatch.
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('keeps what the editor needs: style attributes and provider players', async () => {
    const csp = String((await shell('/eng/deploy')).headers['content-security-policy']);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain('frame-src https:');
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("connect-src 'self' ws: wss:");
  });

  it('marks every response nosniff and keeps the referrer on this origin', async () => {
    const page = await shell('/eng/deploy');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['referrer-policy']).toBe('same-origin');

    const api = await shell('/api/v1/health');
    expect(api.headers['x-content-type-options']).toBe('nosniff');
    expect(api.headers['referrer-policy']).toBe('same-origin');
    // JSON is not a document, so it carries no shell policy.
    expect(api.headers['content-security-policy']).toBeUndefined();
  });
});
