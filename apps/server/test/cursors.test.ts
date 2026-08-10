import { describe, expect, it } from 'vitest';
import { newPageId } from '@tablinum/shared';
import { CURSOR_TTL_MS, CursorDesk, clampedTo, ownerKey } from '../src/cursors.js';

const MARKDOWN = '# Deploy\n\nRun the pipeline from main.\n\n- build\n- ship\n';

function page(markdown = MARKDOWN) {
  return { id: newPageId(), path: 'eng/deploy', markdown };
}

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

describe('CursorDesk', () => {
  it('has nothing until a caret is put somewhere', () => {
    const desk = new CursorDesk();
    expect(desk.get('agent:a', 'ws', newPageId())).toBeNull();
  });

  it('hands back the caret it was given', () => {
    const desk = new CursorDesk();
    const one = page();
    const span = { anchor: { block: 1, offset: 4 }, head: { block: 1, offset: 16 } };

    const written = desk.set('agent:a', 'ws', one, span, NOW);
    expect(written.anchor).toEqual(span.anchor);
    expect(written.head).toEqual(span.head);
    expect(written.path).toBe('eng/deploy');
    expect(written.updated).toBe('2026-01-01T00:00:00.000Z');
    expect(desk.get('agent:a', 'ws', one.id, NOW)).toEqual(written);
  });

  it('moves a caret past the end back onto text that exists', () => {
    const desk = new CursorDesk();
    const one = page();
    const written = desk.set(
      'agent:a',
      'ws',
      one,
      { anchor: { block: 40, offset: 900 }, head: { block: 40, offset: 900 } },
      NOW,
    );
    expect(written.anchor).toEqual({ block: 2, offset: 14 });
  });

  it('keeps two callers apart on the same page', () => {
    const desk = new CursorDesk();
    const one = page();
    desk.set('agent:a', 'ws', one, { anchor: { block: 0, offset: 1 }, head: { block: 0, offset: 1 } }, NOW);
    desk.set('user:u', 'ws', one, { anchor: { block: 1, offset: 2 }, head: { block: 1, offset: 2 } }, NOW);

    expect(desk.get('agent:a', 'ws', one.id, NOW)?.head).toEqual({ block: 0, offset: 1 });
    expect(desk.get('user:u', 'ws', one.id, NOW)?.head).toEqual({ block: 1, offset: 2 });
  });

  it('keeps two workspaces apart even when a page id is the same', () => {
    const desk = new CursorDesk();
    const one = page();
    desk.set('agent:a', 'ws1', one, { anchor: { block: 2, offset: 0 }, head: { block: 2, offset: 0 } }, NOW);
    expect(desk.get('agent:a', 'ws2', one.id, NOW)).toBeNull();
  });

  it('forgets a caret nobody has moved in a long time', () => {
    const desk = new CursorDesk();
    const one = page();
    desk.set('agent:a', 'ws', one, { anchor: { block: 0, offset: 0 }, head: { block: 0, offset: 0 } }, NOW);

    expect(desk.get('agent:a', 'ws', one.id, NOW + CURSOR_TTL_MS - 1)).not.toBeNull();
    expect(desk.get('agent:a', 'ws', one.id, NOW + CURSOR_TTL_MS)).toBeNull();
  });

  it('sweeps away every lapsed caret at once', () => {
    const desk = new CursorDesk();
    for (const owner of ['agent:a', 'agent:b']) {
      desk.set('x', 'ws', page(), { anchor: { block: 0, offset: 0 }, head: { block: 0, offset: 0 } }, NOW);
      desk.set(owner, 'ws', page(), { anchor: { block: 0, offset: 0 }, head: { block: 0, offset: 0 } }, NOW);
    }
    expect(desk.size).toBeGreaterThan(0);
    desk.sweep(NOW + CURSOR_TTL_MS);
    expect(desk.size).toBe(0);
  });

  it('takes every caret off a page that is gone', () => {
    const desk = new CursorDesk();
    const one = page();
    const other = page();
    const at = { anchor: { block: 0, offset: 0 }, head: { block: 0, offset: 0 } };
    desk.set('agent:a', 'ws', one, at, NOW);
    desk.set('user:u', 'ws', one, at, NOW);
    desk.set('agent:a', 'ws', other, at, NOW);

    desk.clearPage('ws', one.id);

    expect(desk.get('agent:a', 'ws', one.id, NOW)).toBeNull();
    expect(desk.get('user:u', 'ws', one.id, NOW)).toBeNull();
    expect(desk.get('agent:a', 'ws', other.id, NOW)).not.toBeNull();
  });

  it('takes one caller\'s caret off a page', () => {
    const desk = new CursorDesk();
    const one = page();
    const at = { anchor: { block: 1, offset: 0 }, head: { block: 1, offset: 0 } };
    desk.set('agent:a', 'ws', one, at, NOW);
    desk.clear('agent:a', 'ws', one.id);
    expect(desk.get('agent:a', 'ws', one.id, NOW)).toBeNull();
  });
});

describe('clampedTo', () => {
  it('moves a caret onto a block that is still there when a page is cut short', () => {
    const desk = new CursorDesk();
    const one = page();
    const held = desk.set(
      'agent:a',
      'ws',
      one,
      { anchor: { block: 2, offset: 14 }, head: { block: 2, offset: 14 } },
      NOW,
    );
    const pulled = clampedTo(held, 'Just one line now.\n');
    expect(pulled.anchor).toEqual({ block: 0, offset: 14 });
    expect(pulled.head).toEqual({ block: 0, offset: 14 });
  });
});

describe('ownerKey', () => {
  it('names an agent, an account and an operator token apart', () => {
    expect(ownerKey({ agent: { id: 'ag_1' }, account: null })).toBe('agent:ag_1');
    expect(ownerKey({ agent: null, account: { id: 'us_1' } })).toBe('user:us_1');
    expect(ownerKey({ agent: null, account: null })).toBe('token');
  });

  it('lets an agent token win over the account it acts for', () => {
    expect(ownerKey({ agent: { id: 'ag_1' }, account: { id: 'us_1' } })).toBe('agent:ag_1');
  });
});
