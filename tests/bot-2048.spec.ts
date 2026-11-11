import { test, expect } from '@playwright/test';
import { initBotSession, runBot } from '../src/bot';
import { GAME_URL, MAX_MOVES, ACTIVE_STRATEGY } from '../src/config';
import { renderBoardAscii } from '../src/board';

test.describe('2048 Autonomous Bot', () => {
  // Allow autonomous play to run until game completion without runner timeout
  test.setTimeout(0);

  test('Plays 2048 to Completion', async ({ page }) => {
    console.log('\n🚀 Starting 2048 Autonomous Bot...');
    console.log(`   Target URL: ${GAME_URL}`);
    console.log(`   Strategy:   ${ACTIVE_STRATEGY}`);
    console.log(`   Move Cap:   ${MAX_MOVES} moves\n`);

    // 1. Initialize a pristine game session
    await initBotSession(page, GAME_URL);

    // 2. Play game continuously until Game Over or Win
    const result = await runBot(
      page,
      {
        maxMoves: MAX_MOVES,
        strategy: ACTIVE_STRATEGY,
        logEveryMoves: 50,
      },
      {
        onMove: (event) => {
          if (event.moveCount % 10 === 0) {
            console.log(
              `[Move #${event.moveCount.toString().padStart(4)}] ${event.direction.padEnd(11)} | Score: ${event.score.toString().padStart(6)} | Highest Tile: ${event.highestTile}`
            );
          }
        },
        onMilestone: (m) => {
          console.log(
            `\n📊 --- Milestone at ${m.moveCount} moves | Score: ${m.score} | Highest: ${m.highestTile} | Speed: ${m.movesPerSecond} MPS ---\n`
          );
        },
      }
    );

    // 3. Print final summary report
    console.log('\n' + '='.repeat(60));
    console.log('🎮 2048 GAME FINISHED!');
    console.log(`   Termination Reason: ${result.terminationReason}`);
    console.log(`   Final Score:        ${result.finalScore}`);
    console.log(`   Highest Tile:       ${result.highestTile}`);
    console.log(`   Total Moves:        ${result.totalMoves}`);
    console.log(`   Average Latency:    ${result.averageLatencyMs} ms`);
    console.log(`   Average Speed:      ${result.movesPerSecond} moves/sec`);
    console.log('='.repeat(60));
    console.log('\nFinal Board State:');
    console.log(renderBoardAscii(result.finalBoard));
    console.log('='.repeat(60) + '\n');

    // 4. Verify legitimate game run
    expect(result.totalMoves).toBeGreaterThan(0);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.highestTile).toBeGreaterThanOrEqual(4);

    // 5. If running in headed mode (visible browser window), keep browser open for user inspection
    if (!test.info().project.use.headless) {
      console.log('👁️ Browser window is kept open so you can inspect the final board.');
      console.log('👉 Close the Chrome browser window when you are done.\n');
      await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
    }
  });
});
