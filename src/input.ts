import { Page } from '@playwright/test';

/**
 * Valid directional moves recognized by the 2048 game engine.
 * Aligned with standard keyboard navigation events.
 */
export type Direction = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp';

/**
 * All allowed directional arrow keys as an immutable list.
 */
export const DIRECTIONS: readonly Direction[] = [
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
] as const;

/**
 * Type guard validating whether an unknown value is a supported Direction.
 *
 * @param value - Value to check.
 * @returns True if value is a valid Direction.
 */
export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && DIRECTIONS.includes(value as Direction);
}

/**
 * Dispatches a single directional keystroke to the 2048 game via Playwright's keyboard API.
 * Uses authentic keyboard events (page.keyboard.press).
 *
 * Fast-fails immediately if the direction is invalid or page is missing.
 *
 * @param page - Active Playwright Page instance.
 * @param direction - Directional arrow key ('ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp').
 */
export async function dispatchKeypress(
  page: Page,
  direction: Direction
): Promise<void> {
  if (!page) {
    throw new Error('dispatchKeypress: Page instance must be provided.');
  }

  if (!isDirection(direction)) {
    throw new Error(
      `dispatchKeypress: Invalid direction "${direction}". Supported directions: ${DIRECTIONS.join(', ')}`
    );
  }

  await page.keyboard.press(direction);
}

