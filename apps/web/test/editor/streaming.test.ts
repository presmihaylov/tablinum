import { describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { collab, getVersion, receiveTransaction, sendableSteps } from '@tiptap/pm/collab';
import { Step } from '@tiptap/pm/transform';
import type { DocStep } from '@tablinum/shared';
import { DocRooms, versionOf } from '../../../server/src/docroom';
import { writeMarkdown } from '../../src/editor/markdown';
import { createTestEditor } from './harness';

const PATH = 'docs/live';

/**
 * One tab: a real editor with the real schema, plus the collab plugin that tracks which of
 * its steps the authority has confirmed.
 */
class Peer {
  readonly editor: Editor;

  constructor(
    readonly id: string,
    markdown: string,
    version: number,
  ) {
    this.editor = createTestEditor(markdown);
    this.editor.registerPlugin(collab({ version, clientID: id }));
  }

  get markdown(): string {
    return writeMarkdown(this.editor.state.doc);
  }

  get version(): number {
    return getVersion(this.editor.state);
  }

  /** Put text in at a document position, exactly as a keystroke would. */
  type(at: number, text: string): void {
    this.editor.chain().setTextSelection(at).insertContent(text).run();
  }

  /** Find a position by the text around it, so the tests do not carry magic offsets. */
  endOf(text: string): number {
    let found = -1;
    this.editor.state.doc.descendants((node, pos) => {
      if (!node.isText || node.text !== text || found >= 0) return;
      found = pos + text.length;
    });
    if (found < 0) throw new Error(`no text node "${text}"`);
    return found;
  }

  startOf(text: string): number {
    return this.endOf(text) - text.length;
  }

  receive(steps: DocStep[]): void {
    const parsed = steps.map((entry) => Step.fromJSON(this.editor.schema, entry.step));
    const ids = steps.map((entry) => entry.client);
    this.editor.view.dispatch(receiveTransaction(this.editor.state, parsed, ids));
  }

  destroy(): void {
    this.editor.destroy();
  }
}

/**
 * The server, exactly as `LiveHub` drives it: submit at the head of the room, broadcast what
 * was accepted to everyone including the sender, say nothing at all when a batch is stale.
 */
class Wire {
  readonly rooms = new DocRooms();
  readonly peers: Peer[] = [];
  /** Accepted batches that are still in flight, so the tests can hold a broadcast back. */
  readonly inFlight: DocStep[][] = [];

  join(peer: Peer, markdown: string): void {
    this.rooms.open(PATH, peer.id, { markdown, title: 'Live', rev: 'rev-1' });
    this.peers.push(peer);
  }

  /** Offer a peer's unconfirmed work. Returns false when the room turned it away. */
  send(peer: Peer): boolean {
    const sendable = sendableSteps(peer.editor.state);
    if (sendable === null) return true;
    const result = this.rooms.submit(
      PATH,
      peer.id,
      sendable.version,
      sendable.steps.map((step) => step.toJSON()),
    );
    if (!result.ok) return false;
    this.inFlight.push(result.steps);
    return true;
  }

  /** Hand every accepted batch to every tab, sender included, in the order the room set. */
  deliver(): void {
    const batches = this.inFlight.splice(0, this.inFlight.length);
    for (const batch of batches) {
      for (const peer of this.peers) peer.receive(batch);
    }
  }

  /** Keep offering and delivering until nobody has anything left. */
  settle(): void {
    for (let round = 0; round < 10; round += 1) {
      this.deliver();
      let quiet = true;
      for (const peer of this.peers) {
        if (sendableSteps(peer.editor.state) === null) continue;
        quiet = false;
        this.send(peer);
      }
      this.deliver();
      if (quiet) return;
    }
    throw new Error('the peers never settled');
  }
}

function setup(markdown: string): { wire: Wire; a: Peer; b: Peer } {
  const wire = new Wire();
  const a = new Peer('tab-a', markdown, 0);
  const b = new Peer('tab-b', markdown, 0);
  wire.join(a, markdown);
  wire.join(b, markdown);
  return { wire, a, b };
}

describe('keystroke streaming', () => {
  it('lands one tab’s typing on the other', () => {
    const { wire, a, b } = setup('one\n');
    a.type(a.endOf('one'), ' more');
    wire.settle();

    expect(a.markdown).toBe('one more\n');
    expect(b.markdown).toBe('one more\n');
    a.destroy();
    b.destroy();
  });

  it('merges two people typing in different paragraphs at the same instant', () => {
    const source = 'one\n\ntwo\n\nthree\n';
    const { wire, a, b } = setup(source);

    // Neither has sent anything yet, so both built their steps on version 0.
    a.type(a.startOf('one'), 'ONE ');
    b.type(b.endOf('three'), ' THREE');
    expect(sendableSteps(a.editor.state)?.version).toBe(0);
    expect(sendableSteps(b.editor.state)?.version).toBe(0);

    // A's batch is accepted but still in flight, so B sends without having seen it.
    expect(wire.send(a)).toBe(true);
    expect(wire.send(b)).toBe(false);
    wire.settle();

    expect(a.markdown).toBe('ONE one\n\ntwo\n\nthree THREE\n');
    expect(b.markdown).toBe(a.markdown);
    a.destroy();
    b.destroy();
  });

  it('merges two people typing inside the same paragraph', () => {
    const { wire, a, b } = setup('the quick fox\n');
    a.type(a.startOf('the quick fox'), 'A: ');
    b.type(b.endOf('the quick fox'), ' jumped');
    // Both send on version 0 before either broadcast lands.
    expect(wire.send(a)).toBe(true);
    expect(wire.send(b)).toBe(false);
    wire.settle();

    expect(a.markdown).toBe('A: the quick fox jumped\n');
    expect(b.markdown).toBe(a.markdown);
    a.destroy();
    b.destroy();
  });

  it('keeps both tabs at the same version as the room', () => {
    const { wire, a, b } = setup('one\n');
    a.type(a.endOf('one'), ' x');
    b.type(b.endOf('one'), ' y');
    wire.settle();

    const room = wire.rooms.get(PATH);
    expect(room).not.toBeNull();
    expect(a.version).toBe(versionOf(room!));
    expect(b.version).toBe(versionOf(room!));
    a.destroy();
    b.destroy();
  });

  it('does not disturb the round trip of the markdown it did not touch', () => {
    const source = '# Title\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n';
    const { wire, a, b } = setup(source);
    a.type(a.endOf('Title'), ' Two');
    wire.settle();

    expect(b.markdown).toBe(source.replace('# Title', '# Title Two'));
    expect(a.markdown).toBe(b.markdown);
    a.destroy();
    b.destroy();
  });

  it('gives a tab that joins late the log it missed', () => {
    const { wire, a, b } = setup('one\n');
    a.type(a.endOf('one'), ' more');
    wire.settle();

    const room = wire.rooms.get(PATH)!;
    const late = new Peer('tab-c', room.baseline.markdown, room.baseVersion);
    late.receive(room.steps);
    wire.join(late, room.baseline.markdown);

    expect(late.markdown).toBe('one more\n');
    expect(late.version).toBe(versionOf(room));

    late.type(late.endOf('one more'), '!');
    wire.settle();
    expect(a.markdown).toBe('one more!\n');
    expect(b.markdown).toBe('one more!\n');
    a.destroy();
    b.destroy();
    late.destroy();
  });

  it('starts a compacted room where the old one stopped', () => {
    const { wire, a, b } = setup('one\n');
    a.type(a.endOf('one'), ' more');
    wire.settle();

    // What the writer does after its save lands: report the text now on disk.
    const saved = a.markdown;
    expect(wire.rooms.rebaseline(PATH, 'tab-a', a.version, {
      markdown: saved,
      title: 'Live',
      rev: 'rev-2',
    })).toBe(true);

    const room = wire.rooms.get(PATH)!;
    expect(room.steps).toEqual([]);
    expect(room.baseline.markdown).toBe(saved);

    const late = new Peer('tab-c', room.baseline.markdown, room.baseVersion);
    wire.join(late, room.baseline.markdown);
    expect(late.markdown).toBe(saved);

    // The tabs that were already there never moved, so a new step still reaches everyone.
    late.type(late.endOf('one more'), '?');
    wire.settle();
    expect(a.markdown).toBe('one more?\n');
    expect(b.markdown).toBe('one more?\n');
    a.destroy();
    b.destroy();
    late.destroy();
  });
});
