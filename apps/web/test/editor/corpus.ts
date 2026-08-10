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

  'suspect char before a mark': 'Use 2 * 3 in **bold** text\n',

  'bracket before a mark': 'see [1] and **b**\n',

  'bold text opening with a number marker': '**1. a**\n',

  'italic text opening with a bullet': '*- a*\n',

  'link label opening with a bullet': '[- a](/b)\n',

  'underscore emphasis': 'An _alternate_ and an __alternate heavy__ run.\n',

  'intraword underscores': 'The value snake_case_name stays intact.\n',

  'inline code with asterisks': 'Compute `a * b * c` and `**not bold**` verbatim.\n',

  'inline code with backticks': 'Write ``a ` b`` when the span holds a backtick.\n',

  'double space after a full stop': 'One sentence.  Two sentences.\n',

  'code span with two spaces': 'Run `git  log` now.\n',

  'code span of one space': 'Type ` ` to select.\n',

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

  'ordered list all ones': '1. one\n1. two\n1. three\n',

  'ordered list zero based': '0. zero\n0. one\n',

  'ordered list descending numbers': '3. three\n2. two\n1. one\n',

  'ordered list with gaps in numbering': '1. one\n5. five\n9. nine\n',

  'ordered task list all ones': '1. [ ] a\n1. [x] b\n',

  'blockquote with an all-ones ordered list': '> 1. one\n> 1. two\n',

  'indented code under a single-digit item': '9. nine\n\n       code\n\n10. ten\n',

  'nested bullet under a single-digit item':
    '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n   - deep\n10. j\n',

  'empty bullet item': '-\n',

  'empty ordered item': '1.\n',

  'empty item mid-list': '- one\n-\n- three\n',

  'task item labelled with a wikilink': '- [ ] [[a]]\n',

  'task item labelled with an image': '- [ ] ![alt](/a.png)\n',

  'task item labelled with a break': '- [ ] <br>\n',

  'two lists differing in delimiter': '1. one\n2) two\n',

  'two lists differing in marker': '- a\n* b\n',

  'paragraph then bullet list': 'Do the following:\n- one\n',

  'paragraph then numbered list': 'Do the following:\n1. one\n2. two\n',

  'paragraph then list starting at two': 'A paragraph.\n2. two\n',

  'paragraph then blockquote': 'Before.\n> q\n',

  'paragraph then table': 'Intro.\n| a | b |\n| --- | --- |\n| 1 | 2 |\n',

  'paragraph then html block': 'Before.\n<div>x</div>\n',

  'loose list': '- first item\n\n- second item\n',

  // One blank line in a list makes every item loose, so the first pair must not close up.
  'partially loose list': '- one\n- two\n\n- three\n',

  'task list': '- [ ] unchecked\n- [x] checked\n- [X] shouting\n',

  'nested task list': '- [ ] parent\n  - [x] child\n',

  'task list with marks': '- [ ] read **the** docs\n',

  blockquote: '> A quoted line.\n> A second quoted line.\n',

  'blockquote with list': '> - first\n> - second\n',

  'blockquote with heading': '> ## Quoted heading\n>\n> And a body.\n',

  'tight heading and body in a blockquote': '> # H\n> body\n',

  'tight heading and body in a callout': '> [!TIP]\n> # H\n> body\n',

  'two blank quote lines': '> a\n>\n>\n> b\n',

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

  'mermaid diagram':
    '```mermaid\ngraph TD\n  A[Start] --> B{Is it good?}\n  B -->|yes| C[Ship it]\n  B -->|no| A\n```\n',

  'mermaid diagram with tildes': '~~~mermaid\nsequenceDiagram\n  A->>B: hi\n~~~\n',

  'indented code': '    indented code line\n    second line\n',

  'tab-indented code': '\tcode with tab\n',

  'indented code past the fourth column': '      six spaces\n',

  'horizontal rules': '---\n\n***\n\n___\n',

  'spaced thematic breaks': '- - -\n\n* * *\n\n_ _ _\n',

  'thematic break in a blockquote': '> * * *\n',

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

  'link with balanced parens in the destination': '[a](https://en.wikipedia.org/wiki/X_(y))\n',

  autolink: 'Ping <https://example.com/status> for uptime.\n',

  'inline link whose text is its destination': 'go to [https://e.com](https://e.com) now\n',

  'bold autolink': '[**https://example.com**](https://example.com)\n',

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

  'video embed iframe':
    '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>\n',

  'video embed file': '<div class="gd-video"><video src="/_assets/pg_1/clip.mp4" controls></video></div>\n',

  'video embed between paragraphs':
    'Before.\n\n<iframe src="https://player.vimeo.com/video/76979871" title="Vimeo" allowfullscreen></iframe>\n\nAfter.\n',

  'page embed': '![[eng/deploy]]\n',

  'page embed between paragraphs': 'Before.\n\n![[eng/deploy]]\n\nAfter.\n',

  'page embed pair': '![[eng/deploy]]\n![[eng/rollback]]\n',

  'page embed above a heading': '![[eng/deploy]]\n\n# Next\n',

  diagram: '![Architecture](/_assets/pg_1/architecture.excalidraw.svg)\n',

  'diagram with no label': '![](/_assets/pg_1/sketch.excalidraw.svg)\n',

  'diagram between paragraphs':
    'Before.\n\n![Flow](/_assets/pg_1/flow.excalidraw.svg)\n\nAfter.\n',

  'diagram pair': '![a](/_assets/pg_1/a.excalidraw.svg)\n![b](/_assets/pg_1/b.excalidraw.svg)\n',

  'diagram above a heading': '![Flow](/_assets/pg_1/flow.excalidraw.svg)\n\n# Next\n',

  // A diagram path in any shape the block rule does not claim stays an ordinary image.
  'diagram path with a title': '![Flow](/_assets/pg_1/flow.excalidraw.svg "Figure 1")\n',

  'diagram path inside a sentence': 'See ![Flow](/_assets/pg_1/flow.excalidraw.svg) above.\n',

  'diagram path in a list item': '- ![Flow](/_assets/pg_1/flow.excalidraw.svg)\n',

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

  // Markdown lets any block open an item, not just a paragraph.
  'bullet item opening with a heading': '- # heading\n',

  'bullet item opening with a quote': '- > quoted\n',

  'bullet item opening with a fence': '- ```sh\n  ls\n  ```\n',

  'ordered item opening with a fence': '1. ```sh\n   ls\n   ```\n',

  'ordered item opening with a nested ordered list': '1. 2023. Founded\n2. 2024. Series A\n',

  'bullet item opening with a table': '- | a | b |\n  | --- | --- |\n  | 1 | 2 |\n',

  'item holding only a nested list': '- - inner\n',

  'setext heading in a list item': '- Title\n  =====\n',

  // No item holds a paragraph, so the tight and the loose form render the same HTML.
  'loose list of headings': '- # H\n\n- # H2\n',

  // A tight list still separates the blocks inside one item with no blank line.
  'tight fence in an ordered item': '1. one\n   ```sh\n   ls\n   ```\n2. two\n',

  'tight fence in a bullet item': '- one\n  ```sh\n  ls\n  ```\n- two\n',

  'tight heading and body in a list item': '- one\n  # H\n  body\n',

  'tight rule and body in a list item': '- one\n  ***\n  after\n',

  'tight blocks in a quoted list item': '> - one\n>   # H\n>   body\n',

  'two blank lines between list items': '- one\n\n\n- two\n',

  'loose heading and body in a list item': '- one\n\n  # H\n  body\n',

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

  // The checkbox has already opened the line, so none of these can start a block.
  'task label opening with a hash': '- [ ] # not a heading\n',

  'task label opening with a number marker': '- [ ] 1. not a list\n',

  'task label opening with a bullet': '- [ ] - not a list\n',

  // GFM needs a paragraph for the checkbox, so the underline kills it and both must survive.
  'task label under a setext underline': '- [ ] one\n  ---\n',

  'empty callout as the last block': '> [!NOTE]\n',

  'empty callout followed by a paragraph': '> [!NOTE]\n\nAfter.\n',

  // --- tables ---------------------------------------------------------------
  'gfm table with empty cells': '| a | b |\n| --- | --- |\n|  | x |\n| y |  |\n',

  'gfm table with a break in a cell': '| a | b |\n| --- | --- |\n| one<br>two | x |\n',

  'gfm table with emoji and cjk': '| 名前 | 🚀 |\n| --- | --- |\n| 日本語 | ok |\n',

  'gfm table with a wikilink': '| a | b |\n| --- | --- |\n| [[x/y]] | 1 |\n',

  'gfm table with an aliased wikilink': '| a | b |\n| --- | --- |\n| [[x/y\\|Z]] | 2 |\n',

  'gfm table with a piped link': '| a | b |\n| --- | --- |\n| [x](/y\\|z) | 2 |\n',

  'gfm table with a piped image': '| a | b |\n| --- | --- |\n| ![a\\|b](/y.png) | 2 |\n',

  'gfm table with a piped html attribute':
    '| a | b |\n| --- | --- |\n| <span t="a\\|b">x</span> | 2 |\n',

  'gfm table with ragged widths': '| name | count |\n| --- | --- |\n| a very long value | 1 |\n',

  'gfm table with a short delimiter row': '| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |\n',

  'gfm table with a wide delimiter row': '| a | b |\n| ----- | ----- |\n| 1 | 2 |\n',

  'gfm table with no outer pipes': 'a | b\n--- | ---\n1 | 2\n',

  'table in a blockquote': '> | a | b |\n> | :-- | --: |\n> | 1 | 2 |\n',

  'table in a blockquote with no outer pipes': '> a | b\n> --- | ---\n> 1 | 2\n',

  'column-aligned table':
    '| Name  | Count |\n| ----- | ----- |\n| alpha |     1 |\n| beta  |     2 |\n',

  'unpadded table': '|a|b|\n|---|---|\n|1|2|\n',

  // Leading and trailing pipes are independent: one side may be absent.
  'table with leading pipes only': '| a | b\n| --- | ---\n| 1 | 2\n',

  'table with trailing pipes only': 'a | b |\n--- | --- |\n1 | 2 |\n',

  'one-column table with trailing pipes': 'a |\n--- |\n1 |\n',

  'table header with trailing spaces': '| a | b |  \n| --- | --- |\n| 1 | 2 |\n',

  'table row with trailing spaces': '| a | b |\n| --- | --- |\n| 1 | 2 |   \n',

  // The parser drops the extra cell and pads the short row out to the header width.
  // Neither change belongs in the file, so both rows replay their own source line.
  'table row with an extra cell': '| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n',

  'table row with a missing cell': '| a | b |\n| --- | --- |\n| 1 |\n',

  // --- code -----------------------------------------------------------------
  'fenced code with a bare rule': '```\n---\n```\n',

  'fenced code holding a whole page':
    '```markdown\n---\ntitle: foo\n---\n\n# Body\n```\n',

  'fenced code with tildes holding backticks': '~~~\n```\nnot a fence\n```\n~~~\n',

  'fenced code with an extended info string': '```js title="a.js" {1,3}\nconst a = 1;\n```\n',

  'fenced code with trailing whitespace inside': '```\na   \nb\t\n```\n',

  'fenced code with trailing spaces on the fence line': '```js  \nlet a = 1;\n```\n',

  'fenced code holding a bare triple backtick': '```\na ``` b\n```\n',

  'mermaid diagram holding a bare triple backtick':
    '```mermaid\ngraph TD\n  A["a ``` b"] --> B\n```\n',

  // Trailing spaces on the fence line and on a content line, a blank first line, a tab-only
  // line and a blank line before the close: none of it is the editor's to tidy up.
  'mermaid diagram with awkward whitespace':
    '```mermaid  \n\ngraph LR\n  A -->|"  yes  "| B  \n\t\n  B --> C\n\n```\n',

  'fenced code ending in a blank line': '```\ncode\n\n```\n',

  'fence in a blockquote with a blank line': '> ```\n> code\n>\n> ```\n',

  // The quote marker here is code, so the blank-line trim must not reach it.
  'fence in a blockquote holding a quote marker': '> ```\n> > quoted\n> ```\n',

  'bare blockquote marker': '>\n',

  'inline code with underscores': 'Literal `_not em_` here.\n',

  'inline code with a pipe': 'Use `a | b` here.\n',

  'inline code with brackets': 'Use `[[not a wikilink]]` here.\n',

  'inline code with a backslash': 'Use `a\\b` here.\n',

  'inline code with a tag': 'Use `<div>` here.\n',

  'code span inside a link': '[`a`](/b)\n',

  'code span inside bold': '**run `make` now**\n',

  'code span inside strike': '~~`a`~~\n',

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

  'blockquote with a bold title on the marker line': '> [!NOTE] **Bold** title\n> body\n',

  'blockquote with a code title on the marker line': '> [!NOTE] `code` title\n> body\n',

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

  // --- mentions -------------------------------------------------------------
  'mention on its own': '@ada\n',

  'mention in a sentence': 'Ask @ada.lovelace about it.\n',

  'mention at the start of a line': '@ada wrote the runbook.\n',

  'mention in a heading': '# Owned by @ada\n',

  'mention in a list item': '- [ ] Ask @ada\n',

  'mention in a table cell': '| Owner |\n| --- |\n| @ada |\n',

  'mention inside brackets': '(@ada) and (@sam)\n',

  'mention next to punctuation': 'Ask @ada, then @sam.\n',

  'mention pair': '@ada @sam\n',

  'mention with a dash and an underscore': '@ada-l_1 shipped it.\n',

  'email address is not a mention': 'Write to ada@example.com.\n',

  'at sign on its own': 'Cost is 3 @ 5 each.\n',

  'at sign before an uppercase word': 'See @Ada.\n',

  'mention inside code stays code': 'Run `ping @ada` now.\n',

  'mention inside a fence stays code': '```sh\nping @ada\n```\n',

  'escaped at sign': 'Not a mention: \\@ada\n',

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

  'setext h1 in a blockquote': '> Title\n> =====\n',

  'setext h2 in a blockquote': '> Title\n> -----\n',

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
