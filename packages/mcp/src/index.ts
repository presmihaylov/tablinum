export { GitdocsClient } from './client.js';
export type {
  FetchLike,
  GitdocsClientOptions,
  SearchParams,
  SpaceTree,
  ViewParams,
} from './client.js';
export {
  DEFAULT_BASE_URL,
  USAGE,
  parseCliOptions,
  type CliOptions,
  type EnvSource,
} from './cli-options.js';
export {
  formatGitStatus,
  formatHistory,
  formatPage,
  formatPageLine,
  formatSearchHits,
  formatTreeOutline,
  formatViewTable,
  renderPropValue,
} from './format.js';
export { normalizeRef, refLabel, resolvePage, resolvePageId } from './refs.js';
export type { PageRef, ResolvedRef } from './refs.js';
export {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  STYLE_GUIDE_PROMPT,
  TREE_RESOURCE_URI,
  createGitdocsMcpServer,
  treeOutline,
  type CreateServerOptions,
} from './server.js';
export { STYLE_GUIDE, styleGuideFor } from './style-guide.js';
export { toolErrorMessage } from './tool-errors.js';
export { TOOL_SPECS, getToolSpec, type ToolSpec } from './tools.js';
