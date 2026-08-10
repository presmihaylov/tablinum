import { readdir, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { validation } from '@tablinum/shared';

/**
 * A small ZIP reader and writer.
 *
 * A workspace travels as a zip of its whole git repository, `.git` included, so an export can
 * be imported anywhere and keep every page and its history. Node ships deflate but no archive
 * format, and the format needed here is small enough to own outright: stored and deflated
 * entries, unix file modes, and the zip64 end record so a repository with more than 65534
 * loose objects still opens.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
const ZIP64_EOCD_BYTES = 56;
const ZIP64_LOCATOR_BYTES = 20;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Bit 11: the name is UTF-8 rather than the ancient code page. */
const FLAG_UTF8 = 0x0800;

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

/** Made by unix, format 3.0, so the external attributes carry a file mode. */
const VERSION_MADE_BY = 0x031e;
const VERSION_NEEDED = 20;

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is what a zip entry stores. */
function dosStamp(at: Date): { time: number; date: number } {
  // The format starts at 1980 and cannot go below it.
  const year = Math.max(at.getFullYear(), 1980);
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

interface PendingEntry {
  name: string;
  method: number;
  crc: number;
  compressed: Buffer;
  size: number;
  mode: number;
  time: number;
  date: number;
  offset: number;
  directory: boolean;
}

/** One file or directory read out of an archive. */
export interface ZipEntry {
  /** Slash separated path inside the archive. A directory ends with a slash. */
  name: string;
  data: Buffer;
  mode: number;
  directory: boolean;
}

export interface ZipOptions {
  /** Refuse an archive larger than this. Guards against zipping something enormous by mistake. */
  maxBytes?: number;
}

export const DEFAULT_MAX_ZIP_BYTES = 512 * 1024 * 1024;

/** Names that must never be walked into, whatever the caller points at. */
const SKIP_ALWAYS = new Set(['.DS_Store']);

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (SKIP_ALWAYS.has(entry.name)) continue;
    const absolute = join(dir, entry.name);
    // A symlink is not followed: an archive that can point outside itself is a trap.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      out.push(`${relative(root, absolute).split(sep).join('/')}/`);
      await walk(root, absolute, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(relative(root, absolute).split(sep).join('/'));
  }
}

/** Zip a whole directory, dotfiles and `.git` included. */
export async function zipDirectory(root: string, options: ZipOptions = {}): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ZIP_BYTES;
  const names: string[] = [];
  await walk(root, root, names);

  const parts: Buffer[] = [];
  const entries: PendingEntry[] = [];
  let offset = 0;

  for (const name of names) {
    const directory = name.endsWith('/');
    const absolute = join(root, directory ? name.slice(0, -1) : name);
    const info = await stat(absolute);
    if (!directory && info.size > U32_MAX) {
      throw validation(`${name} is larger than 4 GB, which this archive format cannot hold`);
    }

    const raw = directory ? Buffer.alloc(0) : await readFile(absolute);
    const deflated = raw.byteLength === 0 ? raw : deflateRawSync(raw);
    // Storing beats deflating whenever the "compressed" form grew, which small files do.
    const useDeflate = deflated.byteLength < raw.byteLength;
    const stamp = dosStamp(info.mtime);

    const entry: PendingEntry = {
      name,
      method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
      crc: crc32(raw),
      compressed: useDeflate ? deflated : raw,
      size: raw.byteLength,
      mode: info.mode & 0xffff,
      time: stamp.time,
      date: stamp.date,
      offset,
      directory,
    };
    entries.push(entry);

    const header = Buffer.alloc(LOCAL_HEADER_BYTES);
    header.writeUInt32LE(LOCAL_SIG, 0);
    header.writeUInt16LE(VERSION_NEEDED, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(entry.time, 10);
    header.writeUInt16LE(entry.date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressed.byteLength, 18);
    header.writeUInt32LE(entry.size, 22);
    const nameBytes = Buffer.from(name, 'utf8');
    header.writeUInt16LE(nameBytes.byteLength, 26);
    header.writeUInt16LE(0, 28);

    parts.push(header, nameBytes, entry.compressed);
    offset += header.byteLength + nameBytes.byteLength + entry.compressed.byteLength;
    if (offset > maxBytes) throw validation(`The archive is larger than the ${maxBytes} byte limit`);
  }

  const centralStart = offset;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(CENTRAL_HEADER_BYTES);
    header.writeUInt32LE(CENTRAL_SIG, 0);
    header.writeUInt16LE(VERSION_MADE_BY, 4);
    header.writeUInt16LE(VERSION_NEEDED, 6);
    header.writeUInt16LE(FLAG_UTF8, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(entry.time, 12);
    header.writeUInt16LE(entry.date, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressed.byteLength, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(nameBytes.byteLength, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE((((entry.mode << 16) >>> 0) | (entry.directory ? 0x10 : 0)) >>> 0, 38);
    header.writeUInt32LE(Math.min(entry.offset, U32_MAX), 42);
    parts.push(header, nameBytes);
    offset += header.byteLength + nameBytes.byteLength;
  }

  const centralSize = offset - centralStart;
  const needsZip64 = entries.length > U16_MAX - 1 || centralStart > U32_MAX || centralSize > U32_MAX;

  if (needsZip64) {
    const record = Buffer.alloc(ZIP64_EOCD_BYTES);
    record.writeUInt32LE(ZIP64_EOCD_SIG, 0);
    record.writeBigUInt64LE(BigInt(ZIP64_EOCD_BYTES - 12), 4);
    record.writeUInt16LE(VERSION_MADE_BY, 12);
    record.writeUInt16LE(45, 14);
    record.writeUInt32LE(0, 16);
    record.writeUInt32LE(0, 20);
    record.writeBigUInt64LE(BigInt(entries.length), 24);
    record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(centralSize), 40);
    record.writeBigUInt64LE(BigInt(centralStart), 48);

    const locator = Buffer.alloc(ZIP64_LOCATOR_BYTES);
    locator.writeUInt32LE(ZIP64_LOCATOR_SIG, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(offset), 8);
    locator.writeUInt32LE(1, 16);

    parts.push(record, locator);
  }

  const end = Buffer.alloc(EOCD_BYTES);
  end.writeUInt32LE(EOCD_SIG, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Math.min(entries.length, U16_MAX), 8);
  end.writeUInt16LE(Math.min(entries.length, U16_MAX), 10);
  end.writeUInt32LE(Math.min(centralSize, U32_MAX), 12);
  end.writeUInt32LE(Math.min(centralStart, U32_MAX), 16);
  end.writeUInt16LE(0, 20);
  parts.push(end);

  const archive = Buffer.concat(parts);
  if (archive.byteLength > maxBytes) {
    throw validation(`The archive is larger than the ${maxBytes} byte limit`);
  }
  return archive;
}

/** Where the central directory starts, and how many entries it holds. */
function readEndRecord(archive: Buffer): { start: number; count: number } {
  const lowest = Math.max(0, archive.byteLength - EOCD_BYTES - U16_MAX);
  for (let at = archive.byteLength - EOCD_BYTES; at >= lowest; at -= 1) {
    if (archive.readUInt32LE(at) !== EOCD_SIG) continue;
    let count = archive.readUInt16LE(at + 10);
    let start = archive.readUInt32LE(at + 16);

    const locatorAt = at - ZIP64_LOCATOR_BYTES;
    if (locatorAt >= 0 && archive.readUInt32LE(locatorAt) === ZIP64_LOCATOR_SIG) {
      const recordAt = Number(archive.readBigUInt64LE(locatorAt + 8));
      if (recordAt >= 0 && recordAt + ZIP64_EOCD_BYTES <= archive.byteLength) {
        if (archive.readUInt32LE(recordAt) === ZIP64_EOCD_SIG) {
          count = Number(archive.readBigUInt64LE(recordAt + 32));
          start = Number(archive.readBigUInt64LE(recordAt + 48));
        }
      }
    }
    return { start, count };
  }
  throw validation('That file is not a zip archive');
}

/** Read every entry out of an archive. */
export function readZip(archive: Buffer): ZipEntry[] {
  const { start, count } = readEndRecord(archive);
  const entries: ZipEntry[] = [];
  let at = start;

  for (let index = 0; index < count; index += 1) {
    if (at + CENTRAL_HEADER_BYTES > archive.byteLength || archive.readUInt32LE(at) !== CENTRAL_SIG) {
      throw validation('The zip central directory is damaged');
    }
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const compressedSize = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const external = archive.readUInt32LE(at + 38);
    const localAt = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + CENTRAL_HEADER_BYTES, at + CENTRAL_HEADER_BYTES + nameLength);
    at += CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;

    if (localAt + LOCAL_HEADER_BYTES > archive.byteLength || archive.readUInt32LE(localAt) !== LOCAL_SIG) {
      throw validation(`The zip entry ${name} is damaged`);
    }
    const localNameLength = archive.readUInt16LE(localAt + 26);
    const localExtraLength = archive.readUInt16LE(localAt + 28);
    const dataAt = localAt + LOCAL_HEADER_BYTES + localNameLength + localExtraLength;
    const raw = archive.subarray(dataAt, dataAt + compressedSize);

    const directory = name.endsWith('/');
    const data = directory ? Buffer.alloc(0) : inflate(name, method, raw, size);
    if (!directory && crc32(data) !== crc) throw validation(`The zip entry ${name} is corrupt`);

    // A mode of 0 means the archive came from a system without them; fall back to a sane one.
    const mode = (external >>> 16) & 0xfff;
    entries.push({ name, data, directory, mode: mode === 0 ? (directory ? 0o755 : 0o644) : mode });
  }

  return entries;
}

function inflate(name: string, method: number, raw: Buffer, size: number): Buffer {
  if (method === METHOD_STORE) return Buffer.from(raw);
  if (method !== METHOD_DEFLATE) {
    throw validation(`The zip entry ${name} uses compression method ${method}, which is not supported`);
  }
  // A damaged stream throws a bare zlib error, which would read as a server fault.
  const data = attempt(() => inflateRawSync(raw), `The zip entry ${name} is corrupt`);
  if (data.byteLength !== size) throw validation(`The zip entry ${name} has the wrong length`);
  return data;
}

function attempt(work: () => Buffer, message: string): Buffer {
  try {
    return work();
  } catch {
    throw validation(message);
  }
}

/**
 * True when an entry name stays inside the directory it is written to. Anything absolute,
 * anything with a `..` segment and anything with a drive letter is refused.
 */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 1000) return false;
  if (name.startsWith('/') || name.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  if (name.includes('\0')) return false;
  return !name
    .split('/')
    .some((segment) => segment === '..' || segment.includes('\\'));
}

