import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetResponseSchema, DIAGRAM_EXT, ErrorBodySchema } from '@tablinum/shared';
import { MAX_ASSET_BYTES } from '../src/routes/assets.js';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';
import { multipart } from './support/multipart.js';

let harness: Harness;
let pageId: string;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

beforeEach(async () => {
  harness = await makeHarness();
  const seeded = await seed(harness);
  pageId = seeded.pageIds[0] ?? '';
});

afterEach(async () => {
  await harness.close();
});

function upload(options: Parameters<typeof multipart>[0]) {
  const built = multipart(options);
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/assets',
    headers: { ...harness.authHeaders(), ...built.headers },
    payload: built.payload,
  });
}

describe('asset upload', () => {
  it('stores the file under the page id and returns its url', async () => {
    const response = await upload({
      fields: { pageId },
      filename: 'diagram.png',
      contentType: 'image/png',
      data: PNG,
    });
    expect(response.statusCode).toBe(200);

    const asset = bodyOf(response, AssetResponseSchema);
    expect(asset.path).toBe(`_assets/${pageId}/diagram.png`);
    expect(asset.url).toBe(`/_assets/${pageId}/diagram.png`);

    const written = await readFile(join(harness.contentDir, asset.path));
    expect(written.equals(PNG)).toBe(true);
  });

  it('accepts the page id from the query string', async () => {
    const built = multipart({ filename: 'note.txt', data: Buffer.from('hello') });
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assets?pageId=${pageId}`,
      headers: { ...harness.authHeaders(), ...built.headers },
      payload: built.payload,
    });
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response, AssetResponseSchema).path).toBe(`_assets/${pageId}/note.txt`);
  });

  it('strips any directory component from the filename', async () => {
    const response = await upload({
      fields: { pageId },
      filename: '../../../etc/passwd.txt',
      data: Buffer.from('root:x:0:0'),
    });
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response, AssetResponseSchema).path).toBe(`_assets/${pageId}/passwd.txt`);
  });

  it('never overwrites an existing attachment', async () => {
    const first = await upload({ fields: { pageId }, filename: 'logo.png', data: PNG });
    expect(bodyOf(first, AssetResponseSchema).path).toBe(`_assets/${pageId}/logo.png`);

    const second = await upload({
      fields: { pageId },
      filename: 'logo.png',
      data: Buffer.from('different'),
    });
    expect(bodyOf(second, AssetResponseSchema).path).toBe(`_assets/${pageId}/logo-2.png`);

    const original = await readFile(join(harness.contentDir, `_assets/${pageId}/logo.png`));
    expect(original.equals(PNG)).toBe(true);
  });

  it('keeps a double extension whole when it takes a free name', async () => {
    const name = 'sketch.excalidraw.svg';
    await upload({ fields: { pageId }, filename: name, data: Buffer.from('<svg/>') });
    const second = await upload({ fields: { pageId }, filename: name, data: Buffer.from('<svg/>') });
    expect(bodyOf(second, AssetResponseSchema).path).toBe(
      `_assets/${pageId}/sketch-2.excalidraw.svg`,
    );
  });

  it('writes over the same name when the upload asks to replace it', async () => {
    const name = 'sketch.excalidraw.svg';
    const first = await upload({ fields: { pageId }, filename: name, data: Buffer.from('<svg>1') });
    const path = bodyOf(first, AssetResponseSchema).path;

    const again = await upload({
      fields: { pageId, replace: 'true' },
      filename: name,
      data: Buffer.from('<svg>2'),
    });
    expect(bodyOf(again, AssetResponseSchema).path).toBe(path);

    const written = await readFile(join(harness.contentDir, path), 'utf8');
    expect(written).toBe('<svg>2');
  });

  it('replaces a name that is not there yet, so a first save still lands', async () => {
    const response = await upload({
      fields: { pageId, replace: 'true' },
      filename: 'new.excalidraw.svg',
      data: Buffer.from('<svg/>'),
    });
    expect(bodyOf(response, AssetResponseSchema).path).toBe(`_assets/${pageId}/new.excalidraw.svg`);
  });

  it('serves the stored file back over /_assets', async () => {
    const stored = await upload({
      fields: { pageId },
      filename: 'served.png',
      contentType: 'image/png',
      data: PNG,
    });
    const asset = bodyOf(stored, AssetResponseSchema);

    const fetched = await harness.app.inject({
      method: 'GET',
      url: asset.url,
      headers: harness.authHeaders(),
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.rawPayload.equals(PNG)).toBe(true);
  });

  it('rejects a filename with unsafe characters', async () => {
    const response = await upload({
      fields: { pageId },
      filename: 'bad:name?.png',
      data: PNG,
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('rejects an unknown page id with NOT_FOUND', async () => {
    const response = await upload({
      fields: { pageId: 'pg_00000000000000000000000000' },
      filename: 'orphan.png',
      data: PNG,
    });
    expect(response.statusCode).toBe(404);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed page id with VALIDATION', async () => {
    const response = await upload({
      fields: { pageId: 'not-a-page-id' },
      filename: 'orphan.png',
      data: PNG,
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('rejects an upload with no file part', async () => {
    const response = await upload({ fields: { pageId } });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('rejects a request that is not multipart', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: harness.authHeaders(),
      payload: { pageId },
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('rejects a file over the size limit', async () => {
    const response = await upload({
      fields: { pageId },
      filename: 'huge.bin',
      data: Buffer.alloc(MAX_ASSET_BYTES + 1024, 7),
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });
});

describe('attachments are never active content', () => {
  it('refuses an upload a browser would execute', async () => {
    for (const filename of ['evil.html', 'logo.svg', 'run.js']) {
      const response = await upload({
        fields: { pageId },
        filename,
        data: Buffer.from('<script>alert(1)</script>'),
      });
      expect(`${filename} -> ${response.statusCode}`).toBe(`${filename} -> 400`);
      expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
    }
  });

  it('serves an image inline, with its own type', async () => {
    const stored = await upload({
      fields: { pageId },
      filename: 'diagram.png',
      contentType: 'image/png',
      data: PNG,
    });
    const asset = bodyOf(stored, AssetResponseSchema);

    const fetched = await harness.app.inject({
      method: 'GET',
      url: asset.url,
      headers: harness.authHeaders(),
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/png');
    expect(fetched.headers['content-disposition']).toBeUndefined();
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves the editor own diagram as an image, sandboxed', async () => {
    const stored = await upload({
      fields: { pageId },
      filename: `scene${DIAGRAM_EXT}`,
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    const asset = bodyOf(stored, AssetResponseSchema);

    const fetched = await harness.app.inject({
      method: 'GET',
      url: asset.url,
      headers: harness.authHeaders(),
    });
    expect(fetched.statusCode).toBe(200);
    // An <img> needs the real type. Script inside it never runs there, and a direct hit is
    // sandboxed into an opaque origin by the CSP below.
    expect(fetched.headers['content-type']).toBe('image/svg+xml');
    expect(fetched.headers['content-disposition']).toBeUndefined();
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
    expect(String(fetched.headers['content-security-policy'])).toContain('sandbox');
  });

  it('still refuses a plain svg that only pretends to be a diagram', async () => {
    for (const filename of ['excalidraw.svg', 'a.excalidraw.svg.svg']) {
      const response = await upload({
        fields: { pageId },
        filename,
        data: Buffer.from('<svg onload="alert(1)"/>'),
      });
      expect(`${filename} -> ${response.statusCode}`).toBe(`${filename} -> 400`);
    }
  });

  it('downloads a file that predates the allowlist instead of rendering it', async () => {
    const dir = join(harness.contentDir, '_assets', pageId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'legacy.html'), '<script>alert(1)</script>');

    const fetched = await harness.app.inject({
      method: 'GET',
      url: `/_assets/${pageId}/legacy.html`,
      headers: harness.authHeaders(),
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('application/octet-stream');
    expect(fetched.headers['content-disposition']).toBe('attachment');
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
    expect(String(fetched.headers['content-security-policy'])).toContain('sandbox');
  });
});
