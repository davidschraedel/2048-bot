import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import {
  Board,
  createEmptyBoard,
  readBoard,
} from '../src/board';
import { initBotSession, runBot } from '../src/bot';
import { GAME_URL } from '../src/config';
import { SELECTORS } from '../src/selectors';
import {
  cornerPriorityStrategy,
  lookaheadHeuristicStrategy,
  getValidMoves,
  simulateMove,
  getHighestTile,
  Strategy,
} from '../src/strategy';
import { areBoardsEqual } from '../src/sync';
import { formatLiveStatusLine, formatRunSummary } from '../src/telemetry';

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Recursively collects all TypeScript source files under a directory.
 */
function collectTsFiles(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Strips single-line and block comments from TypeScript source text
 * so static policy checks evaluate actual executable code rather than docstrings.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * Runs a deterministic seeded 2048 simulation in memory for a given strategy.
 */
function runSeededSimulation(
  strategy: Strategy,
  initialSeed: number,
  maxMoves = 3000
): { highestTile: number; score: number; moves: number } {
  let seed = initialSeed;
  const nextRand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const spawnTile = (board: Board): void => {
    const empties: Array<{ r: number; c: number }> = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (board[r][c] === 0) empties.push({ r, c });
      }
    }
    if (empties.length === 0) return;
    const cell = empties[Math.floor(nextRand() * empties.length)];
    board[cell.r][cell.c] = nextRand() < 0.9 ? 2 : 4;
  };

  const board = createEmptyBoard();
  spawnTile(board);
  spawnTile(board);

  let moves = 0;
  let score = 0;

  while (moves < maxMoves) {
    const validMoves = getValidMoves(board);
    if (validMoves.length === 0) break;

    const dir = strategy(board, validMoves);
    if (!validMoves.includes(dir)) {
      throw new Error(`Strategy returned illegal move "${dir}" not in [${validMoves.join(', ')}]`);
    }

    const sim = simulateMove(board, dir);
    if (!sim.moved) {
      throw new Error(`simulateMove reported moved=false for valid move "${dir}"`);
    }

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        board[r][c] = sim.board[r][c];
      }
    }
    score += sim.scoreGained;
    spawnTile(board);
    moves++;
  }

  return {
    highestTile: getHighestTile(board),
    score,
    moves,
  };
}

