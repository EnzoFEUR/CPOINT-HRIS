import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

test.describe('Real Browser Mobile Primitives Behavioural Test Suite (Playwright)', () => {
  let viteServer;
  let browser;
  let serverUrl;

  test.before(async () => {
    viteServer = await createServer({
      root: frontendDir,
      server: { port: 5188, strictPort: true },
      logLevel: 'error',
    });
    await viteServer.listen();
    serverUrl = 'http://localhost:5188/test-primitives-harness.html';

    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
  });

  test.after(async () => {
    if (browser) await browser.close();
    if (viteServer) await viteServer.close();
  });

  test('1. Tabbar enforces 5-item maximum cap in real browser rendering', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tabbar-container nav button');

    const tabButtons = page.locator('#tabbar-container nav button');
    const count = await tabButtons.count();
    assert.equal(count, 5, 'Tabbar must cap rendered tabs at 5 despite receiving 7 items');

    const labels = await tabButtons.allInnerTexts();
    assert.deepEqual(
      labels.map(l => l.trim()),
      ['Home', 'Attendance', 'Leaves', 'Docs', 'Profile'],
      'Only the first 5 tabs must be rendered in DOM'
    );
    await page.close();
  });

  test('2. BottomSheet manages background inert attribute and locks body scroll', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#open-sheet-btn');

    // Initially background is active
    let isInert = await page.locator('#main-content').getAttribute('inert');
    assert.equal(isInert, null, 'Background must not be inert when sheet is closed');

    // Click trigger to open sheet
    await page.click('#open-sheet-btn');
    await page.waitForSelector('[role="dialog"][aria-modal="true"]');
    await page.waitForFunction(() => document.querySelector('#main-content')?.hasAttribute('inert'));

    // Verify background becomes inert
    isInert = await page.locator('#main-content').evaluate(el => el.hasAttribute('inert'));
    assert.equal(isInert, true, 'Main content background must have inert attribute when sheet is open');

    // Verify body overflow is locked
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    assert.equal(bodyOverflow, 'hidden', 'Document body style overflow must be set to hidden');

    await page.close();
  });

  test('3. BottomSheet traps focus strictly within modal and cycles with Tab / Shift+Tab', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#open-sheet-btn');

    await page.click('#open-sheet-btn');
    await page.waitForSelector('[role="dialog"][aria-modal="true"]');
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog && dialog.contains(document.activeElement);
    });

    // Initial focus must be inside sheet
    const initialFocused = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    assert.ok(initialFocused, 'Focus must land on an element inside the dialog');

    // Press Tab multiple times and verify activeElement is never outside dialog
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const isInside = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog ? dialog.contains(document.activeElement) : false;
      });
      assert.equal(isInside, true, `Tab step ${i}: Active element must remain inside [role="dialog"]`);
    }

    // Press Shift+Tab multiple times and verify reverse focus cycling remains inside
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      const isInside = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog ? dialog.contains(document.activeElement) : false;
      });
      assert.equal(isInside, true, `Shift+Tab step ${i}: Active element must remain inside [role="dialog"]`);
    }

    await page.close();
  });

  test('4. BottomSheet closes on Escape key press and restores focus to trigger element', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#open-sheet-btn');

    await page.click('#open-sheet-btn');
    await page.waitForSelector('[role="dialog"]');
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog && dialog.contains(document.activeElement);
    });

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.id === 'open-sheet-btn');

    // Focus must return to the trigger button
    const activeElementId = await page.evaluate(() => document.activeElement?.id);
    assert.equal(activeElementId, 'open-sheet-btn', 'Focus must restore to the opening trigger button');

    // Body overflow must restore
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    assert.notEqual(bodyOverflow, 'hidden', 'Body overflow lock must be released on close');

    await page.close();
  });

  test('5. BottomSheet closes on backdrop click and restores focus to trigger element', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#open-sheet-btn');

    await page.click('#open-sheet-btn');
    await page.waitForSelector('[role="dialog"]');
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog && dialog.contains(document.activeElement);
    });

    // Click backdrop near the top of the viewport (outside modal sheet)
    await page.mouse.click(195, 50);
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.id === 'open-sheet-btn');

    // Focus returns to trigger
    const activeElementId = await page.evaluate(() => document.activeElement?.id);
    assert.equal(activeElementId, 'open-sheet-btn', 'Focus must restore to trigger button after backdrop click');

    await page.close();
  });

  test('6. BottomSheet automatically closes when viewport resizes across lg (>= 1024px)', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#open-sheet-btn');

    await page.click('#open-sheet-btn');
    await page.waitForSelector('[role="dialog"]');
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog && dialog.contains(document.activeElement);
    });

    // Resize viewport to desktop 1280x800
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.waitForFunction(() => !document.querySelector('#main-content')?.hasAttribute('inert'));

    const dialogCount = await page.locator('[role="dialog"]').count();
    assert.equal(dialogCount, 0, 'BottomSheet must close when resizing across lg breakpoint');

    // Background inert must be removed
    const isInert = await page.locator('#main-content').evaluate(el => el.hasAttribute('inert'));
    assert.equal(isInert, false, 'Inert lock must be removed to avoid trapping desktop users');

    await page.close();
  });
});
