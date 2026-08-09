import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { isAppError } from '@tablinum/shared';
import { crc32, isSafeEntryName, readZip, unzipToDirectory, zipDirectory } from '../src/zip.js';

const run = promisify(execFile);
const roots: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tablinum-zip-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

async function write(root: string, path: string, body: string | Buffer): Promise<void> {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, body);
}

function codeOf(err: unknown): string {
  return isAppError(err) ? err.code : `unexpected: ${String(err)}`;
}

describe('crc32', () => {
  it('matches the known values', () => {
    expect(crc32(Buffer.from(''))).toBe(0);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('zipDirectory', () => {
  it('carries files, nested directories and dotfiles through a round trip', async () => {
    const source = await tempDir();
    await write(source, 'README.md', '# Handbook\n');
    await write(source, 'eng/deploy.md', 'Ship it.\n');
    await write(source, '.git/HEAD', 'ref: refs/heads/main\n');
    await write(source, '.git/objects/ab/cdef', Buffer.from([0, 1, 2, 3, 255]));

    const archive = await zipDirectory(source);
    const target = await tempDir();
    const written = await unzipToDirectory(archive, target);

    expect(written).toBe(4);
    expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('# Handbook\n');
    expect(await readFile(join(target, 'eng/deploy.md'), 'utf8')).toBe('Ship it.\n');
    expect(await readFile(join(target, '.git/HEAD'), 'utf8')).toBe('ref: refs/heads/main\n');
    expect((await readFile(join(target, '.git/objects/ab/cdef'))).equals(Buffer.from([0, 1, 2, 3, 255])))
      .toBe(true);
  });

  it('keeps an empty directory', async () => {
    const source = await tempDir();
    await mkdir(join(source, 'empty/inner'), { recursive: true });

    const target = await tempDir();
    await unzipToDirectory(await zipDirectory(source), target);
    expect((await stat(join(target, 'empty/inner'))).isDirectory()).toBe(true);
  });

  it('deflates text that repeats and stores bytes that do not compress', async () => {
    const source = await tempDir();
    await write(source, 'long.md', 'the same line over and over\n'.repeat(400));
    await write(source, 'tiny.txt', 'x');

    const archive = await zipDirectory(source);
    expect(archive.byteLength).toBeLessThan(2000);

    const entries = readZip(archive);
    expect(entries.map((entry) => entry.name).sort()).toEqual(['long.md', 'tiny.txt']);
    expect(entries.find((entry) => entry.name === 'tiny.txt')?.data.toString()).toBe('x');
  });

  it('keeps the executable bit, which git hooks need', async () => {
    const source = await tempDir();
    await write(source, 'hook.sh', '#!/bin/sh\n');
    const { chmod } = await import('node:fs/promises');
    await chmod(join(source, 'hook.sh'), 0o755);

    const target = await tempDir();
    await unzipToDirectory(await zipDirectory(source), target);
    expect((await stat(join(target, 'hook.sh'))).mode & 0o111).not.toBe(0);
  });

  it('leaves a symlink out rather than following it', async () => {
    const source = await tempDir();
    await write(source, 'real.md', 'here\n');
    await symlink('/etc/passwd', join(source, 'escape.md'));

    const entries = readZip(await zipDirectory(source));
    expect(entries.map((entry) => entry.name)).toEqual(['real.md']);
  });

  it('refuses to grow past the byte limit', async () => {
    const source = await tempDir();
    await write(source, 'big.bin', Buffer.alloc(4096, 7));
    await expect(zipDirectory(source, { maxBytes: 64 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('produces an archive the system unzip can read', async () => {
    const source = await tempDir();
    await write(source, 'eng/deploy.md', 'Ship it.\n');
    const archive = await zipDirectory(source);

    const holder = await tempDir();
    const path = join(holder, 'export.zip');
    await writeFile(path, archive);
    await run('unzip', ['-qq', path, '-d', join(holder, 'out')]);
    expect(await readFile(join(holder, 'out/eng/deploy.md'), 'utf8')).toBe('Ship it.\n');
  });

  it('reads an archive the system zip produced', async () => {
    const source = await tempDir();
    await write(source, 'eng/deploy.md', 'Ship it.\n');
    await write(source, '.git/HEAD', 'ref: refs/heads/main\n');

    const holder = await tempDir();
    const path = join(holder, 'made.zip');
    await run('zip', ['-q', '-r', path, '.'], { cwd: source });

    const target = await tempDir();
    await unzipToDirectory(await readFile(path), target);
    expect(await readFile(join(target, 'eng/deploy.md'), 'utf8')).toBe('Ship it.\n');
    expect(await readFile(join(target, '.git/HEAD'), 'utf8')).toBe('ref: refs/heads/main\n');
  });
});

describe('unzipToDirectory', () => {
  it('refuses a file that is not an archive', async () => {
    const target = await tempDir();
    await expect(unzipToDirectory(Buffer.from('not a zip at all'), target)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('refuses an entry that points outside the directory', async () => {
    const source = await tempDir();
    await write(source, 'ok.md', 'fine\n');
    const archive = await zipDirectory(source);

    // Rewrite the one entry name in place, in both headers, to a traversal.
    const escaped = Buffer.from(archive);
    let at = 0;
    while ((at = escaped.indexOf('ok.md', at, 'utf8')) !== -1) {
      escaped.write('../up', at, 'utf8');
      at += 5;
    }

    const target = await tempDir();
    const failure = await unzipToDirectory(escaped, target).catch((err: unknown) => err);
    expect(codeOf(failure)).toBe('VALIDATION');
  });

  it('refuses an entry whose bytes do not match its checksum', async () => {
    const source = await tempDir();
    await write(source, 'ok.md', 'x'.repeat(50));
    const archive = await zipDirectory(source);

    const damaged = Buffer.from(archive);
    // The first byte of the stored payload sits right after the local header and the name.
    const at = 30 + 'ok.md'.length;
    damaged.writeUInt8(damaged.readUInt8(at) ^ 0xff, at);

    const target = await tempDir();
    const failure = await unzipToDirectory(damaged, target).catch((err: unknown) => err);
    expect(codeOf(failure)).toBe('VALIDATION');
  });
});

describe('isSafeEntryName', () => {
  it('accepts ordinary paths and refuses every way out', () => {
    expect(isSafeEntryName('eng/deploy.md')).toBe(true);
    expect(isSafeEntryName('.git/objects/ab/cdef')).toBe(true);
    expect(isSafeEntryName('a..b/c')).toBe(true);

    expect(isSafeEntryName('')).toBe(false);
    expect(isSafeEntryName('/etc/passwd')).toBe(false);
    expect(isSafeEntryName('../up')).toBe(false);
    expect(isSafeEntryName('eng/../../up')).toBe(false);
    expect(isSafeEntryName('C:/windows')).toBe(false);
    expect(isSafeEntryName('a\\..\\b')).toBe(false);
    expect(isSafeEntryName('a\0b')).toBe(false);
  });
});
