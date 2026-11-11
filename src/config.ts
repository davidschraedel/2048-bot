import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env in the repository root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Validates and retrieves the GAME_URL from environment variables.
 * Fast-fails immediately if GAME_URL is missing, empty, or malformed.
 */
export function getGameUrl(): string {
  const url = process.env.GAME_URL;
  if (!url || url.trim() === '') {
    throw new Error(
      'Configuration Error: GAME_URL is missing or empty. Please define GAME_URL in your .env file or environment variables.'
    );
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `Configuration Error: GAME_URL "${url}" has invalid protocol "${parsed.protocol}". Must use http: or https:.`
      );
    }
    return parsed.href;
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(
        `Configuration Error: GAME_URL "${url}" is not a valid URL. Error: ${err.message}`
      );
    }
    throw err;
  }
}

export const GAME_URL = getGameUrl();

/** Supported decision strategies */
export type StrategyType = 'corner' | 'lookahead';

/**
 * Complete configuration schema for the 2048 autonomous bot.
 */
export interface BotConfig {
  /** Target web application URL */
  gameUrl: string;
  /** Hard cap on total moves executed per session (Triple Safety Guard 3) */
  maxMoves: number;
  /** Timeout in ms for standard Playwright actions */
  actionTimeoutMs: number;
  /** Timeout in ms for DOM state mutation and settling */
  settleTimeoutMs: number;
  /** Active decision strategy ('corner' or 'lookahead') */
  strategy: StrategyType;
  /** Whether to continue playing after reaching 2048 win state */
  keepPlayingOnWin: boolean;
  /** Step reporting cadence for macro milestones */
  logEveryMoves: number;
  /** Pacing delay in milliseconds between moves for human visual observation */
  moveDelayMs: number;
}

/** Parses and validates integer move cap from environment */
export function parseMaxMoves(value?: string): number {
  if (!value || value.trim() === '') return 3000;
  const parsed = parseInt(value.trim(), 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(
      `Configuration Error: Invalid MAX_MOVES value "${value}". Must be a positive integer.`
    );
  }
  return parsed;
}

/** Parses and validates millisecond timeout from environment */
export function parseTimeout(value: string | undefined, defaultMs: number): number {
  if (!value || value.trim() === '') return defaultMs;
  const parsed = parseInt(value.trim(), 10);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error(
      `Configuration Error: Invalid timeout value "${value}". Must be a non-negative integer.`
    );
  }
  return parsed;
}

/** Parses and validates strategy selection from environment */
export function parseStrategy(value?: string): StrategyType {
  if (!value || value.trim() === '') return 'lookahead';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'corner' || normalized === 'lookahead') {
    return normalized;
  }
  throw new Error(
    `Configuration Error: Invalid strategy "${value}". Supported strategies: "corner", "lookahead".`
  );
}

/** Parsed environment constants */
export const MAX_MOVES = parseMaxMoves(process.env.MAX_MOVES);
export const ACTION_TIMEOUT_MS = parseTimeout(process.env.ACTION_TIMEOUT_MS, 10000);
export const SETTLE_TIMEOUT_MS = parseTimeout(process.env.SETTLE_TIMEOUT_MS, 5000);
export const ACTIVE_STRATEGY = parseStrategy(
  process.env.STRATEGY || process.env.BOT_STRATEGY
);
export const KEEP_PLAYING_ON_WIN =
  process.env.KEEP_PLAYING_ON_WIN === 'true' || process.env.KEEP_PLAYING_ON_WIN === '1';
export const LOG_EVERY_MOVES = parseTimeout(process.env.LOG_EVERY_MOVES, 100);
export const MOVE_DELAY_MS = parseTimeout(process.env.MOVE_DELAY_MS, 100);

/** Default safety thresholds and automation limits */
export const DEFAULT_CONFIG: BotConfig = {
  gameUrl: GAME_URL,
  maxMoves: MAX_MOVES,
  actionTimeoutMs: ACTION_TIMEOUT_MS,
  settleTimeoutMs: SETTLE_TIMEOUT_MS,
  strategy: ACTIVE_STRATEGY,
  keepPlayingOnWin: KEEP_PLAYING_ON_WIN,
  logEveryMoves: LOG_EVERY_MOVES,
  moveDelayMs: MOVE_DELAY_MS,
};

/**
 * Merges user-provided configuration overrides with defaults and validates options.
 *
 * @param overrides - Optional configuration overrides.
 * @returns Fully populated, validated BotConfig.
 */
export function getBotConfig(overrides?: Partial<BotConfig>): BotConfig {
  const merged: BotConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
  };

  if (merged.maxMoves <= 0) {
    throw new Error(
      `Configuration Error: maxMoves must be greater than 0, got ${merged.maxMoves}.`
    );
  }
  if (merged.settleTimeoutMs <= 0) {
    throw new Error(
      `Configuration Error: settleTimeoutMs must be greater than 0, got ${merged.settleTimeoutMs}.`
    );
  }
  if (merged.actionTimeoutMs <= 0) {
    throw new Error(
      `Configuration Error: actionTimeoutMs must be greater than 0, got ${merged.actionTimeoutMs}.`
    );
  }
  if (merged.moveDelayMs < 0) {
    throw new Error(
      `Configuration Error: moveDelayMs must be non-negative, got ${merged.moveDelayMs}.`
    );
  }
  if (merged.strategy !== 'corner' && merged.strategy !== 'lookahead') {
    throw new Error(
      `Configuration Error: Invalid strategy "${merged.strategy}". Supported strategies: "corner", "lookahead".`
    );
  }

  return merged;
}

