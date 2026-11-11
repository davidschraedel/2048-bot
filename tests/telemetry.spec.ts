import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import {
  formatLiveStatusLine,
  printLiveStatus,
  clearLiveStatus,
  formatMilestoneBanner,
  formatRunSummary,
  captureFinalScreenshot,
} from '../src/telemetry';
import { BotMoveEvent, BotMilestoneEvent, BotRunResult } from '../src/bot';
import { Board } from '../src/board';
import { getBotConfig, DEFAULT_CONFIG } from '../src/config';
import { GAME_URL } from '../src/config';
import { initBotSession } from '../src/bot';

test.describe('Phase 7: Observability, Metrics & Telemetry Unit & Integration Tests', () => {
  // ---------------------------------------------------------------------------
  // 1. Live CLI Status Line Formatter
  // ---------------------------------------------------------------------------
  test.describe('formatLiveStatusLine', () => {
    test('formats live status line containing move count, direction, score, highest tile, and latency', () => {
      const dummyBoard: Board = [
        [2, 0, 0, 0],
        [0, 4, 0, 0],
        [0, 0, 8, 0],
        [0, 0, 0, 16],
      ];

      const event: BotMoveEvent = {
        moveCount: 42,
        direction: 'ArrowDown',
        score: 1420,
        highestTile: 128,
        latencyMs: 18.4,
        board: dummyBoard,
      };

      const line = formatLiveStatusLine(event);

      // Verifies all 5 required telemetry elements
      expect(line).toContain('[Move #0042]');
      expect(line).toContain('ArrowDown');
      expect(line).toContain('Score:   1,420');
      expect(line).toContain('Highest Tile:   128');
      expect(line).toContain('Latency:   18ms');
    });

    test('handles large move counts, large scores, and zero latency cleanly with alignment', () => {
      const dummyBoard: Board = Array(4).fill(Array(4).fill(0));
      const event: BotMoveEvent = {
        moveCount: 2500,
        direction: 'ArrowLeft',
        score: 32450,
        highestTile: 2048,
        latencyMs: 0.2,
        board: dummyBoard,
      };

      const line = formatLiveStatusLine(event);

      expect(line).toContain('[Move #2500]');
      expect(line).toContain('ArrowLeft');
      expect(line).toContain('Score:  32,450');
      expect(line).toContain('Highest Tile:  2048');
      expect(line).toContain('Latency:    0ms');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Stream & CLI Output Emission
  // ---------------------------------------------------------------------------
  test.describe('printLiveStatus & clearLiveStatus', () => {
    test('writes in-place carriage return to stream when inPlace is true', () => {
      let writtenData = '';
      const mockStream = {
        isTTY: true,
        write: (chunk: string) => {
          writtenData += chunk;
          return true;
        },
      } as unknown as NodeJS.WriteStream;

      const event: BotMoveEvent = {
        moveCount: 1,
        direction: 'ArrowRight',
        score: 4,
        highestTile: 4,
        latencyMs: 12,
        board: Array(4).fill(Array(4).fill(0)),
      };

      printLiveStatus(event, { inPlace: true, stream: mockStream });

      expect(writtenData.startsWith('\r[Move #0001] ArrowRight')).toBe(true);
      expect(writtenData.length).toBeGreaterThanOrEqual(80);
    });

    test('clearLiveStatus writes clearing spaces and carriage returns on TTY stream', () => {
      let writtenData = '';
      const mockStream = {
        isTTY: true,
        write: (chunk: string) => {
          writtenData += chunk;
          return true;
        },
      } as unknown as NodeJS.WriteStream;

      clearLiveStatus(mockStream);
      expect(writtenData.startsWith('\r')).toBe(true);
      expect(writtenData.endsWith('\r')).toBe(true);
      expect(writtenData.length).toBe(82); // \r + 80 spaces + \r
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Macro Milestone Banner Formatter
  // ---------------------------------------------------------------------------
  test.describe('formatMilestoneBanner', () => {
    test('formats macro milestone banner with moves, score, highest tile, speed, and average latency', () => {
      const milestone: BotMilestoneEvent = {
        moveCount: 100,
        score: 1250,
        highestTile: 128,
        movesPerSecond: 18.42,
        averageLatencyMs: 15.67,
      };

      const banner = formatMilestoneBanner(milestone);

      expect(banner).toContain('📊 Macro Milestone: Move 100');
      expect(banner).toContain('Score: 1,250');
      expect(banner).toContain('Highest Tile: 128');
      expect(banner).toContain('Speed: 18.42 MPS');
      expect(banner).toContain('Avg Latency: 15.7ms');
      expect(banner).toContain('─'.repeat(74));
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Final Run Summary Generator
  // ---------------------------------------------------------------------------
  test.describe('formatRunSummary', () => {
    const sampleBoard: Board = [
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2048, 4],
      [2, 0, 0, 0],
    ];

    test('formats comprehensive run summary with all required telemetry fields and ASCII board', () => {
      const result: BotRunResult = {
        totalMoves: 450,
        finalScore: 18450,
        highestTile: 2048,
        terminationReason: 'GameWon',
        finalBoard: sampleBoard,
        durationMs: 25400,
        movesPerSecond: 17.72,
        moveLatencies: [15, 16, 17],
        averageLatencyMs: 16.0,
      };

      const summary = formatRunSummary(result);

      // Verifies all required summary sections
      expect(summary).toContain('2048 AUTONOMOUS BOT — FINAL RUN SUMMARY');
      expect(summary).toContain('• Termination Reason : GameWon');
      expect(summary).toContain('• Final Score        : 18,450');
      expect(summary).toContain('• Highest Tile       : 2048');
      expect(summary).toContain('• Total Moves        : 450');
      expect(summary).toContain('• Wall Duration      : 25.40s (25400 ms)');
      expect(summary).toContain('• Throughput (MPS)   : 17.72 moves/sec');
      expect(summary).toContain('• Average Latency    : 16.00 ms');

      // Verifies ASCII board representation
      expect(summary).toContain('+------+------+------+------+');
      expect(summary).toContain('| 2048 |');
      expect(summary).toContain('|    . |');
    });

    test('supports all deterministic termination reasons', () => {
      const reasons: BotRunResult['terminationReason'][] = [
        'GameWon',
        'GameOver',
        'Deadlocked',
        'MoveCapReached',
      ];

      for (const reason of reasons) {
        const result: BotRunResult = {
          totalMoves: 10,
          finalScore: 100,
          highestTile: 16,
          terminationReason: reason,
          finalBoard: sampleBoard,
          durationMs: 500,
          movesPerSecond: 20,
          moveLatencies: [10],
          averageLatencyMs: 10,
        };

        const summary = formatRunSummary(result);
        expect(summary).toContain(`• Termination Reason : ${reason}`);
      }
    });

    test('supports optional omission of ASCII board', () => {
      const result: BotRunResult = {
        totalMoves: 5,
        finalScore: 20,
        highestTile: 4,
        terminationReason: 'MoveCapReached',
        finalBoard: sampleBoard,
        durationMs: 200,
        movesPerSecond: 25,
        moveLatencies: [8],
        averageLatencyMs: 8,
      };

      const summary = formatRunSummary(result, { includeAsciiBoard: false });
      expect(summary).not.toContain('+------+------+------+------+');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Screenshot Capture & Persistence Integration Test
  // ---------------------------------------------------------------------------
  test.describe('captureFinalScreenshot', () => {
    test('captures and persists screenshot to disk, creating directory if needed', async ({ page }) => {
      await initBotSession(page, GAME_URL);

      const targetPath = 'test-results/test-screenshots/unit-test-run.png';
      const resolvedPath = path.resolve(process.cwd(), targetPath);

      // Clean up previous artifact if present
      if (fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
      }

      const savedPath = await captureFinalScreenshot(page, targetPath);

      expect(savedPath).toBe(resolvedPath);
      expect(fs.existsSync(savedPath)).toBe(true);

      const stats = fs.statSync(savedPath);
      expect(stats.size).toBeGreaterThan(1000); // Valid PNG file size

      // Clean up test screenshot
      if (fs.existsSync(savedPath)) {
        fs.unlinkSync(savedPath);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Configuration Integration Tests for Telemetry Options
  // ---------------------------------------------------------------------------
  test.describe('Telemetry Configuration in src/config.ts', () => {
    test('defaults screenshotOnTermination to false and screenshotPath to test-results/final-run.png', () => {
      expect(DEFAULT_CONFIG.screenshotPath).toBe('test-results/final-run.png');
      expect(DEFAULT_CONFIG.screenshotOnTermination).toBe(false);
    });

    test('merges and validates screenshot overrides correctly', () => {
      const config = getBotConfig({
        screenshotOnTermination: true,
        screenshotPath: 'test-results/custom-run.png',
      });

      expect(config.screenshotOnTermination).toBe(true);
      expect(config.screenshotPath).toBe('test-results/custom-run.png');
    });

    test('rejects empty screenshotPath override with descriptive error', () => {
      expect(() => getBotConfig({ screenshotPath: '   ' })).toThrow(
        'screenshotPath cannot be empty'
      );
    });
  });
});
