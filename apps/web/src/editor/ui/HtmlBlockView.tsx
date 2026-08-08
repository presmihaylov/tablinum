import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { playerSrc, readEmbed } from '../embeds';

const FRAME_ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture';

/**
 * A raw HTML block. It becomes a real player when the block names an embed the
 * allowlist knows, and stays the plain source box for every other kind of HTML.
 * The player is built here from the checked URL, never from the stored markup.
 */
export function HtmlBlockView({ node }: NodeViewProps) {
  const raw = typeof node.attrs['raw'] === 'string' ? node.attrs['raw'] : '';
  const embed = readEmbed(raw);

  if (!embed) {
    return (
      <NodeViewWrapper as="div" className="gd-editor-html gd-editor-html--block">
        {raw}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="div" className="gd-editor-embed" data-provider={embed.provider}>
      <div className="gd-editor-embed__frame" contentEditable={false}>
        {embed.kind === 'video' ? (
          <video className="gd-editor-embed__player" src={embed.src} controls />
        ) : (
          <iframe
            className="gd-editor-embed__player"
            src={playerSrc(embed, window.location.hostname)}
            title={embed.provider}
            allow={FRAME_ALLOW}
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}

export default HtmlBlockView;
