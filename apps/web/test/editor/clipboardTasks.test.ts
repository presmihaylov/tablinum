import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { createTestEditor, toMarkdown } from './harness';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

interface Copied {
  html: string;
  text: string;
}

/** Select everything and run it through the real clipboard props, exactly as a copy does. */
function copyAll(instance: Editor): Copied {
  instance.commands.selectAll();
  const copied = instance.view.serializeForClipboard(instance.state.selection.content());
  return { html: copied.dom.innerHTML, text: copied.text };
}

function open(markdown: string): Editor {
  editor = createTestEditor(markdown);
  return editor;
}

/** The `<li>` elements of the copied HTML, read back as DOM. */
function items(html: string): HTMLLIElement[] {
  const host = document.createElement('div');
  host.innerHTML = html;
  return Array.from(host.querySelectorAll('li'));
}

// A nested list is allowed inside an item, and the test below asserts one. Only the tags an
// importer reads as a block of its own are forbidden.
const BLOCK_TAGS = 'p, div, blockquote, pre, h1, h2, h3, h4, h5, h6, table';

describe('copying a task list', () => {
  it('writes one flat li per item, with the checkbox inline', () => {
    const { html } = copyAll(open('- [ ] Setup and test notifications\n- [x] Ship it\n'));
    const copied = items(html);
    expect(copied).toHaveLength(2);
    expect(copied.map((item) => item.getAttribute('data-type'))).toEqual(['taskItem', 'taskItem']);
    expect(copied.map((item) => item.getAttribute('data-checked'))).toEqual(['false', 'true']);
    const boxes = copied.map((item) => item.firstElementChild);
    expect(boxes.map((box) => box?.tagName)).toEqual(['INPUT', 'INPUT']);
    expect(boxes.map((box) => box?.getAttribute('type'))).toEqual(['checkbox', 'checkbox']);
    expect(boxes.map((box) => box?.hasAttribute('checked'))).toEqual([false, true]);
    expect(copied.map((item) => item.textContent)).toEqual([
      'Setup and test notifications',
      'Ship it',
    ]);
  });

  it('puts no block-level element inside an item', () => {
    const { html } = copyAll(open('- [ ] Setup and test notifications\n- [x] Ship it\n'));
    for (const item of items(html)) {
      expect(item.querySelector(BLOCK_TAGS)).toBeNull();
    }
  });

  it('keeps the marks on the label', () => {
    const { html } = copyAll(open('- [ ] Ship **now**, not [later](https://example.com)\n'));
    const [item] = items(html);
    expect(item?.querySelector('strong')?.textContent).toBe('now');
    expect(item?.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(item?.querySelector('p')).toBeNull();
  });

  it('nests a sub-list inside the item that owns it', () => {
    const { html } = copyAll(open('- [x] Ship it\n  - [ ] Push the tag\n'));
    const [outer] = items(html);
    expect(outer?.firstElementChild?.tagName).toBe('INPUT');
    expect(outer?.querySelector('ul > li')?.textContent).toBe('Push the tag');
    expect(outer?.querySelector('p')).toBeNull();
  });

  it('writes the plain-text half as markdown, one line per item', () => {
    const { text } = copyAll(
      open('- [ ] Setup and test notifications\n- [x] Ship it\n- [ ] Tell the team\n'),
    );
    expect(text).toBe(
      '- [ ] Setup and test notifications\n- [x] Ship it\n- [ ] Tell the team',
    );
  });

  it('leaves an ordinary bullet list alone', () => {
    const { html } = copyAll(open('- Freeze the branch\n- Tag the release\n'));
    expect(html).toContain('<li data-gd-gap="0"><p>Freeze the branch</p></li>');
    expect(html).not.toContain('checkbox');
  });
});

describe('pasting a copied task list back into tablinum', () => {
  const SOURCE = '- [ ] Setup and test notifications\n- [x] Ship **it**\n  - [ ] Push the tag\n';

  /** Copy out of one editor and paste into an empty one, then read the markdown back. */
  function copyAndPaste(source: string): string {
    const { html } = copyAll(open(source));
    const target = createTestEditor('');
    try {
      target.view.pasteHTML(html);
      return toMarkdown(target);
    } finally {
      target.destroy();
    }
  }

  it('comes back as a task list, not a list plus loose paragraphs', () => {
    expect(copyAndPaste(SOURCE)).toBe(SOURCE);
  });

  it('keeps the case of an upper-case checkmark', () => {
    expect(copyAndPaste('- [X] a\n')).toBe('- [X] a\n');
  });

  it('keeps the source numbers of an ordered task list', () => {
    expect(copyAndPaste('1. [ ] a\n1. [x] b\n')).toBe('1. [ ] a\n1. [x] b\n');
  });

  it('opens no paragraph outside a task item', () => {
    const { html } = copyAll(open(SOURCE));
    const target = createTestEditor('');
    try {
      target.view.pasteHTML(html);
      const names: string[] = [];
      target.state.doc.forEach((node) => names.push(node.type.name));
      expect(names).toEqual(['taskList']);
    } finally {
      target.destroy();
    }
  });
});
