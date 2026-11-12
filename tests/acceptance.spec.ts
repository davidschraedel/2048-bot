import * as fs from 'fs';
import * as path from 'path';
import { test, expect, Page } from '@playwright/test';
import {
  Board,
  createEmptyBoard,
  readBoard,
} from '../src/board';
import { initBotSession, runBot } from '../src/bot';
import { DEFAULT_CONFIG, GAME_URL } from '../src/config';
import { Direction } from '../src/input';
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
 * Strips single-line and block comments from TypeScript source text while preserving
 * string and template literals so URLs ('https://...') or globs ('**' + '/*') do not
 * corrupt comment detection.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    // Preserve single-quoted, double-quoted, and template literals
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c = source[i];
        out += c;
        if (c === '\\' && i + 1 < len) {
          out += source[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (c === quote) break;
      }
      continue;
    }

    // Strip single-line comments
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Strip block comments
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        i++;
      }
      i += 2;
      out += ' ';
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Creates a deterministic seeded tile spawner and an in-memory mock Playwright Page
 * so runBot() can be stress-tested across 3,000+ moves offline without browser overhead.
 */
function createMock2048Page(initialSeed: number): { page: Page; resetBoard: () => void } {
  let seed = initialSeed;
  const nextRand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  let board: Board = createEmptyBoard();
  let score = 0;
  let isGameOver = false;

  const spawnTile = (b: Board): void => {
    const empties: Array<{ r: number; c: number }> = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (b[r][c] === 0) empties.push({ r, c });
      }
    }
    if (empties.length === 0) return;
    const cell = empties[Math.floor(nextRand() * empties.length)];
    b[cell.r][cell.c] = nextRand() < 0.9 ? 2 : 4;
  };

  const resetBoard = (): void => {
    board = createEmptyBoard();
    score = 0;
    isGameOver = false;
    spawnTile(board);
    spawnTile(board);
  };

  resetBoard();

  const mockPage = {
    on: () => mockPage,
    off: () => mockPage,
    bringToFront: async () => {},
    locator: () => ({ focus: async () => {} }),
    keyboard: {
      press: async (dir: string) => {
        const sim = simulateMove(board, dir as Direction);
        if (sim.moved) {
          board = sim.board;
          score += sim.scoreGained;
          spawnTile(board);
          if (getValidMoves(board).length === 0) {
            isGameOver = true;
          }
        }
      },
    },
    waitForFunction: async () => {},
    evaluate: async (_fn: unknown, arg?: Record<string, unknown>) => {
      // readBoard() passes the selectors object containing `tile`
      if (arg && typeof arg === 'object' && 'tile' in arg) {
        const tiles: Array<{ className: string; innerText: string }> = [];
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            const val = board[r][c];
            if (val > 0) {
              tiles.push({
                className: `tile tile-${val} tile-position-${c + 1}-${r + 1}`,
                innerText: String(val),
              });
            }
          }
        }
        return {
          tiles,
          scoreText: String(score),
          isGameOver,
          isGameWon: false,
        };
      }
      return undefined;
    },
  } as unknown as Page;

  return { page: mockPage, resetBoard };
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
  // 2. Zero-Sleep Synchronization Policy & Visual Pacing Configuration
  // ---------------------------------------------------------------------------
  test('2. Zero-Sleep Synchronization: zero waitForTimeout calls and zero sync sleeps', () => {
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

    // Only bot.ts may use setTimeout, and strictly for optional post-move visual pacing (config.moveDelayMs > 0)
    for (const file of srcFiles) {
      const base = path.basename(file);
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      expect(code, `Unexpected setInterval in ${base}`).not.toMatch(/\bsetInterval\s*\(/);
      if (base !== 'bot.ts') {
        expect(code, `Unexpected setTimeout in ${base}`).not.toMatch(/\bsetTimeout\s*\(/);
      } else {
        const timeoutMatches = code.match(/\bsetTimeout\s*\(/g) ?? [];
        expect(timeoutMatches.length).toBe(1);
        expect(code).toContain('if (config.moveDelayMs > 0)');
      }
    }

    // Visual pacing defaults to 100ms for headed observation
    expect(DEFAULT_CONFIG.moveDelayMs).toBe(100);
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
      expect(code, `Prohibited HTMLActuator access in ${path.basename(file)}`).not.toMatch(
        /HTMLActuator/i
      );
      expect(code, `Prohibited KeyboardInputManager access in ${path.basename(file)}`).not.toMatch(
        /KeyboardInputManager/i
      );
      expect(code, `Prohibited localStorage.getItem in ${path.basename(file)}`).not.toMatch(
        /localStorage\??\.getItem/
      );
      expect(code, `Prohibited localStorage.setItem in ${path.basename(file)}`).not.toMatch(
        /localStorage\??\.setItem/
      );
      expect(code, `Prohibited sessionStorage.getItem in ${path.basename(file)}`).not.toMatch(
        /sessionStorage\??\.getItem/
      );
      expect(code, `Prohibited sessionStorage.setItem in ${path.basename(file)}`).not.toMatch(
        /sessionStorage\??\.setItem/
      );
      expect(code, `Prohibited synthetic dispatchEvent in ${path.basename(file)}`).not.toMatch(
        /\bdispatchEvent\s*\(/
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
  test('5. Memory & Trace Safety: runner timeout 0, trace off, macro throttling, 3,000+ move stability', async () => {
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
    expect(botSpec).toMatch(/isFullPlay\s*\?\s*100\s*:/);

    // Exercise the actual runBot() loop, per-move telemetry formatting, and 100-move
    // macro milestone throttling across two 3,200+ move passes (6,400+ moves total)
    // to verify bounded steady-state heap growth without OOM or linear leaks.
    const startHeapMb = process.memoryUsage().heapUsed / (1024 * 1024);

    const runMovePass = async (seedBase: number) => {
      let passMoves = 0;
      let passMilestones = 0;
      let lastSummary: Parameters<typeof formatRunSummary>[0] | null = null;

      for (let gameIdx = 0; passMoves < 3200; gameIdx++) {
        const { page: mockPage } = createMock2048Page(seedBase + gameIdx);
        const remainingToTarget = 3200 - passMoves;
        let gameMilestones = 0;

        const result = await runBot(
          mockPage,
          {
            maxMoves: Math.max(remainingToTarget, 1000),
            strategy: 'lookahead',
            moveDelayMs: 0,
            logEveryMoves: 100,
            screenshotOnTermination: false,
          },
          {
            onMove: (event) => {
              const line = formatLiveStatusLine(event);
              expect(line.length).toBeGreaterThan(0);
            },
            onMilestone: (milestone) => {
              expect(milestone.moveCount % 100).toBe(0);
              gameMilestones++;
              passMilestones++;
            },
          }
        );

        expect(gameMilestones).toBe(Math.floor(result.totalMoves / 100));
        expect(result.moveLatencies.length).toBe(result.totalMoves);
        passMoves += result.totalMoves;
        lastSummary = {
          finalBoard: result.finalBoard,
          totalMoves: passMoves,
          finalScore: result.finalScore,
          highestTile: result.highestTile,
          durationMs: result.durationMs,
          movesPerSecond: result.movesPerSecond,
          averageLatencyMs: result.averageLatencyMs,
          moveLatencies: result.moveLatencies,
          terminationReason: result.terminationReason,
        };
      }

      return { passMoves, passMilestones, lastSummary: lastSummary! };
    };

    const pass1 = await runMovePass(1000);
    const midHeapMb = process.memoryUsage().heapUsed / (1024 * 1024);

    const pass2 = await runMovePass(5000);
    const endHeapMb = process.memoryUsage().heapUsed / (1024 * 1024);

    expect(pass1.passMoves).toBeGreaterThanOrEqual(3000);
    expect(pass2.passMoves).toBeGreaterThanOrEqual(3000);
    expect(pass1.passMilestones).toBeGreaterThan(0);
    expect(pass2.passMilestones).toBeGreaterThan(0);

    const summaryText = formatRunSummary(pass2.lastSummary);
    expect(summaryText).toContain('Termination Reason');

    const totalHeapDeltaMb = endHeapMb - startHeapMb;
    const steadyStateDeltaMb = endHeapMb - midHeapMb;
    // Steady-state heap growth between pass 1 and pass 2 must stay bounded (V8 GC reuses heap)
    expect(steadyStateDeltaMb).toBeLessThan(64);
    expect(totalHeapDeltaMb).toBeLessThan(256);
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

    // Ensure headed and headless reflect two distinct benchmark runs rather than fallback clones
    expect(data.headed.timestamp).not.toBe(data.headless.timestamp);

    expect(data.headed.mode).toBe('headed');
    expect(data.headed.totalMoves).toBeGreaterThan(0);
    expect(data.headed.movesPerSecond).toBeGreaterThan(0);
    expect(data.headed.domOverhead.iterations).toBeGreaterThan(0);
    expect(data.headed.domOverhead.overheadRatio).toBeGreaterThan(1);
    expect(data.headed.rendering.sampleCount).toBeGreaterThan(0);
    expect(data.headed.rendering.measuredFps).toBeGreaterThan(0);
    expect(data.headed.tileMilestones['128']?.reached).toBe(true);

    expect(data.headless.mode).toBe('headless');
    expect(data.headless.totalMoves).toBeGreaterThan(0);
    expect(data.headless.movesPerSecond).toBeGreaterThan(0);
    expect(data.headless.domOverhead.iterations).toBeGreaterThan(0);
    expect(data.headless.domOverhead.overheadRatio).toBeGreaterThan(1);
    expect(data.headless.rendering.sampleCount).toBeGreaterThan(0);
    expect(data.headless.rendering.measuredFps).toBeGreaterThan(0);
    expect(data.headless.tileMilestones['128']?.reached).toBe(true);
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

    // D. Guard 1 (Win) verification on live page (halt & keepPlayingOnWin)
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

    const keepPlayingResult = await runBot(page, {
      maxMoves: 2,
      strategy: 'lookahead',
      keepPlayingOnWin: true,
      moveDelayMs: 0,
    });
    expect(keepPlayingResult.totalMoves).toBe(2);
    expect(keepPlayingResult.terminationReason).toBe('MoveCapReached');

    // E. Guard 2 (Deadlocked board with zero valid moves and no .game-over class)
    await page.evaluate((sel) => {
      const msg = document.querySelector(sel.gameMessage);
      if (msg) msg.classList.remove('game-over', 'game-won');
      const container = document.querySelector(sel.tileContainer);
      if (container) {
        container.innerHTML = '';
        const matrix = [
          [2, 4, 2, 4],
          [4, 2, 4, 2],
          [2, 4, 2, 4],
          [4, 2, 4, 2],
        ];
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            const tile = document.createElement('div');
            tile.className = `tile tile-${matrix[r][c]} tile-position-${c + 1}-${r + 1}`;
            const inner = document.createElement('div');
            inner.className = 'tile-inner';
            inner.textContent = matrix[r][c].toString();
            tile.appendChild(inner);
            container.appendChild(tile);
          }
        }
      }
    }, SELECTORS);
    const deadlockedResult = await runBot(page, {
      maxMoves: 10,
      strategy: 'lookahead',
      moveDelayMs: 0,
    });
    expect(deadlockedResult.totalMoves).toBe(0);
    expect(deadlockedResult.terminationReason).toBe('Deadlocked');

    // Verify readBoard reads cleanly with terminal classes removed
    const finalParsed = await readBoard(page);
    expect(finalParsed.board.length).toBe(4);
    expect(finalParsed.isGameOver).toBe(false);
    expect(finalParsed.isGameWon).toBe(false);
  });
});
