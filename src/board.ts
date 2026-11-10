import { Page } from '@playwright/test';
import {
  SELECTORS,
  CLASSES,
  ParsedTile,
  extractDestinationCoordinate,
  extractTileValue,
  selectAuthoritativeTile,
} from './selectors';

/**
 * 4x4 matrix representation of the 2048 grid.
 * Indexing: board[row][col] where row is 0..3 (top to bottom) and col is 0..3 (left to right).
 * A value of 0 represents an empty cell.
 */
export type Board = number[][];

/**
 * Authoritative snapshot of the game state parsed from the DOM.
 */
export interface GameState {
  board: Board;
  score: number;
  highestTile: number;
  isGameOver: boolean;
  isGameWon: boolean;
}

/**
 * Raw tile information extracted directly from DOM elements during evaluate().
 */
export interface RawDomTile {
  className: string;
  innerText: string;
}

/**
 * Raw payload returned by the single in-browser page.evaluate() batch query.
 */
export interface RawDomState {
  tiles: RawDomTile[];
  scoreText: string;
  isGameOver: boolean;
  isGameWon: boolean;
}

/**
 * Creates a fresh, empty 4x4 board initialized with zeros.
 */
export function createEmptyBoard(): Board {
  return [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
}

/**
 * Creates a deep copy of a 4x4 board matrix.
 */
export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/**
 * Parses numeric score safely from raw score container text, discarding any transient
 * animation text like '+4' or '+16'.
 *
 * @param scoreText - Inner text of the score container.
 * @returns Parsed non-negative integer score (defaults to 0 if absent/malformed).
 */
export function parseScore(scoreText?: string | null): number {
  if (!scoreText) return 0;
  // Match first contiguous integer sequence (base score)
  const trimmed = scoreText.trim();
  const match = trimmed.match(/^\d+/) || trimmed.match(/\b\d+\b/);
  if (!match) return 0;
  const val = parseInt(match[0], 10);
  return isNaN(val) ? 0 : Math.max(0, val);
}

/**
 * Parses raw DOM tile records into a clean 4x4 matrix and computes the highest tile.
 * Applies destination coordinate extraction and coordinate deduplication:
 * - Selects final destination class from multi-class sliding tiles.
 * - Resolves merge conflicts by prioritizing .tile-merged over transient parents.
 * - Falls back to Math.max() if neither tile has .tile-merged.
 *
 * @param rawTiles - Array of raw tile descriptors from the DOM.
 * @returns Object with parsed 4x4 board and highest tile number.
 */
export function parseTilesToBoard(rawTiles: RawDomTile[]): {
  board: Board;
  highestTile: number;
} {
  const board: Board = createEmptyBoard();

  if (!rawTiles || rawTiles.length === 0) {
    return { board, highestTile: 0 };
  }

  // 1. Parse raw tiles into ParsedTile objects
  const parsedTiles: ParsedTile[] = [];
  for (const raw of rawTiles) {
    if (!raw || !raw.className) continue;

    const coord = extractDestinationCoordinate(raw.className);
    if (!coord) continue;

    // Validate coordinate range (1..4)
    if (coord.col < 1 || coord.col > 4 || coord.row < 1 || coord.row > 4) {
      continue;
    }

    const value = extractTileValue(raw.className, raw.innerText);
    if (value <= 0) continue;

    parsedTiles.push({
      col: coord.col,
      row: coord.row,
      value,
      isMerged: raw.className.includes(CLASSES.tileMerged),
      isNew: raw.className.includes(CLASSES.tileNew),
    });
  }

  // 2. Group parsed tiles by destination coordinate (col, row)
  const coordMap = new Map<string, ParsedTile[]>();
  for (const tile of parsedTiles) {
    const key = `${tile.col}-${tile.row}`;
    const group = coordMap.get(key);
    if (group) {
      group.push(tile);
    } else {
      coordMap.set(key, [tile]);
    }
  }

  // 3. Deduplicate per coordinate and populate 4x4 matrix
  let highestTile = 0;
  for (const [, tilesAtCoord] of coordMap.entries()) {
    const authoritative = selectAuthoritativeTile(tilesAtCoord);
    // col and row are 1-indexed (col: 1..4, row: 1..4)
    // Board is 0-indexed: [row - 1][col - 1]
    const r = authoritative.row - 1;
    const c = authoritative.col - 1;
    board[r][c] = authoritative.value;

    if (authoritative.value > highestTile) {
      highestTile = authoritative.value;
    }
  }

  return { board, highestTile };
}

/**
 * Pure parser that converts a RawDomState payload into a complete GameState.
 *
 * @param raw - Extracted DOM state payload.
 * @returns Fully structured GameState.
 */
export function parseGameStateFromRaw(raw: RawDomState): GameState {
  const score = parseScore(raw.scoreText);
  const { board, highestTile } = parseTilesToBoard(raw.tiles);

  return {
    board,
    score,
    highestTile,
    isGameOver: Boolean(raw.isGameOver),
    isGameWon: Boolean(raw.isGameWon),
  };
}

/**
 * Batch queries all board, tile, score, and terminal status data from the live DOM
 * in a single page.evaluate() call, eliminating multi-roundtrip CDP latency.
 *
 * Resilient against empty boards, rapid layout reflows, and transient DOM states.
 *
 * @param page - Active Playwright Page instance.
 * @returns Authoritative GameState representation.
 */
export async function readBoard(page: Page): Promise<GameState> {
  const rawDomState = await page.evaluate(
    (sel) => {
      try {
        // Query all tile elements
        const tileEls = Array.from(document.querySelectorAll(sel.tile));
        const tiles = tileEls.map((el) => ({
          className: el.className || '',
          innerText: el.textContent?.trim() || '',
        }));

        // Query score container (strip any score-addition animation bubbles)
        const scoreEl = document.querySelector(sel.scoreContainer);
        let scoreText = '0';
        if (scoreEl) {
          const clone = scoreEl.cloneNode(true) as HTMLElement;
          const additions = clone.querySelectorAll(sel.scoreAddition);
          additions.forEach((a) => a.remove());
          scoreText = clone.textContent?.trim() || '0';
        }

        // Terminal game message detection
        const gameMsgEl = document.querySelector(sel.gameMessage);
        const isGameOver = Boolean(
          document.querySelector(sel.gameOverMessage) ||
            (gameMsgEl && gameMsgEl.classList.contains('game-over'))
        );
        const isGameWon = Boolean(
          document.querySelector(sel.gameWonMessage) ||
            (gameMsgEl && gameMsgEl.classList.contains('game-won'))
        );

        return {
          tiles,
          scoreText,
          isGameOver,
          isGameWon,
        };
      } catch {
        return {
          tiles: [],
          scoreText: '0',
          isGameOver: false,
          isGameWon: false,
        };
      }
    },
    {
      tile: SELECTORS.tile,
      scoreContainer: SELECTORS.scoreContainer,
      scoreAddition: SELECTORS.scoreAddition,
      gameMessage: SELECTORS.gameMessage,
      gameOverMessage: SELECTORS.gameOverMessage,
      gameWonMessage: SELECTORS.gameWonMessage,
    }
  );

  return parseGameStateFromRaw(rawDomState);
}

/**
 * Renders a 4x4 board matrix as a human-readable ASCII table for CLI logs and telemetry.
 *
 * @param board - 4x4 matrix.
 * @returns ASCII formatted board string.
 */
export function renderBoardAscii(board: Board): string {
  const horizontalDivider = '+------+------+------+------+';
  const lines: string[] = [horizontalDivider];

  for (const row of board) {
    const cells = row.map((val) => {
      const cellStr = val === 0 ? '.' : val.toString();
      return cellStr.padStart(5, ' ');
    });
    lines.push(`|${cells.join(' |')} |`);
    lines.push(horizontalDivider);
  }

  return lines.join('\n');
}

/**
 * Formats a full GameState snapshot as an ASCII string.
 */
export function formatGameState(state: GameState): string {
  const status = state.isGameOver
    ? 'Game Over'
    : state.isGameWon
    ? 'Game Won'
    : 'Playing';
  return [
    `Score: ${state.score} | Highest Tile: ${state.highestTile} | Status: ${status}`,
    renderBoardAscii(state.board),
  ].join('\n');
}
