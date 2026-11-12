import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import {
  calculateLatencyPercentiles,
  readBoardViaLocators,
  measureDomQueryOverhead,
  measureRenderingPerformance,
  runBenchmarkSession,
  runComparativeBenchmark,
  formatBenchmarkTable,
  saveBenchmarkData,
  appendBenchmarkHistory,
  loadBenchmarkHistory,
  BenchmarkReport,
} from '../src/benchmark';
import { readBoard } from '../src/board';
import { initBotSession } from '../src/bot';
import { GAME_URL } from '../src/config';

test.describe('Phase 8: Execution Benchmarking (Headed vs. Headless)', () => {
  // Disable timeout for benchmark tests
  test.setTimeout(0);

  // ---------------------------------------------------------------------------
  // 1. Unit Tests: Latency Percentile Statistics & Table Formatting
  // ---------------------------------------------------------------------------
  test.describe('Statistical & Formatting Utilities', () => {
    test('calculateLatencyPercentiles accurately computes statistical percentiles', () => {
      // Empty input safe handling
      const emptyStats = calculateLatencyPercentiles([]);
      expect(emptyStats).toEqual({
        min: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        max: 0,
        mean: 0,
        stdDev: 0,
      });

      // Single element
      const single = calculateLatencyPercentiles([42]);
      expect(single.min).toBe(42);
      expect(single.max).toBe(42);
      expect(single.mean).toBe(42);
      expect(single.p50).toBe(42);
      expect(single.stdDev).toBe(0);

      // Known distribution: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const stats = calculateLatencyPercentiles(values);

      expect(stats.min).toBe(10);
      expect(stats.max).toBe(100);
      expect(stats.mean).toBe(55);
      expect(stats.p50).toBe(55);
      expect(stats.p90).toBe(91);
      expect(stats.p95).toBe(95.5);
      expect(stats.stdDev).toBeGreaterThan(0);
    });

    test('formatBenchmarkTable renders comprehensive ASCII comparison table', () => {
      const mockReport: BenchmarkReport = {
        timestamp: '2026-11-11T00:00:00.000Z',
        environment: {
          platform: 'darwin',
          arch: 'arm64',
          nodeVersion: 'v20.0.0',
          playwrightVersion: '^1.65.0',
          browser: 'Chromium',
          strategy: 'lookahead',
          moveDelayMs: 0,
        },
        comparativeSummary: {
          fasterMode: 'headless',
          speedupFactor: 1.25,
          throughputDiffMps: 10.5,
          latencyDiffMs: 3.2,
          batchVsLocatorOverheadRatio: 18.5,
          animationDelayDiffMs: 4.8,
        },
        headed: {
          mode: 'headed',
          timestamp: '2026-11-11T00:00:00.000Z',
          totalMoves: 300,
          durationMs: 7000,
          movesPerSecond: 42.86,
          averageLatencyMs: 19.4,
          latencyPercentiles: { min: 14, p50: 19, p90: 25, p95: 28, max: 45, mean: 19.4, stdDev: 3.2 },
          finalScore: 3500,
          highestTile: 256,
          terminationReason: 'GameOver',
          tileMilestones: {
            128: { tile: 128, reached: true, moveCount: 80, elapsedMs: 1800, score: 950, mps: 44.4 },
            256: { tile: 256, reached: true, moveCount: 160, elapsedMs: 3700, score: 2100, mps: 43.2 },
            512: { tile: 512, reached: false },
          },
          rendering: { measuredFps: 60, averageFrameDeltaMs: 16.67, frameDeltaJitterMs: 1.1, doubleRafSettlingMs: 33.3, sampleCount: 60 },
          domOverhead: { batchEvaluateAvgMs: 1.5, locatorQueryAvgMs: 27.5, overheadRatio: 18.33, iterations: 15 },
          finalBoard: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        },
        headless: {
          mode: 'headless',
          timestamp: '2026-11-11T00:00:00.000Z',
          totalMoves: 300,
          durationMs: 5600,
          movesPerSecond: 53.57,
          averageLatencyMs: 16.2,
          latencyPercentiles: { min: 11, p50: 15.8, p90: 21, p95: 24, max: 38, mean: 16.2, stdDev: 2.8 },
          finalScore: 3600,
          highestTile: 256,
          terminationReason: 'GameOver',
          tileMilestones: {
            128: { tile: 128, reached: true, moveCount: 78, elapsedMs: 1450, score: 940, mps: 53.8 },
            256: { tile: 256, reached: true, moveCount: 155, elapsedMs: 2900, score: 2050, mps: 53.4 },
            512: { tile: 512, reached: false },
          },
          rendering: { measuredFps: 60, averageFrameDeltaMs: 16.67, frameDeltaJitterMs: 1.8, doubleRafSettlingMs: 28.5, sampleCount: 60 },
          domOverhead: { batchEvaluateAvgMs: 1.2, locatorQueryAvgMs: 22.4, overheadRatio: 18.67, iterations: 15 },
          finalBoard: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        },
      };

      const table = formatBenchmarkTable(mockReport);
      expect(table).toContain('EXECUTION BENCHMARK RESULTS: HEADED VS. HEADLESS CHROMIUM');
      expect(table).toContain('Throughput (Moves / Second)');
      expect(table).toContain('Average Latency (ms / move)');
      expect(table).toContain('DOM QUERY OVERHEAD: BATCH EVALUATE VS. LOCATORS');
      expect(table).toContain('RENDERING & ANIMATION SCHEDULING (requestAnimationFrame)');
      expect(table).toContain('BENCHMARK TILE TIME-TO-ACHIEVEMENT (128, 256, 512)');
      expect(table).toContain('SUMMARY: HEADLESS mode is 1.25x faster');
    });

    test('saveBenchmarkData writes valid JSON dataset to disk', () => {
      const testPath = 'test-results/test-benchmark-sample.json';
      const mockReport: BenchmarkReport = {
        timestamp: new Date().toISOString(),
        environment: {
          platform: 'darwin',
          arch: 'arm64',
          nodeVersion: process.version,
          playwrightVersion: '^1.65.0',
          browser: 'Chromium',
          strategy: 'lookahead',
          moveDelayMs: 0,
        },
        comparativeSummary: {
          fasterMode: 'headless',
          speedupFactor: 1.2,
          throughputDiffMps: 8.0,
          latencyDiffMs: 2.5,
          batchVsLocatorOverheadRatio: 15.0,
          animationDelayDiffMs: 3.0,
        },
        headed: {} as any,
        headless: {} as any,
      };

      const resolved = saveBenchmarkData(mockReport, testPath);
      expect(fs.existsSync(resolved)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      expect(parsed.comparativeSummary.fasterMode).toBe('headless');

      // Cleanup scratch file
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    });

    test('appendBenchmarkHistory and loadBenchmarkHistory write and read ledger correctly', () => {
      const historyFile = 'test-results/test-benchmark-history.jsonl';
      const mockReport: BenchmarkReport = {
        timestamp: new Date().toISOString(),
        environment: {
          platform: 'darwin',
          arch: 'arm64',
          nodeVersion: process.version,
          playwrightVersion: '^1.65.0',
          browser: 'Chromium',
          strategy: 'lookahead',
          moveDelayMs: 0,
        },
        comparativeSummary: {
          fasterMode: 'headless',
          speedupFactor: 1.2,
          throughputDiffMps: 8.0,
          latencyDiffMs: 2.5,
          batchVsLocatorOverheadRatio: 15.0,
          animationDelayDiffMs: 3.0,
        },
        headed: {
          mode: 'headed',
          timestamp: '2026-11-12T00:00:00.000Z',
          totalMoves: 100,
          durationMs: 5000,
          movesPerSecond: 20,
          averageLatencyMs: 45,
          latencyPercentiles: { min: 30, p50: 44, p90: 55, p95: 60, max: 70, mean: 45, stdDev: 5 },
          finalScore: 1200,
          highestTile: 128,
          terminationReason: 'MoveCapReached',
          tileMilestones: {},
          rendering: { measuredFps: 60, averageFrameDeltaMs: 16.67, frameDeltaJitterMs: 0.5, doubleRafSettlingMs: 33.3, sampleCount: 20 },
          domOverhead: { batchEvaluateAvgMs: 1.0, locatorQueryAvgMs: 10.0, overheadRatio: 10.0, iterations: 5 },
          finalBoard: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        },
        headless: {
          mode: 'headless',
          timestamp: '2026-11-12T00:00:00.000Z',
          totalMoves: 100,
          durationMs: 4000,
          movesPerSecond: 25,
          averageLatencyMs: 38,
          latencyPercentiles: { min: 25, p50: 36, p90: 48, p95: 52, max: 65, mean: 38, stdDev: 4 },
          finalScore: 1300,
          highestTile: 128,
          terminationReason: 'MoveCapReached',
          tileMilestones: {},
          rendering: { measuredFps: 60, averageFrameDeltaMs: 16.67, frameDeltaJitterMs: 0.1, doubleRafSettlingMs: 33.2, sampleCount: 20 },
          domOverhead: { batchEvaluateAvgMs: 0.9, locatorQueryAvgMs: 8.0, overheadRatio: 8.89, iterations: 5 },
          finalBoard: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        },
      };

      appendBenchmarkHistory(mockReport, historyFile);
      const history = loadBenchmarkHistory(historyFile);
      expect(history.length).toBe(2);
      expect(history[0].mode).toBe('headed');
      expect(history[0].totalMoves).toBe(100);
      expect(history[1].mode).toBe('headless');
      expect(history[1].totalMoves).toBe(100);

      // Cleanup
      const resolved = path.resolve(process.cwd(), historyFile);
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Integration Tests: In-Browser Measurements
  // ---------------------------------------------------------------------------
  test.describe('In-Browser Performance Metrics', () => {
    test('readBoardViaLocators extracts pristine board state consistent with readBoard', async ({
      page,
    }) => {
      await initBotSession(page, GAME_URL);

      const batchState = await readBoard(page);
      const locatorState = await readBoardViaLocators(page);

      expect(locatorState.score).toBe(batchState.score);
      expect(locatorState.isGameOver).toBe(batchState.isGameOver);
      expect(locatorState.isGameWon).toBe(batchState.isGameWon);
      expect(locatorState.highestTile).toBe(batchState.highestTile);

      // Verify identical non-zero tile positions
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          expect(locatorState.board[r][c]).toBe(batchState.board[r][c]);
        }
      }
    });

    test('measureDomQueryOverhead confirms batch evaluate is significantly faster than locators', async ({
      page,
    }) => {
      await initBotSession(page, GAME_URL);

      const metrics = await measureDomQueryOverhead(page, 10);

      expect(metrics.iterations).toBe(10);
      expect(metrics.batchEvaluateAvgMs).toBeGreaterThan(0);
      expect(metrics.locatorQueryAvgMs).toBeGreaterThan(0);
      // Locators cross CDP multiple times per tile and must be substantially slower than batch evaluate
      expect(metrics.locatorQueryAvgMs).toBeGreaterThan(metrics.batchEvaluateAvgMs);
      expect(metrics.overheadRatio).toBeGreaterThan(1.5);

      console.log(`\n  [DOM Query Benchmark] Batch evaluate(): ${metrics.batchEvaluateAvgMs}ms | Locators: ${metrics.locatorQueryAvgMs}ms | Overhead Ratio: ${metrics.overheadRatio}x slower`);
    });

    test('measureRenderingPerformance accurately captures browser FPS and double-rAF delay', async ({
      page,
    }) => {
      await initBotSession(page, GAME_URL);

      const metrics = await measureRenderingPerformance(page, 30);

      expect(metrics.sampleCount).toBe(30);
      expect(metrics.measuredFps).toBeGreaterThan(15);
      expect(metrics.averageFrameDeltaMs).toBeGreaterThan(0);
      expect(metrics.doubleRafSettlingMs).toBeGreaterThan(0);

      console.log(`\n  [Rendering Benchmark] FPS: ${metrics.measuredFps} | Frame Delta: ${metrics.averageFrameDeltaMs}ms | double-rAF Settling: ${metrics.doubleRafSettlingMs}ms`);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Complete Comparative Benchmark Execution & Dataset Output
  // ---------------------------------------------------------------------------
  test.describe('Comparative Execution Benchmark', () => {
    test('Executes Headed vs Headless Benchmark and writes benchmark data', async () => {
      const isFull = process.env.FULL_BENCHMARK === 'true';
      // In full benchmark mode, run up to 400 moves to reach benchmark tiles (128, 256, 512).
      // In test suite mode, run calibrated 20 moves to verify full end-to-end benchmarking in seconds.
      const moveCap = isFull ? 400 : 20;
      const targetPath = isFull
        ? 'test-results/benchmark-data.json'
        : 'test-results/benchmark-test.json';

      const report = await runComparativeBenchmark({
        maxMoves: moveCap,
        strategy: 'lookahead',
        benchmarkTiles: [128, 256, 512],
        outputPath: targetPath,
        domIterations: isFull ? 15 : 5,
        frameSamples: isFull ? 60 : 10,
        logProgress: isFull,
        forceHeadless: !isFull, // Run silently headless during fast test suite runs
      });

      // Verify Comparative Dataset Integrity
      expect(report).toBeDefined();
      expect(['headed', 'headless', 'equal']).toContain(report.comparativeSummary.fasterMode);
      expect(report.comparativeSummary.speedupFactor).toBeGreaterThan(0);
      expect(report.comparativeSummary.batchVsLocatorOverheadRatio).toBeGreaterThan(1.0);

      // Verify Headed Data
      expect(report.headed.mode).toBe('headed');
      expect(report.headed.totalMoves).toBeGreaterThan(0);
      expect(report.headed.movesPerSecond).toBeGreaterThan(0);
      expect(report.headed.averageLatencyMs).toBeGreaterThan(0);
      expect(report.headed.latencyPercentiles.p50).toBeGreaterThan(0);
      expect(report.headed.domOverhead.overheadRatio).toBeGreaterThan(1.0);
      expect(report.headed.rendering.measuredFps).toBeGreaterThan(0);

      // Verify Headless Data
      expect(report.headless.mode).toBe('headless');
      expect(report.headless.totalMoves).toBeGreaterThan(0);
      expect(report.headless.movesPerSecond).toBeGreaterThan(0);
      expect(report.headless.averageLatencyMs).toBeGreaterThan(0);
      expect(report.headless.latencyPercentiles.p50).toBeGreaterThan(0);
      expect(report.headless.domOverhead.overheadRatio).toBeGreaterThan(1.0);
      expect(report.headless.rendering.measuredFps).toBeGreaterThan(0);

      // Verify Target Benchmark Data File Exists and is Valid
      const filePath = path.resolve(process.cwd(), targetPath);
      expect(fs.existsSync(filePath)).toBe(true);
      const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(fileContent.headed.totalMoves).toBe(report.headed.totalMoves);
      expect(fileContent.headless.totalMoves).toBe(report.headless.totalMoves);
      expect(fileContent.comparativeSummary.fasterMode).toBe(report.comparativeSummary.fasterMode);

      // Clean up temporary test file in fast test mode
      if (!isFull && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  });
});
