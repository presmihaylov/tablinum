import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Account, Agent, CommentAnchor, CommentThread, Page } from '@tablinum/shared';
import { PageEditor } from '../src/editor';
import { AuthProvider } from '../src/lib/auth';
import { CommentsProvider, useComments } from '../src/lib/comments';
import { CommentsPanel } from '../src/components/Comments/CommentsPanel';
import { page } from './fixtures';
import { installFetch, type MockServer, type Routes } from './mockFetch';
import { renderApp } from './render';

let server: MockServer | null = null;

afterEach(() => {
  server?.restore();
  server = null;
});

const ADA: Account = {
  id: 'us_00000000000000000000000001',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  handle: 'ada.lovelace',
  role: 'admin',
  color: '#3b82f6',
  avatarRev: null,
  disabled: false,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
};

const SAM: Account = {
  ...ADA,
  id: 'us_00000000000000000000000002',
  email: 'sam@example.com',
  name: 'Sam Rivers',
  handle: 'sam.rivers',
  role: 'member',
  color: '#22c55e',
};

const BOT: Agent = {
  id: 'ag_00000000000000000000000001',
  name: 'Doc Bot',
  handle: 'doc.bot',
  identity: 'Keeps the runbooks tidy.',
  workspaceId: 'ws_00000000000000000000000001',
  color: '#a855f7',
  avatarRev: null,
  webhookUrl: null,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  lastUsed: null,
};

const PAGE: Page = page({ markdown: 'Run the pipeline every Friday.\n' });

const ANCHOR: CommentAnchor = {
  quote: 'the pipeline',
  prefix: 'Run ',
  suffix: ' every Friday.',
  start: 4,
};

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  const id = overrides.id ?? 'ct_00000000000000000000000001';
  return {
    id,
    pageId: PAGE.id,
    anchor: ANCHOR,
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    comments: [
      {
        id: 'cm_00000000000000000000000001',
        threadId: id,
        author: ADA.id,
        body: 'Is this still the right pipeline?',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** Lets a test drive the parts of the panel that only the editor toolbar reaches. */
function Controls() {
  const comments = useComments();
  return (
    <button type="button" onClick={() => comments.startDraft(ANCHOR)}>
      Start a draft
    </button>
  );
}

async function mount(threads: CommentThread[], routes: Routes = {}): Promise<void> {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [] },
    'GET /api/v1/auth/state': { setupRequired: false, user: ADA },
    'GET /api/v1/users': { users: [ADA, SAM] },
    'GET /api/v1/agents': { agents: [BOT] },
    [`GET /api/v1/pages/${PAGE.id}/comments`]: { threads },
    ...routes,
  });

  renderApp(
    <AuthProvider>
      <CommentsProvider pageId={PAGE.id}>
        <PageEditor
          page={PAGE}
          saveState="idle"
          onChange={vi.fn()}
          onTitleChange={vi.fn()}
          onIconChange={vi.fn()}
        />
        <Controls />
        <CommentsPanel />
      </CommentsProvider>
    </AuthProvider>,
  );

  await screen.findByRole('complementary', { name: 'Comments' });
  const first = threads[0];
  // The card, not the words: a body that names somebody is drawn in several pieces.
  if (first !== undefined) await waitFor(() => cardFor(first.id));
}

/**
 * jsdom does no layout, so ProseMirror cannot turn a click into a document position on its own.
 * These two stubs put the caret inside the node the test clicked, which is what a browser does.
 */
function aimAt(node: HTMLElement): void {
  const text = node.firstChild;
  document.elementFromPoint = () => node;
  document.caretRangeFromPoint = () => {
    const range = document.createRange();
    if (text !== null) range.setStart(text, 1);
    range.collapse(true);
    return range;
  };
}

function openCount(): string {
  return document.querySelector('.comments__count')?.textContent ?? '';
}

