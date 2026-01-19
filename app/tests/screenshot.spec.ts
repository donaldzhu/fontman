import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const libraryRoot = join(process.cwd(), '.playwright', 'library');
const require = createRequire(import.meta.url);

const createLibraryRoot = () => {
  mkdirSync(libraryRoot, { recursive: true });
};

test('opens window, renders grid, and updates sample text', async () => {
  createLibraryRoot();

  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [join(process.cwd(), 'dist', 'main', 'index.js')],
    env: {
      ...process.env,
      FONTMAN_TEST_LIBRARY_ROOT: libraryRoot,
      FONTMAN_DISABLE_HELPER: '1',
    },
  });

  const window = await electronApp.firstWindow();
  await expect(window).toHaveTitle(/Fontman/);

  const grid = window.getByTestId('font-grid');
  await expect(grid).toBeVisible();
  await expect(grid.getByTestId('font-tile')).toHaveCount(6);

  const sampleInput = window.getByTestId('sample-text-input');
  await sampleInput.fill('Pack my box with five dozen liquor jugs');
  await expect(window.getByTestId('font-preview').first()).toHaveText(
    'Pack my box with five dozen liquor jugs'
  );

  await expect(window).toHaveScreenshot('fontman-grid.png', { fullPage: true });
  await electronApp.close();
});
