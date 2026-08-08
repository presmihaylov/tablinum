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
import { pageHref } from '../lib/href';
import { useToast } from '../lib/toast';
import type { SaveState } from '../lib/autosave';
import { PromptDialog } from '../components/ui/PromptDialog';
import type { PromptRequest } from '../components/ui/PromptDialog';
import { SaveIndicator } from '../components/ui/SaveIndicator';
import { EMBED_PROVIDERS, embedHtml, resolveEmbed } from './embeds';
import { buildExtensions } from './extensions';
import type { EmbeddedPage, WikilinkItem } from './extensions';
import { DEFAULT_FRAME, PARSE_OPTIONS, readMarkdown, writeMarkdown } from './markdown';
import type { MarkdownFrame } from './markdown';
import { BlockHandles } from './ui/BlockHandles';
import { EmojiPicker } from './ui/EmojiPicker';
import type { EmojiAnchor } from './ui/EmojiPicker';
import { MarkMenu } from './ui/MarkMenu';
import { PagePicker } from './ui/PagePicker';
import { PageTitle } from './ui/PageTitle';
import { TableControls } from './ui/TableControls';
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
  pickVideo: () => void;
  pickPage: () => void;
  insertVideo: (url: string) => void;
  upload: (file: File) => Promise<string | null>;
  search: (query: string) => Promise<WikilinkItem[]>;
  load: (path: string) => Promise<EmbeddedPage | null>;
  open: (path: string) => void;
}

const SEARCH_LIMIT = 8;

export function PageEditor({ page, onChange, onTitleChange, saveState }: PageEditorProps) {
  const [title, setTitle] = useState(page.title);
  const [emojiAt, setEmojiAt] = useState<EmojiAnchor | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);

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

  const loadPage = useCallback(
    async (path: string): Promise<EmbeddedPage | null> => {
      const target = path.trim().replace(/^\/+/, '');
      if (target.length === 0) return null;
      try {
        const data = await client.fetchQuery({
          queryKey: qk.pageByPath(target),
          queryFn: ({ signal }) => api.getPageByPath(target, signal),
          staleTime: 5_000,
        });
        return {
          path: data.page.path,
          title: data.page.title,
          icon: data.page.icon ?? null,
          markdown: data.page.markdown,
        };
      } catch {
        return null;
      }
    },
    [client],
  );

  const openPage = useCallback(
    (path: string): void => {
      const target = path.trim().replace(/^\/+/, '');
      if (target.length === 0) return;
      navigate(pageHref(target));
    },
    [navigate],
  );

  const insertVideo = useCallback(
    (url: string): void => {
      const embed = resolveEmbed(url);
      if (embed === null) {
        toast.push(`That link cannot be embedded. Try ${EMBED_PROVIDERS.join(', ')}.`, 'error');
        return;
      }
      editorRef.current
        ?.chain()
        .focus()
        .insertContent({ type: 'htmlBlock', attrs: { raw: embedHtml(embed) } })
        .run();
    },
    [toast],
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
    pickVideo: () => undefined,
    pickPage: () => undefined,
    insertVideo: () => undefined,
    upload: () => Promise.resolve(null),
    search: () => Promise.resolve([]),
    load: () => Promise.resolve(null),
    open: () => undefined,
  });
  handlers.current = {
    pickImage: () => fileRef.current?.click(),
    pickEmoji: openEmoji,
    pickVideo: () => setVideoOpen(true),
    pickPage: () => setPageOpen(true),
    insertVideo,
    upload: uploadImage,
    search: searchPages,
    load: loadPage,
    open: openPage,
  };

  // Built once: rebuilding the extension list would recreate the whole schema.
  const extensions = useMemo(
    () =>
      buildExtensions({
        onPickImage: () => handlers.current.pickImage(),
        onPickEmoji: () => handlers.current.pickEmoji(),
        onPickVideo: () => handlers.current.pickVideo(),
        onPickPage: () => handlers.current.pickPage(),
        uploadImage: (file) => handlers.current.upload(file),
        searchPages: (query) => handlers.current.search(query),
        loadPage: (path) => handlers.current.load(path),
        openPage: (path) => handlers.current.open(path),
      }),
    [],
  );

  const editor = useEditor({
    extensions,
    content: readMarkdown(page.markdown).body,
    parseOptions: PARSE_OPTIONS,
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
    setVideoOpen(false);
    setPageOpen(false);
    editor?.commands.setContent(readMarkdown(page.markdown).body, false, PARSE_OPTIONS);
  }, [page.id, page.title, page.markdown, editor]);

  // Held steady while the dialog is open: a new object resets the field the user types in.
  const videoRequest = useMemo<PromptRequest | null>(
    () =>
      videoOpen
        ? {
            title: 'Embed a video',
            label: 'Video link',
            confirmLabel: 'Embed',
            placeholder: 'https://www.youtube.com/watch?v=…',
            onConfirm: (url) => handlers.current.insertVideo(url),
          }
        : null,
    [videoOpen],
  );

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
        {editor ? <TableControls editor={editor} canvas={canvasRef} /> : null}
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

      <PromptDialog request={videoRequest} onClose={() => setVideoOpen(false)} />

      <PagePicker
        open={pageOpen}
        search={searchPages}
        onClose={() => setPageOpen(false)}
        onPick={(path) => editorRef.current?.chain().focus().insertPageEmbed(path).run()}
      />

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
