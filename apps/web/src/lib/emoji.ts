export interface EmojiEntry {
  char: string;
  name: string;
  keywords: readonly string[];
}

/**
 * A short, curated list. A full emoji database would be a megabyte of data for a
 * feature used a few times a page, and every entry here is a plain UTF-8
 * character that a markdown file can hold as-is.
 */
export const EMOJI: readonly EmojiEntry[] = [
  { char: '😀', name: 'grinning', keywords: ['smile', 'happy'] },
  { char: '😄', name: 'smile', keywords: ['happy', 'joy'] },
  { char: '😉', name: 'wink', keywords: ['joke'] },
  { char: '🙂', name: 'slight smile', keywords: ['happy'] },
  { char: '😅', name: 'sweat smile', keywords: ['relief', 'phew'] },
  { char: '😂', name: 'joy', keywords: ['laugh', 'tears'] },
  { char: '🤔', name: 'thinking', keywords: ['hmm', 'question'] },
  { char: '😴', name: 'sleeping', keywords: ['tired', 'zzz'] },
  { char: '😐', name: 'neutral', keywords: ['meh'] },
  { char: '😬', name: 'grimacing', keywords: ['awkward'] },
  { char: '😱', name: 'scream', keywords: ['fear', 'panic'] },
  { char: '🥳', name: 'party face', keywords: ['celebrate'] },
  { char: '😎', name: 'sunglasses', keywords: ['cool'] },
  { char: '🤖', name: 'robot', keywords: ['bot', 'agent', 'automation'] },
  { char: '👍', name: 'thumbs up', keywords: ['yes', 'approve', 'lgtm'] },
  { char: '👎', name: 'thumbs down', keywords: ['no', 'reject'] },
  { char: '👏', name: 'clap', keywords: ['applause', 'praise'] },
  { char: '🙏', name: 'pray', keywords: ['thanks', 'please'] },
  { char: '💪', name: 'muscle', keywords: ['strong'] },
  { char: '👀', name: 'eyes', keywords: ['look', 'review', 'watch'] },
  { char: '🧠', name: 'brain', keywords: ['think', 'smart'] },
  { char: '❤️', name: 'heart', keywords: ['love'] },
  { char: '🔥', name: 'fire', keywords: ['hot', 'urgent', 'burn'] },
  { char: '✨', name: 'sparkles', keywords: ['new', 'shiny', 'magic'] },
  { char: '🎉', name: 'party popper', keywords: ['celebrate', 'launch', 'ship'] },
  { char: '🚀', name: 'rocket', keywords: ['launch', 'ship', 'deploy', 'fast'] },
  { char: '🛠️', name: 'tools', keywords: ['build', 'fix', 'maintenance'] },
  { char: '🔧', name: 'wrench', keywords: ['fix', 'config'] },
  { char: '🐛', name: 'bug', keywords: ['defect', 'issue', 'error'] },
  { char: '⚙️', name: 'gear', keywords: ['settings', 'config', 'system'] },
  { char: '🧪', name: 'test tube', keywords: ['test', 'experiment', 'lab'] },
  { char: '📦', name: 'package', keywords: ['release', 'box', 'module'] },
  { char: '📈', name: 'chart up', keywords: ['growth', 'metrics', 'graph'] },
  { char: '📉', name: 'chart down', keywords: ['decline', 'metrics'] },
  { char: '📊', name: 'bar chart', keywords: ['data', 'report', 'analytics'] },
  { char: '🗓️', name: 'calendar', keywords: ['date', 'schedule', 'plan'] },
  { char: '⏱️', name: 'stopwatch', keywords: ['time', 'latency', 'speed'] },
  { char: '📝', name: 'memo', keywords: ['note', 'write', 'doc', 'edit'] },
  { char: '📄', name: 'page', keywords: ['doc', 'file'] },
  { char: '📚', name: 'books', keywords: ['docs', 'library', 'reference'] },
  { char: '🔖', name: 'bookmark', keywords: ['tag', 'save'] },
  { char: '📌', name: 'pushpin', keywords: ['pin', 'important'] },
  { char: '🔍', name: 'magnifier', keywords: ['search', 'find', 'inspect'] },
  { char: '🔗', name: 'link', keywords: ['url', 'reference'] },
  { char: '🔒', name: 'lock', keywords: ['secure', 'private', 'auth'] },
  { char: '🔑', name: 'key', keywords: ['secret', 'token', 'credential'] },
  { char: '🛡️', name: 'shield', keywords: ['security', 'protect'] },
  { char: '⚠️', name: 'warning', keywords: ['caution', 'danger'] },
  { char: '🚨', name: 'siren', keywords: ['alert', 'incident', 'urgent'] },
  { char: '✅', name: 'check', keywords: ['done', 'ok', 'pass', 'yes'] },
  { char: '❌', name: 'cross', keywords: ['no', 'fail', 'remove'] },
  { char: '⭐', name: 'star', keywords: ['favourite', 'rating'] },
  { char: '💡', name: 'bulb', keywords: ['idea', 'tip', 'insight'] },
  { char: '❓', name: 'question', keywords: ['help', 'ask', 'unknown'] },
  { char: '❗', name: 'exclamation', keywords: ['important', 'alert'] },
  { char: '🧭', name: 'compass', keywords: ['direction', 'guide', 'north'] },
  { char: '🗺️', name: 'map', keywords: ['roadmap', 'plan', 'overview'] },
  { char: '🏗️', name: 'construction', keywords: ['wip', 'building', 'draft'] },
  { char: '🧹', name: 'broom', keywords: ['cleanup', 'chore', 'tidy'] },
  { char: '🗑️', name: 'wastebasket', keywords: ['delete', 'trash', 'remove'] },
  { char: '💾', name: 'floppy disk', keywords: ['save', 'storage', 'disk'] },
  { char: '🖥️', name: 'desktop', keywords: ['computer', 'machine', 'host'] },
  { char: '☁️', name: 'cloud', keywords: ['server', 'hosting', 'sky'] },
  { char: '🌐', name: 'globe', keywords: ['web', 'internet', 'network'] },
  { char: '📡', name: 'satellite', keywords: ['signal', 'network', 'telemetry'] },
  { char: '🔋', name: 'battery', keywords: ['power', 'energy'] },
  { char: '🧩', name: 'puzzle', keywords: ['plugin', 'extension', 'piece'] },
  { char: '🎯', name: 'target', keywords: ['goal', 'objective', 'aim'] },
  { char: '🏁', name: 'chequered flag', keywords: ['finish', 'done', 'race'] },
  { char: '🥇', name: 'gold medal', keywords: ['first', 'win', 'best'] },
  { char: '🧵', name: 'thread', keywords: ['sequence', 'discussion'] },
  { char: '☕', name: 'coffee', keywords: ['break', 'morning'] },
  { char: '🍕', name: 'pizza', keywords: ['food', 'lunch'] },
  { char: '🌱', name: 'seedling', keywords: ['growth', 'new', 'start'] },
  { char: '🌍', name: 'earth', keywords: ['world', 'global'] },
  { char: '⚡', name: 'zap', keywords: ['fast', 'power', 'performance'] },
  { char: '🌈', name: 'rainbow', keywords: ['colour', 'variety'] },
  { char: '🕵️', name: 'detective', keywords: ['investigate', 'debug', 'audit'] },
  { char: '🧑‍💻', name: 'developer', keywords: ['engineer', 'code', 'work'] },
];

/** Higher is worse. `MISS` drops the entry. */
const MISS = 9;

function rank(entry: EmojiEntry, needle: string): number {
  if (entry.name === needle) return 0;
  if (entry.name.startsWith(needle)) return 1;
  if (entry.name.split(' ').some((word) => word.startsWith(needle))) return 2;
  if (entry.name.includes(needle)) return 3;
  if (entry.keywords.includes(needle)) return 4;
  if (entry.keywords.some((keyword) => keyword.startsWith(needle))) return 5;
  return MISS;
}

/**
 * Best match first: the whole name, then its start, then a word of it, then a
 * keyword. A tie keeps the order of the list above, and the sort is stable.
 */
export function filterEmoji(query: string): EmojiEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...EMOJI];
  return EMOJI.map((entry) => ({ entry, score: rank(entry, needle) }))
    .filter((row) => row.score < MISS)
    .sort((a, b) => a.score - b.score)
    .map((row) => row.entry);
}
