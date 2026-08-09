/**
 * Load test: many concurrent writers on one page, against the real server stack.
 *
 * Not part of `pnpm test`: it boots a real Fastify server, a real git repo and a real content
 * watcher, and takes seconds rather than milliseconds. Run it with `pnpm test:load`.
 *
 * Two workloads, because they have genuinely different answers:
 *   disjoint  - every writer owns one line. Nothing may be lost. This is the guarantee.
 *   same-line - every writer appends at the same point. A line merge cannot settle that, so
 *               the losers are told, and the measurement here is that nobody is told wrongly.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CLIENT_HEADER, loadConfig, mergeText } from '@tablinum/shared';
import { buildApp } from '../../src/app.js';
import { contextOf } from '../../src/context.js';
import { buildRealDeps } from '../../src/server.js';
import { startContentWatcher } from '../../src/wiring.js';

const run = promisify(execFile);

const TOKEN = 'load-token-aaaaaaaaaaaaaaaaaaaa';
const WRITERS = Number(process.env.LOAD_WRITERS ?? 12);
const OPS = Number(process.env.LOAD_OPS ?? 20);
const THINK_MS = Number(process.env.LOAD_THINK_MS ?? 15);
const MAX_ATTEMPTS = 12;

interface Stats {
  workload: string;
  writers: number;
  opsPerWriter: number;
  opsAttempted: number;
  acked: number;
  refused: number;
  conflicts409: number;
  otherErrors: number;
  lostAckedMarkers: number;
  elapsedMs: number;
  opsPerSec: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  commits: number;
  dirtyLines: number;
}

interface Started {
  base: string;
  auth: Record<string, string>;
  contentDir: string;
  stop: () => Promise<void>;
}

async function startServer(): Promise<Started> {
  const root = await mkdtemp(join(tmpdir(), 'tablinum-load-'));
  const contentDir = join(root, 'content');

  const config = loadConfig({
    TABLINUM_CONTENT_DIR: contentDir,
    TABLINUM_SESSION_SECRET: 'load-test-secret-0123456789abcdef',
    TABLINUM_API_TOKENS: TOKEN,
    TABLINUM_AUTOCOMMIT_MS: '200',
    TABLINUM_AUTOPULL_MS: '0',
  });

  const { deps, git: coreGit, search, accounts } = buildRealDeps(config);
  deps.logger = false;
  deps.webDistDir = null;

  await deps.store.init();
  await deps.git.init();
  await deps.search.init();
  accounts.init();

  const app = await buildApp(deps);
  const ctx = contextOf(app);
  if (ctx === null) throw new Error('the app exposes no context');
  const watcher = startContentWatcher(deps, ctx.wiring, app.log, ctx.live);
  await watcher.whenReady();
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');

  return {
    base: `http://127.0.0.1:${address.port}/api/v1`,
    auth: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    contentDir,
    stop: async (): Promise<void> => {
      await watcher.close();
      await app.close();
      await coreGit.flushPendingCommit().catch(() => null);
      await coreGit.close();
      search.close();
      accounts.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[at] ?? 0;
}

/** Replace the line owned by `writer`. Mirrors a person editing only their own paragraph. */
function withLine(markdown: string, writer: number, line: string): string {
  const lines = markdown.split('\n');
  const at = lines.findIndex((text) => text.startsWith(`w${writer}:`));
  if (at === -1) return `${markdown}\n${line}`;
  lines[at] = line;
  return lines.join('\n');
}

