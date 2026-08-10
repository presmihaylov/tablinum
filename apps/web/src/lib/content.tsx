import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { depth, isDescendantOf, parentPath, segments, slugify, spaceOf } from '@tablinum/shared';
import type { PagePath, TreeNode } from '@tablinum/shared';
import { api } from '../api/client';
import {
  useCreatePage,
  useCreateSpace,
  useDeletePage,
  useTree,
  useUpdatePage,
  useUpdateSpace,
} from '../api/hooks';
import { ConfirmDialog, type ConfirmRequest } from '../components/ui/ConfirmDialog';
import { PromptDialog, type PromptRequest } from '../components/ui/PromptDialog';
import { SpaceDialog, type SpaceDialogRequest } from '../components/ui/SpaceDialog';
import {
  SpacePickerDialog,
  type SpaceOption,
  type SpacePickerRequest,
} from '../components/ui/SpacePickerDialog';
import { absolutePageUrl, pageHref, pathFromSplat } from './href';
import { readStored, writeStored } from './storage';
import {
  childPathFor,
  computeMove,
  computeSpaceMove,
  renamedPath,
  type DropPosition,
  type MovePatch,
} from './treeMove';
import { childrenOf, type SpaceTree } from './tree';
import { useToast } from './toast';

const SPACE_KEY = 'space';
const RECENTS_KEY = 'recents';

/** How many pages the Recents bucket keeps. Notion shows about this many. */
const RECENTS_LIMIT = 10;

interface ContentValue {
  spaces: SpaceTree[];
  isLoadingTree: boolean;
  /** Pages opened on this device, newest first. */
  recents: PagePath[];
  currentPath: PagePath;
  currentSpace: string;
  setCurrentSpace: (slug: string) => void;
  newPage: (parent: PagePath | null) => void;
  newSpace: () => void;
  editSpace: (slug: string) => void;
  renamePage: (node: TreeNode) => void;
  duplicatePage: (node: TreeNode) => void;
  deletePage: (node: TreeNode) => void;
  copyLink: (path: PagePath) => void;
  movePage: (sourcePath: PagePath, targetPath: PagePath, position: DropPosition) => void;
  moveToSpace: (node: TreeNode) => void;
}

const ContentContext = createContext<ContentValue | null>(null);

interface MoveOptions {
  message?: string;
  /** Open the page that moved even when another page is on screen. */
  follow?: boolean;
}

