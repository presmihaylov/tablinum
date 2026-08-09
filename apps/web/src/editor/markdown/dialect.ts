/**
 * Names of the data attributes that carry markdown source detail across the
 * markdown-it -> HTML -> ProseMirror hop. Everything the serializer needs to
 * rebuild the original bytes travels on one of these.
 */
export const DATA = {
  break: 'data-gd-break',
  trail: 'data-gd-trail',
  gap: 'data-gd-gap',
  escape: 'data-gd-esc',
  html: 'data-gd-html',
  fence: 'data-gd-fence',
  info: 'data-gd-info',
  indent: 'data-gd-indent',
  markup: 'data-gd-markup',
  marker: 'data-gd-marker',
  number: 'data-gd-number',
  delimiter: 'data-gd-delimiter',
  setext: 'data-gd-setext',
  delims: 'data-gd-delims',
  rows: 'data-gd-rows',
  align: 'data-gd-align',
  autolink: 'data-gd-autolink',
  label: 'data-gd-label',
  wikilink: 'data-gd-wikilink',
  alias: 'data-gd-alias',
  embed: 'data-gd-embed',
  mention: 'data-gd-mention',
  callout: 'data-callout',
} as const;

/** GitHub alert kinds, rendered as callout blocks. */
export const CALLOUT_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;

export type CalloutType = (typeof CALLOUT_TYPES)[number];

export function isCalloutType(value: unknown): value is CalloutType {
  return typeof value === 'string' && (CALLOUT_TYPES as readonly string[]).includes(value);
}

export function toCalloutType(value: unknown): CalloutType {
  return isCalloutType(value) ? value : 'NOTE';
}

/** Attribute readers that keep `unknown` out of the serializers. */
export function stringAttr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function rawStringAttr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function numberAttr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function boolAttr(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
