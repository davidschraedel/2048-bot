import { Page } from '@playwright/test';
import { Board } from './board';
import { SELECTORS, CLASSES } from './selectors';
import { DEFAULT_CONFIG } from './config';
import { Direction, dispatchKeypress } from './input';

/**
 * Deterministically compares two 4x4 board matrices for structural and numerical equality.
 *
 * @param a - First board matrix.
 * @param b - Second board matrix.
 * @returns True if both boards have identical 4x4 dimensions and identical values at every cell.
 */
export function areBoardsEqual(a: Board, b: Board): boolean {
  if (!a || !b) return false;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== 4 || b.length !== 4) return false;

  for (let r = 0; r < 4; r++) {
    const rowA = a[r];
    const rowB = b[r];
    if (
      !Array.isArray(rowA) ||
      !Array.isArray(rowB) ||
      rowA.length !== 4 ||
      rowB.length !== 4
    ) {
      return false;
    }
    for (let c = 0; c < 4; c++) {
      if (rowA[c] !== rowB[c]) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Options for state synchronization.
 */
export interface SyncOptions {
  /**
   * Maximum duration (in milliseconds) to wait for board mutation and settling.
   * Defaults to DEFAULT_CONFIG.settleTimeoutMs (5,000ms).
   */
  timeoutMs?: number;

  /**
   * Optional logger callback or boolean flag.
   * If true, logs latency to console.log. If a function is provided, calls it with latency metrics.
   */
  logger?: boolean | ((message: string) => void);
}

/**
 * Result metrics captured during a state synchronization cycle.
 */
export interface SyncResult {
  /** Whether the state mutation settled successfully */
  settled: boolean;
  /** Elapsed round-trip latency in milliseconds from wait initiation to settled DOM state */
  latencyMs: number;
}

/**
 * Combined result metrics for a dispatched move and its subsequent synchronization.
 */
export interface MoveResult {
  /** The direction key that was dispatched */
  direction: Direction;
  /** Total elapsed latency from keypress dispatch to DOM settling in milliseconds */
  latencyMs: number;
}

/**
 * Awaits deterministic DOM state mutation and in-browser animation settling after a move.
 *
 * Synchronization strategy:
 * 1. Uses page.waitForFunction() polling on requestAnimationFrame (zero waitForTimeout, zero CDP flooding).
 * 2. In-browser predicate verifies either:
 *    (a) The 4x4 board reconstructed from DOM tile elements has mutated from previousBoard, OR
 *    (b) Terminal game message (.game-over or .game-won) has appeared.
 * 3. Once mutated, in-browser double requestAnimationFrame guarantees CSS transitions and layouts settle.
 * 4. Measures and returns round-trip latency in milliseconds, logging if configured.
 *
 * @param page - Active Playwright Page instance.
 * @param previousBoard - 4x4 matrix representation prior to move dispatch.
 * @param options - Optional timeout and logging controls.
 * @returns SyncResult with settling confirmation and latency metrics.
 */
export async function waitForStateSettling(
  page: Page,
  previousBoard: Board,
  options?: SyncOptions
): Promise<SyncResult> {
  if (!page) {
    throw new Error('waitForStateSettling: Page instance must be provided.');
  }

  if (
    !previousBoard ||
    !Array.isArray(previousBoard) ||
    previousBoard.length !== 4 ||
    previousBoard.some((row) => !Array.isArray(row) || row.length !== 4)
  ) {
    throw new Error(
      'waitForStateSettling: A valid 4x4 previousBoard matrix must be provided.'
    );
  }

  const startTime = performance.now();
  const timeout = options?.timeoutMs ?? DEFAULT_CONFIG.settleTimeoutMs;

  try {
    await page.waitForFunction(
      (args: {
        previousBoard: Board;
        sel: typeof SELECTORS;
        classes: typeof CLASSES;
      }) => {
        // 1. Terminal status check: game-over or game-won messages
        const isGameOver = Boolean(
          document.querySelector(args.sel.gameOverMessage)
        );
        const isGameWon = Boolean(
          document.querySelector(args.sel.gameWonMessage)
        );

        if (isGameOver || isGameWon) {
          // Terminal state detected; await double rAF settling
          return new Promise<boolean>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve(true);
              });
            });
          });
        }

        // 2. Parse current tile state from DOM
        const tileEls = Array.from(document.querySelectorAll(args.sel.tile));
        const currentBoard: number[][] = [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ];

        const posRegex = /\btile-position-(\d+)-(\d+)\b/g;
        const valRegex = /\btile-(\d+)\b/;

        interface ParsedDomTile {
          col: number;
          row: number;
          value: number;
          isMerged: boolean;
        }

        const coordMap = new Map<string, ParsedDomTile[]>();

        for (const el of tileEls) {
          const className = el.className || '';
          const matches = Array.from(className.matchAll(new RegExp(posRegex)));
          if (matches.length === 0) continue;

          // Final destination class is the last position match
          const lastMatch = matches[matches.length - 1];
          const col = parseInt(lastMatch[1], 10);
          const row = parseInt(lastMatch[2], 10);
          if (col < 1 || col > 4 || row < 1 || row > 4) continue;

          let val = 0;
          const valMatch = className.match(valRegex);
          if (valMatch && valMatch[1]) {
            val = parseInt(valMatch[1], 10);
          } else {
            const txt = el.textContent?.trim() || '';
            const parsed = parseInt(txt, 10);
            if (!isNaN(parsed)) val = parsed;
          }
          if (val <= 0) continue;

          const isMerged = className.includes(args.classes.tileMerged);
          const key = `${col}-${row}`;
          const existing = coordMap.get(key);
          if (existing) {
            existing.push({ col, row, value: val, isMerged });
          } else {
            coordMap.set(key, [{ col, row, value: val, isMerged }]);
          }
        }

        // Merge and coordinate deduplication
        for (const [, group] of coordMap.entries()) {
          let authoritative = group[0];
          if (group.length > 1) {
            const merged = group.filter((t) => t.isMerged);
            if (merged.length > 0) {
              authoritative = merged.reduce((best, curr) =>
                curr.value > best.value ? curr : best
              );
            } else {
              authoritative = group.reduce((best, curr) =>
                curr.value > best.value ? curr : best
              );
            }
          }
          const r = authoritative.row - 1;
          const c = authoritative.col - 1;
          currentBoard[r][c] = authoritative.value;
        }

        // Check for mutation against previousBoard
        let mutated = false;
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            if (currentBoard[r][c] !== args.previousBoard[r][c]) {
              mutated = true;
              break;
            }
          }
          if (mutated) break;
        }

        if (!mutated) {
          return false;
        }

        // Once mutation is observed, settle DOM animations via double requestAnimationFrame
        return new Promise<boolean>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve(true);
            });
          });
        });
      },
      { previousBoard, sel: SELECTORS, classes: CLASSES },
      { timeout, polling: 'raf' }
    );
  } catch (err: unknown) {
    const error = err as Error;
    if (error && error.name === 'TimeoutError') {
      throw new Error(
        `waitForStateSettling: Timed out after ${timeout}ms waiting for DOM state mutation or terminal message. Verify move legality or game responsiveness.`
      );
    }
    throw err;
  }

  const latencyMs = Math.round((performance.now() - startTime) * 100) / 100;

  if (options?.logger) {
    const logFn =
      typeof options.logger === 'function' ? options.logger : console.log;
    logFn(`[StateSettling] Settled in ${latencyMs}ms`);
  }

  return {
    settled: true,
    latencyMs,
  };
}

