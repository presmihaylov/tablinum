import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * Links to a single block.
 *
 * A block is named by a slug of its own words, the shape a heading anchor already has. Nothing
 * is written into the document, so no id can reach the markdown file and the byte-identical
 * round trip holds. The bargain is the same one the comment anchors take: a block keeps its
 * link while its words stand, and loses it when they are rewritten.
 */

/** How much of a block's text the slug keeps. Long enough to be unique, short enough to read. */
const MAX_SLUG_LENGTH = 48;

export interface BlockAnchor {
  id: string;
  from: number;
  to: number;
}

/** The words of one block, cut to a readable length on a word boundary. */
function slugOf(node: ProseMirrorNode): string {
  const words = node.textContent
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // An image, a divider or an empty line has no words, so its kind is the whole name.
  if (words.length === 0) return node.type.name.toLowerCase();
  if (words.length <= MAX_SLUG_LENGTH) return words;
  const cut = words.slice(0, MAX_SLUG_LENGTH);
  const boundary = cut.lastIndexOf('-');
  // One word longer than the whole budget is cut mid-word, which is still stable.
  return boundary > 0 ? cut.slice(0, boundary) : cut;
}

/** Every top-level block of the page, each with the id a link to it carries. */
export function blockAnchors(doc: ProseMirrorNode): BlockAnchor[] {
  const counts = new Map<string, number>();
  const found: BlockAnchor[] = [];
  doc.forEach((node, offset) => {
    const base = slugOf(node);
    const seen = (counts.get(base) ?? 0) + 1;
    counts.set(base, seen);
    // Two blocks of the same words are told apart by their order, as heading anchors are.
    found.push({ id: seen === 1 ? base : `${base}-${seen}`, from: offset, to: offset + node.nodeSize });
  });
  return found;
}

/** The id of a link to the top-level block that starts at `pos`. */
export function anchorIdAt(doc: ProseMirrorNode, pos: number): string | null {
  return blockAnchors(doc).find((anchor) => anchor.from === pos)?.id ?? null;
}

/** Where the block a link names stands now, or null when its words are gone. */
export function findBlockAnchor(doc: ProseMirrorNode, id: string): BlockAnchor | null {
  return blockAnchors(doc).find((anchor) => anchor.id === id) ?? null;
}

/** The block id a page URL points at, or null when it points at no block. */
export function blockIdFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (raw.length === 0) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    // A half-written escape in the address bar is not a block id.
    return null;
  }
}

/** The fragment that names a block, ready to append to a page URL. */
export function blockHash(id: string): string {
  return `#${encodeURIComponent(id)}`;
}
