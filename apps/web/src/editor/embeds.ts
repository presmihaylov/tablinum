/**
 * Video embeds ride on ordinary raw HTML, so a page that holds a player is still a
 * plain markdown file and the round trip needs no new rule.
 *
 * Nothing the file holds is ever injected as live DOM. The source URL is read back
 * out, matched against the host allowlist, and the player is rebuilt from a fixed
 * template, so a hand-written `<iframe onload=...>` can never reach the page.
 */
import { escapeHtml } from './markdown';

export type EmbedKind = 'iframe' | 'video';

export interface Embed {
  /** The provider's display name, used for the frame title and the caption. */
  provider: string;
  kind: EmbedKind;
  src: string;
  /** Twitch plays nothing unless the embedding host is named in the URL. */
  needsParent: boolean;
}

interface Provider {
  name: string;
  /** Page hosts, with any `www.` already stripped. */
  hosts: readonly string[];
  /** Hosts an embed may point at. A stored file can frame nothing else. */
  embedHosts: readonly string[];
  needsParent: boolean;
  /** The embed URL for one of this provider's page URLs, or null for anything else. */
  embed: (url: URL) => string | null;
}

const PROVIDERS: readonly Provider[] = [
  {
    name: 'YouTube',
    hosts: ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'],
    embedHosts: ['youtube.com', 'youtube-nocookie.com'],
    needsParent: false,
    embed: youtubeEmbed,
  },
  {
    name: 'Vimeo',
    hosts: ['vimeo.com', 'player.vimeo.com'],
    embedHosts: ['player.vimeo.com'],
    needsParent: false,
    embed: vimeoEmbed,
  },
  {
    name: 'Loom',
    hosts: ['loom.com'],
    embedHosts: ['loom.com'],
    needsParent: false,
    embed: loomEmbed,
  },
  {
    name: 'Wistia',
    hosts: ['wistia.com', 'home.wistia.com', 'fast.wistia.net', 'fast.wistia.com'],
    embedHosts: ['fast.wistia.net'],
    needsParent: false,
    embed: wistiaEmbed,
  },
  {
    name: 'Dailymotion',
    hosts: ['dailymotion.com', 'dai.ly', 'geo.dailymotion.com'],
    embedHosts: ['dailymotion.com', 'geo.dailymotion.com'],
    needsParent: false,
    embed: dailymotionEmbed,
  },
  {
    name: 'Twitch',
    hosts: ['twitch.tv', 'clips.twitch.tv', 'player.twitch.tv'],
    embedHosts: ['player.twitch.tv', 'clips.twitch.tv'],
    needsParent: true,
    embed: twitchEmbed,
  },
  {
    name: 'Streamable',
    hosts: ['streamable.com'],
    embedHosts: ['streamable.com'],
    needsParent: false,
    embed: streamableEmbed,
  },
];

/** Named in the `/video` prompt, so the list the user reads is the list that works. */
export const EMBED_PROVIDERS: readonly string[] = PROVIDERS.map((provider) => provider.name);

const BY_EMBED_HOST = new Map<string, Provider>(
  PROVIDERS.flatMap((provider) => provider.embedHosts.map((name) => [name, provider] as const)),
);

const MEDIA_FILE = /\.(mp4|webm|ogv|ogg|mov|m4v)$/i;

/**
 * The player a URL describes, or null when nothing here can play it. The input is
 * whatever the author pasted: a watch page, a share link or a media file.
 */
export function resolveEmbed(input: string): Embed | null {
  const text = input.trim();
  if (text.length === 0) return null;
  // A site-relative asset path, which is what an upload hands back.
  if (isLocalPath(text) && MEDIA_FILE.test(pathOnly(text))) return mediaEmbed(text);

  const url = toUrl(text);
  if (!url) return null;
  for (const provider of PROVIDERS) {
    if (!provider.hosts.includes(host(url))) continue;
    const src = provider.embed(url);
    if (src !== null) {
      return { provider: provider.name, kind: 'iframe', src, needsParent: provider.needsParent };
    }
  }
  return MEDIA_FILE.test(url.pathname) ? mediaEmbed(url.toString()) : null;
}

const FRAME_ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture';

/** The markdown the file stores. One line, so it stays a single HTML block. */
export function embedHtml(embed: Embed): string {
  const src = escapeHtml(embed.src);
  if (embed.kind === 'video') {
    return `<div class="gd-video"><video src="${src}" controls></video></div>`;
  }
  const title = escapeHtml(embed.provider);
  return `<iframe src="${src}" title="${title}" allow="${FRAME_ALLOW}" allowfullscreen></iframe>`;
}

const TAG = /<(iframe|video)\b([^>]*)>/i;
const SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * The player a stored HTML block describes, or null when it is raw HTML like any
 * other. This is the security boundary: everything it returns was checked here.
 */
export function readEmbed(raw: string): Embed | null {
  const tag = TAG.exec(raw);
  if (!tag) return null;
  const found = SRC.exec(tag[2] ?? '');
  const src = unescapeHtml(found?.[1] ?? found?.[2] ?? '');
  if (src.length === 0) return null;
  return (tag[1] ?? '').toLowerCase() === 'video' ? readMedia(src) : readFrame(src);
}

/** The URL the player really loads. Twitch reads the embedding host from it. */
export function playerSrc(embed: Embed, hostname: string): string {
  if (!embed.needsParent) return embed.src;
  const join = embed.src.includes('?') ? '&' : '?';
  return `${embed.src}${join}parent=${encodeURIComponent(hostname)}`;
}