/**
 * Dispatches a directional keypress and deterministically awaits DOM state mutation and settling.
 * Measures and logs the total round-trip latency.
 *
 * @param page - Active Playwright Page instance.
 * @param direction - Direction key to press.
 * @param previousBoard - Board state prior to keypress.
 * @param options - Optional timeout and logging controls.
 * @returns MoveResult with direction and round-trip latency in ms.
 */
export async function dispatchMoveAndSync(
  page: Page,
  direction: Direction,
  previousBoard: Board,
  options?: SyncOptions
): Promise<MoveResult> {
  if (!page) {
    throw new Error('dispatchMoveAndSync: Page instance must be provided.');
  }

  if (!previousBoard) {
    throw new Error(
      'dispatchMoveAndSync: A valid 4x4 previousBoard matrix must be provided.'
    );
  }

  const startTime = performance.now();

  // 1. Dispatch authentic keypress
  await dispatchKeypress(page, direction);

  // 2. Await mutation and animation settling
  await waitForStateSettling(page, previousBoard, options);

  const latencyMs = Math.round((performance.now() - startTime) * 100) / 100;

  if (options?.logger) {
    const logFn =
      typeof options.logger === 'function' ? options.logger : console.log;
    logFn(`[MoveSync] Dispatched ${direction} -> Settled in ${latencyMs}ms`);
  }

  return {
    direction,
    latencyMs,
  };
}

