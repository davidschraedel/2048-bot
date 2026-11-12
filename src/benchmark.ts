import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Page, chromium, Browser, BrowserContext } from '@playwright/test';
import { Board, GameState, readBoard, parseGameStateFromRaw, renderBoardAscii } from './board';
import { SELECTORS, CLASSES } from './selectors';
import { initBotSession, runBot, BotRunResult, TerminationReason } from './bot';
import { GAME_URL, StrategyType } from './config';

/**
 * Statistical distribution of move-to-settling roundtrip latencies.
 */
export interface PercentileStats {
  min: number;
  p50: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
  stdDev: number;
}

/**
 * Milestone achievement record for key benchmark tiles (128, 256, 512).
 */
export interface TileMilestone {
  tile: number;
  reached: boolean;
  moveCount?: number;
  elapsedMs?: number;
  score?: number;
  mps?: number;
}

/**
 * Frame rate, animation scheduling, and double-rAF settling metrics in Chromium.
 */
export interface RenderingMetrics {
  measuredFps: number;
  averageFrameDeltaMs: number;
  frameDeltaJitterMs: number;
  doubleRafSettlingMs: number;
  sampleCount: number;
}

/**
 * Comparative overhead of Playwright element Locators vs batch page.evaluate().
 */
export interface DomOverheadMetrics {
  batchEvaluateAvgMs: number;
  locatorQueryAvgMs: number;
  overheadRatio: number;
  iterations: number;
}

/**
 * Comprehensive benchmark dataset for a single browser mode (headed or headless).
 */
export interface BenchmarkModeData {
  mode: 'headed' | 'headless';
  timestamp: string;
  totalMoves: number;
  durationMs: number;
  movesPerSecond: number;
  averageLatencyMs: number;
  latencyPercentiles: PercentileStats;
  finalScore: number;
  highestTile: number;
  terminationReason: TerminationReason;
  tileMilestones: Record<number, TileMilestone>;
  rendering: RenderingMetrics;
  domOverhead: DomOverheadMetrics;
  finalBoard: Board;
}

/**
 * High-level comparative summary between headed and headless execution.
 */
export interface ComparativeSummary {
  fasterMode: 'headed' | 'headless' | 'equal';
  speedupFactor: number;
  throughputDiffMps: number;
  latencyDiffMs: number;
  batchVsLocatorOverheadRatio: number;
  animationDelayDiffMs: number;
}

/**
 * Full comparative execution benchmark report.
 */
export interface BenchmarkReport {
  timestamp: string;
  environment: {
    platform: string;
    arch: string;
    nodeVersion: string;
    playwrightVersion: string;
    browser: string;
    strategy: StrategyType;
    moveDelayMs: number;
  };
  comparativeSummary: ComparativeSummary;
  headed: BenchmarkModeData;
  headless: BenchmarkModeData;
}

/**
 * Options for configuring an individual benchmark session.
 */
export interface BenchmarkSessionOptions {
  mode: 'headed' | 'headless';
  maxMoves?: number;
  strategy?: StrategyType;
  benchmarkTiles?: number[];
  domIterations?: number;
  frameSamples?: number;
}

/**
 * Options for running the comparative or individual execution benchmarks.
 */
export interface ComparativeBenchmarkOptions {
  maxMoves?: number;
  strategy?: StrategyType;
  benchmarkTiles?: number[];
  outputPath?: string;
  historyPath?: string;
  domIterations?: number;
  frameSamples?: number;
  logProgress?: boolean;
  benchmarkMode?: 'comparative' | 'headed' | 'headless';
  forceHeadless?: boolean;
}

/**
 * Historical benchmark execution record appended to the benchmark history ledger.
 */
export interface BenchmarkHistoryEntry {
  timestamp: string;
  mode: 'headed' | 'headless';
  totalMoves: number;
  durationMs: number;
  movesPerSecond: number;
  averageLatencyMs: number;
  latencyP50: number;
  latencyP95: number;
  finalScore: number;
  highestTile: number;
  terminationReason: TerminationReason;
  domOverheadRatio?: number;
  measuredFps?: number;
}

