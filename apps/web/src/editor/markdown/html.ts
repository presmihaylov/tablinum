/** Minimal HTML helpers. Kept local so no markdown-it internal path is imported. */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Raw markdown fragments (HTML blocks, comments) travel inside an attribute.
 * Percent-encoding keeps quotes, newlines and angle brackets intact through
 * DOMParser and back out again.
 */
export function encodeRaw(value: string): string {
  return encodeURIComponent(value);
}

export function decodeRaw(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
