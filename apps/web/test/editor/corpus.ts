/**
 * Every construct the editor claims to support, written the way a human or an
 * agent would write it in a `.md` file. Each entry must survive
 * markdown -> ProseMirror -> markdown byte for byte.
 */
export const CORPUS: Record<string, string> = {
  'atx headings': '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n',

  'setext headings': 'Title\n=====\n\nSubtitle\n--------\n',

  'heading with closing hashes': '## Two ##\n',

  'heading with trailing spaces': '# Title  \n',

  'setext heading with trailing spaces': 'Title\n=====  \n',

  'setext heading with an indented underline': 'Title\n  =====\n',

  'empty heading': '#\n\n# \n',

  'heading followed by its body': '# Title\nThe body starts on the next line.\n',

  'heading followed by a list': '## Steps\n- one\n- two\n',

  'fence followed by text': '```sh\nls\n```\nAfter the fence.\n',

  'rule followed by text': '---\nAfter the rule.\n',

  'comment followed by text': '<!-- a note -->\nAfter the comment.\n',

  'list followed by a heading': '- one\n- two\n# Next\n',

  paragraphs: 'First paragraph.\n\nSecond paragraph, longer, with a comma.\n',

  'inline marks': 'A *slanted*, a **heavy**, a ~~struck~~ and a `literal` run.\n',

  'underscore emphasis': 'An _alternate_ and an __alternate heavy__ run.\n',

  'intraword underscores': 'The value snake_case_name stays intact.\n',

  'inline code with asterisks': 'Compute `a * b * c` and `**not bold**` verbatim.\n',

  'inline code with backticks': 'Write ``a ` b`` when the span holds a backtick.\n',

  'escaped punctuation': 'A literal \\* star and a \\_ score and a \\# hash.\n',

  'bulleted list': '- alpha\n- beta\n- gamma\n',

  'star bullets': '* alpha\n* beta\n',

  'plus bullets': '+ alpha\n+ beta\n',

  'nested list three levels': '- one\n  - two\n    - three\n- back to one\n',

  'mixed nested list':
    '1. first\n   - inner bullet\n     1. deepest\n2. second\n',

  'ordered list': '1. one\n2. two\n3. three\n',

  'ordered list starting late': '7. seven\n8. eight\n',

  'ordered list past ten': '9. nine\n10. ten\n11. eleven\n',

  'ordered list paren delimiter': '1) one\n2) two\n',

  'loose list': '- first item\n\n- second item\n',

  'task list': '- [ ] unchecked\n- [x] checked\n- [X] shouting\n',

  'nested task list': '- [ ] parent\n  - [x] child\n',

  'task list with marks': '- [ ] read **the** docs\n',

  blockquote: '> A quoted line.\n> A second quoted line.\n',

  'blockquote with list': '> - first\n> - second\n',

  'blockquote with heading': '> ## Quoted heading\n>\n> And a body.\n',

  'nested blockquote': '> outer\n>\n> > inner\n',

  'callout note': '> [!NOTE]\n> Useful information.\n',

  'callout warning': '> [!WARNING]\n> Something can go wrong.\n',

  'callout with list': '> [!TIP]\n> - one\n> - two\n',

  'all callout kinds':
    '> [!NOTE]\n> n\n\n> [!TIP]\n> t\n\n> [!IMPORTANT]\n> i\n\n> [!WARNING]\n> w\n\n> [!CAUTION]\n> c\n',

  'fenced code': '```js\nconst answer = 41 + 1;\n```\n',

  'fenced code no language': '```\nplain text\n```\n',

  'fenced code with backticks': '````md\nA fence inside:\n\n```js\nlet a = 1;\n```\n````\n',

  'fenced code with dashes': '```yaml\n---\nid: pg_1\n---\n```\n',

  'fenced code with tildes': '~~~python\nprint("hi")\n~~~\n',

  'fenced code with blank lines': '```sh\none\n\nthree\n```\n',

  'fenced code empty': '```\n```\n',

  'indented code': '    indented code line\n    second line\n',

  'horizontal rules': '---\n\n***\n\n___\n',

  'gfm table': '| Name | Count |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |\n',

  'gfm table alignment':
    '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n',

  'gfm table with pipes in cells':
    '| Pattern | Meaning |\n| --- | --- |\n| `a \\| b` | a or b |\n| x \\| y | literal pipe |\n',

  'gfm table with marks':
    '| Field | Note |\n| --- | --- |\n| **id** | *stable* |\n| `path` | ~~old~~ |\n',

  'link inline': 'Read the [handbook](https://example.com/handbook).\n',

  'link with title': 'Read the [handbook](https://example.com "The handbook").\n',

  'link relative': 'See [the deploy page](../eng/deploy.md).\n',

  autolink: 'Ping <https://example.com/status> for uptime.\n',

  'image plain': '![A diagram](/_assets/pg_1/diagram.png)\n',

  'image with title': '![A diagram](/_assets/pg_1/diagram.png "Figure 1")\n',

  'image inline in text': 'Before ![icon](/_assets/pg_1/icon.png "Icon") after.\n',

  wikilink: 'See [[eng/deploy]] for the steps.\n',

  'wikilink with alias': 'See [[eng/deploy|the deploy runbook]] for the steps.\n',

  'wikilink in list': '- [[eng/deploy|Deploy]]\n- [[eng/rollback|Rollback]]\n',

  'reference link': 'See [the docs][ref].\n\n[ref]: https://example.com\n',

  'reference image': '![alt][img]\n\n[img]: /_assets/pg_1/a.png\n',

  'html comment': '<!-- a note for agents only -->\n',

  'html comment inline': 'Text <!-- hidden --> more text.\n',

  'html block': '<div align="center">\n  <b>raw</b>\n</div>\n',

  'html block details': '<details>\n<summary>More</summary>\n\nBody text.\n\n</details>\n',

  'html inline tag': 'Press <kbd>Esc</kbd> to close.\n',

  'html inline tag the schema knows': 'A <b>bold</b> and an <i>slanted</i> word.\n',

  'html inline break': 'One<br>Two\n',

  'html inline anchor': 'An <a href="https://example.com">anchor</a>.\n',

  'html inline image': 'An <img src="/_assets/pg_1/a.png" alt="a"> image.\n',

  'html inline span with attributes': 'A <span class="badge">span</span> here.\n',

  'html entity': 'Five &amp; six &lt; seven.\n',

  emoji: 'Ship it 🚀 and celebrate 🎉 with a 👍.\n',

  'emoji in heading': '# 🚀 Launch plan\n',

  cjk: '日本語のテキストと中文文本、그리고 한국어.\n',

  'cjk in list': '- 日本語\n- 中文\n- 한국어\n',

  'hard break backslash': 'first line\\\nsecond line\n',

  'hard break spaces': 'first line  \nsecond line\n',

  'soft wrap': 'first line\nsecond line\nthird line\n',

  'trailing space single': 'a line with one trailing space \nand a follower\n',

  'trailing whitespace at block end': 'a paragraph that ends in spaces   \n',

  'trailing tab at block end': 'a paragraph that ends in a tab\t\n',

  'no trailing newline': '# No newline at end of file',

  'blank lines between blocks': '# Head\n\n\nBody after two blank lines.\n',

  'leading blank lines': '\n\nStarts after blank lines.\n',

  'text that looks like syntax': 'a - b\n\n1. is not a list because of this sentence\n',

  'literal brackets': 'An array index a\\[0] and a \\[\\[not a wikilink]].\n',

  // --- deeper nesting -------------------------------------------------------
  'nested list four levels': '- 1\n  - 2\n    - 3\n      - 4\n',

  'nested list three levels, star markers': '* one\n  * two\n    * three\n',

  'nested list three levels, alternating markers': '- one\n  * two\n    + three\n',

  'nested ordered three levels': '1. one\n   1. two\n      1. three\n',

  'nested ordered three levels, siblings':
    '1. one\n   1. two\n      1. three\n      2. four\n',

  'nested list three levels, loose outer': '- one\n\n  - two\n    - three\n\n- back\n',

  'nested list with paragraph continuations':
    '- one\n\n  more of one\n\n  - two\n\n    more of two\n\n    - three\n',

  'nested list with a fenced child':
    '- one\n  - two\n\n    ```sh\n    ls\n    ```\n\n    - three\n',

  'task list three levels': '- [ ] a\n  - [x] b\n    - [ ] c\n',

  'task list star marker': '* [ ] a\n* [x] b\n',

  'task list in blockquote': '> - [ ] a\n> - [x] b\n',

  'task list loose': '- [ ] a\n\n- [x] b\n',

  'ordered task list': '1. [ ] first\n2. [x] second\n',

  'ordered task list with a paren delimiter': '1) [ ] first\n2) [x] second\n',

  'ordered task list starting past one': '3. [ ] third\n4. [x] fourth\n',

  'task list mixed with plain items': '- [ ] a\n- plain\n- [x] b\n',

  'plain item before a task item': '- plain\n- [x] task\n',

  'task item with no label': '- [ ]\n',

  'empty callout as the last block': '> [!NOTE]\n',

  'empty callout followed by a paragraph': '> [!NOTE]\n\nAfter.\n',

  // --- tables ---------------------------------------------------------------
  'gfm table with empty cells': '| a | b |\n| --- | --- |\n|  | x |\n| y |  |\n',

  'gfm table with a break in a cell': '| a | b |\n| --- | --- |\n| one<br>two | x |\n',

  'gfm table with emoji and cjk': '| 名前 | 🚀 |\n| --- | --- |\n| 日本語 | ok |\n',

  'gfm table with a wikilink': '| a | b |\n| --- | --- |\n| [[x/y]] | 1 |\n',

  'gfm table with ragged widths': '| name | count |\n| --- | --- |\n| a very long value | 1 |\n',

  'gfm table with a short delimiter row': '| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |\n',

  'gfm table with a wide delimiter row': '| a | b |\n| ----- | ----- |\n| 1 | 2 |\n',

  'gfm table with no outer pipes': 'a | b\n--- | ---\n1 | 2\n',

  // --- code -----------------------------------------------------------------
  'fenced code with a bare rule': '```\n---\n```\n',

  'fenced code holding a whole page':
    '```markdown\n---\ntitle: foo\n---\n\n# Body\n```\n',

  'fenced code with tildes holding backticks': '~~~\n```\nnot a fence\n```\n~~~\n',

  'fenced code with an extended info string': '```js title="a.js" {1,3}\nconst a = 1;\n```\n',

  'fenced code with trailing whitespace inside': '```\na   \nb\t\n```\n',

  'fenced code with trailing spaces on the fence line': '```js  \nlet a = 1;\n```\n',

  'fenced code holding a bare triple backtick': '```\na ``` b\n```\n',

  'inline code with underscores': 'Literal `_not em_` here.\n',

  'inline code with a pipe': 'Use `a | b` here.\n',

  'inline code with brackets': 'Use `[[not a wikilink]]` here.\n',

  'inline code with a backslash': 'Use `a\\b` here.\n',

  'inline code with a tag': 'Use `<div>` here.\n',

  // --- quotes and callouts --------------------------------------------------
  'blockquote with nested bullets': '> - one\n>   - two\n>     - three\n',

  'blockquote with an ordered list': '> 1. one\n> 2. two\n',

  'blockquote list then paragraph': '> - one\n>\n> after the list\n',

  'nested blockquote with a list': '> > - one\n> > - two\n',

  'blockquote with a fence': '> ```sh\n> ls\n> ```\n',

  'callout with a nested list': '> [!TIP]\n> - one\n>   - two\n',

  'callout with two paragraphs': '> [!WARNING]\n> One.\n>\n> Two.\n',

  'callout with a fence': '> [!NOTE]\n> ```sh\n> ls\n> ```\n',

  'callout with an unknown kind': '> [!HINT]\n> unknown.\n',

  'callout written in lower case': '> [!note]\n> lower.\n',

  'callout with a title on the marker line': '> [!NOTE] Title here\n> Body.\n',

  // --- images and links -----------------------------------------------------
  'image with a bracketed destination': '![d](</my path/a.png> "T")\n',

  'image with an empty alt': '![](/a.png "T")\n',

  'image with markup in the alt': '![**bold** alt](/a.png "T")\n',

  'image with brackets in the alt': '![a [b] c](/x.png)\n',

  'image reference with a title': '![alt][k]\n\n[k]: /a.png "Title"\n',

  // --- wikilinks ------------------------------------------------------------
  'wikilink with spaces': 'See [[eng/my page]].\n',

  'wikilink with an anchor': 'See [[eng/deploy#step-2]].\n',

  'wikilink in a heading': '# See [[eng/deploy]]\n',

  'wikilink adjacent pair': '[[a]][[b]]\n',

  'wikilink with an emoji alias': 'See [[a|🚀 go]].\n',

  // --- html -----------------------------------------------------------------
  'html comment multiline': '<!--\nline one\nline two\n-->\n',

  'html comment holding markdown': '<!-- # not a heading\n- not a list\n-->\n',

  'html comment touching text': 'a<!-- x -->b\n',

  'html comment then a list': '<!-- x -->\n- one\n',

  // --- unicode --------------------------------------------------------------
  'emoji zwj sequence': 'Family: 👨‍👩‍👧‍👦 here.\n',

  'emoji with a skin tone': 'Wave 👋🏽 here.\n',

  'emoji flag': 'Flag 🇯🇵 here.\n',

  'emoji keycap': 'Key 1️⃣ here.\n',

  'emoji in a code span': 'Use `🚀` here.\n',

  'emoji in a table': '| 🚀 | 🎉 |\n| --- | --- |\n| a | b |\n',

  'cjk with emphasis': 'これは**太字**です。\n',

  'cjk fullwidth punctuation': '「引用」、（括弧）、【強調】。\n',

  'cjk in a heading': '# 日本語の見出し\n',

  'cjk in a table': '| 列 | 値 |\n| --- | --- |\n| 名前 | 値段 |\n',

  'cjk around emphasis with no spaces': '中文*斜体*中文\n',

  // --- breaks and headings --------------------------------------------------
  'hard break three spaces': 'one   \ntwo\n',

  'hard break in a list item': '- one  \n  two\n',

  'hard break in a blockquote': '> one  \n> two\n',

  'hard break before emphasis': 'one\\\n**two**\n',

  'hard break at the end of the document': 'one  \n',

  'setext underline one char': 'Title\n=\n',

  'setext underline long': 'Ti\n==========================\n',

  'setext heading with marks': '**Bold** title\n=====\n',

  'setext h2 followed by a list': 'Title\n-----\n- one\n',

  // --- whitespace -----------------------------------------------------------
  'trailing blank lines at end of file': 'A paragraph.\n\n\n',

  'leading blanks and trailing spaces': '\n\nBody.  \n\n',

  'heading with trailing spaces at end of file': '# Title   \n',

  'mixed document':
    '# Release checklist\n\n' +
    'Run the steps in order. See [[eng/deploy|Deploy]] first.\n\n' +
    '> [!IMPORTANT]\n' +
    '> Freeze the branch before you start.\n\n' +
    '- [ ] Tag the release\n' +
    '- [x] Update the changelog\n' +
    '  - [x] Add the 🚀 header\n\n' +
    '| Stage | Owner |\n' +
    '| --- | --- |\n' +
    '| build | infra |\n' +
    '| deploy | oncall |\n\n' +
    '```sh\ngit tag -a v1.2.0 -m "release"\n```\n\n' +
    '<!-- reviewers: check the tag signature -->\n\n' +
    '---\n\n' +
    'Questions? Read <https://example.com/runbooks>.\n',
};