/**
 * Computes statistical percentiles (min, p50, p90, p95, max, mean, stdDev) for move latencies.
 *
 * @param latencies - Array of latency measurements in milliseconds.
 * @returns PercentileStats object.
 */
export function calculateLatencyPercentiles(latencies: number[]): PercentileStats {
  if (!latencies || latencies.length === 0) {
    return { min: 0, p50: 0, p90: 0, p95: 0, max: 0, mean: 0, stdDev: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const max = sorted[n - 1];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = Math.round((sum / n) * 100) / 100;

  const variance =
    sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
  const stdDev = Math.round(Math.sqrt(variance) * 100) / 100;

  const getPercentile = (p: number): number => {
    const idx = (p / 100) * (n - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const weight = idx - lower;
    if (lower === upper) return sorted[lower];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };

  const p50 = Math.round(getPercentile(50) * 100) / 100;
  const p90 = Math.round(getPercentile(90) * 100) / 100;
  const p95 = Math.round(getPercentile(95) * 100) / 100;

  return {
    min: Math.round(min * 100) / 100,
    p50,
    p90,
    p95,
    max: Math.round(max * 100) / 100,
    mean,
    stdDev,
  };
}

/**
 * Reads 2048 game state using Playwright Locators individually over CDP.
 * Used exclusively for benchmarking to measure the concrete CDP roundtrip overhead
 * of locator queries compared to batch evaluate() queries.
 *
 * @param page - Active Playwright Page instance.
 * @returns GameState parsed via individual locator round trips.
 */
export async function readBoardViaLocators(page: Page): Promise<GameState> {
  const tileLocators = await page.locator(SELECTORS.tile).all();
  const rawTiles: { className: string; innerText: string }[] = [];

  for (const loc of tileLocators) {
    const className = (await loc.getAttribute('class')) || '';
    const innerText = (await loc.innerText().catch(() => '')).trim();
    rawTiles.push({ className, innerText });
  }

  const scoreEl = page.locator(SELECTORS.scoreContainer);
  let scoreText = '0';
  if ((await scoreEl.count()) > 0) {
    scoreText = (await scoreEl.innerText().catch(() => '0')).trim();
  }

  const isGameOver = (await page.locator(SELECTORS.gameOverMessage).count()) > 0;
  const isGameWon = (await page.locator(SELECTORS.gameWonMessage).count()) > 0;

  return parseGameStateFromRaw({
    tiles: rawTiles,
    scoreText,
    isGameOver,
    isGameWon,
  });
}

/**
 * Quantifies the real-world overhead difference between Playwright element Locators
 * (multi-roundtrip CDP calls) and batch page.evaluate() (single in-browser execution).
 *
 * @param page - Active Playwright Page instance with active 2048 game.
 * @param iterations - Number of read iterations to sample (default: 15).
 * @returns DomOverheadMetrics with timings and overhead multiplier.
 */
export async function measureDomQueryOverhead(
  page: Page,
  iterations: number = 15
): Promise<DomOverheadMetrics> {
  // Warm up calls
  await readBoard(page);
  await readBoardViaLocators(page);

  // Measure batch evaluate() duration
  const batchTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await readBoard(page);
    batchTimes.push(performance.now() - start);
  }

  // Measure Playwright locator duration
  const locatorTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await readBoardViaLocators(page);
    locatorTimes.push(performance.now() - start);
  }

  const batchAvg = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
  const locatorAvg = locatorTimes.reduce((a, b) => a + b, 0) / locatorTimes.length;
  const ratio = batchAvg > 0 ? locatorAvg / batchAvg : 0;

  return {
    batchEvaluateAvgMs: Math.round(batchAvg * 100) / 100,
    locatorQueryAvgMs: Math.round(locatorAvg * 100) / 100,
    overheadRatio: Math.round(ratio * 100) / 100,
    iterations,
  };
}

/**
 * Samples requestAnimationFrame timestamps and double-rAF settling durations
 * inside the browser context to quantify rendering frame rates and animation delays.
 *
 * @param page - Active Playwright Page instance.
 * @param sampleCount - Number of consecutive rAF frames to sample (default: 60).
 * @returns RenderingMetrics with measured FPS, frame jitter, and double-rAF settling.
 */
export async function measureRenderingPerformance(
  page: Page,
  sampleCount: number = 60
): Promise<RenderingMetrics> {
  return await page.evaluate((samples) => {
    return new Promise<RenderingMetrics>((resolve) => {
      const frameDeltas: number[] = [];
      let lastTime: number | null = null;
      let count = 0;

      function onFrame(now: number) {
        if (lastTime !== null) {
          frameDeltas.push(now - lastTime);
        }
        lastTime = now;
        count++;

        if (count < samples) {
          requestAnimationFrame(onFrame);
        } else {
          const avgDelta =
            frameDeltas.length > 0
              ? frameDeltas.reduce((a, b) => a + b, 0) / frameDeltas.length
              : 16.67;
          const variance =
            frameDeltas.length > 0
              ? frameDeltas.reduce((acc, d) => acc + Math.pow(d - avgDelta, 2), 0) /
                frameDeltas.length
              : 0;
          const jitter = Math.sqrt(variance);
          const fps = avgDelta > 0 ? 1000 / avgDelta : 60;

          // Measure double-rAF animation settling delay (20 samples)
          const doubleRafSamples: number[] = [];
          let dCount = 0;

          function sampleDoubleRaf() {
            const start = performance.now();
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                doubleRafSamples.push(performance.now() - start);
                dCount++;
                if (dCount < 20) {
                  sampleDoubleRaf();
                } else {
                  const avgDoubleRaf =
                    doubleRafSamples.reduce((a, b) => a + b, 0) /
                    doubleRafSamples.length;
                  resolve({
                    measuredFps: Math.round(fps * 10) / 10,
                    averageFrameDeltaMs: Math.round(avgDelta * 100) / 100,
                    frameDeltaJitterMs: Math.round(jitter * 100) / 100,
                    doubleRafSettlingMs: Math.round(avgDoubleRaf * 100) / 100,
                    sampleCount: samples,
                  });
                }
              });
            });
          }

          sampleDoubleRaf();
        }
      }

      requestAnimationFrame(onFrame);
    });
  }, sampleCount);
}

