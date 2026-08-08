export {
  ContentStore,
  DEFAULT_SPACE_NAME,
  DEFAULT_SPACE_SLUG,
  WELCOME_MARKDOWN,
  WELCOME_TITLE,
  type ContentStoreOptions,
  type CreatePageInput,
  type SpaceTree,
  type UpdatePageInput,
} from './store.js';

export {
  firstHeading,
  frontmatterEqual,
  normalizeBody,
  normalizeIcon,
  parse,
  serialize,
  serializePreserving,
  stringifyFrontmatter,
  titleize,
  type ParseHints,
  type ParsedFile,
} from './frontmatter.js';

export { IndexMap, type IndexMapOptions, type IndexedPage } from './index-map.js';

export {
  buildBacklinkIndex,
  createPageResolver,
  extractLinks,
  isExternalTarget,
  maskCodeRegions,
  resolveWikilinks,
  type ExtractedLink,
  type LinkKind,
  type LinkablePage,
  type LinkedPage,
  type PageResolver,
  type ResolveOptions,
  type WikilinkResolver,
  type WikilinkTarget,
} from './links.js';

export {
  shouldIgnore,
  watchContent,
  type ContentChange,
  type ContentChangeType,
  type ContentWatcher,
  type WatchContentOptions,
} from './watcher.js';

export { parseSpaceFile, serializeSpaceFile } from './space-file.js';

export {
  isPageFileName,
  isSpaceSlug,
  listSpaceSlugs,
  scanPageFiles,
  type ScannedPageFile,
} from './scan.js';

export { consoleLogger, silentLogger, type Logger } from './logger.js';

export { resolveInside } from './fs-utils.js';

export { emitNumber, emitString, needsQuotes, quoteString } from './yaml-emit.js';
