import { test, expect } from '@playwright/test';
import { initCleanSession } from '../src/storage';
import { GAME_URL } from '../src/config';
import {
  SELECTORS,
  CLASSES,
  extractTileValue,
  extractDestinationCoordinate,
  selectAuthoritativeTile,
  ParsedTile,
} from '../src/selectors';

test('inspect live 2048 DOM hierarchy and selectors', async ({ page }) => {
  // Initialize clean session with neutralized redirect and clean storage
  await initCleanSession(page, GAME_URL);

  // 1. Verify board and grid containers
  const gameContainer = page.locator(SELECTORS.gameContainer);
  await expect(gameContainer).toBeVisible();

  const tileContainer = page.locator(SELECTORS.tileContainer);
  // .tile-container has 0x0 bounding box as CSS positioning anchor, so check toBeAttached
  await expect(tileContainer).toBeAttached();
  // Child tiles themselves have full dimensions and are visible
  await expect(page.locator(SELECTORS.tile).first()).toBeVisible();

  const gridContainer = page.locator(SELECTORS.gridContainer);
  await expect(gridContainer).toBeVisible();

  // 2. Score and best containers
  const scoreContainer = page.locator(SELECTORS.scoreContainer);
  await expect(scoreContainer).toBeVisible();
  const initialScoreText = await scoreContainer.innerText();
  const initialScore = parseInt(initialScoreText, 10);
  expect(initialScore).toBeGreaterThanOrEqual(0);

  const bestContainer = page.locator(SELECTORS.bestContainer);
  await expect(bestContainer).toBeVisible();

  // 3. Action buttons
  const restartButton = page.locator(SELECTORS.restartButton);
  await expect(restartButton).toBeVisible();

  const keepPlayingButton = page.locator(SELECTORS.keepPlayingButton);
  // Keep playing button is present in the DOM (hidden until 2048 tile reached)
  expect(await keepPlayingButton.count()).toBeGreaterThanOrEqual(1);

  // 4. Game message container
  const gameMessage = page.locator(SELECTORS.gameMessage);
  await expect(gameMessage).toBeAttached();

  // 5. Inspect and parse initial tiles
  const rawTiles = await page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector)).map((el) => ({
      className: el.className,
      innerText: el.textContent?.trim() || '',
    }));
  }, SELECTORS.tile);

  expect(rawTiles.length).toBeGreaterThanOrEqual(2);

  const parsedInitialTiles: ParsedTile[] = rawTiles
    .map((t) => {
      const coord = extractDestinationCoordinate(t.className);
      if (!coord) return null;
      return {
        col: coord.col,
        row: coord.row,
        value: extractTileValue(t.className, t.innerText),
        isMerged: t.className.includes(CLASSES.tileMerged),
        isNew: t.className.includes(CLASSES.tileNew),
      };
    })
    .filter((t): t is ParsedTile => t !== null);

  expect(parsedInitialTiles.length).toBeGreaterThanOrEqual(2);

  // Verify coordinates are 1-indexed (col: 1..4, row: 1..4)
  for (const tile of parsedInitialTiles) {
    expect(tile.col).toBeGreaterThanOrEqual(1);
    expect(tile.col).toBeLessThanOrEqual(4);
    expect(tile.row).toBeGreaterThanOrEqual(1);
    expect(tile.row).toBeLessThanOrEqual(4);
    expect([2, 4]).toContain(tile.value);
  }

  // 6. Test movement and verify multi-class handling & destination extraction
  await page.keyboard.press('ArrowDown');
  // Wait for mutation to settle
  await page.waitForFunction(
    (selector) => document.querySelectorAll(selector).length >= 2,
    SELECTORS.tile
  );

  const tilesAfterMove = await page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector)).map((el) => ({
      className: el.className,
      innerText: el.textContent?.trim() || '',
    }));
  }, SELECTORS.tile);

  expect(tilesAfterMove.length).toBeGreaterThanOrEqual(2);

  // 7. Verify helper unit logic with mock multi-class and merge scenarios
  const slidingTileClass = 'tile tile-4 tile-position-1-1 tile-position-1-2';
  const destCoord = extractDestinationCoordinate(slidingTileClass);
  expect(destCoord).toEqual({ col: 1, row: 2 });

  // Verify merge deduplication logic
  const mockTilesAtCoord: ParsedTile[] = [
    { col: 3, row: 4, value: 4, isMerged: false, isNew: false },
    { col: 3, row: 4, value: 4, isMerged: false, isNew: false },
    { col: 3, row: 4, value: 8, isMerged: true, isNew: false },
  ];
  const authoritative = selectAuthoritativeTile(mockTilesAtCoord);
  expect(authoritative.value).toBe(8);
  expect(authoritative.isMerged).toBe(true);
});