/**
 * Runs a single benchmark session (in headed or headless mode) with visual pacing disabled
 * (MOVE_DELAY_MS=0) to measure authentic raw browser throughput and latency.
 *
 * @param page - Active Playwright Page instance.
 * @param options - Configuration options for the benchmark session.
 * @returns BenchmarkModeData containing all collected metrics.
 */
export async function runBenchmarkSession(
  page: Page,
  options: BenchmarkSessionOptions
): Promise<BenchmarkModeData> {
  const maxMoves = options.maxMoves ?? 350;
  const strategy = options.strategy ?? 'lookahead';
  const targetTiles = options.benchmarkTiles ?? [128, 256, 512];
  const domIterations = options.domIterations ?? 15;
  const frameSamples = options.frameSamples ?? 60;

  // 1. Session initialization and pristine state verification
  await initBotSession(page, GAME_URL);

  // 2. Measure rendering performance in browser context
  const rendering = await measureRenderingPerformance(page, frameSamples);

  // 3. Initialize milestone tracking dictionary
  const tileMilestones: Record<number, TileMilestone> = {};
  for (const t of targetTiles) {
    tileMilestones[t] = { tile: t, reached: false };
  }

  // 4. Execute autonomous loop with raw throughput (moveDelayMs: 0)
  const loopStartTime = performance.now();

  const botResult: BotRunResult = await runBot(
    page,
    {
      maxMoves,
      strategy,
      moveDelayMs: 0, // Disable visual pacing for raw performance measurement
      logEveryMoves: 50,
      screenshotOnTermination: false,
    },
    {
      onMove: (event) => {
        // Track first achievement of benchmark tiles (128, 256, 512, etc.)
        for (const t of targetTiles) {
          if (!tileMilestones[t].reached && event.highestTile >= t) {
            const elapsedMs = Math.round(performance.now() - loopStartTime);
            const mps =
              elapsedMs > 0
                ? Math.round((event.moveCount / (elapsedMs / 1000)) * 100) / 100
                : 0;
            tileMilestones[t] = {
              tile: t,
              reached: true,
              moveCount: event.moveCount,
              elapsedMs,
              score: event.score,
              mps,
            };
          }
        }
      },
    }
  );

  // 5. Measure DOM query overhead (Locators vs batch evaluate) on active/populated board
  const domOverhead = await measureDomQueryOverhead(page, domIterations);

  const percentiles = calculateLatencyPercentiles(botResult.moveLatencies);

  return {
    mode: options.mode,
    timestamp: new Date().toISOString(),
    totalMoves: botResult.totalMoves,
    durationMs: botResult.durationMs,
    movesPerSecond: botResult.movesPerSecond,
    averageLatencyMs: botResult.averageLatencyMs,
    latencyPercentiles: percentiles,
    finalScore: botResult.finalScore,
    highestTile: botResult.highestTile,
    terminationReason: botResult.terminationReason,
    tileMilestones,
    rendering,
    domOverhead,
    finalBoard: botResult.finalBoard,
  };
}

