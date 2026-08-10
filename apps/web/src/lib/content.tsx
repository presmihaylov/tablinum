import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { baseName, depth, isDescendantOf, parentPath, segments, slugify, spaceOf } from '@tablinum/shared';
import type { PagePath, TreeNode } from '@tablinum/shared';
import { api } from '../api/client';
import {
  useAddFavorite,
  useCreatePage,
  useCreateSpace,
  useDeletePage,
  useFavorites,
  useRemoveFavorite,
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
import { myUser } from './identity';
import { readStored, removeStored, writeStored } from './storage';
import {
  childPathFor,
  computeMove,
  computeSpaceMove,
  renamedPath,
  type DropPosition,
  type MovePatch,
} from './treeMove';
import { childrenOf, findNode, findNodeById, type SpaceTree } from './tree';
import { useToast } from './toast';

const SPACE_KEY = 'space';
const RECENTS_KEY = 'recents';

/** How many pages the Recents bucket keeps. Notion shows about this many. */
const RECENTS_LIMIT = 10;

/** Where one person's list lives. Two people who share a browser never see each other's. */
function recentsKeyFor(accountId: string): string {
  return `${RECENTS_KEY}.${accountId}`;
}

interface ContentValue {
  spaces: SpaceTree[];
  isLoadingTree: boolean;
  /** Pages this person opened on this device, newest first opened. A page never moves again. */
  recents: PagePath[];
  /** Pages this person pinned in this workspace, oldest pin first. */
  favorites: TreeNode[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (node: TreeNode) => void;
  currentPath: PagePath;
  currentSpace: string;
  setCurrentSpace: (slug: string) => void;
  newPage: (parent: PagePath | null) => void;
  newSpace: (options?: { private?: boolean }) => void;
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

/**
 * The prompt a page gets when it leaves a private space. The move is not undoable in the way it
 * looks: the workspace can read the page from then on, and git starts to track the file.
 */
function publishRequest(title: string, onConfirm: () => void): ConfirmRequest {
  return {
    title: 'Move out of Private?',
    message: `"${title}" is private to you today. Everybody in the workspace will be able to read it, and it will go into git.`,
    confirmLabel: 'Move it',
    onConfirm,
  };
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
  const favoritesQuery = useFavorites();
  const addFavorite = useAddFavorite();
  const removeFavorite = useRemoveFavorite();

  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [spacePick, setSpacePick] = useState<SpacePickerRequest | null>(null);
  const [spaceEdit, setSpaceEdit] = useState<SpaceDialogRequest | null>(null);
  const [storedSpace, setStoredSpace] = useState<string>(() => readStored<string>(SPACE_KEY, ''));
  const [recents, setRecents] = useState<PagePath[]>([]);

  // Read the way the live channel reads it: the account is set while the provider above renders,
  // and the shell is only reached once somebody is signed in.
  const accountId = myUser()?.id ?? null;
  const recentsKey = accountId === null ? null : recentsKeyFor(accountId);

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

  // "New page" follows the reader. Without this the space it falls back to is the first one in
  // the tree, so a page made after a step off a private page landed in a public space.
  useEffect(() => {
    const space = segments(currentPath)[0];
    if (space === undefined || space === storedSpace) return;
    setCurrentSpace(space);
  }, [currentPath, storedSpace, setCurrentSpace]);

  useEffect(() => {
    if (recentsKey === null) return;
    setRecents(readStored<PagePath[]>(recentsKey, []));
    // One list used to be shared by everybody who signed in on this browser. It is dropped
    // rather than handed to the first person who arrives, because nobody can say whose it was.
    removeStored(RECENTS_KEY);
  }, [recentsKey]);

  useEffect(() => {
    if (currentPath === '' || recentsKey === null) return;
    setRecents((prev) => {
      // A page already in the list keeps its place, and its row is lit where it stands. Moving
      // it to the top would reshuffle the bucket under the pointer that just clicked it.
      if (prev.includes(currentPath)) return prev;
      const next = [currentPath, ...prev].slice(0, RECENTS_LIMIT);
      writeStored(recentsKey, next);
      return next;
    });
  }, [currentPath, recentsKey]);

  const favoriteIds = useMemo(
    () => new Set((favoritesQuery.data?.favorites ?? []).map((favorite) => favorite.pageId)),
    [favoritesQuery.data],
  );

  // A pinned page that was deleted stays in the list until the server drops it, so resolve each.
  const favorites = useMemo(
    () =>
      (favoritesQuery.data?.favorites ?? [])
        .map((favorite) => findNodeById(spaces, favorite.pageId))
        .filter((node) => node !== null),
    [favoritesQuery.data, spaces],
  );

  const isFavorite = useCallback((id: string) => favoriteIds.has(id), [favoriteIds]);

  const toggleFavorite = useCallback(
    (node: TreeNode) => {
      if (favoriteIds.has(node.id)) {
        removeFavorite.mutate(node.id, {
          onError: (error) => pushError(error, 'Could not remove the favorite.'),
        });
        return;
      }
      addFavorite.mutate(node.id, {
        onError: (error) => pushError(error, 'Could not add the favorite.'),
      });
    },
    [favoriteIds, addFavorite, removeFavorite, pushError],
  );

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

  const newSpace = useCallback(
    (options: { private?: boolean } = {}) => {
      const isPrivate = options.private === true;
      setSpaceEdit({
        title: isPrivate ? 'New private space' : 'New space',
        confirmLabel: 'Create',
        onConfirm: ({ name, icon }) => {
          const slug = slugify(name);
          createSpace.mutate(
            { slug, name, ...(icon ? { icon } : {}), ...(isPrivate ? { private: true } : {}) },
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
    },
    [createSpace, navigate, push, pushError, setCurrentSpace],
  );

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

  /** True when the page would leave a space only its owner sees for one the workspace reads. */
  const leavesPrivate = useCallback(
    (sourcePath: PagePath, targetSlug: string): boolean => {
      const from = spaces.find((space) => space.slug === spaceOf(sourcePath));
      const to = spaces.find((space) => space.slug === targetSlug);
      return from?.owner !== undefined && to !== undefined && to.owner === undefined;
    },
    [spaces],
  );

  const movePage = useCallback(
    (sourcePath: PagePath, targetPath: PagePath, position: DropPosition) => {
      const patch = computeMove({ spaces, sourcePath, targetPath, position });
      if (!patch) return;
      const run = (): void => applyMove(sourcePath, patch);
      if (!leavesPrivate(sourcePath, spaceOf(targetPath))) {
        run();
        return;
      }
      const title = findNode(spaces, sourcePath)?.title ?? baseName(sourcePath);
      setConfirm(publishRequest(title, run));
    },
    [spaces, applyMove, leavesPrivate],
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
          // A space with an owner belongs to one person, and git never takes its files.
          private: space.owner !== undefined,
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
          const run = (): void =>
            applyMove(node.path, patch, { message: `Moved to ${name}.`, follow: true });
          if (!leavesPrivate(node.path, slug)) {
            run();
            return;
          }
          setConfirm(publishRequest(node.title, run));
        },
      });
    },
    [spaces, applyMove, push, leavesPrivate],
  );

  const value = useMemo<ContentValue>(
    () => ({
      spaces,
      isLoadingTree: tree.isLoading,
      recents,
      favorites,
      isFavorite,
      toggleFavorite,
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
      favorites,
      isFavorite,
      toggleFavorite,
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
