import { useEffect, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { EmojiGlyph } from '../../components/ui/EmojiGlyph';
import { DatabaseView } from '../../components/Database/DatabaseView';
import type { EmbeddedPage, PageEmbedOptions } from '../extensions/pageEmbed';

type Status = 'loading' | 'ready' | 'missing';

/**
 * Another page of the repo, shown in place. A plain page shows as its icon and title, and a
 * click opens it. A page that is a database draws the database itself: that is what makes a
 * database inline, with no second markdown format to keep.
 */
export function PageEmbedView({ node, extension }: NodeViewProps) {
  const target = typeof node.attrs['target'] === 'string' ? node.attrs['target'] : '';
  const options = extension.options as PageEmbedOptions;

  const [page, setPage] = useState<EmbeddedPage | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let live = true;
    setStatus('loading');
    options.load(target).then(
      (found) => {
        if (!live) return;
        setPage(found);
        setStatus(found === null ? 'missing' : 'ready');
      },
      () => {
        if (live) setStatus('missing');
      },
    );
    return () => {
      live = false;
    };
  }, [target, options]);

  if (page?.database) {
    return (
      <NodeViewWrapper as="div" className="gd-editor-pageembed" data-target={target}>
        {/* contentEditable=false, or every cell would fight ProseMirror for the keystrokes. */}
        <div className="gd-editor-pageembed__db" contentEditable={false}>
          <button
            type="button"
            className="gd-editor-pageembed__open"
            title={`Open ${page.title}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => options.open(target)}
          >
            <span className="gd-editor-pageembed__icon" aria-hidden="true">
              <EmojiGlyph value={page.icon ?? '🗂️'} />
            </span>
            {page.title}
          </button>
          <DatabaseView page={page} />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="div" className="gd-editor-pageembed" data-target={target}>
      <button
        type="button"
        className={`gd-editor-pageembed__link${status === 'missing' ? ' is-missing' : ''}`}
        contentEditable={false}
        title={status === 'missing' ? 'This page cannot be found' : target}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => options.open(target)}
      >
        <span className="gd-editor-pageembed__icon" aria-hidden="true">
          <EmojiGlyph value={page?.icon ?? '📄'} />
        </span>
        <span className="gd-editor-pageembed__title">{page?.title ?? target}</span>
      </button>
    </NodeViewWrapper>
  );
}

export default PageEmbedView;
