import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { collab, getVersion, receiveTransaction, sendableSteps } from '@tiptap/pm/collab';
import type { Transaction } from '@tiptap/pm/state';
import { Step } from '@tiptap/pm/transform';
import { mergeText, type DocStep, type Page } from '@tablinum/shared';
import type { DocInit, DocRoom } from '../lib/docRoom';
import { myClientId } from '../lib/identity';
import { caretsKey, clearCarets, dropCaret, remoteCarets, setCaret } from './carets';
import { PARSE_OPTIONS, readMarkdown, writeMarkdown } from './markdown';
import type { MarkdownFrame } from './markdown';

/** Batch a fast typist's steps into one frame instead of one frame per keystroke. */
const SEND_STEPS_MS = 40;

/** A caret moves far more often than it needs to be redrawn on somebody else's screen. */
const SEND_CARET_MS = 120;

export interface StreamOptions {
  editor: Editor | null;
  /** Null when the live channel is off, which leaves the plain autosave path in charge. */
  room: DocRoom | null;
  /** The whitespace frame of the file, kept in step with whatever the stream puts on screen. */
  frame: MutableRefObject<MarkdownFrame>;
  /** The page as the server last confirmed it, used to compact the room's step log. */
  page: Page;
  /** A title that arrived with a baseline, so a rename made elsewhere shows here. */
  onTitle: (title: string) => void;
}

/**
 * Keystroke streaming for one page.
 *
 * The server orders steps and does nothing else, so the schema never leaves the browser and
 * the file on disk stays plain markdown. Each tab rebases its own unconfirmed work, which is
 * what makes two people typing in the same paragraph safe.
 */
export function useDocStream({ editor, room, frame, page, onTitle }: StreamOptions): void {
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;

  /** The baseline this tab is working from, which is the base of the merge after a reset. */
  const baseRef = useRef<string | null>(null);

  useEffect(() => {
    if (editor === null || room === null) return;

    const clientId = myClientId();
    editor.registerPlugin(remoteCarets());
    let stepTimer: ReturnType<typeof setTimeout> | null = null;
    let caretTimer: ReturnType<typeof setTimeout> | null = null;
    let live = true;

    const parse = (steps: DocStep[]): { steps: Step[]; ids: string[] } => {
      const parsed: Step[] = [];
      const ids: string[] = [];
      for (const entry of steps) {
        try {
          parsed.push(Step.fromJSON(editor.schema, entry.step));
          ids.push(entry.client);
        } catch {
          // A step this build cannot read means two tabs disagree about the schema. Applying
          // part of a batch would corrupt the document, so none of it is applied.
          return { steps: [], ids: [] };
        }
      }
      return { steps: parsed, ids };
    };

    const flushSteps = (): void => {
      stepTimer = null;
      if (!live) return;
      const sendable = sendableSteps(editor.state);
      if (sendable === null) return;
      room.sendSteps(
        sendable.version,
        sendable.steps.map((step) => step.toJSON()),
      );
    };

    const scheduleSteps = (): void => {
      if (stepTimer !== null || !live) return;
      stepTimer = setTimeout(flushSteps, SEND_STEPS_MS);
    };

    const scheduleCaret = (): void => {
      if (caretTimer !== null || !live) return;
      caretTimer = setTimeout(() => {
        caretTimer = null;
        if (!live) return;
        const { anchor, head } = editor.state.selection;
        room.sendCaret(anchor, head);
      }, SEND_CARET_MS);
    };

    /** Replace the document and restart the step counter at the authority's version. */
    const seed = (markdown: string, version: number, emit: boolean): void => {
      editor.unregisterPlugin('collab');
      const read = readMarkdown(markdown);
      frame.current = read.frame;
      editor.commands.setContent(read.body, emit, PARSE_OPTIONS);
      editor.registerPlugin(collab({ version, clientID: clientId }));
      clearCarets(editor.view);
    };

    const onInit = (init: DocInit): void => {
      const previousBase = baseRef.current;
      // Whatever is on screen right now. On the first join that is the page as it loaded;
      // on a rejoin it is this tab's work, which the room below has never seen.
      const carried = writeMarkdown(editor.state.doc, frame.current);

      seed(init.baseline.markdown, init.baseVersion, false);
      const parsed = parse(init.steps);
      if (parsed.steps.length > 0) {
        editor.view.dispatch(receiveTransaction(editor.state, parsed.steps, parsed.ids));
      }
      baseRef.current = init.baseline.markdown;
      onTitleRef.current(init.baseline.title);

      // Fold this tab's work back in. Only the tab that writes the file does it, or every
      // tab applies the same merge and they all fight to save it.
      if (!room.isWriter) return;
      const shared = writeMarkdown(editor.state.doc, frame.current);
      if (carried === shared) return;

      const merged = mergeText(previousBase ?? shared, carried, shared, {
        ours: 'your edits',
        theirs: 'the file on disk',
      });
      // A merge that clashes keeps this tab's text. Saving it is rejected by the server,
      // which opens the conflict dialog the shell already has.
      const text = merged.clean ? merged.text : carried;
      if (text === shared) return;

      const read = readMarkdown(text);
      frame.current = read.frame;
      editor.commands.setContent(read.body, true, PARSE_OPTIONS);
      scheduleSteps();
    };

    const off = room.listen({
      onInit,
      onSteps: (steps) => {
        const parsed = parse(steps);
        if (parsed.steps.length === 0) return;
        editor.view.dispatch(receiveTransaction(editor.state, parsed.steps, parsed.ids));
        // Our own work may have been turned away while these were in flight. Now that this
        // tab is back at the head of the room, offer it again.
        scheduleSteps();
      },
      onCaret: (caret) => setCaret(editor.view, caret),
      onLeft: (client) => dropCaret(editor.view, client),
      // What is on screen stays there and is merged into the new baseline on the way back in.
      onReset: () => room.rejoin(),
    });

    const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
      if (transaction.docChanged) scheduleSteps();
      if (transaction.selectionSet || transaction.docChanged) scheduleCaret();
    };
    editor.on('transaction', onTransaction);

    return () => {
      live = false;
      editor.off('transaction', onTransaction);
      if (stepTimer !== null) clearTimeout(stepTimer);
      if (caretTimer !== null) clearTimeout(caretTimer);
      off();
      baseRef.current = null;
      if (editor.isDestroyed) return;
      editor.unregisterPlugin(caretsKey);
      editor.unregisterPlugin('collab');
    };
  }, [editor, room, frame]);

  /**
   * Compact the room once a save lands. It is only truthful while the document on screen is
   * exactly the text the server confirmed, so a tab that has typed on since simply waits for
   * the next quiet moment.
   */
  useEffect(() => {
    if (editor === null || room === null || !room.joined || !room.isWriter) return;
    if (writeMarkdown(editor.state.doc, frame.current) !== page.markdown) return;
    room.sendBaseline(getVersion(editor.state), {
      markdown: page.markdown,
      title: page.title,
      rev: page.rev,
    });
    baseRef.current = page.markdown;
  }, [editor, room, frame, page.rev, page.markdown, page.title]);
}
