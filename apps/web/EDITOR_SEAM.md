# The editor seam

`apps/web/src/editor/` is the only directory of `@gitdocs/web` owned by the editor.
Everything else - routing, data fetching, saving, the sidebar, the details panel, the
command palette - is the shell. The two meet at exactly one component.

The shell currently ships a placeholder implementation (a title `<input>` and a markdown
`<textarea>`) so the app builds and the seam is exercised end to end. Replace the body of
that component with the real block editor. **Do not change the props.**

---

## 1. The contract

`src/editor/index.tsx` must export `PageEditor` as a **named** export and as the **default**
export, with this exact signature:

```ts
import type { Page } from '@gitdocs/shared';
import type { SaveState } from '../lib/autosave';

export interface PageEditorProps {
  page: Page;
  onChange: (markdown: string) => void;
  onTitleChange: (title: string) => void;
  saveState: SaveState;
}

export function PageEditor(props: PageEditorProps): JSX.Element;
export default PageEditor;
```

The shell calls it from `src/routes/PageRoute.tsx` like this, and nothing else:

```tsx
<PageEditor
  page={page}
  saveState={autosave.saveState}
  onChange={(markdown) => autosave.queue({ markdown })}
  onTitleChange={(title) => autosave.queue({ title })}
/>
```

### `page: Page`

The full page from `GET /api/v1/pages?path=...`, typed by `@gitdocs/shared`:

| field | meaning for the editor |
| --- | --- |
| `id` | The identity of the document. **The only signal that the content must be reloaded.** |
| `title` | Initial title. |
| `markdown` | Initial body, **without** frontmatter. |
| `icon` | Optional emoji. The placeholder renders it left of the title. |
| `path`, `space`, `tags`, `props`, `created`, `updated`, `hasChildren` | Metadata. The details panel owns these; the editor may read them but must not write them. |

### `onChange(markdown)`

Call it with the **complete markdown body** after every edit, not a diff and not a
fragment. The shell debounces the calls, so calling on every keystroke is correct and
cheap. Never call it during the initial mount or while loading a different page: an
unprompted call marks the page dirty and triggers a PATCH.

### `onTitleChange(title)`

Same rules, for the title only. Send the plain string, without a leading `#`.

### `saveState`

`'idle' | 'saving' | 'saved' | 'error'`, imported from `../lib/autosave`. Render it with
the shared `SaveIndicator` component (`src/components/ui/SaveIndicator.tsx`) or with your
own indicator. It is display only.

---

## 2. Rules the editor must follow

1. **Resync on `page.id` only.** `page` is a new object after every successful save. If
   the editor resets its content whenever `page.markdown` changes, every save yanks the
   cursor back. The placeholder shows the pattern:

   ```ts
   const loadedId = useRef(page.id);
   useEffect(() => {
     if (loadedId.current === page.id) return;
     loadedId.current = page.id;
     // load page.title and page.markdown into the editor
   }, [page.id, page.title, page.markdown]);
   ```

2. **Do not save.** No `fetch`, no `api.updatePage`, no mutation hooks. Autosave, retry,
   backoff and the unload warning all live in `src/lib/autosave.ts` and
   `src/lib/useAutosave.ts`. A second saver would race the first.

3. **Do not navigate.** Internal page links must go through `pageHref(path)` from
   `src/lib/href.ts` and `useNavigate` or an `<a href>`; do not touch `window.location`.

4. **Markdown is the wire format.** The file on disk is markdown, and agents edit it
   directly. Round-trip stability matters more than feature count: parsing a document and
   serialising it back with no edit must return byte-identical markdown wherever possible.
   Do not invent syntax that a plain markdown reader cannot understand.

5. **Scope your CSS.** Use the design tokens in `src/styles/tokens.css`. Prefix every class
   with `editor__` or `gd-editor-`, and put the styles in `src/editor/*.css`. Never
   restyle the shell's classes (`.app-*`, `.sidebar*`, `.palette*`, `.meta*`).

6. **Theme.** Read colours from the tokens only. Both themes must work; the root element
   carries `data-theme="light" | "dark"`, or nothing when the viewer follows the system.

---

## 3. What the shell already gives you

| need | use this |
| --- | --- |
| Save status | `SaveState` from `src/lib/autosave.ts`, `SaveIndicator` from `src/components/ui/SaveIndicator.tsx` |
| Image and file upload | `useUploadAsset()` from `src/api/hooks.ts`; it returns `{ url, path }`. Insert the returned `url`. |
| Full-text search (for `@`-mentions and link pickers) | `useSearch({ q, limit })` from `src/api/hooks.ts` |
| The page tree (for a link picker) | `useWorkspace().spaces` from `src/lib/workspace.tsx` |
| Link to another page | `pageHref(path)` from `src/lib/href.ts` |
| Toasts | `useToast()` from `src/lib/toast.tsx` |
| Debounce a value | `useDebouncedValue(value, ms)` from `src/lib/useDebouncedValue.ts` |
| Dialogs | `PromptDialog`, `ConfirmDialog` in `src/components/ui/` |
| Icons | `src/components/ui/Icon.tsx` |

Server assets are served under `/_assets/...`; the Vite dev server proxies that prefix
along with `/api`.

---

## 4. Dependencies already declared

`apps/web/package.json` lists these for the editor. Do not add another editor framework,
and do not add a UI framework (no Tailwind, no MUI); the shell is plain CSS.

- `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/suggestion`
- Extensions: `bubble-menu`, `character-count`, `code-block-lowlight`, `color`,
  `dropcursor`, `floating-menu`, `gapcursor`, `highlight`, `horizontal-rule`, `image`,
  `link`, `placeholder`, `table`, `table-cell`, `table-header`, `table-row`, `task-item`,
  `task-list`, `text-align`, `text-style`, `typography`, `underline`
- `tiptap-markdown` (markdown in and out)
- `lowlight` and `highlight.js` (code block highlighting)
- `tippy.js` (slash menu and bubble menu positioning)

Add anything else you need to `apps/web/package.json`, but **do not run `pnpm install`**;
a later integration step installs the whole workspace once.

---

## 5. Keyboard shortcuts the shell owns

Do not bind these inside the editor; they are handled on `window` and must keep working
while the editor has focus.

| shortcut | action |
| --- | --- |
| `Cmd/Ctrl + K` | Command palette |
| `Cmd/Ctrl + S` | Flush the pending save |
| `Cmd/Ctrl + \` | Toggle the sidebar |
| `Cmd/Ctrl + Shift + .` | Toggle the details panel |

Everything else inside the content area is yours, including `/` for the slash menu.

---

## 6. Definition of done

- `pnpm --filter @gitdocs/web typecheck` passes, with no `as any` and no `@ts-ignore`.
- `pnpm --filter @gitdocs/web test` passes; the shell's tests in `apps/web/test/` must not
  need edits.
- Typing in the editor produces exactly one PATCH per burst, and the save indicator moves
  `saving -> saved -> idle`.
- Switching pages in the sidebar loads the new content and never mixes two documents.
