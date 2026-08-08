import { toAppError, type ErrorCode } from '@gitdocs/shared';

/** What a model should do next when it sees each error code. */
const REMEDY: Record<ErrorCode, string> = {
  NOT_FOUND:
    'No page or space matches that id or path. Call gitdocs_list_tree or gitdocs_search to find the real path, then retry.',
  CONFLICT:
    'A page already exists at that path, or the move target is occupied. Pick a different path, or call gitdocs_update_page on the existing page instead.',
  VALIDATION:
    'The arguments were rejected. Fix the reported field and call the tool again. Paths look like "eng/runbooks/deploy": lowercase, slash separated, no leading or trailing slash, no ".md".',
  UNAUTHORIZED:
    'The gitdocs server rejected the credentials. Set GITDOCS_TOKEN to one of the tokens in the server GITDOCS_API_TOKENS list.',
  GIT_ERROR:
    'The git operation failed. Check the remote and its credentials on the server, then retry gitdocs_git_sync.',
  INTERNAL: 'The gitdocs server failed. Check the server logs, then retry.',
};

/** Render any thrown value as a tool error a model can act on. */
export function toolErrorMessage(err: unknown): string {
  const error = toAppError(err);
  return `${error.code}: ${error.message}\nWhat to do: ${REMEDY[error.code]}`;
}
