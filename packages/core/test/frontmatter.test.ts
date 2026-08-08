import { describe, expect, it } from 'vitest';
import { isPageId, newPageId, type Frontmatter } from '@gitdocs/shared';
import {
  firstHeading,
  frontmatterEqual,
  normalizeBody,
  parse,
  serialize,
  serializePreserving,
  stringifyFrontmatter,
  titleize,
} from '../src/frontmatter.js';

const ID = 'pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V1';
const CREATED = '2026-01-02T03:04:05.000Z';
const UPDATED = '2026-01-02T03:04:06.000Z';

function base(overrides: Partial<Frontmatter> = {}): Frontmatter {
  return { id: ID, title: 'A page', created: CREATED, updated: UPDATED, ...overrides };
}

describe('serialize', () => {
  it('writes the contract key order', () => {
    const out = serialize(
      base({
        title: 'Deploy',
        icon: 'D',
        tags: ['ops', 'runbook'],
        order: 2,
        props: { status: 'live', owner: 'infra' },
      }),
      '# Deploy\n',
    );
    expect(out.split('\n').slice(1, 10)).toEqual([
      `id: ${ID}`,
      'title: Deploy',
      'icon: "D"',
      'tags: [ops, runbook]',
      'order: 2',
      `created: ${CREATED}`,
      `updated: ${UPDATED}`,
      'props:',
      '  status: live',
    ]);
  });

  it('omits empty optional fields', () => {
    const out = serialize(base({ tags: [], props: {} }), 'hi');
    expect(out).not.toContain('tags:');
    expect(out).not.toContain('props:');
    expect(out).not.toContain('icon:');
    expect(out).not.toContain('order:');
  });

  it('ends with a single newline and no body block when the body is empty', () => {
    expect(serialize(base(), '   \n\n ')).toBe(
      `---\nid: ${ID}\ntitle: A page\ncreated: ${CREATED}\nupdated: ${UPDATED}\n---\n`,
    );
  });
});

describe('round trip', () => {
  const hostile: [string, string][] = [
    ['a colon pair', 'foo: bar'],
    ['a truthy word', 'yes'],
    ['a falsy word', 'No'],
    ['the word null', 'null'],
    ['a tilde', '~'],
    ['a version number', '1.0'],
    ['an integer', '42'],
    ['a hex literal', '0x1F'],
    ['a sexagesimal', '12:30'],
    ['a date', '2026-01-02'],
    ['leading and trailing spaces', '  padded  '],
    ['a leading dash', '- not a list'],
    ['a leading hash', '#tag'],
    ['a trailing colon', 'Chapter:'],
    ['an inline comment marker', 'ship it # now'],
    ['a quote character', 'the "best" page'],
    ['a backslash', 'C:\\Users\\dev'],
    ['a brace', '{ not a map }'],
    ['a bracket', '[not, a, list]'],
    ['a newline', 'line one\nline two'],
    ['a tab', 'left\tright'],
    ['an emoji', 'Ship it \u{1F680}'],
  ];

  for (const [label, value] of hostile) {
    it(`keeps a title with ${label} byte identical`, () => {
      const original = serialize(base({ title: value }), 'body text');
      const parsed = parse(original);
      expect(parsed.frontmatter.title).toBe(value);
      expect(parsed.repaired).toBe(false);
      expect(serialize(parsed.frontmatter, parsed.body)).toBe(original);
      expect(serializePreserving(parsed, parsed.frontmatter, parsed.body)).toBe(original);
    });

    it(`keeps a prop and a tag with ${label} byte identical`, () => {
      // A tag is always trimmed, so the canonical file never carries an untrimmed one.
      const tag = value.trim();
      const original = serialize(base({ tags: [tag], props: { note: value } }), 'body');
      const parsed = parse(original);
      expect(parsed.frontmatter.tags).toEqual([tag]);
      expect(parsed.frontmatter.props?.['note']).toBe(value);
      expect(parsed.repaired).toBe(false);
      expect(serialize(parsed.frontmatter, parsed.body)).toBe(original);
    });
  }

  it('keeps hostile prop keys byte identical', () => {
    const props = { 'due: date': '2026-03-01', 'has space': 'yes', normal: 'ok' };
    const original = serialize(base({ props }), 'body');
    const parsed = parse(original);
    expect(parsed.frontmatter.props).toEqual(props);
    expect(parsed.repaired).toBe(false);
    expect(serialize(parsed.frontmatter, parsed.body)).toBe(original);
  });

  it('keeps mixed prop value types', () => {
    const props = { count: 3, ready: true, missing: null, list: ['a', 'b'], ratio: -0.5 };
    const original = serialize(base({ props }), 'body');
    const parsed = parse(original);
    expect(parsed.frontmatter.props).toEqual(props);
    expect(parsed.repaired).toBe(false);
    expect(serialize(parsed.frontmatter, parsed.body)).toBe(original);
  });

  it('hands back the original bytes when nothing changed', () => {
    const original = serialize(base({ icon: 'X', order: 1 }), 'Hello\n\nWorld');
    const parsed = parse(original);
    expect(serializePreserving(parsed, parsed.frontmatter, parsed.body)).toBe(parsed.raw);
  });

  it('re-serializes once a field actually changes', () => {
    const original = serialize(base(), 'body');
    const parsed = parse(original);
    const next = { ...parsed.frontmatter, title: 'Renamed' };
    const out = serializePreserving(parsed, next, parsed.body);
    expect(out).not.toBe(original);
    expect(out).toContain('title: Renamed');
  });

  it('never preserves the bytes of a repaired file', () => {
    const parsed = parse('# Bare\n\nNo frontmatter here.\n');
    expect(parsed.repaired).toBe(true);
    const out = serializePreserving(parsed, parsed.frontmatter, parsed.body);
    expect(out.startsWith('---\n')).toBe(true);
  });
});

