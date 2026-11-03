import { expect, test, uniqueSlug } from './fixtures';

/**
 * Connected agents.
 *
 * An agent is a writer like any other, so the list names it and draws its face. There is no
 * active or paused state: deleting an agent is what stops it, and its token dies with it.
 */

/** One red pixel. The browser has to decode it, so a text file would not do. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('connected agents', () => {
  test('names an agent, gives it a picture, and offers no paused state', async ({ page }) => {
    const name = `Doc Bot ${uniqueSlug('a')}`;
    await page.goto('/settings/agents');

    await page.getByLabel('Agent name').fill(name);
    await page.getByLabel('Agent identity').fill('You keep the runbooks tidy.');
    await page.getByRole('button', { name: 'Add agent' }).click();

    // The token is shown once. Putting it away leaves the list behind.
    await expect(page.getByText(/^gda_/)).toBeVisible();
    await page.getByRole('button', { name: 'I have copied it' }).click();

    const row = page.locator('.people-row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText('never connected');
    // Its initials stand in until it is given a picture.
    await expect(row.locator('span.avatar')).toHaveText(/^[A-Z]{1,2}$/);

    // Nothing switches an agent on or off any more.
    await expect(page.getByLabel(`State of ${name}`)).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Paused' })).toHaveCount(0);

    const edit = page.locator('.agent-edit');
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await edit
      .getByLabel(`Picture of ${name}`)
      .setInputFiles({ name: 'bot.png', mimeType: 'image/png', buffer: PNG_BYTES });

    // The initials give way to the image the server now serves back.
    const face = row.locator('img.avatar');
    await expect(face).toBeVisible();
    await expect(face).toHaveAttribute('src', /\/api\/v1\/agents\/ag_[A-Z0-9]+\/avatar\?v=/);

    await edit.getByRole('button', { name: 'Remove' }).click();
    await expect(row.locator('span.avatar')).toHaveText(/^[A-Z]{1,2}$/);

    // Clean up, so a later run of this spec starts from the same place.
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.people-row').filter({ hasText: name })).toHaveCount(0);
  });
});
