import * as fs from 'fs';
import { test, expect } from '@playwright/test';
import { initBotSession, runBot, BotRunResult } from '../src/bot';
import { GAME_URL, MAX_MOVES, ACTIVE_STRATEGY } from '../src/config';
import {
  printLiveStatus,
  formatMilestoneBanner,
  printRunSummary,
  captureFinalScreenshot,
} from '../src/telemetry';

test.describe('2048 Autonomous Bot', () => {
  // Allow autonomous play to run until game completion without runner timeout
  test.setTimeout(0);

  test('Plays 2048 to Completion', async ({ page }) => {
    // In automated test suite runs, cap at 15 moves so the test suite finishes quickly;
    // In full play mode (npm run play, headed mode, or explicit MAX_MOVES), run to full cap.
    const isFullPlay =
      process.env.BOT_PLAY === 'true' ||
      process.env.MAX_MOVES !== undefined ||
      !test.info().project.use.headless;
    const moveCap = isFullPlay ? MAX_MOVES : 15;
    // Macro milestone interval: every 100 moves in full runs; every 10 moves in quick test suite runs
    const milestoneInterval = isFullPlay ? 100 : 10;

    console.log('\n🚀 Starting 2048 Autonomous Bot...');
    console.log(`   Target URL:         ${GAME_URL}`);
    console.log(`   Strategy:           ${ACTIVE_STRATEGY}`);
    console.log(`   Move Cap:           ${moveCap} moves${isFullPlay ? '' : ' (test suite mode)'}`);
    console.log(`   Milestone Cadence:  every ${milestoneInterval} moves\n`);

    // -------------------------------------------------------------------------
    // Macro Step 1: Session Initialization
    // -------------------------------------------------------------------------
    await test.step('1. Session Initialization & Pristine Board Check', async () => {
      await initBotSession(page, GAME_URL);
    });

    // -------------------------------------------------------------------------
    // Macro Step 2: Autonomous Play Loop with Macro Milestone Throttling
    // Throttles test.step() to macro milestones (every 100 moves) to protect
    // Playwright trace buffer memory from being overwhelmed by thousands of micro-steps.
    // -------------------------------------------------------------------------
    let result!: BotRunResult;

    await test.step('2. Autonomous Play Loop', async () => {
      result = await runBot(
        page,
        {
          maxMoves: moveCap,
          strategy: ACTIVE_STRATEGY,
          logEveryMoves: milestoneInterval,
          moveDelayMs: isFullPlay ? undefined : 0,
        },
        {
          // Emits live CLI status line on every move:
          // [Move #0042] ArrowDown   | Score:   1,420 | Highest Tile:   128 | Latency:   18ms
          onMove: (event) => {
            printLiveStatus(event);
          },
          // Throttled macro milestone step (every 100 moves in full run / every 10 moves in test run)
          onMilestone: async (m) => {
            await test.step(
              `Macro Milestone: Move ${m.moveCount} (Score: ${m.score}, Highest: ${m.highestTile}, MPS: ${m.movesPerSecond})`,
              async () => {
                console.log(formatMilestoneBanner(m));
              }
            );
          },
        }
      );
    });

    // -------------------------------------------------------------------------
    // Macro Step 3: Run Summary & Telemetry Reporting
    // Comprehensive final report with ASCII board, MPS throughput, and termination reason
    // -------------------------------------------------------------------------
    await test.step('3. Run Summary & Telemetry Reporting', async () => {
      printRunSummary(result);

      // Verify legitimate game run
      expect(result.totalMoves).toBeGreaterThan(0);
      expect(result.finalScore).toBeGreaterThanOrEqual(0);
      expect(result.highestTile).toBeGreaterThanOrEqual(4);
      expect(['GameWon', 'GameOver', 'Deadlocked', 'MoveCapReached']).toContain(
        result.terminationReason
      );
    });

    // -------------------------------------------------------------------------
    // Macro Step 4: Final Board Screenshot Persistence
    // Automatically captures and saves board screenshot to test-results/final-run.png
    // -------------------------------------------------------------------------
    await test.step('4. Capture Final Board Screenshot', async () => {
      const screenshotPath = await captureFinalScreenshot(page, 'test-results/final-run.png');
      console.log(`📸 Final board screenshot saved to: ${screenshotPath}`);

      expect(fs.existsSync(screenshotPath)).toBe(true);
      expect(fs.statSync(screenshotPath).size).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------
    // Macro Step 5: Post-Game Inspection (Headed mode only)
    // -------------------------------------------------------------------------
    if (!test.info().project.use.headless) {
      console.log('👁️ Browser window is kept open so you can inspect the final board.');
      console.log('👉 Close the Chrome browser window when you are done.\n');
      await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
    }
  });
});
