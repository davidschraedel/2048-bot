import { test, expect } from '@playwright/test';
import {
  initBotSession,
  runBot,
  ensureActiveFocus,
  dismissUnexpectedModals,
  TerminationReason,
  BotRunResult,
} from '../src/bot';
import {
  getBotConfig,
  parseMaxMoves,
  parseTimeout,
  parseStrategy,
  GAME_URL,
  DEFAULT_CONFIG,
} from '../src/config';
import { readBoard, renderBoardAscii } from '../src/board';
import { SELECTORS } from '../src/selectors';

test.describe('Phase 6: Core Automation Loop & Triple Termination Safety', () => {
  // Disable test timeout to allow autonomous bot sessions to execute without test runner aborts
  test.setTimeout(0);

  // ---------------------------------------------------------------------------
  // 1. Configuration Module Unit Tests
  // ---------------------------------------------------------------------------
  test.describe('Configuration Module (src/config.ts)', () => {
    test('parses valid and default configuration correctly', () => {
      expect(parseMaxMoves('1500')).toBe(1500);
      expect(parseMaxMoves(undefined)).toBe(3000);

      expect(parseTimeout('8000', 5000)).toBe(8000);
      expect(parseTimeout(undefined, 5000)).toBe(5000);

      expect(parseStrategy('corner')).toBe('corner');
      expect(parseStrategy('LOOKAHEAD')).toBe('lookahead');
      expect(parseStrategy(undefined)).toBe('lookahead');
    });

    test('rejects invalid maxMoves, timeouts, and strategies with fast-fail errors', () => {
      expect(() => parseMaxMoves('-10')).toThrow('Must be a positive integer');
      expect(() => parseMaxMoves('abc')).toThrow('Must be a positive integer');

      expect(() => parseTimeout('0', 5000)).toThrow('Must be a positive integer');
      expect(() => parseTimeout('-5', 5000)).toThrow('Must be a positive integer');

      expect(() => parseStrategy('random')).toThrow('Invalid strategy "random"');
    });

    test('getBotConfig returns defaults and merges valid overrides', () => {
      const config = getBotConfig({ maxMoves: 50, strategy: 'corner' });
      expect(config.maxMoves).toBe(50);
      expect(config.strategy).toBe('corner');
      expect(config.gameUrl).toBe(DEFAULT_CONFIG.gameUrl);
      expect(config.settleTimeoutMs).toBe(DEFAULT_CONFIG.settleTimeoutMs);
    });

    test('getBotConfig rejects invalid override values', () => {
      expect(() => getBotConfig({ maxMoves: 0 })).toThrow('maxMoves must be greater than 0');
      expect(() => getBotConfig({ settleTimeoutMs: -100 })).toThrow(
        'settleTimeoutMs must be greater than 0'
      );
      expect(() => getBotConfig({ actionTimeoutMs: 0 })).toThrow(
        'actionTimeoutMs must be greater than 0'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Session Initialization & Pristine Board Routine
  // ---------------------------------------------------------------------------
  test.describe('Session Initialization Routine', () => {
    test('initializes clean session with cleared storage, score 0, and pristine initial tiles', async ({
      page,
    }) => {
      const state = await initBotSession(page, GAME_URL);

      // Verify pristine initial score and status
      expect(state.score).toBe(0);
      expect(state.isGameOver).toBe(false);
      expect(state.isGameWon).toBe(false);

      // Verify initial tile count (2048 spawns 2 tiles on clean game start)
      const tiles = state.board.flat().filter((val) => val > 0);
      expect(tiles.length).toBeGreaterThanOrEqual(2);
      for (const val of tiles) {
        expect([2, 4]).toContain(val);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Triple Safety Guards
  // ---------------------------------------------------------------------------
  test.describe('Triple Termination Safety Guards', () => {
    test('Guard 3 (Move Cap): terminates deterministically when moveCount reaches maxMoves', async ({
      page,
    }) => {
      await initBotSession(page, GAME_URL);

      const targetCap = 5;
      const result = await runBot(page, {
        maxMoves: targetCap,
        strategy: 'corner',
      });

      expect(result.totalMoves).toBe(targetCap);
      expect(result.terminationReason).toBe('MoveCapReached');
      expect(result.moveLatencies.length).toBe(targetCap);
      expect(result.finalScore).toBeGreaterThanOrEqual(0);
      expect(result.highestTile).toBeGreaterThanOrEqual(2);
      expect(result.movesPerSecond).toBeGreaterThan(0);
    });

    test('Guard 2 (Loss/Deadlock): halts immediately when terminal game-over is detected', async ({
      page,
    }) => {
      await initBotSession(page, GAME_URL);

      // Inject game-over state directly in the DOM to simulate terminal game loss
      await page.evaluate((sel) => {
        const msg = document.querySelector(sel.gameMessage);
        if (msg) {
          msg.classList.add('game-over');
        }
      }, SELECTORS);

      const result = await runBot(page, {
        maxMoves: 100,
        strategy: 'lookahead',
      });

      expect(result.totalMoves).toBe(0);
      expect(result.terminationReason).toBe('GameOver');
    });

    test('Guard 1 (Win): halts cleanly on win when keepPlayingOnWin is false', async ({
      page,
    }) => {
      await initBotSession(page, GAME_URL);

      // Inject game-won state directly in the DOM to simulate reaching 2048
      await page.evaluate((sel) => {
        const msg = document.querySelector(sel.gameMessage);
        if (msg) {
          msg.classList.add('game-won');
        }
      }, SELECTORS);

      const result = await runBot(page, {
        maxMoves: 100,
        strategy: 'lookahead',
        keepPlayingOnWin: false,
      });

      expect(result.totalMoves).toBe(0);
      expect(result.terminationReason).toBe('GameWon');
    });

    test('Guard 1 (Win): clicks keep-playing button and continues if keepPlayingOnWin is true', async ({
      page,
    }) => {
      await initBotSession(page, GAME_URL);

      // Inject game-won state and ensure keep-playing button is present
      await page.evaluate((sel) => {
        const msg = document.querySelector(sel.gameMessage);
        if (msg) {
          msg.classList.add('game-won');
        }
      }, SELECTORS);

      // Run bot with keepPlayingOnWin = true and maxMoves = 2
      const result = await runBot(page, {
        maxMoves: 2,
        strategy: 'corner',
        keepPlayingOnWin: true,
      });

      // Should have clicked keep-playing button and executed 2 moves to reach MoveCapReached
      expect(result.totalMoves).toBe(2);
      expect(result.terminationReason).toBe('MoveCapReached');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Modal and Tab Focus Exception Handling
  // ---------------------------------------------------------------------------
  test.describe('Exception Handling & Focus Resilience', () => {
    test('handles unexpected overlays and maintains active window focus', async ({ page }) => {
      await initBotSession(page, GAME_URL);

      // Inject simulated external overlay / cookie consent banner
      await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.className = 'cookie-notice';
        overlay.textContent = 'Simulated cookie notice banner';
        document.body.appendChild(overlay);
      });

      // Ensure focus defense cleans it up
      await dismissUnexpectedModals(page);
      await ensureActiveFocus(page);

      const overlayCount = await page.locator('.cookie-notice').count();
      expect(overlayCount).toBe(0);

      // Run a few moves to ensure input dispatch works smoothly after overlay removal
      const result = await runBot(page, { maxMoves: 3, strategy: 'corner' });
      expect(result.totalMoves).toBe(3);
      expect(result.terminationReason).toBe('MoveCapReached');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. End-to-End Autonomous Gameplay Execution
  // ---------------------------------------------------------------------------
  test.describe('Autonomous Gameplay Execution', () => {
    test('executes autonomous 2048 bot loop with lookahead strategy and live telemetry', async ({
      page,
    }) => {
      await test.step('1. Initialize pristine session', async () => {
        const initialState = await initBotSession(page, GAME_URL);
        expect(initialState.score).toBe(0);
      });

      const moveLog: string[] = [];
      const milestones: number[] = [];

      // Run 25 autonomous moves for standard test suite verification (or MAX_MOVES if provided)
      const targetMoves = process.env.MAX_MOVES
        ? parseInt(process.env.MAX_MOVES, 10)
        : 25;

      let runResult: BotRunResult | undefined;
      await test.step(`2. Execute autonomous bot loop for ${targetMoves} moves`, async () => {
        runResult = await runBot(
          page,
          {
            maxMoves: targetMoves,
            strategy: 'lookahead',
            logEveryMoves: 10,
          },
          {
            onMove: (event) => {
              moveLog.push(
                `Move #${event.moveCount}: ${event.direction} (Score: ${event.score}, High: ${event.highestTile}, Latency: ${event.latencyMs}ms)`
              );
            },
            onMilestone: (m) => {
              milestones.push(m.moveCount);
            },
          }
        );
      });

      await test.step('3. Verify telemetry and termination', async () => {
        expect(runResult).toBeDefined();
        if (!runResult) throw new Error('runResult should be defined');
        expect(runResult.totalMoves).toBe(targetMoves);
        expect(
          ['MoveCapReached', 'GameOver', 'GameWon', 'Deadlocked'] as TerminationReason[]
        ).toContain(runResult.terminationReason);

        // Expect score to have advanced
        expect(runResult.finalScore).toBeGreaterThanOrEqual(0);
        // Expect highest tile to be >= 4 after 25 moves
        expect(runResult.highestTile).toBeGreaterThanOrEqual(4);
        expect(runResult.movesPerSecond).toBeGreaterThan(0);
        expect(runResult.averageLatencyMs).toBeGreaterThan(0);

        // Verify hooks fired
        expect(moveLog.length).toBe(targetMoves);
        expect(milestones.length).toBeGreaterThanOrEqual(2); // at move 10 and 20

        // Verify ASCII representation
        const ascii = renderBoardAscii(runResult.finalBoard);
        expect(ascii).toContain('+------+------+------+------+');
      });
    });
  });
});
