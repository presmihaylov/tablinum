import { mergeAttributes } from '@tiptap/core';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';

/**
 * `tiptap-markdown` installs `markdown-it-task-lists` and rewrites the rendered
 * list in its default parse hooks. The dialect handles both itself and keeps the
 * `[X]` casing, so both hooks are shadowed.
 */
export const GitdocsTaskList = TaskList.extend({
  // One markdown list can mix `- [ ] a` with `- b`. Without plain items here the parser splits
  // it into two lists, and saving writes a blank line that turns the tight list loose.
  content: '(taskItem|listItem)+',

  addStorage() {
    return { markdown: { parse: {} } };
  },

  addAttributes() {
    return {
      // `1. [ ] a` is a task list too. Without these the ordered form is parsed as a plain
      // list and its checkboxes are written back as escaped literal brackets.
      ordered: {
        default: false,
        keepOnSplit: true,
        parseHTML: (element: HTMLElement) => element.tagName.toLowerCase() === 'ol',
        renderHTML: () => ({}),
      },
      start: {
        default: 1,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('start');
          if (raw === null) return 1;
          const value = Number.parseInt(raw, 10);
          return Number.isFinite(value) ? value : 1;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes['start'] === 1 || typeof attributes['start'] !== 'number'
            ? {}
            : { start: String(attributes['start']) },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'ul[data-type="taskList"]', priority: 51 },
      { tag: 'ol[data-type="taskList"]', priority: 51 },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const tag = node.attrs['ordered'] === true ? 'ol' : 'ul';
    return [
      tag,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': this.name }),
      0,
    ];
  },
}).configure({ HTMLAttributes: { class: 'gd-editor-tasks' } });

export const GitdocsTaskItem = TaskItem.extend({
  addStorage() {
    return { markdown: { parse: {} } };
  },
}).configure({ nested: true, HTMLAttributes: { class: 'gd-editor-task' } });
