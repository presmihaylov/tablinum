import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { link, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TEMP_FILE_PREFIX } from '@tablinum/shared';
import { writeBytes, writeText } from '../src/fs-utils.js';
import { isPageFileName } from '../src/scan.js';
import { shouldIgnore } from '../src/watcher.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let dir = '';

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(dir);
});

async function names(relDir = '.'): Promise<string[]> {
  return (await readdir(path.join(dir, relDir))).sort();
}

describe('writeText', () => {
  it('writes the content and creates the parent directory', async () => {
    const target = path.join(dir, 'eng', 'deploy.md');
    await writeText(target, 'Ship it.\n');

    expect(await readFile(target, 'utf8')).toBe('Ship it.\n');
    expect(await names('eng')).toEqual(['deploy.md']);
  });

  it('replaces the old file instead of truncating it', async () => {
    const target = path.join(dir, 'deploy.md');
    await writeFile(target, 'The old text.\n', 'utf8');
    // A hard link holds the file the old bytes are in. A write that truncates in place would
    // change what the link points at; a write that renames leaves it exactly as it was.
    const held = path.join(dir, 'held');
    await link(target, held);

    await writeText(target, 'The new text.\n');

    expect(await readFile(target, 'utf8')).toBe('The new text.\n');
    expect(await readFile(held, 'utf8')).toBe('The old text.\n');
  });

  it('leaves nothing behind when the write fails', async () => {
    // A directory where the file should go: the rename cannot land, so the write throws.
    const target = path.join(dir, 'deploy.md');
    await mkdir(target);

    await expect(writeText(target, 'Ship it.\n')).rejects.toThrow();
    expect(await names()).toEqual(['deploy.md']);
  });

  it('names the temp file so the scanner and the watcher both skip it', async () => {
    const name = `${TEMP_FILE_PREFIX}1234-1`;

    expect(isPageFileName(name)).toBe(false);
    expect(shouldIgnore(dir, path.join(dir, 'eng', name))).toBe(true);
  });
});

describe('writeBytes', () => {
  it('writes the bytes as they were given', async () => {
    const target = path.join(dir, '_assets', 'logo.png');
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

    await writeBytes(target, data);

    expect(new Uint8Array(await readFile(target))).toEqual(data);
    expect(await names('_assets')).toEqual(['logo.png']);
  });
});
