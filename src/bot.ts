import { Page } from '@playwright/test';
import { Board, GameState, readBoard } from './board';
import { Direction } from './input';
import { SELECTORS } from './selectors';
import { initCleanSession } from './storage';
import { getValidMoves, getStrategy, Strategy } from './strategy';
import { areBoardsEqual, dispatchMoveAndSync } from './sync';
import { BotConfig, DEFAULT_CONFIG, getBotConfig, GAME_URL } from './config';
import { captureFinalScreenshot } from './telemetry';

/**
 * Deterministic termination reasons for the 2048 automation loop.
 * Covers Triple Safety Guards:
 * - Guard 1: GameWon (reaches 2048 tile and keepPlaying is false)
 * - Guard 2: GameOver / Deadlocked (board full or zero legal moves remain)
 * - Guard 3: MoveCapReached (moveCount reaches maxMoves threshold)
 */
export type TerminationReason =
  | 'GameWon'
  | 'GameOver'
  | 'Deadlocked'
  | 'MoveCapReached'
  | 'Aborted';

/**
 * Telemetry and performance metrics returned upon bot session termination.
 */
export interface BotRunResult {
  /** Total directional moves dispatched and settled */
  totalMoves: number;
  /** Final score parsed from the score container */
  finalScore: number;
  /** Highest numerical tile achieved on the board */
  highestTile: number;
  /** Deterministic reason why the game loop halted */
  terminationReason: TerminationReason;
  /** Final 4x4 board matrix snapshot */
  finalBoard: Board;
  /** Total wall-clock duration of the game loop in milliseconds */
  durationMs: number;
  /** Throughput in moves per second (MPS) */
  movesPerSecond: number;
  /** Array of individual move-to-settle roundtrip latencies in milliseconds */
  moveLatencies: number[];
  /** Mean move roundtrip latency in milliseconds */
  averageLatencyMs: number;
}

/**
 * Event payload emitted after each successful move execution.
 */
export interface BotMoveEvent {
  moveCount: number;
  direction: Direction;
  score: number;
  highestTile: number;
  latencyMs: number;
  board: Board;
}

/**
 * Event payload emitted periodically at macro milestones.
 */
export interface BotMilestoneEvent {
  moveCount: number;
  score: number;
  highestTile: number;
  movesPerSecond: number;
  averageLatencyMs: number;
}

/**
 * Lifecycle hooks for observability, live logging, and trace milestone throttling.
 */
export interface BotHooks {
  onMove?: (event: BotMoveEvent) => void | Promise<void>;
  onMilestone?: (milestone: BotMilestoneEvent) => void | Promise<void>;
  onTermination?: (result: BotRunResult) => void | Promise<void>;
}

/**
 * Defensively restores active tab and window focus to guarantee reliable keyboard event delivery.
 * Handles loss of tab focus, backgrounding, and blurs any accidental text selections or overlays.
 *
 * @param page - Active Playwright Page instance.
 */
export async function ensureActiveFocus(page: Page): Promise<void> {
  try {
    await page.bringToFront().catch(() => {});
    await page
      .evaluate(() => {
        try {
          window.focus();
          if (document.activeElement && document.activeElement !== document.body) {
            (document.activeElement as HTMLElement).blur?.();
          }
        } catch {
          // Ignore iframe/security boundary restrictions
        }
      })
      .catch(() => {});
    await page.locator(SELECTORS.gameContainer).focus().catch(() => {});
  } catch {
    // Non-fatal: proceed with keystroke dispatch
  }
}

/**
 * Dismisses unexpected modal overlays, cookie consent dialogues, or obstruction backdrops
 * that could intercept keystrokes or alter DOM layout.
 *
 * @param page - Active Playwright Page instance.
 */
export async function dismissUnexpectedModals(page: Page): Promise<void> {
  try {
    await page
      .evaluate(() => {
        const modalSelectors = [
          '.cookie-notice',
          '.cookie-banner',
          '#cookie-consent',
          '.modal-backdrop',
          '[aria-modal="true"]',
        ];
        modalSelectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            // Do not remove the game container or game message
            if (!el.closest('.game-container')) {
              el.remove();
            }
          });
        });
      })
      .catch(() => {});
  } catch {
    // Non-fatal overlay dismissal
  }
}

/**
 * Session initialization routine:
 * 1. Installs network routing guards and navigates to GAME_URL.
 * 2. Clears localStorage, sessionStorage, and cookies.
 * 3. Reloads page and awaits initial tile rendering.
 * 4. Ensures active window focus.
 * 5. Verifies a pristine board: score is 0, game is active, and exactly initial tiles are present.
 *
 * @param page - Active Playwright Page instance.
 * @param gameUrl - Optional target URL (defaults to GAME_URL).
 * @returns Pristine initial GameState.
 */
