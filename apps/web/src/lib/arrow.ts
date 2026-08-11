/**
 * `->` becomes `→` while it is typed.
 *
 * The page body gets this from a ProseMirror input rule, next to every other typing rule it has.
 * A plain field carries no ProseMirror plugins, so one listener on the document does the same job
 * for every `input` and `textarea` the app draws. One listener rather than one call per field,
 * because a field that has to ask for the rewrite is a field somebody forgets to ask from.
 */

/** The character the rewrite puts in. */
export const ARROW = '→';

/** The characters the writer types to get it. */
export const ARROW_SOURCE = '->';

/** True when the caret sits directly after a `->` the writer has just finished. */
export function wantsArrow(text: string, caret: number | null): boolean {
  return caret !== null && text.slice(0, caret).endsWith(ARROW_SOURCE);
}

/**
 * Listens for typing across the whole app and rewrites `->` wherever it lands.
 *
 * Returns the call that takes the listener off again.
 */
export function installArrowRewrite(root: Document = document): () => void {
  // An IME builds a word over many events. Tiptap's rule runner stands back for the whole of it
  // and looks once at the end, so this does the same.
  let composing = false;

  const onInput = (event: Event): void => {
    if (composing || !isTyping(event)) return;
    const field = plainTextField(event.target);
    if (field !== null) rewriteArrow(field);
  };

  const onCompositionStart = (): void => {
    composing = true;
  };

  const onCompositionEnd = (event: Event): void => {
    composing = false;
    const field = plainTextField(event.target);
    if (field !== null) rewriteArrow(field);
  };

  root.addEventListener('input', onInput);
  root.addEventListener('compositionstart', onCompositionStart);
  root.addEventListener('compositionend', onCompositionEnd);

  return () => {
    root.removeEventListener('input', onInput);
    root.removeEventListener('compositionstart', onCompositionStart);
    root.removeEventListener('compositionend', onCompositionEnd);
  };
}

/**
 * True for text a person just typed.
 *
 * A paste is left exactly as it arrived, which is what the page body already does: tiptap runs its
 * rules from typing and not from the clipboard. A drop, a delete and the browser's own undo are
 * left alone for the same reason.
 */
function isTyping(event: Event): boolean {
  if (!(event instanceof InputEvent)) return true;
  if (event.isComposing) return false;
  return event.inputType === 'insertText';
}

/**
 * The field an event landed in, when it is one the rewrite belongs in, else null.
 *
 * Every text box is in by default. A box that must keep `->` exactly as typed says so with
 * `data-no-arrow`, or by being something other than plain text in the first place.
 */
function plainTextField(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  const field =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
  if (field === null) return null;
  // An address, a number, a password, a date and a search box each hold something an arrow would
  // spoil, and `type` already says which one this is.
  if (field instanceof HTMLInputElement && field.type !== 'text') return null;
  // Raw markdown, edited as bytes on the way out of a conflict.
  if (field.classList.contains('conflict__editor')) return null;
  // The page body has the ProseMirror rule already; a second rewrite here would fight it.
  return field.closest('[contenteditable=""], [contenteditable="true"], [data-no-arrow]') === null
    ? field
    : null;
}

/**
 * Swaps the `->` in front of the caret for an arrow, when there is one.
 *
 * `execCommand` is deprecated, but it is the one edit path that leaves a field's own undo stack
 * alone and raises a trusted `input` event, so React's controlled value follows along and a single
 * undo gives the writer their `->` back. Where the browser refuses it, `setRangeText` writes the
 * same edit and the event is raised by hand. Neither path goes through the `value` property, which
 * is what React watches to decide a field changed, so React accepts both as a change.
 */
function rewriteArrow(field: HTMLInputElement | HTMLTextAreaElement): void {
  const caret = field.selectionStart;
  if (caret === null || !wantsArrow(field.value, caret)) return;

  const from = caret - ARROW_SOURCE.length;
  field.setSelectionRange(from, caret);
  if (insertText(field)) return;
  field.setRangeText(ARROW, from, caret, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertText(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (typeof document.execCommand !== 'function') return false;
  const before = field.value;
  try {
    return document.execCommand('insertText', false, ARROW) && field.value !== before;
  } catch {
    return false;
  }
}