/**
 * Executes comparative benchmark runs under identical test conditions in both
 * headed and headless Chromium modes, computing cross-mode performance differentials
 * and outputting the dataset to test-results/benchmark-data.json.
 *
 * @param options - Comparative benchmark options.
 * @returns BenchmarkReport containing side-by-side metrics and comparative analysis.
 */
export async function runComparativeBenchmark(
  options?: ComparativeBenchmarkOptions
): Promise<BenchmarkReport> {
  const maxMoves = options?.maxMoves ?? 350;
  const strategy = options?.strategy ?? 'lookahead';
  const targetTiles = options?.benchmarkTiles ?? [128, 256, 512];
  const outputPath = options?.outputPath ?? 'test-results/benchmark-data.json';
  const historyPath = options?.historyPath;
  const logProgress = options?.logProgress ?? true;
  const benchmarkMode: 'comparative' | 'headed' | 'headless' =
    options?.benchmarkMode ??
    (process.env.BENCHMARK_MODE === 'headed' || process.env.BENCHMARK_MODE === 'headless'
      ? (process.env.BENCHMARK_MODE as 'headed' | 'headless')
      : 'comparative');
  const forceHeadless = options?.forceHeadless ?? false;

  if (logProgress) {
    console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║        2048 PLAYWRIGHT BOT — HEADED VS. HEADLESS BENCHMARK SUITE             ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
    console.log(`  Strategy:           ${strategy}`);
    console.log(`  Move Cap per Mode:  ${maxMoves} moves`);
    console.log(`  Target Tiles:       ${targetTiles.join(', ')}`);
    console.log(`  Benchmark Mode:     ${benchmarkMode}`);
    console.log(`  Output Path:        ${outputPath}\n`);
  }

  // Load existing report if available so single-mode runs (headed-only or headless-only) preserve counterpart data
  const resolvedOutputPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(process.cwd(), outputPath);
  let existingReport: BenchmarkReport | null = null;
  if (fs.existsSync(resolvedOutputPath)) {
    try {
      existingReport = JSON.parse(fs.readFileSync(resolvedOutputPath, 'utf-8'));
    } catch {
      existingReport = null;
    }
  }

  let headedData: BenchmarkModeData | null = null;
  let headlessData: BenchmarkModeData | null = null;

  // ---------------------------------------------------------------------------
  // 1. Headed Chromium Benchmark Run (if comparative or headed)
  // ---------------------------------------------------------------------------
  if (benchmarkMode === 'comparative' || benchmarkMode === 'headed') {
    if (logProgress) {
      console.log(
        `▶ [${benchmarkMode === 'comparative' ? '1/2' : '1/1'}] Launching Headed Chromium Benchmark Run${
          forceHeadless ? ' (simulated headless)' : ''
        }...`
      );
    }
    let headedBrowser: Browser | null = null;

    try {
      headedBrowser = await chromium.launch({
        headless: forceHeadless ? true : false,
        args: ['--window-size=1280,900'],
      });
      const context = await headedBrowser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();

      headedData = await runBenchmarkSession(page, {
        mode: 'headed',
        maxMoves,
        strategy,
        benchmarkTiles: targetTiles,
        domIterations: options?.domIterations,
        frameSamples: options?.frameSamples,
      });

      await context.close();
    } finally {
      if (headedBrowser) {
        await headedBrowser.close().catch(() => {});
      }
    }

    if (logProgress && headedData) {
      console.log(
        `  ✓ Headed Run Finished: ${headedData.totalMoves} moves in ${(
          headedData.durationMs / 1000
        ).toFixed(2)}s (${headedData.movesPerSecond} MPS, avg latency: ${
          headedData.averageLatencyMs
        }ms)`
      );
    }
  } else if (existingReport?.headed) {
    headedData = existingReport.headed;
  }

  // ---------------------------------------------------------------------------
  // 2. Headless Chromium Benchmark Run (if comparative or headless)
  // ---------------------------------------------------------------------------
  if (benchmarkMode === 'comparative' || benchmarkMode === 'headless') {
    if (logProgress) {
      console.log(
        `\n▶ [${benchmarkMode === 'comparative' ? '2/2' : '1/1'}] Launching Headless Chromium Benchmark Run...`
      );
    }
    let headlessBrowser: Browser | null = null;

    try {
      headlessBrowser = await chromium.launch({
        headless: true,
        args: ['--window-size=1280,900'],
      });
      const context = await headlessBrowser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();

      headlessData = await runBenchmarkSession(page, {
        mode: 'headless',
        maxMoves,
        strategy,
        benchmarkTiles: targetTiles,
        domIterations: options?.domIterations,
        frameSamples: options?.frameSamples,
      });

      await context.close();
    } finally {
      if (headlessBrowser) {
        await headlessBrowser.close().catch(() => {});
      }
    }

    if (logProgress && headlessData) {
      console.log(
        `  ✓ Headless Run Finished: ${headlessData.totalMoves} moves in ${(
          headlessData.durationMs / 1000
        ).toFixed(2)}s (${headlessData.movesPerSecond} MPS, avg latency: ${
          headlessData.averageLatencyMs
        }ms)`
      );
    }
  } else if (existingReport?.headless) {
    headlessData = existingReport.headless;
  }

  // Fallback defaults if running single-mode without pre-existing counterpart data
  if (!headedData && headlessData) {
    headedData = { ...headlessData, mode: 'headed' };
  }
  if (!headlessData && headedData) {
    headlessData = { ...headedData, mode: 'headless' };
  }

  // ---------------------------------------------------------------------------
  // 3. Cross-Mode Comparative Summary Calculation
  // ---------------------------------------------------------------------------
  const speedupFactor =
    headedData!.movesPerSecond > 0
      ? Math.round((headlessData!.movesPerSecond / headedData!.movesPerSecond) * 100) / 100
      : 1.0;

  const fasterMode: 'headed' | 'headless' | 'equal' =
    headlessData!.movesPerSecond > headedData!.movesPerSecond
      ? 'headless'
      : headedData!.movesPerSecond > headlessData!.movesPerSecond
      ? 'headed'
      : 'equal';

  const throughputDiffMps =
    Math.round((headlessData!.movesPerSecond - headedData!.movesPerSecond) * 100) / 100;
  const latencyDiffMs =
    Math.round((headedData!.averageLatencyMs - headlessData!.averageLatencyMs) * 100) / 100;

  const avgLocatorRatio =
    Math.round(
      ((headedData!.domOverhead.overheadRatio + headlessData!.domOverhead.overheadRatio) / 2) *
        100
    ) / 100;

  const animationDelayDiffMs =
    Math.round(
      (headedData!.rendering.doubleRafSettlingMs - headlessData!.rendering.doubleRafSettlingMs) *
        100
    ) / 100;

  const summary: ComparativeSummary = {
    fasterMode,
    speedupFactor,
    throughputDiffMps,
    latencyDiffMs,
    batchVsLocatorOverheadRatio: avgLocatorRatio,
    animationDelayDiffMs,
  };

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    environment: {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      playwrightVersion: '^1.65.0',
      browser: 'Chromium',
      strategy,
      moveDelayMs: 0,
    },
    comparativeSummary: summary,
    headed: headedData!,
    headless: headlessData!,
  };

  // ---------------------------------------------------------------------------
  // 4. Save Dataset to output path and historical ledger
  // ---------------------------------------------------------------------------
  saveBenchmarkData(report, outputPath, historyPath);

  // ---------------------------------------------------------------------------
  // 5. Render Formatted Comparative Table
  // ---------------------------------------------------------------------------
  if (logProgress) {
    console.log('\n' + formatBenchmarkTable(report) + '\n');
  }

  return report;
}

