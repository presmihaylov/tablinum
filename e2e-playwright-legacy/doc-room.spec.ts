import { expect, test } from './fixtures';

/**
 * The shared document under a page. Every tab joins a room for the page it is on, and the room
 * hands out a baseline whenever it starts: on the join, and again whenever the file moves under
 * it. That baseline replaces what is on screen, and a person is often typing while it lands.
 */
test.describe('a room that restarts under a writer', () => {
  test('keeps the caret where the writer left it', async ({ page, api, content }) => {
    const space = await api.createUniqueSpace('docroom');
    const path = `${space.slug}/caret`;
    const created = await api.createPage({
      path,
      title: 'Caret',
      markdown: 'Alpha line.\n\nBeta line.\n',
    });
    const file = await content.waitForPageFile(path);

    await page.goto(`/p/${path}`);
    const body = page.locator('.gd-editor-surface');
    await expect(body).toContainText('Beta line.');

    await body.getByText('Beta line.', { exact: true }).click();
    await page.keyboard.press('End');

    // Somebody else writes the file. The room restarts under this tab and hands it the new text.
    await api.updatePage(created.id, { markdown: 'Alpha line.\n\nBeta line.\n\nGamma line.\n' });
    await expect(body).toContainText('Gamma line.');

    // The caret was at the end of the second line, so that is where the words have to land.
    await page.keyboard.type(' tail');
    await expect(body).toContainText('Beta line. tail');
    await expect
      .poll(async () => (await content.read(file)) ?? '', {
        message: 'the typed words never reached the page file',
      })
      .toContain('Beta line. tail');
  });
});