describe('repair', () => {
  it('invents an id and takes the title from the first heading', () => {
    const parsed = parse('# Deploy runbook\n\nSteps.\n', { filename: 'deploy' });
    expect(isPageId(parsed.frontmatter.id)).toBe(true);
    expect(parsed.frontmatter.title).toBe('Deploy runbook');
    expect(parsed.body).toBe('# Deploy runbook\n\nSteps.');
    expect(parsed.repaired).toBe(true);
  });

  it('falls back to the filename when there is no heading', () => {
    const parsed = parse('Just prose.\n', { filename: 'getting-started' });
    expect(parsed.frontmatter.title).toBe('Getting started');
  });

  it('falls back to Untitled with no heading and no filename', () => {
    expect(parse('text').frontmatter.title).toBe('Untitled');
  });

  it('reuses the id supplied by the caller', () => {
    const id = newPageId();
    expect(parse('# Hi\n', { fallbackId: id }).frontmatter.id).toBe(id);
  });

  it('keeps a valid id and repairs only the missing parts', () => {
    const parsed = parse(`---\nid: ${ID}\n---\n\n# Real title\n`);
    expect(parsed.frontmatter.id).toBe(ID);
    expect(parsed.frontmatter.title).toBe('Real title');
    expect(parsed.repaired).toBe(true);
  });

  it('folds unknown top-level keys into props', () => {
    const parsed = parse(`---\nid: ${ID}\ntitle: T\nstatus: live\nowner: infra\n---\n\nbody\n`);
    expect(parsed.frontmatter.props).toEqual({ status: 'live', owner: 'infra' });
    expect(parsed.repaired).toBe(true);
  });

  it('splits a comma separated tag string', () => {
    const parsed = parse(`---\nid: ${ID}\ntitle: T\ntags: ops, infra\n---\n`);
    expect(parsed.frontmatter.tags).toEqual(['ops', 'infra']);
  });

  it('keeps the body and the id when the YAML block is broken', () => {
    const raw = `---\nid: ${ID}\ntitle: [unclosed\n---\n\nreal content\n`;
    const parsed = parse(raw);
    expect(parsed.blockBroken).toBe(true);
    expect(parsed.frontmatter.id).toBe(ID);
    expect(parsed.body).toBe('real content');
    // A file YAML cannot read is never rewritten: doing so would mint a second id and
    // inline the old block into the body as prose.
    expect(parsed.repaired).toBe(false);
    expect(serializePreserving(parsed, parsed.frontmatter, parsed.body)).toBe(raw);
  });

  it('recovers every simple scalar from a block with an unquoted colon', () => {
    const raw = `---\nid: ${ID}\ntitle: foo: bar\ncreated: ${CREATED}\nupdated: ${UPDATED}\n---\n\nBody survives?\n`;
    const parsed = parse(raw);
    expect(parsed.blockBroken).toBe(true);
    expect(parsed.frontmatter).toEqual({
      id: ID,
      title: 'foo: bar',
      created: CREATED,
      updated: UPDATED,
    });
    expect(parsed.body).toBe('Body survives?');
    expect(parsed.repaired).toBe(false);
  });

  it('drops a leading byte order mark', () => {
    const bom = String.fromCharCode(0xfeff);
    const parsed = parse(`${bom}---\nid: ${ID}\ntitle: T\ncreated: ${CREATED}\nupdated: ${UPDATED}\n---\n\nx\n`);
    expect(parsed.frontmatter.title).toBe('T');
    expect(parsed.repaired).toBe(false);
  });

  it('accepts an unquoted ISO timestamp that YAML turns into a date', () => {
    const parsed = parse(
      `---\nid: ${ID}\ntitle: T\ncreated: ${CREATED}\nupdated: ${UPDATED}\n---\n\nx\n`,
    );
    expect(parsed.frontmatter.created).toBe(CREATED);
    expect(parsed.frontmatter.updated).toBe(UPDATED);
    expect(parsed.repaired).toBe(false);
  });
});

