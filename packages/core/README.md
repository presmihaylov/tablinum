# @tablinum/core

The content store. Every page is a markdown file with YAML frontmatter under the content
directory, and nothing else holds state. A person editing in the browser, an agent calling the
REST API and an agent editing `.md` files straight in the git repository all see the same content.

```ts
import { ContentStore } from '@tablinum/core';

const store = new ContentStore({ contentDir: '/srv/tablinum/content' });
await store.init();
```

## ContentStore

| Method | Purpose |
| --- | --- |
| `init()` | Create the content directory and, when it is empty, a `docs` space with a welcome page. |
| `rebuild()` / `markStale()` | Re-scan after an external edit. `markStale()` defers the scan to the next read. |
| `listSpaces()` / `getSpace(slug)` / `createSpace(slug, name, icon?, order?)` | Spaces, backed by `<slug>/_space.yml`. |
| `getTree()` | Every space with its nested `TreeNode[]`. Siblings sort by `order` then title. |
| `listPages()` | Flat `PageSummary[]`, sorted by path. |
| `getPageByPath(path)` / `getPageById(id)` | One `Page`, body included. Throws `NOT_FOUND`. |
| `createPage(input)` | Writes the file, generates the id and the timestamps. Throws `CONFLICT` when the path is taken. |
| `updatePage(id, patch)` | Patches fields, the body, or the path. A move carries the children along. |
| `deletePage(id, recursive?)` | Returns the deleted paths. Throws `CONFLICT` on a non-recursive delete of a parent. |
| `readRaw(file)` / `writeRaw(file, content)` | Byte-for-byte access inside the content root. |
| `saveAsset(pageId, filename, data)` | Stores an attachment under `_assets/<pageId>/`. |
| `getBacklinks(id)` / `resolveLinks(markdown, from?)` | Link graph over the files on disk. |

Every failure is an `AppError` from `@tablinum/shared`, so the server can map it straight onto a
status code.

## On-disk shape

```
content/
  docs/
    _space.yml        # name, icon, order
    index.md          # the page "docs"
    guide.md          # a leaf page "docs/guide"
    runbooks/
      index.md        # "docs/runbooks", a page that has children
      deploy.md       # "docs/runbooks/deploy"
  _assets/
    pg_01J.../diagram.png
```

A leaf is promoted from `foo.md` to `foo/index.md` when it gets its first child, and demoted back
when it loses its last one. Page ids never change across a rename or a move.

## Frontmatter

`parse()` and `serialize()` keep the contract key order: `id`, `title`, `icon`, `order`,
`created`, `updated`. Two rules make the store safe to point at a git repository:

- **Round trips are byte identical.** Opening and saving an unchanged page produces no git diff.
  Values that YAML would coerce (`yes`, `null`, `1.0`, `12:30`, `2026-01-02`, padded strings) are
  quoted on the way out and read back as the exact same string.
- **Broken frontmatter is repaired, never rejected.** An agent may hand-write a `.md` file with no
  frontmatter at all. The parser generates the id, takes the title from the first heading or the
  filename, and ignores every key the contract does not name. The file is only rewritten once
  something actually changes it.

## Other exports

- `IndexMap` - in-memory id to file index, with duplicate-id detection.
- `extractLinks`, `resolveWikilinks`, `buildBacklinkIndex`, `createPageResolver` - the link graph.
- `watchContent(dir, onChange)` - debounced chokidar watcher that skips `.git` and `_assets`.
- `resolveInside(root, target)` - path guard; anything outside the content root throws.
