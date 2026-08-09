import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { Page } from '@tablinum/shared';
import { api } from '../api/client';
import { useCreatePage, useTree, useUploadAsset, useUsers } from '../api/hooks';
import { qk } from '../api/keys';
import { pageHref } from '../lib/href';
import { useToast } from '../lib/toast';
import { childPathFor } from '../lib/treeMove';
import type { SaveState } from '../lib/autosave';
import type { DocRoom } from '../lib/docRoom';
import type { IncomingContent } from '../lib/usePageDoc';
import { PromptDialog } from '../components/ui/PromptDialog';
import type { PromptRequest } from '../components/ui/PromptDialog';
import { SaveIndicator } from '../components/ui/SaveIndicator';
import { EMBED_PROVIDERS, embedHtml, resolveEmbed } from './embeds';
import { buildExtensions, insertEmoji } from './extensions';
import type { EmbeddedPage, MentionItem, WikilinkItem } from './extensions';
import { DEFAULT_FRAME, PARSE_OPTIONS, readMarkdown, writeMarkdown } from './markdown';
import type { MarkdownFrame } from './markdown';
import { useDocStream } from './useStream';
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
  /**
   * Text merged from another writer. The editor replaces its content whenever `token` changes,
   * and must not report the replacement back through `onChange`.
   */
  incoming?: IncomingContent | null;
  /**
   * The page's step stream. When it is present the editor streams every keystroke through it
   * and draws the other people's carets. Without it the editor behaves exactly as before.
   */
  room?: DocRoom | null;
  /**
   * Called when the page icon is picked, or cleared with null. Without it the icon on the
   * title row stays read only.
   */
  onIconChange?: (icon: string | null) => void;
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
  people: (query: string) => Promise<MentionItem[]>;
  load: (path: string) => Promise<EmbeddedPage | null>;
  open: (path: string) => void;
}

const SEARCH_LIMIT = 8;

export function PageEditor({
  page,
  onChange,
  onTitleChange,
  saveState,
  incoming,
  room,
  onIconChange,
}: PageEditorProps) {
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState<string | null>(page.icon ?? null);
  const [emojiAt, setEmojiAt] = useState<EmojiAnchor | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const loadedId = useRef(page.id);
  const adoptedToken = useRef(incoming?.token ?? 0);
  const frameRef = useRef<MarkdownFrame>(initialFrame(page.markdown));
  const lastSent = useRef(page.markdown);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const uploadAsset = useUploadAsset();
  const createPage = useCreatePage();
  const tree = useTree();
  const spaces = useMemo(() => tree.data?.spaces ?? [], [tree.data]);
  const users = useUsers();
  const peopleRef = useRef(users.data?.users ?? []);
  peopleRef.current = users.data?.users ?? [];

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

  // The roster is small and already cached, so the `@` menu filters it in the browser.
  const searchPeople = useCallback(async (query: string): Promise<MentionItem[]> => {
    const text = query.trim().toLowerCase();
    return peopleRef.current
      .filter((person) => !person.disabled)
      .filter(
        (person) =>
          text.length === 0 ||
          person.handle.includes(text) ||
          person.name.toLowerCase().includes(text),
      )
      .slice(0, SEARCH_LIMIT)
      .map((person) => ({
        id: person.id,
        handle: person.handle,
        name: person.name,
        color: person.color,
        avatarRev: person.avatarRev,
      }));
  }, []);

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

  // The embed points at a page, so the page has to exist before the node goes in.
  const createAndEmbed = useCallback(
    (title: string): void => {
      createPage.mutate(
        { path: childPathFor(spaces, page.path, title), title },
        {
          onSuccess: (data) => {
            editorRef.current?.chain().focus().insertPageEmbed(data.page.path).run();
          },
          onError: (error) => toast.pushError(error, 'The page could not be created'),
        },
      );
    },
    [createPage, spaces, page.path, toast],
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
    people: () => Promise.resolve([]),
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
    people: searchPeople,
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
        searchPeople: (query) => handlers.current.people(query),
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
    setIcon(page.icon ?? null);
    setEmojiAt(null);
    setVideoOpen(false);
    setPageOpen(false);
    editor?.commands.setContent(readMarkdown(page.markdown).body, false, PARSE_OPTIONS);
  }, [page.id, page.title, page.icon, page.markdown, editor]);

  // Someone else changed the page. The shell already merged the two edits; this only
  // puts the result on screen, with the caret left as close to where it was as possible.
  useEffect(() => {
    if (!editor || !incoming || incoming.token === adoptedToken.current) return;
    adoptedToken.current = incoming.token;
    frameRef.current = initialFrame(incoming.markdown);
    lastSent.current = incoming.markdown;
    setTitle(incoming.title);

    const { from, to } = editor.state.selection;
    editor.commands.setContent(readMarkdown(incoming.markdown).body, false, PARSE_OPTIONS);
    const end = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
  }, [incoming, editor]);

  // Keystroke streaming. It owns the document while a room is joined: it replaces content,
  // keeps the frame, and draws the other carets. Without a room nothing here runs.
  useDocStream({ editor, room: room ?? null, frame: frameRef, page, onTitle: setTitle });

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

  // Shown at once: the save is debounced, and the icon should not lag a click by a second.
  const changeIcon = (value: string | null): void => {
    setIcon(value);
    onIconChange?.(value);
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
          icon={icon}
          onChange={changeTitle}
          onLeave={() => editor?.commands.focus('start')}
          {...(onIconChange ? { onIconChange: changeIcon } : {})}
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
            insertEmoji(editorRef.current, emoji);
          }}
        />
      ) : null}

      <PromptDialog request={videoRequest} onClose={() => setVideoOpen(false)} />

      <PagePicker
        open={pageOpen}
        search={searchPages}
        onClose={() => setPageOpen(false)}
        onPick={(path) => editorRef.current?.chain().focus().insertPageEmbed(path).run()}
        onCreate={createAndEmbed}
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
