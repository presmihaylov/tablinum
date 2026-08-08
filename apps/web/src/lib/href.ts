import type { PagePath } from '@gitdocs/shared';

/** Route for a page. Each segment is encoded on its own so slashes survive. */
export function pageHref(path: PagePath): string {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/p/${encoded}`;
}

/** Read a page path back out of the /p/* splat. */
export function pathFromSplat(splat: string | undefined): PagePath {
  if (!splat) return '';
  return splat
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')
    .replace(/^\/+|\/+$/g, '');
}

export function absolutePageUrl(path: PagePath): string {
  return `${window.location.origin}${pageHref(path)}`;
}
