/**
 * Mermaid diagrams. A diagram is a fenced code block whose info string is `mermaid`,
 * which is the form GitHub and VS Code already draw and every other reader shows as
 * source. Nothing here invents syntax; the whole feature is a node view over that fence.
 */

/** The one fence language tablinum draws as a picture. */
export const MERMAID_LANGUAGE = 'mermaid';

/** An example to edit. An empty canvas is a worse first experience. */
export const MERMAID_STARTER =
  'graph TD\n  A[Start] --> B{Is it good?}\n  B -->|yes| C[Ship it]\n  B -->|no| A';

/**
 * Quiet period before a re-render. Parsing a diagram is not free, and half-typed mermaid
 * is invalid mermaid, so the check waits until the typing really stops.
 */
export const MERMAID_DEBOUNCE_MS = 700;

export type MermaidTheme = 'light' | 'dark';

type MermaidApi = (typeof import('mermaid'))['default'];

let loading: Promise<MermaidApi> | null = null;
let configured: MermaidTheme | null = null;
let counter = 0;

/**
 * mermaid is about a megabyte, so it is fetched only once a page really holds a
 * diagram. The promise is kept, so the second block on a page reuses the same chunk.
 */
function load(): Promise<MermaidApi> {
  loading ??= import('mermaid').then((module) => module.default);
  return loading;
}

/**
 * `strict` encodes HTML inside labels, turns `click` handlers off, and runs the finished
 * SVG through mermaid's own DOMPurify pass. `htmlLabels` would put real markup back into
 * a label, so it stays off at the root and on the flowchart that overrides it.
 */
function configure(api: MermaidApi, theme: MermaidTheme): void {
  if (configured === theme) return;
  api.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    // The node view draws its own error, so mermaid must not push one into the DOM.
    suppressErrorRendering: true,
    fontFamily: 'inherit',
    theme: theme === 'dark' ? 'dark' : 'default',
  });
  configured = theme;
}

/** The SVG of one diagram. Rejects when the source is not valid mermaid. */
export async function renderMermaid(source: string, theme: MermaidTheme): Promise<string> {
  const api = await load();
  configure(api, theme);
  counter += 1;
  const { svg } = await api.render(`gd-mermaid-${counter}`, source);
  return svg;
}

const GOT_TOKEN = /got '([^']+)'/;

/** One readable line out of whatever mermaid threw, short enough to sit under the diagram. */
export function mermaidErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const first = text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  if (first.length === 0) return 'This diagram cannot be drawn.';
  // The rest of a parse error is a caret diagram and a long list of every token mermaid
  // would have accepted. Only the one it actually hit is worth showing.
  const head = first.replace(/:$/, '');
  const got = GOT_TOKEN.exec(text)?.[1] ?? '';
  return got.length > 0 ? `${head} (got ${got})` : head;
}
