// The harness itself, against a static page of its own: the rules every spec relies on.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll } from 'vitest';
import { expect, test } from '../fixtures';

const FIXTURE = `<!doctype html>
<html><head><title>harness fixture</title></head><body>
  <nav aria-label="Pages"><a href="#a">Alpha</a></nav>
  <button>Save</button>
  <button>Save draft</button>
  <button aria-label="Close dialog">x</button>
  <label for="email">Email address</label><input id="email">
  <input aria-label="Search pages">
  <ul role="tree">
    <li role="treeitem">General
      <ul role="group"><li role="treeitem">Roadmap</li></ul>
    </li>
  </ul>
  <p>One shared line</p><p>One shared line</p>
  <div id="card" draggable="true" style="width:120px;height:40px;background:#ddd">card</div>
  <div id="bin" style="margin-top:40px;width:240px;height:80px;background:#eef">bin</div>
  <output id="log"></output>
  <script>
    document.getElementById('card').addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'card'));
    const bin = document.getElementById('bin');
    bin.addEventListener('dragover', (e) => e.preventDefault());
    bin.addEventListener('drop', (e) => {
      e.preventDefault();
      document.getElementById('log').textContent = 'dropped ' + e.dataTransfer.getData('text/plain');
    });
    setTimeout(() => {
      const late = document.createElement('button');
      late.textContent = 'Arrived late';
      document.body.append(late);
    }, 700);
  </script>
</body></html>`;

let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(FIXTURE));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

const fast = { timeout: 600 };

test.describe('the harness', () => {
  test('finds a role by its accessible name, by substring or exactly', async ({ page }) => {
    await page.goto(`${origin}/`);
    await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^save d/i })).toHaveText('Save draft');
    await expect(page.getByRole('button', { name: 'Close dialog' })).toHaveText('x');
    // A tree item's name leaves out the items nested in it.
    await expect(page.getByRole('treeitem', { name: 'Roadmap' })).toHaveCount(1);
  });

  test('finds fields by their label or aria-label', async ({ page }) => {
    await page.goto(`${origin}/`);
    await page.getByLabel('Email address').fill('someone@example.com');
    await expect(page.getByLabel('Email address')).toHaveValue('someone@example.com');
    await expect(page.getByLabel('Search pages')).toHaveCount(1);
  });

  test('refuses to act on, or assert one of, several matches', async ({ page }) => {
    await page.goto(`${origin}/`);
    await expect(page.getByRole('button', { name: 'Save' }).click({ timeout: 600 })).rejects.toThrow(/strict mode: 2 elements/);
    await expect(expect(page.getByText('One shared line')).toBeVisible(fast)).rejects.toThrow(/strict mode: 2 elements/);
  });

  test('waits for an element that arrives late, and gives up on one that never does', async ({ page }) => {
    await page.goto(`${origin}/`);
    await page.getByRole('button', { name: 'Arrived late' }).click();
    await expect(page.getByRole('button', { name: 'Arrived late' })).toBeVisible();
    await expect(expect(page.getByRole('button', { name: 'Never here' })).toBeVisible(fast)).rejects.toThrow(/is not visible/);
    await expect(page.getByRole('button', { name: 'Never here' }).click({ timeout: 600 })).rejects.toThrow(/no element matches/);
  });

  test('keeps two users apart: cookies and storage stay in their own session', async ({ browser }) => {
    const alice = await browser.newContext({ baseURL: origin });
    const bob = await browser.newContext({ baseURL: origin });
    await alice.page.goto('/');
    await bob.page.goto('/');
    await alice.page.evaluate(() => {
      document.cookie = 'who=alice; path=/';
      localStorage.setItem('who', 'alice');
    });
    expect(await bob.page.evaluate(() => [document.cookie, localStorage.getItem('who')])).toEqual(['', null]);
    expect((await alice.cookies()).map((c) => c.name)).toContain('who');
    expect((await bob.cookies()).map((c) => c.name)).not.toContain('who');
  });

  test('opens a second tab as a page of its own, and closing it leaves the first', async ({ page }) => {
    await page.goto(`${origin}/#first`);
    const other = await page.context().newPage();
    expect(other).not.toBe(page);
    await other.goto(`${origin}/#second`);
    expect(await page.evaluate(() => location.hash)).toBe('#first');
    expect(await other.evaluate(() => location.hash)).toBe('#second');
    await other.close();
    await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
  });

  test('fails a negated assertion on a page it cannot read', async ({ browser }) => {
    const gone = await browser.newContext({ baseURL: origin });
    const page = await gone.newPage();
    await page.goto('/');
    await gone.close();
    await expect(expect(page.getByText('anything')).not.toBeVisible(fast)).rejects.toThrow(/could not read the page/);
  });

  test('drags with a native drag and drop, over CDP', async ({ page }) => {
    await page.goto(`${origin}/`);
    await page.locator('#card').dragTo(page.locator('#bin'));
    await expect(page.locator('#log')).toHaveText('dropped card');
  });
});
