import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { createTestEditor, roundtrip, toMarkdown } from './harness';
import { embedHtml, playerSrc, readEmbed, resolveEmbed } from '../../src/editor/embeds';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(markdown: string): Editor {
  editor = createTestEditor(markdown);
  return editor;
}

function srcOf(input: string): string | null {
  return resolveEmbed(input)?.src ?? null;
}

describe('resolveEmbed reads a page URL', () => {
  it('takes a YouTube watch link', () => {
    expect(srcOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    );
  });

  it('takes a youtu.be link, with its start time', () => {
    expect(srcOf('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?start=90',
    );
  });

  it('takes a YouTube short and a live link', () => {
    expect(srcOf('https://www.youtube.com/shorts/abc_123')).toBe(
      'https://www.youtube.com/embed/abc_123',
    );
    expect(srcOf('https://www.youtube.com/live/abc_123')).toBe(
      'https://www.youtube.com/embed/abc_123',
    );
  });

  it('takes a link with no scheme', () => {
    expect(srcOf('youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('takes a Vimeo link, and keeps an unlisted hash', () => {
    expect(srcOf('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(srcOf('https://vimeo.com/76979871/abc123')).toBe(
      'https://player.vimeo.com/video/76979871?h=abc123',
    );
  });

  it('takes a Loom share link', () => {
    expect(srcOf('https://www.loom.com/share/abc123?sid=x')).toBe(
      'https://www.loom.com/embed/abc123',
    );
  });

  it('takes a Wistia link', () => {
    expect(srcOf('https://home.wistia.com/medias/abc123')).toBe(
      'https://fast.wistia.net/embed/iframe/abc123',
    );
  });

  it('takes a Dailymotion link, long and short', () => {
    expect(srcOf('https://www.dailymotion.com/video/x8abc12')).toBe(
      'https://www.dailymotion.com/embed/video/x8abc12',
    );
    expect(srcOf('https://dai.ly/x8abc12')).toBe('https://www.dailymotion.com/embed/video/x8abc12');
  });

  it('takes a Twitch channel, video and clip', () => {
    expect(srcOf('https://www.twitch.tv/somechannel')).toBe(
      'https://player.twitch.tv/?channel=somechannel',
    );
    expect(srcOf('https://www.twitch.tv/videos/123456789')).toBe(
      'https://player.twitch.tv/?video=123456789',
    );
    expect(srcOf('https://clips.twitch.tv/SomeClipSlug')).toBe(
      'https://clips.twitch.tv/embed?clip=SomeClipSlug',
    );
  });

  it('takes a Streamable link', () => {
    expect(srcOf('https://streamable.com/abc123')).toBe('https://streamable.com/e/abc123');
  });

  it('takes a media file, uploaded or remote', () => {
    expect(resolveEmbed('/_assets/pg_1/clip.mp4')).toEqual({
      provider: 'Video',
      kind: 'video',
      src: '/_assets/pg_1/clip.mp4',
      needsParent: false,
    });
    expect(resolveEmbed('https://cdn.example.com/a.webm')?.kind).toBe('video');
  });

  it('refuses anything it cannot play', () => {
    expect(resolveEmbed('')).toBeNull();
    expect(resolveEmbed('https://example.com/some/page')).toBeNull();
    expect(resolveEmbed('javascript:alert(1)')).toBeNull();
    expect(resolveEmbed('https://www.youtube.com/watch')).toBeNull();
    expect(resolveEmbed('/notes/plan.md')).toBeNull();
  });

  it('refuses an id that carries more than an id', () => {
    expect(resolveEmbed('https://www.youtube.com/watch?v=../../evil')).toBeNull();
    expect(resolveEmbed('https://www.loom.com/share/a%22onload%3Dx')).toBeNull();
  });
});

describe('readEmbed reads stored HTML back', () => {
  it('accepts what embedHtml wrote', () => {
    const embed = resolveEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(embed).not.toBeNull();
    expect(readEmbed(embedHtml(embed!))).toEqual(embed);
  });

  it('accepts a hand-written frame on an allowed host', () => {
    const found = readEmbed('<iframe src="https://player.vimeo.com/video/76979871"></iframe>');
    expect(found).toEqual({
      provider: 'Vimeo',
      kind: 'iframe',
      src: 'https://player.vimeo.com/video/76979871',
      needsParent: false,
    });
  });

  it('keeps nothing but the source, so an event handler cannot travel with it', () => {
    const found = readEmbed(
      '<iframe onload="alert(1)" src="https://www.loom.com/embed/abc123" sandbox="allow-scripts"></iframe>',
    );
    expect(found).toEqual({
      provider: 'Loom',
      kind: 'iframe',
      src: 'https://www.loom.com/embed/abc123',
      needsParent: false,
    });
  });

  it('undoes the escapes the attribute was written with', () => {
    expect(readEmbed('<iframe src="https://streamable.com/e/abc123?a=1&amp;b=2"></iframe>')?.src).toBe(
      'https://streamable.com/e/abc123?a=1&b=2',
    );
  });

  it('refuses a host that is not on the list', () => {
    expect(readEmbed('<iframe src="https://evil.example.com/x"></iframe>')).toBeNull();
    expect(readEmbed('<iframe src="https://notyoutube.com/embed/a"></iframe>')).toBeNull();
  });

  it('refuses a frame that is not https', () => {
    expect(readEmbed('<iframe src="http://www.loom.com/embed/abc123"></iframe>')).toBeNull();
    expect(readEmbed('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
  });

  it('refuses a video that does not name a media file', () => {
    expect(readEmbed('<video src="/notes/plan.md" controls></video>')).toBeNull();
    expect(readEmbed('<video src="javascript:alert(1)"></video>')).toBeNull();
    expect(readEmbed('<div class="gd-video"><video src="/a/b.mp4" controls></video></div>')?.kind).toBe(
      'video',
    );
  });

  it('leaves ordinary raw HTML alone', () => {
    expect(readEmbed('<div align="center">\n  <b>raw</b>\n</div>')).toBeNull();
    expect(readEmbed('<!-- a note -->')).toBeNull();
    expect(readEmbed('<iframe></iframe>')).toBeNull();
  });
});

describe('playerSrc', () => {
  it('names the embedding host for Twitch only', () => {
    const twitch = resolveEmbed('https://www.twitch.tv/somechannel');
    const loom = resolveEmbed('https://www.loom.com/share/abc123');
    expect(playerSrc(twitch!, 'docs.example.com')).toBe(
      'https://player.twitch.tv/?channel=somechannel&parent=docs.example.com',
    );
    expect(playerSrc(loom!, 'docs.example.com')).toBe('https://www.loom.com/embed/abc123');
  });
});

describe('an embed in a document', () => {
  it('is one HTML block, and is written back unchanged', () => {
    const embed = resolveEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const source = `${embedHtml(embed!)}\n`;
    const instance = open(source);
    expect(instance.state.doc.firstChild?.type.name).toBe('htmlBlock');
    expect(roundtrip(source)).toBe(source);
  });

  it('is one HTML block for a media file too', () => {
    const source = `${embedHtml(resolveEmbed('/_assets/pg_1/clip.mp4')!)}\n`;
    expect(open(source).state.doc.firstChild?.type.name).toBe('htmlBlock');
    expect(roundtrip(source)).toBe(source);
  });
});

describe('page embeds', () => {
  it('parses `![[path]]` on its own line', () => {
    const node = open('![[eng/deploy]]\n').state.doc.firstChild;
    expect(node?.type.name).toBe('pageEmbed');
    expect(node?.attrs['target']).toBe('eng/deploy');
  });

  it('does not interrupt a paragraph, the way every other reader reads it', () => {
    const source = 'Intro:\n![[eng/deploy]]\n';
    expect(open(source).state.doc.firstChild?.type.name).toBe('paragraph');
    expect(roundtrip(source)).toBe(source);
  });

  it('is an indented code block at four columns', () => {
    expect(open('    ![[eng/deploy]]\n').state.doc.firstChild?.type.name).toBe('codeBlock');
  });

  it('is plain text when the line holds anything else', () => {
    expect(open('![[a]] and more\n').state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('is inserted by the command', () => {
    const instance = open('');
    instance.commands.insertPageEmbed('eng/deploy');
    expect(toMarkdown(instance)).toBe('![[eng/deploy]]\n');
  });
});
