import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { Page } from '@gitdocs/shared';
import { api } from '../api/client';
import { useUploadAsset } from '../api/hooks';
import { qk } from '../api/keys';
import { useToast } from '../lib/toast';
import type { SaveState } from '../lib/autosave';
import { SaveIndicator } from '../components/ui/SaveIndicator';
import { buildExtensions } from './extensions';
import type { WikilinkItem } from './extensions';
import { DEFAULT_FRAME, readMarkdown, writeMarkdown } from './markdown';
import type { MarkdownFrame } from './markdown';
import { BlockHandles } from './ui/BlockHandles';
import { EmojiPicker } from './ui/EmojiPicker';
import type { EmojiAnchor } from './ui/EmojiPicker';
import { MarkMenu } from './ui/MarkMenu';
import { PageTitle } from './ui/PageTitle';
import { TableMenu } from './ui/TableMenu';
import './editor.css';

/**
 * THE EDITOR SEAM. See apps/web/EDITOR_SEAM.md.
 *
 * This signature is frozen: the block editor replaces the body of `PageEditor`,
 * never its props. Saving, routing and data fetching stay in the shell.
 */
export interface PageEditorProps {
  /** The page being edited. Treat `markdown` as initial content, keyed on `page.id`. */
  page: Page;
  /** Called with the full markdown body after every edit. The shell debounces it. */
  onChange: (markdown: string) => void;
  /** Called when the title changes. */
  onTitleChange: (title: string) => void;
  /** Autosave status, for the editor's own indicator. */
  saveState: SaveState;
}

/** Callbacks the extensions hold for the life of the editor, read through a ref. */
interface Handlers {
  pickImage: () => void;
  pickEmoji: () => void;
  upload: (file: File) => Promise<string | null>;
  search: (query: string) => Promise<WikilinkItem[]>;
}

const SEARCH_LIMIT = 8;

export function PageEditor({ page, onChange, onTitleChange, saveState }: PageEditorProps) {
  const [title, setTitle] = useState(page.title);
  const [emojiAt, setEmojiAt] = useState<EmojiAnchor | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const loadedId = useRef(page.id);
  const frameRef = useRef<MarkdownFrame>(initialFrame(page.markdown));
  const lastSent = useRef(page.markdown);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const uploadAsset = useUploadAsset();

  const uploadRef = useRef(uploadAsset.mutateAsync);
  uploadRef.current = uploadAsset.mutateAsync;

  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const asset = await uploadRef.current({ file, pageId: page.id });
        return asset.url;
      } catch (error) {
        toast.pushError(error, 'The image could not be uploaded');
        return null;
      }
    },
    [page.id, toast],
  );

  const searchPages = useCallback(
    async (query: string): Promise<WikilinkItem[]> => {
      const text = query.trim();
      if (text.length === 0) return [];
      const search = { q: text, limit: SEARCH_LIMIT };
      try {
        const data = await client.fetchQuery({
          queryKey: qk.search(search),
          queryFn: ({ signal }) => api.search(search, signal),
          staleTime: 5_000,
        });
        return data.hits.map((hit) => ({ path: hit.path, title: hit.title }));
      } catch {
        return [];
      }
    },
    [client],
  );

  const openEmoji = useCallback((): void => {
    const editor = editorRef.current;
    if (!editor) return;
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    setEmojiAt({ left: coords.left, top: coords.bottom });
  }, []);

  const handlers = useRef<Handlers>({
    pickImage: () => undefined,
    pickEmoji: () => undefined,
    upload: () => Promise.resolve(null),
    search: () => Promise.resolve([]),
  });
  handlers.current = {
    pickImage: () => fileRef.current?.click(),
    pickEmoji: openEmoji,
    upload: uploadImage,
    search: searchPages,
  };

  // Built once: rebuilding the extension list would recreate the whole schema.
  const extensions = useMemo(
    () =>
      buildExtensions({
        onPickImage: () => handlers.current.pickImage(),
        onPickEmoji: () => handlers.current.pickEmoji(),
        uploadImage: (file) => handlers.current.upload(file),
        searchPages: (query) => handlers.current.search(query),
      }),
    [],
  );

  const editor = useEditor({
    extensions,
    content: readMarkdown(page.markdown).body,
    editorProps: {
      attributes: { class: 'gd-editor-surface', spellcheck: 'true' },
    },
    onUpdate: ({ editor: instance }) => {
      const markdown = writeMarkdown(instance.state.doc, frameRef.current);
      if (markdown === lastSent.current) return;
      lastSent.current = markdown;
      onChangeRef.current(markdown);
    },
  });
  editorRef.current = editor;

  // Only a different page replaces local content; a save response must never
  // clobber what is being typed.
  useEffect(() => {
    if (loadedId.current === page.id) return;
    loadedId.current = page.id;
    frameRef.current = initialFrame(page.markdown);
    lastSent.current = page.markdown;
    setTitle(page.title);
    setEmojiAt(null);
    editor?.commands.setContent(readMarkdown(page.markdown).body, false);
  }, [page.id, page.title, page.markdown, editor]);

  const changeTitle = (value: string): void => {
    setTitle(value);
    onTitleChange(value);
  };

  const insertImage = (file: File): void => {
    void uploadImage(file).then((url) => {
      if (!url || !editorRef.current) return;
      editorRef.current.chain().focus().setImage({ src: url, alt: file.name }).run();
    });
  };

  return (
    <article className="editor">
      <header className="editor__head">
        <PageTitle
          value={title}
          icon={page.icon ?? null}
          onChange={changeTitle}
          onLeave={() => editor?.commands.focus('start')}
        />
        <SaveIndicator state={saveState} />
      </header>

      <div className="editor__canvas" ref={canvasRef} onClickCapture={followLink(navigate)}>
        {editor ? <BlockHandles editor={editor} canvas={canvasRef} /> : null}
        <EditorContent editor={editor} className="editor__body" />
        {editor ? <MarkMenu editor={editor} /> : null}
        {editor ? <TableMenu editor={editor} /> : null}
      </div>

      {emojiAt ? (
        <EmojiPicker
          anchor={emojiAt}
          onClose={() => setEmojiAt(null)}
          onPick={(emoji) => {
            setEmojiAt(null);
            editorRef.current?.chain().focus().insertContent(emoji).run();
          }}
        />
      ) : null}

      <input
        ref={fileRef}
        className="editor__file"
        type="file"
        accept="image/*"
        aria-label="Upload an image"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) insertImage(file);
        }}
      />
    </article>
  );
}

/**
 * A brand new page has no bytes to preserve, so it starts with the ordinary
 * frame: no leading blank line and one trailing newline.
 */
function initialFrame(markdown: string): MarkdownFrame {
  if (markdown.trim().length === 0) return DEFAULT_FRAME;
  return readMarkdown(markdown).frame;
}

/** Cmd or Ctrl click follows an internal link; a plain click keeps editing. */
function followLink(navigate: (to: string) => void) {
  return (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (!(event.target instanceof HTMLElement)) return;
    const href = event.target.closest('a')?.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    event.preventDefault();
    navigate(href);
  };
}

export default PageEditor;
