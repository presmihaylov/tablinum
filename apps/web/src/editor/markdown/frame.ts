/**
 * A markdown parser throws away the blank lines around a document and the
 * choice of line ending. Both are bytes in the file, so they are captured
 * before the parse and put back after the serialize.
 */
export interface MarkdownFrame {
  /** Blank lines before the first block. */
  leading: string;
  /** The run of newlines after the last block, usually a single `\n`. */
  trailing: string;
  eol: '\n' | '\r\n';
}

export const DEFAULT_FRAME: MarkdownFrame = { leading: '', trailing: '\n', eol: '\n' };

const LEADING_BLANK = /^(?:[ \t]*\r?\n)*/;
const WHITESPACE = /\s/;

export function captureFrame(source: string): MarkdownFrame {
  const eol = detectEol(source);
  const text = eol === '\r\n' ? source.replace(/\r\n/g, '\n') : source;
  const leading = LEADING_BLANK.exec(text)?.[0] ?? '';
  return { leading, trailing: trailingNewlines(text, leading.length), eol };
}

/** Only newline-led whitespace counts, so trailing spaces on the last line stay in the text. */
function trailingNewlines(text: string, from: number): string {
  let end = text.length;
  while (end > from && WHITESPACE.test(text[end - 1] ?? '')) end -= 1;
  const tail = text.slice(Math.max(end, from));
  const first = tail.indexOf('\n');
  return first === -1 ? '' : tail.slice(first);
}

/** Strip the frame so the parser sees only block content. */
export function stripFrame(source: string, frame: MarkdownFrame): string {
  const text = frame.eol === '\r\n' ? source.replace(/\r\n/g, '\n') : source;
  const body = text.slice(frame.leading.length);
  return frame.trailing.length === 0 ? body : body.slice(0, body.length - frame.trailing.length);
}

export function applyFrame(body: string, frame: MarkdownFrame): string {
  const framed = `${frame.leading}${body}${frame.trailing}`;
  return frame.eol === '\r\n' ? framed.replace(/\n/g, '\r\n') : framed;
}

function detectEol(source: string): '\n' | '\r\n' {
  const crlf = source.match(/\r\n/g)?.length ?? 0;
  if (crlf === 0) return '\n';
  const lf = source.match(/\n/g)?.length ?? 0;
  return crlf === lf ? '\r\n' : '\n';
}