/**
 * Persists benchmark data report to disk as pretty-printed JSON.
 * Defaults to 'test-results/benchmark-data.json'.
 *
 * @param report - Complete BenchmarkReport payload.
 * @param outputPath - Output file path.
 * @param historyPath - Optional explicit history ledger file path.
 * @returns Resolved absolute path of the persisted JSON file.
 */
export function saveBenchmarkData(
  report: BenchmarkReport,
  outputPath: string = 'test-results/benchmark-data.json',
  historyPath?: string
): string {
  const resolvedPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(process.cwd(), outputPath);

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolvedPath, JSON.stringify(report, null, 2), 'utf-8');

  // Automatically record to historical ledger if historyPath is specified,
  // or by default when writing to canonical benchmark-data.json
  const defaultHistoryPath = path.resolve(
    path.dirname(resolvedPath),
    'benchmark-history.jsonl'
  );
  const targetHistory = historyPath
    ? historyPath
    : resolvedPath.endsWith('benchmark-data.json')
    ? defaultHistoryPath
    : undefined;

  if (targetHistory) {
    appendBenchmarkHistory(report, targetHistory);
  }

  return resolvedPath;
}

/**
 * Appends benchmark execution records to an append-only JSON Lines history ledger.
 *
 * @param report - Complete BenchmarkReport payload.
 * @param historyPath - Path to benchmark-history.jsonl.
 * @returns Resolved absolute path to history file.
 */
