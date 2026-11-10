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

/** Default safety thresholds and automation limits */
export const DEFAULT_CONFIG = {
  maxMoves: 3000,
  actionTimeoutMs: 10000,
  settleTimeoutMs: 5000,
} as const;
