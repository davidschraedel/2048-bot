import * as fs from 'fs';
import * as path from 'path';
import { Page } from '@playwright/test';
import { Board, renderBoardAscii } from './board';
import { BotMoveEvent, BotMilestoneEvent, BotRunResult, TerminationReason } from './bot';

/**
 * Configuration options for live CLI status line output.
 */
export interface TelemetryStreamOptions {
  /**
   * Whether to overwrite the line in-place using carriage return ('\r').
   * Defaults to true if the stream is an interactive TTY and not running in CI.
   */
  inPlace?: boolean;
  /**
   * Writable stream for output (defaults to process.stdout).
   */
  stream?: NodeJS.WriteStream;
}

/**
 * Options for configuring final run summary rendering.
 */
export interface RunSummaryOptions {
  /** Optional custom header title */
  title?: string;
  /** Whether to append the 4x4 ASCII board (default: true) */
  includeAsciiBoard?: boolean;
}

/**
 * Formats a live CLI status line for a single move execution.
 * Aligned with Phase 7 requirements:
 * Displays move count, chosen move, score, highest tile, and sync latency.
 *
 * Example:
 * [Move #0042] ArrowDown   | Score:   1,420 | Highest Tile:   128 | Latency:   18ms
 *
 * @param event - Move execution telemetry payload.
 * @returns Formatted single-line status string.
 */
export function formatLiveStatusLine(event: BotMoveEvent): string {
  const moveStr = `[Move #${event.moveCount.toString().padStart(4, '0')}]`;
  const dirStr = event.direction.padEnd(10, ' ');
  const scoreStr = `Score: ${event.score.toLocaleString().padStart(7, ' ')}`;
  const tileStr = `Highest Tile: ${event.highestTile.toString().padStart(5, ' ')}`;
  const latencyRounded = Math.round(event.latencyMs);
  const latStr = `Latency: ${latencyRounded.toString().padStart(4, ' ')}ms`;

  return `${moveStr} ${dirStr} | ${scoreStr} | ${tileStr} | ${latStr}`;
}

/**
 * Emits the live CLI status line to stdout or a designated writable stream.
 * Overwrites in-place using '\r' when run in an interactive TTY terminal,
 * or logs cleanly per line in non-interactive/piped environments.
 *
 * @param event - Move execution telemetry payload.
 * @param options - Stream and formatting options.
 */
export function printLiveStatus(
  event: BotMoveEvent,
  options?: TelemetryStreamOptions
): void {
  const stream = options?.stream ?? process.stdout;
  const inPlace = options?.inPlace ?? (Boolean(stream.isTTY) && !process.env.CI);
  const line = formatLiveStatusLine(event);

  if (inPlace) {
    // Pad with spaces to clear any previously longer line content
    stream.write(`\r${line.padEnd(80, ' ')}`);
  } else {
    console.log(line);
  }
}

/**
 * Clears the active in-place status line and restores cursor position.
 * Useful before printing a milestone banner or final summary.
 *
 * @param stream - Target writable stream (defaults to process.stdout).
 */
export function clearLiveStatus(stream: NodeJS.WriteStream = process.stdout): void {
  if (stream.isTTY && !process.env.CI) {
    stream.write('\r' + ' '.repeat(80) + '\r');
  }
}

/**
 * Formats a macro milestone banner (emitted every 100 moves or configured interval).
 *
 * @param milestone - Milestone telemetry payload.
 * @returns Formatted multi-line milestone banner string.
 */
export function formatMilestoneBanner(milestone: BotMilestoneEvent): string {
  const divider = '─'.repeat(74);
  const mpsStr = milestone.movesPerSecond.toFixed(2);
  const latStr = milestone.averageLatencyMs.toFixed(1);
  return [
    `\n${divider}`,
    `📊 Macro Milestone: Move ${milestone.moveCount} | Score: ${milestone.score.toLocaleString()} | Highest Tile: ${milestone.highestTile} | Speed: ${mpsStr} MPS | Avg Latency: ${latStr}ms`,
    `${divider}\n`,
  ].join('\n');
}

/**
 * Generates a comprehensive final run summary:
 * - Explicit termination reason (GameWon, GameOver, Deadlocked, MoveCapReached).
 * - Final score and highest tile.
 * - Total moves played and duration.
 * - Moves per second (MPS throughput).
 * - Average move roundtrip latency.
 * - Final 4x4 board state rendered in ASCII.
 *
 * @param result - Bot run result payload.
 * @param options - Summary formatting options.
 * @returns Comprehensive formatted summary string.
 */
export function formatRunSummary(
  result: BotRunResult,
  options?: RunSummaryOptions
): string {
  const title = options?.title ?? '2048 AUTONOMOUS BOT — FINAL RUN SUMMARY';
  const includeBoard = options?.includeAsciiBoard ?? true;
  const divider = '═'.repeat(74);
  const subDivider = '─'.repeat(74);

  const durationSec = (result.durationMs / 1000).toFixed(2);
  const mpsStr = result.movesPerSecond.toFixed(2);
  const avgLatStr = result.averageLatencyMs.toFixed(2);

  const lines: string[] = [
    divider,
    `🎮  ${title}`,
    divider,
    `  • Termination Reason : ${result.terminationReason}`,
    `  • Final Score        : ${result.finalScore.toLocaleString()}`,
    `  • Highest Tile       : ${result.highestTile}`,
    `  • Total Moves        : ${result.totalMoves}`,
    `  • Wall Duration      : ${durationSec}s (${result.durationMs} ms)`,
    `  • Throughput (MPS)   : ${mpsStr} moves/sec`,
    `  • Average Latency    : ${avgLatStr} ms`,
    divider,
  ];

  if (includeBoard) {
    lines.push('Final 4x4 Board Matrix:');
    lines.push(renderBoardAscii(result.finalBoard));
    lines.push(subDivider);
  }

  return lines.join('\n');
}

/**
 * Prints the comprehensive final run summary to console.
 *
 * @param result - Bot run result payload.
 * @param options - Formatting options.
 */
export function printRunSummary(
  result: BotRunResult,
  options?: RunSummaryOptions
): void {
  clearLiveStatus();
  console.log('\n' + formatRunSummary(result, options) + '\n');
}

/**
 * Captures and persists the final board screenshot to disk.
 * Defaults to 'test-results/final-run.png'.
 *
 * Ensures the target output directory exists prior to saving.
 *
 * @param page - Active Playwright Page instance.
 * @param outputPath - Output file path (defaults to 'test-results/final-run.png').
 * @returns Absolute file path of the persisted screenshot.
 */
export async function captureFinalScreenshot(
  page: Page,
  outputPath: string = 'test-results/final-run.png'
): Promise<string> {
  const resolvedPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(process.cwd(), outputPath);

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Defensively capture the full page to show title, score, game container, and message
  await page.screenshot({
    path: resolvedPath,
    fullPage: false,
  });

  return resolvedPath;
}