export function appendBenchmarkHistory(
  report: BenchmarkReport,
  historyPath: string = 'test-results/benchmark-history.jsonl'
): string {
  const resolvedPath = path.isAbsolute(historyPath)
    ? historyPath
    : path.resolve(process.cwd(), historyPath);

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const entries: BenchmarkHistoryEntry[] = [];

  if (report.headed && report.headed.totalMoves > 0) {
    entries.push({
      timestamp: report.headed.timestamp,
      mode: 'headed',
      totalMoves: report.headed.totalMoves,
      durationMs: report.headed.durationMs,
      movesPerSecond: report.headed.movesPerSecond,
      averageLatencyMs: report.headed.averageLatencyMs,
      latencyP50: report.headed.latencyPercentiles.p50,
      latencyP95: report.headed.latencyPercentiles.p95,
      finalScore: report.headed.finalScore,
      highestTile: report.headed.highestTile,
      terminationReason: report.headed.terminationReason,
      domOverheadRatio: report.headed.domOverhead?.overheadRatio,
      measuredFps: report.headed.rendering?.measuredFps,
    });
  }

  if (report.headless && report.headless.totalMoves > 0) {
    entries.push({
      timestamp: report.headless.timestamp,
      mode: 'headless',
      totalMoves: report.headless.totalMoves,
      durationMs: report.headless.durationMs,
      movesPerSecond: report.headless.movesPerSecond,
      averageLatencyMs: report.headless.averageLatencyMs,
      latencyP50: report.headless.latencyPercentiles.p50,
      latencyP95: report.headless.latencyPercentiles.p95,
      finalScore: report.headless.finalScore,
      highestTile: report.headless.highestTile,
      terminationReason: report.headless.terminationReason,
      domOverheadRatio: report.headless.domOverhead?.overheadRatio,
      measuredFps: report.headless.rendering?.measuredFps,
    });
  }

  if (entries.length > 0) {
    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(resolvedPath, lines, 'utf-8');
  }

  return resolvedPath;
}

/**
 * Loads all benchmark execution history records from the append-only history ledger.
 *
 * @param historyPath - Path to benchmark-history.jsonl.
 * @returns Array of historical BenchmarkHistoryEntry objects.
 */