function cardFor(threadId: string): HTMLElement {
  const card = document.querySelector(`[data-thread-id="${threadId}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`no card for ${threadId}`);
  return card;
}

/** A card shows only its first remark until somebody clicks into it. */
async function openCard(threadId: string): Promise<void> {
  await userEvent.click(cardFor(threadId));
}

function highlight(text: string): HTMLElement {
  const found = [...document.querySelectorAll('.gd-comment')].find(
    (node) => node.textContent === text,
  );
  if (!(found instanceof HTMLElement)) throw new Error(`no highlight over ${JSON.stringify(text)}`);
  return found;
}

function callsTo(method: string, path: string) {
  return (server?.calls ?? []).filter((call) => call.method === method && call.url.pathname === path);
}

describe('the comments panel', () => {
  it('lists a thread with its quote, its author and the open count', async () => {
    await mount([thread()]);

    const card = cardFor('ct_00000000000000000000000001');
    expect(within(card).getByText('the pipeline')).toBeTruthy();
    expect(within(card).getByText('Ada Lovelace')).toBeTruthy();
    expect(within(card).getByText('Is this still the right pipeline?')).toBeTruthy();
    expect(openCount()).toBe('1 open');
    expect(screen.getByLabelText('Comments, 1 open')).toBeTruthy();
  });

  it('names an agent that left a remark, exactly as it names a person', async () => {
    const byBot = thread({
      comments: [
        {
          id: 'cm_00000000000000000000000009',
          threadId: 'ct_00000000000000000000000001',
          author: BOT.id,
          body: 'This pipeline moved to Tuesday.',
          created: '2026-01-01T00:00:00.000Z',
          updated: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    await mount([byBot]);

    const card = cardFor('ct_00000000000000000000000001');
    expect(within(card).getByText('Doc Bot')).toBeTruthy();
    expect(within(card).getByText('This pipeline moved to Tuesday.')).toBeTruthy();
    expect(within(card).queryByText('A former member')).toBeNull();
  });

  it('hides a resolved thread until somebody asks for it', async () => {
    const open = thread({ id: 'ct_00000000000000000000000001' });
    const done = thread({
      id: 'ct_00000000000000000000000002',
      resolved: true,
      resolvedBy: SAM.id,
      resolvedAt: '2026-01-02T00:00:00.000Z',
      comments: [
        {
          id: 'cm_00000000000000000000000002',
          threadId: 'ct_00000000000000000000000002',
          author: SAM.id,
          body: 'Fixed in the runbook.',
          created: '2026-01-02T00:00:00.000Z',
          updated: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    await mount([open, done]);

    expect(openCount()).toBe('1 open');
    expect(document.querySelectorAll('[data-thread-id]')).toHaveLength(1);

    await userEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(document.querySelectorAll('[data-thread-id]')).toHaveLength(2));
    expect(screen.getByText('Fixed in the runbook.')).toBeTruthy();

    await openCard(done.id);
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('posts a reply on the thread it was written under', async () => {
    await mount([thread()], {
      'POST /api/v1/comment-threads/ct_00000000000000000000000001/replies': { thread: thread() },
    });

    await openCard('ct_00000000000000000000000001');
    await userEvent.click(within(cardFor('ct_00000000000000000000000001')).getByRole('button', { name: 'Reply' }));
    await userEvent.type(screen.getByLabelText('Reply'), 'It is, I checked on Monday.');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));

    await waitFor(() =>
      expect(callsTo('POST', '/api/v1/comment-threads/ct_00000000000000000000000001/replies')).toHaveLength(1),
    );
    const [sent] = callsTo('POST', '/api/v1/comment-threads/ct_00000000000000000000000001/replies');
    expect(sent?.body).toEqual({ body: 'It is, I checked on Monday.' });
  });

  it('resolves a thread and reads the list again', async () => {
    await mount([thread()], {
      'PATCH /api/v1/comment-threads/ct_00000000000000000000000001': {
        thread: thread({ resolved: true, resolvedBy: ADA.id, resolvedAt: '2026-01-02T00:00:00.000Z' }),
      },
    });

    await openCard('ct_00000000000000000000000001');
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() =>
      expect(callsTo('PATCH', '/api/v1/comment-threads/ct_00000000000000000000000001')).toHaveLength(1),
    );
    const [sent] = callsTo('PATCH', '/api/v1/comment-threads/ct_00000000000000000000000001');
    expect(sent?.body).toEqual({ resolved: true });
  });

  it('takes a resolved thread out of the list at once, even while it is in focus', async () => {
    const id = 'ct_00000000000000000000000001';
    const done = thread({ resolved: true, resolvedBy: ADA.id, resolvedAt: '2026-01-02T00:00:00.000Z' });
    let stored: CommentThread[] = [thread()];
    await mount([thread()], {
      [`GET /api/v1/pages/${PAGE.id}/comments`]: () => ({ threads: stored }),
      [`PATCH /api/v1/comment-threads/${id}`]: () => {
        stored = [done];
        return { thread: done };
      },
    });

    // A click puts the thread in focus, which is what used to keep the card on the screen.
    await userEvent.click(cardFor(id));
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(document.querySelectorAll('[data-thread-id]')).toHaveLength(0));
    expect(openCount()).toBe('0 open');
  });

  it('offers Edit on your own comment only, and Delete on anybody as an admin', async () => {
    const mine = thread();
    const theirs = thread({
      id: 'ct_00000000000000000000000002',
      anchor: null,
      comments: [
        {
          id: 'cm_00000000000000000000000002',
          threadId: 'ct_00000000000000000000000002',
          author: SAM.id,
          body: 'A remark from somebody else.',
          created: '2026-01-02T00:00:00.000Z',
          updated: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    await mount([mine, theirs]);

    // Only the card in focus offers anything to do, so each one is opened in its turn.
    await openCard(mine.id);
    const own = within(cardFor(mine.id));
    expect(own.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(own.getByRole('button', { name: 'Delete' })).toBeTruthy();

    await openCard(theirs.id);
    const other = within(cardFor(theirs.id));
    expect(other.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(other.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(other.getByText('On the whole page')).toBeTruthy();
  });

  it('sends an edited body to the comment it belongs to', async () => {
    await mount([thread()], {
      'PATCH /api/v1/comments/cm_00000000000000000000000001': { thread: thread() },
    });

    await openCard('ct_00000000000000000000000001');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByLabelText('Edit the comment');
    await userEvent.clear(field);
    await userEvent.type(field, 'Is this still right?');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(callsTo('PATCH', '/api/v1/comments/cm_00000000000000000000000001')).toHaveLength(1),
    );
    const [sent] = callsTo('PATCH', '/api/v1/comments/cm_00000000000000000000000001');
    expect(sent?.body).toEqual({ body: 'Is this still right?' });
  });

  it('asks before it deletes, and warns that the thread goes too', async () => {
    await mount([thread()], {
      'DELETE /api/v1/comments/cm_00000000000000000000000001': { thread: null },
    });

    await openCard('ct_00000000000000000000000001');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete comment' }));
    expect(
      dialog.getByText('Delete this comment? The whole thread goes with it, replies included.'),
    ).toBeTruthy();

    await userEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(callsTo('DELETE', '/api/v1/comments/cm_00000000000000000000000001')).toHaveLength(1),
    );
  });

  it('opens a draft on the selection and posts it with its anchor', async () => {
    await mount([], {
      [`POST /api/v1/pages/${PAGE.id}/comments`]: { thread: thread() },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Start a draft' }));
    await userEvent.type(screen.getByLabelText('Write a comment'), 'Is this still right?');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(callsTo('POST', `/api/v1/pages/${PAGE.id}/comments`)).toHaveLength(1));
    const [sent] = callsTo('POST', `/api/v1/pages/${PAGE.id}/comments`);
    expect(sent?.body).toEqual({ body: 'Is this still right?', anchor: ANCHOR });
  });

  it('names somebody from the menu the @ opens', async () => {
    await mount([], {
      [`POST /api/v1/pages/${PAGE.id}/comments`]: { thread: thread() },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Comment on the page' }));
    const field = screen.getByLabelText('Write a comment');
    await userEvent.type(field, 'over to @sam');

    const menu = await screen.findByRole('listbox', { name: 'Mention somebody' });
    expect(within(menu).getByRole('option', { name: /Sam Rivers/ })).toBeTruthy();
    await userEvent.click(within(menu).getByRole('option', { name: /Sam Rivers/ }));

    // The whole handle goes in, not the fragment that was typed.
    expect(field).toHaveValue('over to @sam.rivers ');
    expect(screen.queryByRole('listbox', { name: 'Mention somebody' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(callsTo('POST', `/api/v1/pages/${PAGE.id}/comments`)).toHaveLength(1));
    const [sent] = callsTo('POST', `/api/v1/pages/${PAGE.id}/comments`);
    expect(sent?.body).toEqual({ body: 'over to @sam.rivers' });
  });

  it('takes the highlighted person on Enter and never posts on that key', async () => {
    await mount([]);

    await userEvent.click(screen.getByRole('button', { name: 'Comment on the page' }));
    const field = screen.getByLabelText('Write a comment');
    await userEvent.type(field, 'ping @');

    await screen.findByRole('listbox', { name: 'Mention somebody' });
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(field).toHaveValue('ping @sam.rivers ');
    expect(callsTo('POST', `/api/v1/pages/${PAGE.id}/comments`)).toHaveLength(0);
  });

  // Escape belongs to the menu while it is open, or a mistyped handle throws the draft away.
  it('closes the menu on Escape and keeps the draft', async () => {
    await mount([]);

    await userEvent.click(screen.getByRole('button', { name: 'Comment on the page' }));
    await userEvent.type(screen.getByLabelText('Write a comment'), 'ping @ada');
    await screen.findByRole('listbox', { name: 'Mention somebody' });

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox', { name: 'Mention somebody' })).toBeNull();
    expect(screen.getByLabelText('Write a comment')).toHaveValue('ping @ada');
  });

  it('draws a posted mention as a chip, and marks the reader in it', async () => {
    const named = thread({
      comments: [
        {
          id: 'cm_00000000000000000000000001',
          threadId: 'ct_00000000000000000000000001',
          author: SAM.id,
          body: 'over to @ada.lovelace and @sam.rivers',
          created: '2026-01-01T00:00:00.000Z',
          updated: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    await mount([named]);

    const chips = [...cardFor(named.id).querySelectorAll('.comment__mention')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['@ada.lovelace', '@sam.rivers']);
    // Ada is reading, and she is the one who was asked to do something.
    expect(chips[0]?.classList.contains('comment__mention--me')).toBe(true);
    expect(chips[1]?.classList.contains('comment__mention--me')).toBe(false);
  });

  it('comments on the whole page when no text is selected', async () => {
    await mount([], {
      [`POST /api/v1/pages/${PAGE.id}/comments`]: { thread: thread({ anchor: null }) },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Comment on the page' }));
    expect(screen.getByText('On the whole page')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Write a comment'), 'Who owns this page?');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(callsTo('POST', `/api/v1/pages/${PAGE.id}/comments`)).toHaveLength(1));
    const [sent] = callsTo('POST', `/api/v1/pages/${PAGE.id}/comments`);
    expect(sent?.body).toEqual({ body: 'Who owns this page?' });
  });
});

describe('a card that nobody is in', () => {
  const WITH_REPLY = thread({
    comments: [
      {
        id: 'cm_00000000000000000000000001',
        threadId: 'ct_00000000000000000000000001',
        author: ADA.id,
        body: 'Is this still the right pipeline?',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'cm_00000000000000000000000002',
        threadId: 'ct_00000000000000000000000001',
        author: SAM.id,
        body: 'It is. I checked it on Monday.',
        created: '2026-01-02T00:00:00.000Z',
        updated: '2026-01-02T00:00:00.000Z',
      },
    ],
  });

  it('shows the first remark and counts the rest', async () => {
    await mount([WITH_REPLY]);

    const card = within(cardFor(WITH_REPLY.id));
    expect(card.getByText('Is this still the right pipeline?')).toBeTruthy();
    expect(card.queryByText('It is. I checked it on Monday.')).toBeNull();
    expect(card.getByText('1 more reply')).toBeTruthy();
    expect(card.queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  it('opens on a click, with the whole thread and a way to answer it', async () => {
    await mount([WITH_REPLY]);

    await openCard(WITH_REPLY.id);

    // The card opens on the click that focuses it, which is a render later under load.
    await waitFor(() =>
      expect(within(cardFor(WITH_REPLY.id)).getByText('It is. I checked it on Monday.')).toBeTruthy(),
    );
    const card = within(cardFor(WITH_REPLY.id));
    expect(card.queryByText('1 more reply')).toBeNull();
    expect(card.getByRole('button', { name: 'Reply' })).toBeTruthy();
  });

  it('closes again when another card is opened', async () => {
    const second = thread({
      id: 'ct_00000000000000000000000002',
      comments: [
        {
          id: 'cm_00000000000000000000000003',
          threadId: 'ct_00000000000000000000000002',
          author: SAM.id,
          body: 'And who owns the runbook?',
          created: '2026-01-03T00:00:00.000Z',
          updated: '2026-01-03T00:00:00.000Z',
        },
      ],
    });
    await mount([WITH_REPLY, second]);

    await openCard(WITH_REPLY.id);
    await openCard(second.id);

    expect(within(cardFor(second.id)).getByRole('button', { name: 'Reply' })).toBeTruthy();
    expect(within(cardFor(WITH_REPLY.id)).queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(cardFor(WITH_REPLY.id).className).toContain('comments__thread--peek');
  });
});

describe('the highlight and the thread', () => {
  it('highlights the anchored text and puts the card in focus when it is clicked', async () => {
    await mount([thread()]);
    await waitFor(() => expect(highlight('the pipeline')).toBeTruthy());

    const span = highlight('the pipeline');
    aimAt(span);
    await userEvent.click(span);

    await waitFor(() =>
      expect(cardFor('ct_00000000000000000000000001').className).toContain('comments__thread--active'),
    );
    await waitFor(() => expect(highlight('the pipeline').className).toContain('gd-comment--active'));
  });

  it('highlights the text when the card is clicked, which is the same link the other way', async () => {
    await mount([thread()]);
    await waitFor(() => expect(highlight('the pipeline')).toBeTruthy());
    expect(highlight('the pipeline').className).not.toContain('gd-comment--active');

    await userEvent.click(within(cardFor('ct_00000000000000000000000001')).getByText('Ada Lovelace'));

    await waitFor(() => expect(highlight('the pipeline').className).toContain('gd-comment--active'));
  });

  it('marks a thread orphaned rather than move it when its text is gone', async () => {
    const gone = thread({
      anchor: { quote: 'the deployment', prefix: 'Run ', suffix: ' every Friday.', start: 4 },
    });
    await mount([gone]);

    await waitFor(() => expect(screen.getByText('This text is no longer on the page.')).toBeTruthy());
    expect(document.querySelectorAll('.gd-comment')).toHaveLength(0);
    // The thread stays readable, and it still shows the words it was written about.
    expect(within(cardFor(gone.id)).getByText('the deployment')).toBeTruthy();
  });
});