export async function initBotSession(
  page: Page,
  gameUrl: string = GAME_URL
): Promise<GameState> {
  await initCleanSession(page, gameUrl);
  await ensureActiveFocus(page);
  await dismissUnexpectedModals(page);

  const state = await readBoard(page);

  // Pristine session verification
  if (state.score !== 0) {
    throw new Error(
      `initBotSession: Expected initial score to be 0, got ${state.score}.`
    );
  }

  const nonZeroTiles = state.board.flat().filter((val) => val > 0);
  if (nonZeroTiles.length < 2) {
    throw new Error(
      `initBotSession: Expected at least 2 initial tiles, found ${nonZeroTiles.length}.`
    );
  }

  for (const tileVal of nonZeroTiles) {
    if (tileVal !== 2 && tileVal !== 4) {
      throw new Error(
        `initBotSession: Initial tile value ${tileVal} is invalid; expected 2 or 4.`
      );
    }
  }

  if (state.isGameOver) {
    throw new Error('initBotSession: Pristine board unexpectedly reports isGameOver = true.');
  }

  if (state.isGameWon) {
    throw new Error('initBotSession: Pristine board unexpectedly reports isGameWon = true.');
  }

  return state;
}

/**
 * Assembles and executes the sequential main 2048 automation loop with Triple Safety Guards.
 *
 * Loop Architecture:
 * 1. Read initial state via readBoard().
 * 2. Loop while game is active:
 *    - Guard 1 (Win): Check isGameWon; terminate cleanly or click keep-playing-button if configured.
 *    - Calculate legal moves in memory via getValidMoves(currentBoard).
 *    - Guard 2 (Loss/Deadlock): Check if isGameOver or validMoves.length === 0; log and terminate immediately.
 *    - Guard 3 (Move Cap): Check if moveCount >= MAX_MOVES; terminate immediately.
 *    - Select direction from validMoves via configured active strategy.
 *    - Periodically ensure window focus and dismiss unexpected modal overlays.
 *    - Dispatch keypress (page.keyboard.press()) and await synchronization settling via waitForFunction().
 *    - Re-read updated GameState via readBoard().
 *    - Increment moveCount.
 *    - Emit telemetry hooks and macro milestones.
 *
 * @param page - Active Playwright Page instance.
 * @param configOverrides - Optional partial BotConfig overrides.
 * @param hooks - Optional telemetry and milestone callbacks.
 * @returns Comprehensive BotRunResult with metrics and final board snapshot.
 */