/** The parts of a `.git` directory an import may restore. Config and hooks are code, so they are not. */
const GIT_IMPORT_ALLOWED = [/^\.git\/objects\//, /^\.git\/refs\//, /^\.git\/HEAD$/, /^\.git\/packed-refs$/];

/**
 * True unless the entry is git metadata an import must not restore. A repository opens without
 * its config and its index, so history survives; a hook or an `ext::` remote would run as us.
 */
export function isImportableGitEntry(name: string): boolean {
  const clean = name.endsWith('/') ? name.slice(0, -1) : name;
  const first = clean.split('/')[0]?.toLowerCase() ?? '';
  if (first !== '.git') return true;
  return GIT_IMPORT_ALLOWED.some((rule) => rule.test(clean));
}

/** What an extracted entry gets. The archive's own mode is never honoured: it can be executable. */
const EXTRACT_FILE_MODE = 0o644;
const EXTRACT_DIR_MODE = 0o755;

/** Unpack an archive into a directory. Returns the number of files written. */
export async function unzipToDirectory(archive: Buffer, root: string): Promise<number> {
  const entries = readZip(archive);
  for (const entry of entries) {
    if (!isSafeEntryName(entry.directory ? entry.name.slice(0, -1) : entry.name)) {
      throw validation(`The zip entry ${entry.name} points outside the archive`);
    }
  }

  let written = 0;
  for (const entry of entries) {
    // Dropped rather than refused: an ordinary export ships .git/config and .git/index.
    if (!isImportableGitEntry(entry.name)) continue;
    const target = join(root, entry.name);
    if (entry.directory) {
      await mkdir(target, { recursive: true, mode: EXTRACT_DIR_MODE });
      continue;
    }
    await mkdir(join(target, '..'), { recursive: true, mode: EXTRACT_DIR_MODE });
    await writeFile(target, entry.data, { mode: EXTRACT_FILE_MODE });
    written += 1;
  }
  return written;
}