function readMedia(src: string): Embed | null {
  if (isLocalPath(src)) return MEDIA_FILE.test(pathOnly(src)) ? mediaEmbed(src) : null;
  const url = toUrl(src);
  if (!url || !MEDIA_FILE.test(url.pathname)) return null;
  return mediaEmbed(url.toString());
}

function readFrame(src: string): Embed | null {
  const url = toUrl(src);
  if (!url || url.protocol !== 'https:') return null;
  const provider = BY_EMBED_HOST.get(host(url));
  if (!provider) return null;
  return {
    provider: provider.name,
    kind: 'iframe',
    src: url.toString(),
    needsParent: provider.needsParent,
  };
}

function mediaEmbed(src: string): Embed {
  return { provider: 'Video', kind: 'video', src, needsParent: false };
}

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------

const YOUTUBE_PATHS = ['embed', 'shorts', 'live', 'v'];

function youtubeEmbed(url: URL): string | null {
  const video = youtubeId(url);
  if (video === null) return null;
  const start = startSeconds(url);
  return `https://www.youtube.com/embed/${video}${start === null ? '' : `?start=${start}`}`;
}

function youtubeId(url: URL): string | null {
  const parts = segments(url);
  if (host(url) === 'youtu.be') return safeId(parts[0]);
  if (parts[0] === 'watch') return safeId(url.searchParams.get('v'));
  if (parts[0] !== undefined && YOUTUBE_PATHS.includes(parts[0])) return safeId(parts[1]);
  return null;
}

const UNLISTED = /^[0-9a-f]{6,40}$/i;

function vimeoEmbed(url: URL): string | null {
  const parts = segments(url);
  const at = parts.findIndex((part) => /^\d+$/.test(part));
  const video = at === -1 ? null : safeId(parts[at]);
  if (video === null) return null;
  // An unlisted video is only reachable with its hash, written either way round.
  const next = parts[at + 1];
  const hash =
    next !== undefined && UNLISTED.test(next) ? next : (url.searchParams.get('h') ?? null);
  const query = hash !== null && UNLISTED.test(hash) ? `?h=${hash}` : '';
  return `https://player.vimeo.com/video/${video}${query}`;
}

const LOOM_PATHS = ['share', 'embed', 'v'];

function loomEmbed(url: URL): string | null {
  const parts = segments(url);
  if (parts[0] === undefined || !LOOM_PATHS.includes(parts[0])) return null;
  const video = safeId(parts[1]);
  return video === null ? null : `https://www.loom.com/embed/${video}`;
}

function wistiaEmbed(url: URL): string | null {
  const parts = segments(url);
  const at = parts.indexOf('medias');
  const from = at === -1 ? parts.indexOf('iframe') : at;
  const video = from === -1 ? null : safeId(parts[from + 1]);
  return video === null ? null : `https://fast.wistia.net/embed/iframe/${video}`;
}

function dailymotionEmbed(url: URL): string | null {
  const parts = segments(url);
  if (host(url) === 'dai.ly') {
    const short = safeId(parts[0]);
    return short === null ? null : `https://www.dailymotion.com/embed/video/${short}`;
  }
  const at = parts.indexOf('video');
  const video = at === -1 ? null : safeId(parts[at + 1]);
  return video === null ? null : `https://www.dailymotion.com/embed/video/${video}`;
}

function twitchEmbed(url: URL): string | null {
  const parts = segments(url);
  if (host(url) === 'clips.twitch.tv') return clipEmbed(safeId(parts[0]));
  if (host(url) === 'player.twitch.tv') {
    const video = safeId(url.searchParams.get('video'));
    if (video !== null) return `https://player.twitch.tv/?video=${video}`;
    const channel = safeId(url.searchParams.get('channel'));
    return channel === null ? null : `https://player.twitch.tv/?channel=${channel}`;
  }
  if (parts[0] === 'videos') {
    const video = safeId(parts[1]);
    return video === null ? null : `https://player.twitch.tv/?video=${video}`;
  }
  if (parts[1] === 'clip') return clipEmbed(safeId(parts[2]));
  const channel = safeId(parts[0]);
  return channel === null ? null : `https://player.twitch.tv/?channel=${channel}`;
}

function clipEmbed(slug: string | null): string | null {
  return slug === null ? null : `https://clips.twitch.tv/embed?clip=${slug}`;
}

function streamableEmbed(url: URL): string | null {
  const parts = segments(url);
  const video = safeId(parts[0] === 'e' ? parts[1] : parts[0]);
  return video === null ? null : `https://streamable.com/e/${video}`;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const ID = /^[\w-]{1,64}$/;

/** Only an id that can hold no path, query or fragment may go into a template URL. */
function safeId(value: string | null | undefined): string | null {
  return typeof value === 'string' && ID.test(value) ? value : null;
}

function segments(url: URL): string[] {
  return url.pathname.split('/').filter((part) => part.length > 0);
}

function host(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

/** Same origin, so `//host/x` is excluded: that one names another site. */
function isLocalPath(text: string): boolean {
  return text.startsWith('/') && !text.startsWith('//');
}

function pathOnly(text: string): string {
  return text.split(/[?#]/)[0] ?? text;
}

/** Accepts `youtu.be/x` as readily as the full URL. Only http and https get through. */
function toUrl(text: string): URL | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const CLOCK = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/;

/** `t=90`, `t=1m30s` and `start=90` all name the same offset. */
function startSeconds(url: URL): number | null {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  const match = raw === null ? null : CLOCK.exec(raw);
  if (!match) return null;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return total > 0 ? total : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
};

/** An attribute read back out of stored HTML still carries the escapes it was written with. */
function unescapeHtml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#39);/g, (whole, name: string) => {
    return ENTITIES[name] ?? whole;
  });
}