test.describe('Phase 10: Acceptance Criteria & Final Audit', () => {
  test.setTimeout(0);

  // ---------------------------------------------------------------------------
  // 1. Steering Ladder Alignment & Empirical Artifacts
  // ---------------------------------------------------------------------------
  test('1. Steering Ladder Aligned & Empirical Findings Guide Complete', () => {
    const ladderPath = path.join(REPO_ROOT, 'aiDocs', 'steering-ladder.md');
    expect(fs.existsSync(ladderPath)).toBe(true);
    const ladderContent = fs.readFileSync(ladderPath, 'utf-8');

    expect(ladderContent).toContain('## 1. Problem');
    expect(ladderContent).toContain('## 2. Vision');
    expect(ladderContent).toContain('## 3. Mission');
    expect(ladderContent).toContain('## 4. Strategy');
    expect(ladderContent).toContain('## 5. Plan');
    expect(ladderContent).toContain('## 6. State');

    const findingsPath = path.join(
      REPO_ROOT,
      'aiDocs',
      'playwright-synchronization-findings.md'
    );
    expect(fs.existsSync(findingsPath)).toBe(true);
    const findingsContent = fs.readFileSync(findingsPath, 'utf-8');

    expect(findingsContent).toContain('Animation & DOM Mutation Race Conditions');
    expect(findingsContent).toContain('Playwright Synchronization Boundaries');
    expect(findingsContent).toContain('Headed vs. Headless');
    expect(findingsContent).toContain('DOM Query Overhead');
    expect(findingsContent).toContain('Input Throttling');
    expect(findingsContent).toContain('Memory Management');
    expect(findingsContent).toContain('Actionable Design Patterns');
  });

  // ---------------------------------------------------------------------------
  // 2. Zero-Sleep Policy & Zero-CDP-Flood Synchronization
  // ---------------------------------------------------------------------------
  test('2. Zero-Sleep Policy: zero waitForTimeout calls and zero synchronization sleeps', () => {
    const srcFiles = collectTsFiles(path.join(REPO_ROOT, 'src'));
    const testFiles = collectTsFiles(path.join(REPO_ROOT, 'tests')).filter(
      (file) => !file.endsWith('acceptance.spec.ts')
    );

    for (const file of [...srcFiles, ...testFiles]) {
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      expect(code, `Found waitForTimeout in ${path.basename(file)}`).not.toMatch(
        /\bwaitForTimeout\s*\(/
      );
      expect(code, `Found sleep() call in ${path.basename(file)}`).not.toMatch(
        /\bsleep\s*\(/
      );
    }

    // Synchronization module must use in-browser waitForFunction + rAF settling, zero setTimeout/setInterval
    const syncCode = stripComments(
      fs.readFileSync(path.join(REPO_ROOT, 'src', 'sync.ts'), 'utf-8')
    );
    expect(syncCode).not.toMatch(/\bsetTimeout\s*\(/);
    expect(syncCode).not.toMatch(/\bsetInterval\s*\(/);
    expect(syncCode).toContain('waitForFunction');
    expect(syncCode).toContain("polling: 'raf'");
    expect(syncCode).toContain('requestAnimationFrame');
  });

  // ---------------------------------------------------------------------------
  // 3. Zero JS Cheating Policy
  // ---------------------------------------------------------------------------
  test('3. Zero JS Cheating: strictly external DOM parsing and real keyboard events', () => {
    const srcFiles = collectTsFiles(path.join(REPO_ROOT, 'src'));

    for (const file of srcFiles) {
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      expect(code, `Prohibited gameManager access in ${path.basename(file)}`).not.toMatch(
        /gameManager/i
      );
      expect(code, `Prohibited localStorage.getItem in ${path.basename(file)}`).not.toMatch(
        /localStorage\??\.getItem/
      );
      expect(code, `Prohibited localStorage.setItem in ${path.basename(file)}`).not.toMatch(
        /localStorage\??\.setItem/
      );
    }

    const inputCode = stripComments(
      fs.readFileSync(path.join(REPO_ROOT, 'src', 'input.ts'), 'utf-8')
    );
    expect(inputCode).toContain('page.keyboard.press');
  });

  // ---------------------------------------------------------------------------
  // 4. Zero AI / External Solvers Policy
  // ---------------------------------------------------------------------------
  test('4. Zero AI / External Solvers: deterministic TypeScript logic and clean dependencies', () => {
    const pkgPath = path.join(REPO_ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    const allDeps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    expect(allDeps.sort()).toEqual([
      '@playwright/test',
      '@types/node',
      'dotenv',
      'typescript',
    ]);

    const strategyCode = stripComments(
      fs.readFileSync(path.join(REPO_ROOT, 'src', 'strategy.ts'), 'utf-8')
    );
    expect(strategyCode).not.toMatch(/\bfetch\s*\(/);
    expect(strategyCode).not.toMatch(/openai|anthropic|gemini|tensorflow|onnx/i);

    // Determinism check: identical boards always yield identical moves
    const sampleBoard: Board = [
      [0, 2, 4, 8],
      [2, 8, 16, 4],
      [16, 32, 8, 2],
      [128, 64, 16, 4],
    ];
    const valid = getValidMoves(sampleBoard);
    expect(cornerPriorityStrategy(sampleBoard, valid)).toBe(
      cornerPriorityStrategy(sampleBoard, valid)
    );
    expect(lookaheadHeuristicStrategy(sampleBoard, valid)).toBe(
      lookaheadHeuristicStrategy(sampleBoard, valid)
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Memory & Trace Safety Configuration + 3,000+ Move Bound
  // ---------------------------------------------------------------------------
  test('5. Memory & Trace Safety: runner timeout 0, trace off, macro throttling, 3,000+ move stability', () => {
    const pwConfig = fs.readFileSync(
      path.join(REPO_ROOT, 'playwright.config.ts'),
      'utf-8'
    );
    expect(pwConfig).toMatch(/timeout:\s*0/);
    expect(pwConfig).toMatch(/trace:\s*['"]off['"]/);

    const botSpec = fs.readFileSync(
      path.join(REPO_ROOT, 'tests', 'bot-2048.spec.ts'),
      'utf-8'
    );
    expect(botSpec).toContain('test.setTimeout(0)');
    expect(botSpec).toContain('milestoneInterval = isFullPlay ? 100 : 10');

    // Stress-test 3,200 move decisions, simulations, and telemetry formatting in memory
    // to confirm bounded heap usage without memory leaks or OOM exhaustion.
    const startHeapMb = process.memoryUsage().heapUsed / (1024 * 1024);
    let totalSimulatedMoves = 0;

    for (let gameIdx = 0; totalSimulatedMoves < 3200; gameIdx++) {
      const sim = runSeededSimulation(lookaheadHeuristicStrategy, 1000 + gameIdx, 1000);
      totalSimulatedMoves += sim.moves;
      const line = formatLiveStatusLine({
        moveCount: totalSimulatedMoves,
        direction: 'ArrowDown',
        score: sim.score,
        highestTile: sim.highestTile,
        latencyMs: 18,
        board: createEmptyBoard(),
      });
      expect(line.length).toBeGreaterThan(0);
    }

    const summaryText = formatRunSummary({
      finalBoard: [
        [2, 4, 8, 16],
        [4, 16, 32, 64],
        [8, 32, 64, 128],
        [512, 256, 128, 64],
      ],
      totalMoves: totalSimulatedMoves,
      finalScore: 12000,
      highestTile: 512,
      durationMs: 60000,
      movesPerSecond: 53.3,
      averageLatencyMs: 18.5,
      moveLatencies: [18, 19, 18],
      terminationReason: 'MoveCapReached',
    });

    expect(totalSimulatedMoves).toBeGreaterThanOrEqual(3000);
    expect(summaryText).toContain('MoveCapReached');

    const endHeapMb = process.memoryUsage().heapUsed / (1024 * 1024);
    const heapDeltaMb = endHeapMb - startHeapMb;
    // Bounded memory growth across 3,200+ moves
    expect(heapDeltaMb).toBeLessThan(64);
  });

  // ---------------------------------------------------------------------------
  // 6. Recorded Comparative Performance Benchmarks
  // ---------------------------------------------------------------------------
  test('6. Performance Benchmarks: headed vs headless comparative dataset verified', () => {
    const benchmarkPath = path.join(
      REPO_ROOT,
      'test-results',
      'benchmark-data.json'
    );
    expect(fs.existsSync(benchmarkPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(benchmarkPath, 'utf-8'));
    expect(data.headed).toBeDefined();
    expect(data.headless).toBeDefined();
    expect(data.comparativeSummary).toBeDefined();

    expect(data.headed.mode).toBe('headed');
    expect(data.headed.totalMoves).toBeGreaterThan(0);
    expect(data.headed.movesPerSecond).toBeGreaterThan(0);
    expect(data.headed.domOverhead.overheadRatio).toBeGreaterThan(1);
    expect(data.headed.rendering.measuredFps).toBeGreaterThan(0);

    expect(data.headless.mode).toBe('headless');
    expect(data.headless.totalMoves).toBeGreaterThan(0);
    expect(data.headless.movesPerSecond).toBeGreaterThan(0);
    expect(data.headless.domOverhead.overheadRatio).toBeGreaterThan(1);
    expect(data.headless.rendering.measuredFps).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 7. Strategy Performance Benchmarks (Phase 1 >= 128, Phase 2 >= 256/512)
  // ---------------------------------------------------------------------------
  test('7. Strategy Performance: Phase 1 reaches 128+ and Phase 2 reaches 256/512+ tiles', () => {
    const seeds = Array.from({ length: 15 }, (_, idx) => 101 + idx * 37);

    // Phase 1: Corner Priority Cycling
    const cornerTiles = seeds.map(
      (seed) => runSeededSimulation(cornerPriorityStrategy, seed, 2000).highestTile
    );
    const cornerMax = Math.max(...cornerTiles);
    const corner128Count = cornerTiles.filter((t) => t >= 128).length;
    console.log(
      `\n  [Strategy Audit] Phase 1 (Corner) across ${seeds.length} seeds -> Tiles: [${cornerTiles.join(', ')}] | Max: ${cornerMax} | >=128 rate: ${corner128Count}/${seeds.length}`
    );
    expect(cornerMax).toBeGreaterThanOrEqual(128);
    expect(corner128Count).toBeGreaterThanOrEqual(1);

    // Phase 2: Lookahead Heuristic
    const lookaheadTiles = seeds.map(
      (seed) => runSeededSimulation(lookaheadHeuristicStrategy, seed, 3000).highestTile
    );
    const lookaheadMax = Math.max(...lookaheadTiles);
    const lookahead256Count = lookaheadTiles.filter((t) => t >= 256).length;
    const lookahead512Count = lookaheadTiles.filter((t) => t >= 512).length;
    console.log(
      `  [Strategy Audit] Phase 2 (Lookahead) across ${seeds.length} seeds -> Tiles: [${lookaheadTiles.join(', ')}] | Max: ${lookaheadMax} | >=256: ${lookahead256Count}/${seeds.length} | >=512: ${lookahead512Count}/${seeds.length}`
    );
    expect(lookaheadMax).toBeGreaterThanOrEqual(512);
    expect(lookahead256Count).toBeGreaterThanOrEqual(Math.ceil(seeds.length / 2));
  });

  // ---------------------------------------------------------------------------
  // 8. Live Browser Acceptance: Clean Session, Zero-Waste Moves, Triple Guards
  // ---------------------------------------------------------------------------
  test('8. Live Browser Acceptance: pristine start, zero-waste moves, and triple guards verified', async ({
    page,
  }) => {
    // A. Pristine Session State Cleanliness
    const initialState = await initBotSession(page, GAME_URL);
    expect(initialState.score).toBe(0);
    expect(initialState.isGameOver).toBe(false);
    expect(initialState.isGameWon).toBe(false);

    const initialTiles = initialState.board.flat().filter((v) => v > 0);
    expect(initialTiles.length).toBe(2);
    for (const val of initialTiles) {
      expect([2, 4]).toContain(val);
    }

    // B. Zero-Waste Moves: Every dispatched keystroke must mutate the live DOM board
    let prevBoard = initialState.board;
    let verifiedMutations = 0;

    const runResult = await runBot(
      page,
      {
        maxMoves: 25,
        strategy: 'lookahead',
        moveDelayMs: 0,
      },
      {
        onMove: (event) => {
          expect(areBoardsEqual(prevBoard, event.board)).toBe(false);
          prevBoard = event.board;
          verifiedMutations++;
        },
      }
    );

    expect(runResult.totalMoves).toBe(25);
    expect(runResult.terminationReason).toBe('MoveCapReached');
    expect(verifiedMutations).toBe(25);

    // C. Guard 2 (Loss/Deadlock) verification on live page
    await page.evaluate((sel) => {
      const msg = document.querySelector(sel.gameMessage);
      if (msg) msg.classList.add('game-over');
    }, SELECTORS);
    const overResult = await runBot(page, {
      maxMoves: 10,
      strategy: 'lookahead',
      moveDelayMs: 0,
    });
    expect(overResult.terminationReason).toBe('GameOver');

    // D. Guard 1 (Win) verification on live page
    await page.evaluate((sel) => {
      const msg = document.querySelector(sel.gameMessage);
      if (msg) {
        msg.classList.remove('game-over');
        msg.classList.add('game-won');
      }
    }, SELECTORS);
    const winResult = await runBot(page, {
      maxMoves: 10,
      strategy: 'lookahead',
      keepPlayingOnWin: false,
      moveDelayMs: 0,
    });
    expect(winResult.terminationReason).toBe('GameWon');

    // Clean up injected classes and verify readBoard still reads cleanly
    const finalParsed = await readBoard(page);
    expect(finalParsed.board.length).toBe(4);
  });
});