async function measure(workload: 'disjoint' | 'same-line'): Promise<Stats> {
  const server = await startServer();
  const { base, auth, contentDir } = server;

  const seed =
    workload === 'disjoint'
      ? ['# Load', '', ...Array.from({ length: WRITERS }, (_, i) => `w${i}:`)].join('\n')
      : '# Load\n';

  const created = await fetch(`${base}/pages`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ path: 'docs/load', title: 'Load', markdown: seed }),
  });
  if (!created.ok) throw new Error(`could not create the page: ${await created.text()}`);
  const createdBody: unknown = await created.json();
  if (typeof createdBody !== 'object' || createdBody === null || !('page' in createdBody)) {
    throw new Error('the create response had no page');
  }
  const page = (createdBody as { page: { id: string; markdown: string; rev: string } }).page;

  let acked = 0;
  let refused = 0;
  let conflicts = 0;
  let otherErrors = 0;
  const latencies: number[] = [];
  // Only what the server acknowledged must survive. A refusal is a promise that nothing was
  // written, so counting refused markers as lost would measure the wrong thing.
  const ackedMarkers: string[] = [];

  async function writer(index: number): Promise<void> {
    let confirmed = page.markdown;
    let rev = page.rev;
    const mine: string[] = [];

    for (let op = 0; op < OPS; op += 1) {
      const marker = `w${index}-op${op}`;
      mine.push(marker);
      let text =
        workload === 'disjoint'
          ? withLine(confirmed, index, `w${index}: ${mine.join(' ')}`)
          : `${confirmed}\n${marker}`;
      let sent = false;

      for (let attempt = 0; attempt < MAX_ATTEMPTS && !sent; attempt += 1) {
        const at = Date.now();
        const res = await fetch(`${base}/pages/${page.id}`, {
          method: 'PATCH',
          headers: { ...auth, [CLIENT_HEADER]: `client${index}` },
          body: JSON.stringify({ markdown: text, baseRev: rev }),
        });
        latencies.push(Date.now() - at);

        if (res.ok) {
          const okBody = (await res.json()) as { page: { markdown: string; rev: string } };
          confirmed = okBody.page.markdown;
          rev = okBody.page.rev;
          acked += 1;
          ackedMarkers.push(marker);
          sent = true;
          break;
        }
        if (res.status !== 409) {
          otherErrors += 1;
          console.error(`unexpected ${res.status}: ${await res.text()}`);
          break;
        }

        conflicts += 1;
        const errBody = (await res.json()) as {
          error?: { info?: { markdown: string; rev: string } };
        };
        const info = errBody.error?.info;
        if (info === undefined) break;

        // Exactly what the browser does on a 409: rebase the pending edit onto the new text.
        const rebased =
          workload === 'disjoint'
            ? withLine(info.markdown, index, `w${index}: ${mine.join(' ')}`)
            : mergeText(confirmed, text, info.markdown);
        confirmed = info.markdown;
        rev = info.rev;
        if (typeof rebased === 'string') {
          text = rebased;
          continue;
        }
        if (!rebased.clean) break;
        text = rebased.text;
      }

      if (!sent) {
        refused += 1;
        mine.pop();
      }
      if (THINK_MS > 0) await new Promise((resolve) => setTimeout(resolve, THINK_MS));
    }
  }

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: WRITERS }, (_, index) => writer(index)));
  const elapsedMs = Date.now() - startedAt;

  // Let the debounced autocommit and the watcher settle before reading the tree.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const final = await readFile(join(contentDir, 'docs', 'load.md'), 'utf8');
  const lostAckedMarkers = ackedMarkers.filter((marker) => !final.includes(marker)).length;

  await server.stop.call(null);
  const commits = await run('git', ['-C', contentDir, 'rev-list', '--count', 'HEAD']).catch(() => ({
    stdout: '0',
  }));
  const status = await run('git', ['-C', contentDir, 'status', '--porcelain']).catch(() => ({
    stdout: '',
  }));

  latencies.sort((a, b) => a - b);
  return {
    workload,
    writers: WRITERS,
    opsPerWriter: OPS,
    opsAttempted: WRITERS * OPS,
    acked,
    refused,
    conflicts409: conflicts,
    otherErrors,
    lostAckedMarkers,
    elapsedMs,
    opsPerSec: Math.round((acked / elapsedMs) * 1000),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    commits: Number(commits.stdout.trim()),
    dirtyLines: status.stdout.trim().length === 0 ? 0 : status.stdout.trim().split('\n').length,
  };
}

async function main(): Promise<void> {
  const results: Stats[] = [];
  for (const workload of ['disjoint', 'same-line'] as const) {
    const stats = await measure(workload);
    results.push(stats);
    console.log(JSON.stringify(stats, null, 2));
  }

  const failures: string[] = [];
  for (const stats of results) {
    if (stats.otherErrors > 0) failures.push(`${stats.workload}: ${stats.otherErrors} bad replies`);
    if (stats.lostAckedMarkers > 0) {
      failures.push(`${stats.workload}: ${stats.lostAckedMarkers} acknowledged edits lost`);
    }
    if (stats.dirtyLines > 0) {
      failures.push(`${stats.workload}: the content repo is dirty (${stats.dirtyLines} entries)`);
    }
  }
  // Disjoint edits are the guarantee: different paragraphs must never refuse each other.
  const disjoint = results.find((stats) => stats.workload === 'disjoint');
  if (disjoint !== undefined && disjoint.refused > 0) {
    failures.push(`disjoint: ${disjoint.refused} edits refused, expected none`);
  }

  if (failures.length > 0) {
    console.error(`\nFAILED\n${failures.map((line) => `  - ${line}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nOK: no acknowledged edit was lost and the content repo is clean.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
