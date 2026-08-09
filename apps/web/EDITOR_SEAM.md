# The editor seam

`apps/web/src/editor/` is the only directory of `@gitdocs/web` owned by the editor.
Everything else - routing, data fetching, saving, the sidebar, the details panel, the
command palette - is the shell. The two meet at exactly one component.

The shell currently ships a placeholder implementation (a title `<input>` and a markdown
`<textarea>`) so the app builds and the seam is exercised end to end. Replace the body of
that component with the real block editor. **Do not change the props.**

Three amendments since that rule was written, all **optional** props. `incoming` lets live
collaboration put another person's merged text on screen. `room` lets the editor stream every
keystroke and draw the other people's carets. `onIconChange` lets the person pick the page icon.
An editor that ignores any of them still works: it just will not follow a change made elsewhere,
it will save whole documents instead of streaming them, and its icon stays read only. See
section 1.

---

## 1. The contract

`src/editor/index.tsx` must export `PageEditor` as a **named** export and as the **default**
export, with this exact signature:

```ts
import type { Page } from '@gitdocs/shared';
import type { SaveState } from '../lib/autosave';
import type { DocRoom } from '../lib/docRoom';
import type { IncomingContent } from '../lib/usePageDoc';

export interface PageEditorProps {
  page: Page;
  onChange: (markdown: string) => void;
  onTitleChange: (title: string) => void;
  saveState: SaveState;
  incoming?: IncomingContent | null;
  room?: DocRoom | null;
  onIconChange?: (icon: string | null) => void;
}

export function PageEditor(props: PageEditorProps): JSX.Element;
export default PageEditor;
```

The shell calls it from `src/routes/PageRoute.tsx` like this, and nothing else:

```tsx
<PageEditor
  page={page}
  saveState={doc.saveState}
  incoming={doc.incoming}
  room={doc.room}
  onChange={doc.queueMarkdown}
  onTitleChange={doc.queueTitle}
  onIconChange={doc.queueIcon}
/>
```

### `page: Page`

The full page from `GET /api/v1/pages?path=...`, typed by `@gitdocs/shared`:

| field | meaning for the editor |
| --- | --- |
| `id` | The identity of the document. **The only signal that the content must be reloaded.** |
| `title` | Initial title. |
| `markdown` | Initial body, **without** frontmatter. |
| `icon` | Optional emoji, shown above the title. Editable through `onIconChange`. |
| `path`, `space`, `created`, `updated`, `hasChildren` | Metadata. The details panel owns these; the editor may read them but must not write them. |

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

### `incoming` (optional)

`{ markdown, title, token } | null`. Text that another writer produced, already merged with
whatever this tab holds. Adopt it **only when `token` changes**, because the object identity
changes on every render:

```ts
const adopted = useRef(incoming?.token ?? 0);
useEffect(() => {
  if (!incoming || incoming.token === adopted.current) return;
  adopted.current = incoming.token;
  // replace the content, then restore the caret
}, [incoming]);
```

Two rules apply to the replacement. **Never call `onChange` for it**: the shell already holds
this text, and reporting it back starts a save loop. **Keep the caret** as close to where it
was as the new document allows, or the person typing loses their place mid-sentence.

### `room` (optional)

`DocRoom | null`. The page's step stream, or null while the live channel is off. It moves opaque
step JSON and carets between this tab and the server; it holds no document of its own, because
the ProseMirror state lives in the editor.

`src/editor/useStream.ts` implements the whole of it, and `src/editor/carets.ts` draws the
carets. An editor that does not want to stream simply ignores the prop.

Three rules apply.

1. **The server never parses a step.** Send `step.toJSON()` and nothing else. Keeping the schema
   out of the server is what keeps markdown the only thing on disk.
2. **Steps are accepted only at the head of the room.** A rejected batch is not an error: rebase
   against the steps that arrive next and offer it again. `prosemirror-collab` does this for you.
3. **`room.isWriter` decides who saves.** A tab that is not the writer must still call `onChange`
   as usual; the shell holds that text and saves it if the pen is handed over.

The seam still owns the file's whitespace. Every replacement the stream makes must set the
`MarkdownFrame` from the text it applied, or the round trip breaks.

### `onIconChange` (optional)

Call it with one emoji to set the page icon, or with `null` to clear it. The shell saves it on the
same debounce as the text, and the icon needs no revision, so it never conflicts. Hold the chosen
icon in local state as well: the round trip takes about a second, and the icon must change under
the click at once. `src/editor/ui/PageTitle.tsx` does both.

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
   `src/lib/usePageDoc.ts`. A second saver would race the first.

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
| Full-text search (for link pickers) | `useSearch({ q, limit })` from `src/api/hooks.ts` |
| The roster (for the `@` menu) | `useUsers()` from `src/api/hooks.ts`; each `Account` carries a `handle` |
| The page tree (for a link picker) | `useWorkspace().spaces` from `src/lib/workspace.tsx` |
| Link to another page | `pageHref(path)` from `src/lib/href.ts` |
| Toasts | `useToast()` from `src/lib/toast.tsx` |
| Debounce a value | `useDebouncedValue(value, ms)` from `src/lib/useDebouncedValue.ts` |
| Dialogs | `PromptDialog`, `ConfirmDialog` in `src/components/ui/` |
| Icons | `src/components/ui/Icon.tsx` |
| The emoji list | `EMOJI` and `filterEmoji(query)` from `src/lib/emoji.ts`; the shell picks space icons from the same list |

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