describe('YAML 1.1 coercion', () => {
  const head = `---\nid: ${ID}\n`;
  const tail = `created: ${CREATED}\nupdated: ${UPDATED}\n---\n\nBody.\n`;

  const coerced: [string, string][] = [
    ['an octal-looking title', '0123'],
    ['a version-number title', '1.0'],
    ['a bare year title', '2026'],
    ['a hex-looking title', '0x1f'],
    ['a bare date title', '2026-08-08'],
  ];

  for (const [label, value] of coerced) {
    it(`keeps ${label} exactly as written`, () => {
      const raw = `${head}title: ${value}\n${tail}`;
      const parsed = parse(raw);
      expect(parsed.frontmatter.title).toBe(value);
      // Nothing was invented, so the file keeps its bytes.
      expect(parsed.repaired).toBe(false);
      expect(serializePreserving(parsed, parsed.frontmatter, parsed.body)).toBe(raw);
    });
  }

  it('keeps coerced prop values exactly as written', () => {
    const raw = `${head}title: T\n${tail.replace('---\n\nBody.', 'props:\n  a: 0123\n  b: 1.0\n  c: 3\n  d: -0.5\n  e: null\n---\n\nBody.')}`;
    const parsed = parse(raw);
    expect(parsed.frontmatter.props).toEqual({ a: '0123', b: '1.0', c: 3, d: -0.5, e: null });
    expect(parsed.repaired).toBe(false);
    expect(serializePreserving(parsed, parsed.frontmatter, parsed.body)).toBe(raw);
  });

  it('keeps a nested props map as its JSON text instead of deleting it', () => {
    const raw = `${head}title: T\n${tail.replace('---\n\nBody.', 'props:\n  owner:\n    name: me\n---\n\nBody.')}`;
    const parsed = parse(raw);
    expect(parsed.frontmatter.props).toEqual({ owner: '{"name":"me"}' });
    expect(parsed.repaired).toBe(false);
    expect(serializePreserving(parsed, parsed.frontmatter, parsed.body)).toBe(raw);
  });
});

describe('a file whose first line is a thematic break', () => {
  it('keeps the body when there is one rule', () => {
    const parsed = parse('---\n\nJust a rule then all the real content.\n');
    expect(parsed.body).toBe('---\n\nJust a rule then all the real content.');
    expect(parsed.blockBroken).toBe(false);
    expect(serialize(parsed.frontmatter, parsed.body)).toContain(
      'Just a rule then all the real content.',
    );
  });

  it('keeps the text between two rules', () => {
    const parsed = parse('---\n\nIntro paragraph.\n\n---\n\nRest of the doc.\n');
    expect(parsed.body).toContain('Intro paragraph.');
    expect(parsed.body).toContain('Rest of the doc.');
  });
});

describe('helpers', () => {
  it('normalizes line endings and trims the edges of a body', () => {
    expect(normalizeBody('\r\n\r\nHello\r\nWorld\n\n  ')).toBe('Hello\nWorld');
  });

  it('ignores headings inside fenced code', () => {
    expect(firstHeading('```\n# Not a title\n```\n\n# Real title\n')).toBe('Real title');
  });

  it('reads a setext heading', () => {
    expect(firstHeading('Real title\n==========\n')).toBe('Real title');
  });

  it('titleizes a slug', () => {
    expect(titleize('deploy_runbook-v2')).toBe('Deploy runbook v2');
    expect(titleize('')).toBe('Untitled');
  });

  it('compares frontmatter including prop key order', () => {
    const a = base({ props: { x: '1', y: '2' } });
    const b = base({ props: { y: '2', x: '1' } });
    expect(frontmatterEqual(a, b)).toBe(false);
    expect(frontmatterEqual(a, base({ props: { x: '1', y: '2' } }))).toBe(true);
  });

  it('renders a block without the document markers', () => {
    expect(stringifyFrontmatter(base())).toBe(
      `id: ${ID}\ntitle: A page\ncreated: ${CREATED}\nupdated: ${UPDATED}`,
    );
  });
});