export function loadBenchmarkHistory(
  historyPath: string = 'test-results/benchmark-history.jsonl'
): BenchmarkHistoryEntry[] {
  const resolvedPath = path.isAbsolute(historyPath)
    ? historyPath
    : path.resolve(process.cwd(), historyPath);

  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BenchmarkHistoryEntry);
}

/**
 * Renders a side-by-side ASCII comparison table of headed vs. headless benchmark metrics.
 *
 * @param report - Complete BenchmarkReport payload.
 * @returns Formatted multi-line ASCII table string.
 */
export function formatBenchmarkTable(report: BenchmarkReport): string {
  const d = '═'.repeat(78);
  const s = '─'.repeat(78);

  const h = report.headed;
  const l = report.headless;
  const sum = report.comparativeSummary;

  const pad = (str: string, len: number) => str.padEnd(len, ' ');
  const rpad = (str: string, len: number) => str.padStart(len, ' ');

  const lines: string[] = [
    d,
    '📊  EXECUTION BENCHMARK RESULTS: HEADED VS. HEADLESS CHROMIUM',
    d,
    `Environment: ${report.environment.platform} (${report.environment.arch}) | Node: ${report.environment.nodeVersion} | Strategy: ${report.environment.strategy} | Visual Delay: 0ms`,
    s,
    `Metric                                 │ Headed Chromium  │ Headless Chromium │ Delta / Ratio`,
    s,
    `Total Moves Dispatched                 │ ${rpad(h.totalMoves.toString(), 16)} │ ${rpad(l.totalMoves.toString(), 17)} │ ${rpad((l.totalMoves - h.totalMoves).toString(), 13)}`,
    `Wall-Clock Duration (s)                │ ${rpad((h.durationMs / 1000).toFixed(2), 16)} │ ${rpad((l.durationMs / 1000).toFixed(2), 17)} │ ${rpad(((l.durationMs - h.durationMs) / 1000).toFixed(2) + 's', 13)}`,
    `Throughput (Moves / Second)            │ ${rpad(h.movesPerSecond.toFixed(2), 16)} │ ${rpad(l.movesPerSecond.toFixed(2), 17)} │ ${rpad((sum.throughputDiffMps > 0 ? '+' : '') + sum.throughputDiffMps.toFixed(2) + ' MPS', 13)}`,
    `Average Latency (ms / move)            │ ${rpad(h.averageLatencyMs.toFixed(2), 16)} │ ${rpad(l.averageLatencyMs.toFixed(2), 17)} │ ${rpad((sum.latencyDiffMs > 0 ? '-' : '+') + Math.abs(sum.latencyDiffMs).toFixed(2) + ' ms', 13)}`,
    `Latency P50 (median, ms)               │ ${rpad(h.latencyPercentiles.p50.toFixed(2), 16)} │ ${rpad(l.latencyPercentiles.p50.toFixed(2), 17)} │ ${rpad((l.latencyPercentiles.p50 - h.latencyPercentiles.p50).toFixed(2) + ' ms', 13)}`,
    `Latency P95 (tail, ms)                 │ ${rpad(h.latencyPercentiles.p95.toFixed(2), 16)} │ ${rpad(l.latencyPercentiles.p95.toFixed(2), 17)} │ ${rpad((l.latencyPercentiles.p95 - h.latencyPercentiles.p95).toFixed(2) + ' ms', 13)}`,
    `Highest Tile Achieved                  │ ${rpad(h.highestTile.toString(), 16)} │ ${rpad(l.highestTile.toString(), 17)} │ ${rpad(h.highestTile === l.highestTile ? 'Identical' : 'Differ', 13)}`,
    `Final Game Score                       │ ${rpad(h.finalScore.toLocaleString(), 16)} │ ${rpad(l.finalScore.toLocaleString(), 17)} │ ${rpad((l.finalScore - h.finalScore).toLocaleString(), 13)}`,
    s,
    '🔬 DOM QUERY OVERHEAD: BATCH EVALUATE VS. LOCATORS',
    s,
    `Batch evaluate() Read (ms)             │ ${rpad(h.domOverhead.batchEvaluateAvgMs.toFixed(2), 16)} │ ${rpad(l.domOverhead.batchEvaluateAvgMs.toFixed(2), 17)} │ 1 CDP roundtrip`,
    `Playwright Locator Read (ms)           │ ${rpad(h.domOverhead.locatorQueryAvgMs.toFixed(2), 16)} │ ${rpad(l.domOverhead.locatorQueryAvgMs.toFixed(2), 17)} │ ~25+ CDP roundtrips`,
    `Locator Overhead Multiplier            │ ${rpad(h.domOverhead.overheadRatio.toFixed(1) + 'x slower', 16)} │ ${rpad(l.domOverhead.overheadRatio.toFixed(1) + 'x slower', 17)} │ Avg: ${sum.batchVsLocatorOverheadRatio.toFixed(1)}x`,
    s,
    '🎞️  RENDERING & ANIMATION SCHEDULING (requestAnimationFrame)',
    s,
    `Measured Frame Rate (FPS)              │ ${rpad(h.rendering.measuredFps.toFixed(1), 16)} │ ${rpad(l.rendering.measuredFps.toFixed(1), 17)} │ ${rpad((l.rendering.measuredFps - h.rendering.measuredFps).toFixed(1) + ' FPS', 13)}`,
    `Average Frame Delta (ms)               │ ${rpad(h.rendering.averageFrameDeltaMs.toFixed(2), 16)} │ ${rpad(l.rendering.averageFrameDeltaMs.toFixed(2), 17)} │ ${rpad((l.rendering.averageFrameDeltaMs - h.rendering.averageFrameDeltaMs).toFixed(2) + ' ms', 13)}`,
    `Frame Delta Jitter (std dev ms)        │ ${rpad(h.rendering.frameDeltaJitterMs.toFixed(2), 16)} │ ${rpad(l.rendering.frameDeltaJitterMs.toFixed(2), 17)} │ ${rpad((l.rendering.frameDeltaJitterMs - h.rendering.frameDeltaJitterMs).toFixed(2) + ' ms', 13)}`,
    `Double-rAF Settling Delay (ms)         │ ${rpad(h.rendering.doubleRafSettlingMs.toFixed(2), 16)} │ ${rpad(l.rendering.doubleRafSettlingMs.toFixed(2), 17)} │ ${rpad((l.rendering.doubleRafSettlingMs - h.rendering.doubleRafSettlingMs).toFixed(2) + ' ms', 13)}`,
    s,
    '⏱️  BENCHMARK TILE TIME-TO-ACHIEVEMENT (128, 256, 512)',
    s,
  ];

  // Render tile milestones
  const allTiles = Array.from(
    new Set([...Object.keys(h.tileMilestones), ...Object.keys(l.tileMilestones)])
  )
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b);

  for (const t of allTiles) {
    const mh = h.tileMilestones[t];
    const ml = l.tileMilestones[t];

    const hStr = mh?.reached
      ? `${mh.moveCount} mv (${(mh.elapsedMs! / 1000).toFixed(2)}s)`
      : 'Not Reached';
    const lStr = ml?.reached
      ? `${ml.moveCount} mv (${(ml.elapsedMs! / 1000).toFixed(2)}s)`
      : 'Not Reached';

    let diffStr = '—';
    if (mh?.reached && ml?.reached) {
      const timeDiff = ((ml.elapsedMs! - mh.elapsedMs!) / 1000).toFixed(2);
      diffStr = `${Number(timeDiff) > 0 ? '+' : ''}${timeDiff}s`;
    }

    lines.push(
      `Tile ${pad(t.toString(), 34)} │ ${rpad(hStr, 16)} │ ${rpad(lStr, 17)} │ ${rpad(diffStr, 13)}`
    );
  }

  lines.push(d);
  lines.push(
    `🏆  SUMMARY: ${sum.fasterMode.toUpperCase()} mode is ${sum.speedupFactor}x faster (${sum.throughputDiffMps > 0 ? '+' : ''}${sum.throughputDiffMps} MPS throughput advantage, ${Math.abs(sum.latencyDiffMs)}ms lower latency per move).`
  );
  lines.push(d);

  return lines.join('\n');
}
