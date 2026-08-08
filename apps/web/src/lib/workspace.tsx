import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isDescendantOf, parentPath, segments, slugify } from '@gitdocs/shared';
import type { PagePath, TreeNode } from '@gitdocs/shared';
import { api } from '../api/client';
import { useCreatePage, useCreateSpace, useDeletePage, useTree, useUpdatePage } from '../api/hooks';
import { ConfirmDialog, type ConfirmRequest } from '../components/ui/ConfirmDialog';
import { PromptDialog, type PromptRequest } from '../components/ui/PromptDialog';
import { absolutePageUrl, pageHref, pathFromSplat } from './href';
import { readStored, writeStored } from './storage';
import { childPathFor, computeMove, renamedPath, type DropPosition } from './treeMove';
import { childrenOf, type SpaceTree } from './tree';
import { useToast } from './toast';

const SPACE_KEY = 'space';

interface WorkspaceValue {
  spaces: SpaceTree[];
  isLoadingTree: boolean;
  currentPath: PagePath;
  currentSpace: string;
  setCurrentSpace: (slug: string) => void;
  newPage: (parent: PagePath | null) => void;
  newSpace: () => void;
  renamePage: (node: TreeNode) => void;
  duplicatePage: (node: TreeNode) => void;
  deletePage: (node: TreeNode) => void;
  copyLink: (path: PagePath) => void;
  movePage: (sourcePath: PagePath, targetPath: PagePath, position: DropPosition) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { push, pushError } = useToast();
  const tree = useTree();
  const createPage = useCreatePage();
  const createSpace = useCreateSpace();
  const updatePage = useUpdatePage();
  const deletePageMutation = useDeletePage();

  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [storedSpace, setStoredSpace] = useState<string>(() => readStored<string>(SPACE_KEY, ''));

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
    setPrompt({
      title: 'New space',
      label: 'Space name',
      placeholder: 'Engineering',
      confirmLabel: 'Create',
      onConfirm: (name) => {
        const slug = slugify(name);
        createSpace.mutate(
          { slug, name },
          {
            onSuccess: () => {
              setCurrentSpace(slug);
              push(`Space "${name}" created.`, 'success');
            },
            onError: (error) => pushError(error, 'Could not create the space.'),
          },
        );
      },
    });
  }, [createSpace, push, pushError, setCurrentSpace]);

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

  const movePage = useCallback(
    (sourcePath: PagePath, targetPath: PagePath, position: DropPosition) => {
      const patch = computeMove({ spaces, sourcePath, targetPath, position });
      if (!patch) return;
      updatePage.mutate(patch, {
        onSuccess: (data) => {
          if (currentPath === sourcePath || isDescendantOf(currentPath, sourcePath)) {
            const suffix = currentPath.slice(sourcePath.length);
            navigate(pageHref(`${data.page.path}${suffix}`), { replace: true });
          }
        },
        onError: (error) => pushError(error, 'Could not move the page.'),
      });
    },
    [spaces, updatePage, currentPath, navigate, pushError],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      spaces,
      isLoadingTree: tree.isLoading,
      currentPath,
      currentSpace,
      setCurrentSpace,
      newPage,
      newSpace,
      renamePage,
      duplicatePage,
      deletePage,
      copyLink,
      movePage,
    }),
    [
      spaces,
      tree.isLoading,
      currentPath,
      currentSpace,
      setCurrentSpace,
      newPage,
      newSpace,
      renamePage,
      duplicatePage,
      deletePage,
      copyLink,
      movePage,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return value;
}