export async function runBot(
  page: Page,
  configOverrides?: Partial<BotConfig>,
  hooks?: BotHooks
): Promise<BotRunResult> {
  const config = getBotConfig(configOverrides);
  const strategyFn: Strategy = getStrategy(config.strategy);

  // Automatically dismiss unexpected native browser modal dialogs (alert, confirm, beforeunload)
  const dialogHandler = (dialog: { dismiss: () => Promise<void> }) => {
    dialog.dismiss().catch(() => {});
  };
  page.on('dialog', dialogHandler);

  const startTime = performance.now();
  const moveLatencies: number[] = [];
  let moveCount = 0;
  let currentState: GameState = await readBoard(page);
  let terminationReason: TerminationReason | null = null;

  try {
    while (terminationReason === null) {
      // -------------------------------------------------------------
      // Guard 1 (Win): Check isGameWon
      // -------------------------------------------------------------
      if (currentState.isGameWon) {
        if (config.keepPlayingOnWin) {
          const keepPlayingBtn = page.locator(SELECTORS.keepPlayingButton);
          try {
            await keepPlayingBtn.waitFor({ state: 'visible', timeout: 2000 });
            await keepPlayingBtn.click();
            // Await game-won modal clearance
            await page
              .waitForFunction(
                ({ sel }) => !document.querySelector(sel.gameWonMessage),
                { sel: SELECTORS },
                { timeout: 2000 }
              )
              .catch(() => {});
            currentState = await readBoard(page);
          } catch {
            // Keep playing button could not be activated
          }

          if (currentState.isGameWon) {
            // If win modal persists, terminate cleanly to avoid looping
            terminationReason = 'GameWon';
            break;
          }
        } else {
          terminationReason = 'GameWon';
          break;
        }
      }

      // -------------------------------------------------------------
      // Calculate legal moves in memory via getValidMoves(currentBoard)
      // -------------------------------------------------------------
      const validMoves = getValidMoves(currentState.board);

      // -------------------------------------------------------------
      // Guard 2 (Loss/Deadlock): Check if isGameOver or validMoves.length === 0
      // -------------------------------------------------------------
      if (currentState.isGameOver || validMoves.length === 0) {
        terminationReason = currentState.isGameOver ? 'GameOver' : 'Deadlocked';
        break;
      }

      // -------------------------------------------------------------
      // Guard 3 (Move Cap): Check if moveCount >= MAX_MOVES
      // -------------------------------------------------------------
      if (moveCount >= config.maxMoves) {
        terminationReason = 'MoveCapReached';
        break;
      }

      // -------------------------------------------------------------
      // Strategy Selection: Select direction using active strategy
      // -------------------------------------------------------------
      const direction = strategyFn(currentState.board, validMoves);

      // Focus maintenance & overlay defense every 25 moves
      if (moveCount > 0 && moveCount % 25 === 0) {
        await ensureActiveFocus(page);
        await dismissUnexpectedModals(page);
      }

      // -------------------------------------------------------------
      // Keystroke Dispatch & State Synchronization Settling
      // -------------------------------------------------------------
      let moveResult;
      try {
        moveResult = await dispatchMoveAndSync(page, direction, currentState.board, {
          timeoutMs: config.settleTimeoutMs,
        });
      } catch (syncError) {
        // Defensive synchronization recovery: check if terminal state arrived during move
        await dismissUnexpectedModals(page);
        await ensureActiveFocus(page);
        const recoveredState = await readBoard(page);

        if (recoveredState.isGameOver || recoveredState.isGameWon) {
          currentState = recoveredState;
          moveLatencies.push(config.settleTimeoutMs);
          moveCount++;
          continue; // Next iteration will halt cleanly via Guard 1 or Guard 2
        }

        // If board did mutate despite sync timeout, continue smoothly
        if (!areBoardsEqual(recoveredState.board, currentState.board)) {
          currentState = recoveredState;
          moveLatencies.push(config.settleTimeoutMs);
          moveCount++;
          continue;
        }

        // Single retry after restoring focus and dismissing potential overlays
        try {
          moveResult = await dispatchMoveAndSync(page, direction, currentState.board, {
            timeoutMs: config.settleTimeoutMs,
          });
        } catch {
          throw syncError;
        }
      }

      // Record move latency
      moveLatencies.push(moveResult.latencyMs);

      // -------------------------------------------------------------
      // Re-read updated GameState via readBoard()
      // -------------------------------------------------------------
      currentState = await readBoard(page);

      // Pacing delay between moves for comfortable human visual observation
      if (config.moveDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.moveDelayMs));
      }

      // -------------------------------------------------------------
      // Increment moveCount & Emit Hooks
      // -------------------------------------------------------------
      moveCount++;

      if (hooks?.onMove) {
        await Promise.resolve(
          hooks.onMove({
            moveCount,
            direction,
            score: currentState.score,
            highestTile: currentState.highestTile,
            latencyMs: moveResult.latencyMs,
            board: currentState.board,
          })
        );
      }

      // Macro milestone reporting
      if (config.logEveryMoves > 0 && moveCount % config.logEveryMoves === 0) {
        const elapsedSec = (performance.now() - startTime) / 1000;
        const currentMps = elapsedSec > 0 ? moveCount / elapsedSec : 0;
        const avgLat =
          moveLatencies.length > 0
            ? moveLatencies.reduce((a, b) => a + b, 0) / moveLatencies.length
            : 0;

        if (hooks?.onMilestone) {
          await Promise.resolve(
            hooks.onMilestone({
              moveCount,
              score: currentState.score,
              highestTile: currentState.highestTile,
              movesPerSecond: Math.round(currentMps * 100) / 100,
              averageLatencyMs: Math.round(avgLat * 100) / 100,
            })
          );
        }
      }
    }
  } finally {
    page.off('dialog', dialogHandler);
  }

  const durationMs = Math.round(performance.now() - startTime);
  const movesPerSecond =
    durationMs > 0 ? Math.round((moveCount / (durationMs / 1000)) * 100) / 100 : 0;
  const averageLatencyMs =
    moveLatencies.length > 0
      ? Math.round(
          (moveLatencies.reduce((a, b) => a + b, 0) / moveLatencies.length) * 100
        ) / 100
      : 0;

  const result: BotRunResult = {
    totalMoves: moveCount,
    finalScore: currentState.score,
    highestTile: currentState.highestTile,
    terminationReason: terminationReason ?? 'Aborted',
    finalBoard: currentState.board,
    durationMs,
    movesPerSecond,
    moveLatencies,
    averageLatencyMs,
  };

  if (config.screenshotOnTermination) {
    try {
      await captureFinalScreenshot(page, config.screenshotPath);
    } catch {
      // Non-fatal screenshot capture
    }
  }

  if (hooks?.onTermination) {
    await Promise.resolve(hooks.onTermination(result));
  }

  return result;
}

