import { readFile, writeFile } from 'node:fs/promises';
import { WELCOME_STATE } from '../env';

/** The title and the body of the page a fresh server writes into its starter space. */
export interface WelcomePage {
  title: string;
  markdown: string;
}

/**
 * Keep the welcome page the server started with. The setup project calls this once, before any
 * spec has run, so what lands on disk is the pristine page and never a page a test edited.
 */
export async function saveWelcome(page: WelcomePage): Promise<void> {
  await writeFile(WELCOME_STATE, JSON.stringify(page), 'utf8');
}

let capture: Promise<WelcomePage> | undefined;

/**
 * The captured welcome page, for reset() to write back. It comes from the server under test
 * instead of a copy of `WELCOME_MARKDOWN` in packages/core, so the two cannot drift apart.
 *
 * Read once per worker process: reset() runs before every test and the file never changes.
 */
export function pristineWelcome(): Promise<WelcomePage> {
  capture ??= readFile(WELCOME_STATE, 'utf8').then(
    (raw) => JSON.parse(raw) as WelcomePage,
    (cause: unknown) => {
      throw new Error(`no welcome page captured at ${WELCOME_STATE}; auth.setup.ts writes it`, { cause });
    },
  );
  return capture;
}