export function ContentProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { push, pushError } = useToast();
  const tree = useTree();
  const createPage = useCreatePage();
  const createSpace = useCreateSpace();
  const updatePage = useUpdatePage();
  const updateSpaceMutation = useUpdateSpace();
  const deletePageMutation = useDeletePage();

  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [spacePick, setSpacePick] = useState<SpacePickerRequest | null>(null);
  const [spaceEdit, setSpaceEdit] = useState<SpaceDialogRequest | null>(null);
  const [storedSpace, setStoredSpace] = useState<string>(() => readStored<string>(SPACE_KEY, ''));
  const [recents, setRecents] = useState<PagePath[]>(() => readStored<PagePath[]>(RECENTS_KEY, []));

  const spaces = useMemo<SpaceTree[]>(() => tree.data?.spaces ?? [], [tree.data]);

  const currentPath = useMemo<PagePath>(() => {
    if (!location.pathname.startsWith('/p/')) return '';
    return pathFromSplat(location.pathname.slice('/p/'.length));
  }, [location.pathname]);

  const currentSpace = useMemo(() => {
    const fromPath = segments(currentPath)[0];
    if (fromPath) return fromPath;
    if (storedSpace && spaces.some((space) => space.slug === storedSpace)) return storedSpace;
    return spaces[0]?.slug ?? '';
  }, [currentPath, storedSpace, spaces]);

  const setCurrentSpace = useCallback((slug: string) => {
    setStoredSpace(slug);
    writeStored(SPACE_KEY, slug);
  }, []);

  useEffect(() => {
    if (currentPath === '') return;
    setRecents((prev) => {
      if (prev[0] === currentPath) return prev;
      const next = [currentPath, ...prev.filter((entry) => entry !== currentPath)].slice(0, RECENTS_LIMIT);
      writeStored(RECENTS_KEY, next);
      return next;
    });
  }, [currentPath]);

  const newPage = useCallback(
    (parent: PagePath | null) => {
      const container = parent ?? currentSpace;
      if (!container) {
        push('Create a space first.', 'error');
        return;
      }
      setPrompt({
        title: 'New page',
        label: 'Page title',
        initialValue: 'Untitled',
        confirmLabel: 'Create',
        onConfirm: (title) => {
          createPage.mutate(
            { path: childPathFor(spaces, container, title), title },
            {
              onSuccess: (data) => navigate(pageHref(data.page.path)),
              onError: (error) => pushError(error, 'Could not create the page.'),
            },
          );
        },
      });
    },
    [currentSpace, spaces, createPage, navigate, push, pushError],
  );

  const newSpace = useCallback(() => {
    setSpaceEdit({
      title: 'New space',
      confirmLabel: 'Create',
      onConfirm: ({ name, icon }) => {
        const slug = slugify(name);
        createSpace.mutate(
          { slug, name, ...(icon ? { icon } : {}) },
          {
            onSuccess: (data) => {
              setCurrentSpace(data.space.slug);
              // The server gives the space a home page, so open it right away.
              navigate(pageHref(data.space.slug));
              push(`Space "${data.space.name}" created.`, 'success');
            },
            onError: (error) => pushError(error, 'Could not create the space.'),
          },
        );
      },
    });
  }, [createSpace, navigate, push, pushError, setCurrentSpace]);

  const editSpace = useCallback(
    (slug: string) => {
      const space = spaces.find((candidate) => candidate.slug === slug);
      if (!space) return;
      setSpaceEdit({
        title: 'Edit space',
        confirmLabel: 'Save',
        initialName: space.name,
        initialIcon: space.icon ?? null,
        onConfirm: ({ name, icon }) => {
          updateSpaceMutation.mutate(
            { slug, body: { name, icon } },
            {
              onSuccess: () => push('Space updated.', 'success'),
              onError: (error) => pushError(error, 'Could not update the space.'),
            },
          );
        },
      });
    },
    [spaces, updateSpaceMutation, push, pushError],
  );

  const renamePage = useCallback(
    (node: TreeNode) => {
      setPrompt({
        title: 'Rename page',
        label: 'Page title',
        initialValue: node.title,
        confirmLabel: 'Rename',
        onConfirm: (title) => {
          const nextPath = renamedPath(spaces, node.path, title);
          const body = nextPath === node.path ? { title } : { title, path: nextPath };
          updatePage.mutate(
            { id: node.id, body },
            {
              onSuccess: (data) => {
                if (currentPath === node.path || isDescendantOf(currentPath, node.path)) {
                  navigate(pageHref(data.page.path), { replace: true });
                }
              },
              onError: (error) => pushError(error, 'Could not rename the page.'),
            },
          );
        },
      });
    },
    [spaces, updatePage, currentPath, navigate, pushError],
  );

  const duplicatePage = useCallback(
    (node: TreeNode) => {
      const container = parentPath(node.path) ?? node.path;
      void (async () => {
        try {
          const source = await api.getPage(node.id);
          const body = {
            path: childPathFor(spaces, container, `${node.title} copy`),
            title: `${node.title} copy`,
            markdown: source.page.markdown,
            ...(source.page.icon ? { icon: source.page.icon } : {}),
          };
          const created = await createPage.mutateAsync(body);
          navigate(pageHref(created.page.path));
        } catch (error) {
          pushError(error, 'Could not duplicate the page.');
        }
      })();
    },
    [spaces, createPage, navigate, pushError],
  );

  const deletePage = useCallback(
    (node: TreeNode) => {
      const childCount = childrenOf(spaces, node.path).length;
      setConfirm({
        title: 'Delete page',
        danger: true,
        confirmLabel: 'Delete',
        message:
          childCount > 0
            ? `Delete "${node.title}" and its ${childCount} child page(s)? The files are removed from the repo.`
            : `Delete "${node.title}"? The file is removed from the repo.`,
        onConfirm: () => {
          deletePageMutation.mutate(
            { id: node.id, recursive: childCount > 0 },
            {
              onSuccess: () => {
                push('Page deleted.', 'success');
                if (currentPath === node.path || isDescendantOf(currentPath, node.path)) {
                  const fallback = parentPath(node.path);
                  navigate(fallback ? pageHref(fallback) : '/', { replace: true });
                }
              },
              onError: (error) => pushError(error, 'Could not delete the page.'),
            },
          );
        },
      });
    },
    [spaces, deletePageMutation, currentPath, navigate, push, pushError],
  );

  const copyLink = useCallback(
    (path: PagePath) => {
      const url = absolutePageUrl(path);
      void navigator.clipboard
        ?.writeText(url)
        .then(() => push('Link copied.', 'success'))
        .catch(() => push(url, 'info'));
    },
    [push],
  );

  /**
   * Send one move PATCH. The open document always follows its page. `follow` opens the page
   * that moved even when it was not the open one, so the person sees where it landed.
   */
  const applyMove = useCallback(
    (sourcePath: PagePath, patch: MovePatch, options: MoveOptions = {}) => {
      updatePage.mutate(patch, {
        onSuccess: (data) => {
          if (options.message) push(options.message, 'success');
          const open = currentPath === sourcePath || isDescendantOf(currentPath, sourcePath);
          if (!open && !options.follow) return;
          const suffix = open ? currentPath.slice(sourcePath.length) : '';
          navigate(pageHref(`${data.page.path}${suffix}`), { replace: open });
        },
        onError: (error) => pushError(error, 'Could not move the page.'),
      });
    },
    [updatePage, currentPath, navigate, push, pushError],
  );

  const movePage = useCallback(
    (sourcePath: PagePath, targetPath: PagePath, position: DropPosition) => {
      const patch = computeMove({ spaces, sourcePath, targetPath, position });
      if (!patch) return;
      applyMove(sourcePath, patch);
    },
    [spaces, applyMove],
  );

  const moveToSpace = useCallback(
    (node: TreeNode) => {
      if (depth(node.path) === 1) {
        push('A space home page cannot be moved.', 'error');
        return;
      }
      const options: SpaceOption[] = spaces
        .filter((space) => space.slug !== spaceOf(node.path))
        .map((space) => ({
          slug: space.slug,
          name: space.name,
          ...(space.icon ? { icon: space.icon } : {}),
        }));
      if (options.length === 0) {
        push('There is no other space to move it to.', 'error');
        return;
      }
      setSpacePick({
        title: 'Move to space',
        label: `Move "${node.title}" to`,
        options,
        confirmLabel: 'Move',
        onConfirm: (slug) => {
          const patch = computeSpaceMove({ spaces, sourcePath: node.path, spaceSlug: slug });
          if (!patch) return;
          const name = options.find((option) => option.slug === slug)?.name ?? slug;
          applyMove(node.path, patch, { message: `Moved to ${name}.`, follow: true });
        },
      });
    },
    [spaces, applyMove, push],
  );

  const value = useMemo<ContentValue>(
    () => ({
      spaces,
      isLoadingTree: tree.isLoading,
      recents,
      currentPath,
      currentSpace,
      setCurrentSpace,
      newPage,
      newSpace,
      editSpace,
      renamePage,
      duplicatePage,
      deletePage,
      copyLink,
      movePage,
      moveToSpace,
    }),
    [
      spaces,
      tree.isLoading,
      recents,
      currentPath,
      currentSpace,
      setCurrentSpace,
      newPage,
      newSpace,
      editSpace,
      renamePage,
      duplicatePage,
      deletePage,
      copyLink,
      movePage,
      moveToSpace,
    ],
  );

  return (
    <ContentContext.Provider value={value}>
      {children}
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <SpacePickerDialog request={spacePick} onClose={() => setSpacePick(null)} />
      <SpaceDialog request={spaceEdit} onClose={() => setSpaceEdit(null)} />
    </ContentContext.Provider>
  );
}

export function useContent(): ContentValue {
  const value = useContext(ContentContext);
  if (!value) throw new Error('useContent must be used inside <ContentProvider>');
  return value;
}
