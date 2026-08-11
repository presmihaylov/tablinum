import type { Locator, Page } from '@playwright/test';
import { expect, test, type ApiClient } from './fixtures';

/**
 * Invented words, so a hit can only come from the pages this spec seeded and never from
 * a page another spec left behind. They are also absent from the palette's own actions,
 * so every row a query returns is a search hit.
 */
const ONLY_ONE = 'zarquil';
const SHARED = 'grendix';
const NOTHING = 'zzqxwv';
const EDITED = 'plimtor';

const TELESCOPE_PATH = 'docs/telescope';
const TELESCOPE_TITLE = 'Telescope Maintenance';

interface Seed {
  path: string;
  title: string;
  markdown: string;
}

const PAGES: Seed[] = [
  {
    path: TELESCOPE_PATH,
    title: TELESCOPE_TITLE,
    markdown: `Clean the primary mirror with ${ONLY_ONE} solvent once a season.\n`,
  },
  {
    path: `docs/${SHARED}-overview`,
    title: 'Grendix Overview',
    markdown: `Grendix is the internal name of the cooling loop.\n`,
  },
  {
    path: 'docs/pump-service',
    title: 'Pump Service',
    markdown: `The ${SHARED} loop drives two pumps. Replace the seals every year.\n`,
  },
  {
    path: 'docs/valve-service',
    title: 'Valve Service',
    markdown: `Inspect the ${SHARED} valves for leaks after every service.\n`,
  },
];

async function seed(api: ApiClient): Promise<void> {
  for (const page of PAGES) await api.createPage(page);
}

/** Open the palette from the top bar and return its dialog. The sidebar has a second one. */
async function openSearch(page: Page): Promise<Locator> {
  await page.getByRole('banner').getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  return palette;
}

async function searchFor(page: Page, query: string): Promise<Locator> {
  const palette = await openSearch(page);
  await palette.getByRole('combobox', { name: 'Search pages or run a command' }).fill(query);
  return palette;
}

test.describe('search', () => {
  test.beforeEach(async ({ api }) => {
    await seed(api);
  });

  test('a query that matches one page returns that page', async ({ page }) => {
    await page.goto('/');
    const palette = await searchFor(page, ONLY_ONE);

    await expect(palette.getByRole('option')).toHaveCount(1);
    await expect(palette.getByRole('option', { name: TELESCOPE_TITLE })).toBeVisible();
    await expect(palette.getByText('Pages')).toBeVisible();
  });

  test('a query that matches several pages ranks the title match first', async ({ page }) => {
    await page.goto('/');
    const palette = await searchFor(page, SHARED);

    const options = palette.getByRole('option');
    await expect(options).toHaveCount(3);
    // The word is in one page's title and only in the body of the other two, and the index
    // weighs a title above a body, so that page must lead.
    await expect(options.first()).toContainText('Grendix Overview');
    for (const title of ['Pump Service', 'Valve Service']) {
      await expect(palette.getByRole('option', { name: title })).toBeVisible();
    }
  });

  test('a query that matches nothing shows the empty state', async ({ page }) => {
    await page.goto('/');
    const palette = await searchFor(page, NOTHING);

    await expect(palette.getByText('No matches.')).toBeVisible();
    await expect(palette.getByRole('option')).toHaveCount(0);
  });

  test('clicking a result opens that page', async ({ page }) => {
    await page.goto('/');
    const palette = await searchFor(page, ONLY_ONE);

    await palette.getByRole('option', { name: TELESCOPE_TITLE }).click();

    await expect(page).toHaveURL(new RegExp(`/p/${TELESCOPE_PATH}$`));
    await expect(page.getByLabel('Page title')).toHaveValue(TELESCOPE_TITLE);
    await expect(palette).toHaveCount(0);
  });

  test('a page edited after it was indexed is findable by its new text', async ({ page, api }) => {
    await page.goto(`/p/${TELESCOPE_PATH}`);
    await expect(page.getByLabel('Page title')).toHaveValue(TELESCOPE_TITLE);

    // Enter in the title drops the caret at the start of the body, so the typing below
    // needs no selector of its own.
    const title = page.getByLabel('Page title');
    await title.click();
    await page.keyboard.press('Enter');
    // The caret leaves the title one tick later, so the first character would land in it.
    await expect(title).not.toBeFocused();
    await page.keyboard.type(`The ${EDITED} grease keeps the mount quiet. `);
    await page.keyboard.press('ControlOrMeta+s');

    // The toast stack is a status region too, so the save indicator is picked by its text.
    // It settles on the resting label; the poll below is what proves the edit landed.
    await expect(page.getByRole('status').filter({ hasText: /Sav/ })).toHaveText('Saved to git');
    await expect
      .poll(async () => (await api.getPage(TELESCOPE_PATH))?.markdown ?? '', {
        message: 'the edit never reached the server',
      })
      .toContain(EDITED);

    const palette = await searchFor(page, EDITED);
    await expect(palette.getByRole('option')).toHaveCount(1);
    await expect(palette.getByRole('option', { name: TELESCOPE_TITLE })).toBeVisible();
  });
});
