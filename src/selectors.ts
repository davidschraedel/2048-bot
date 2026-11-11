/**
 * Core element selectors, class schemas, and parsing helpers for the 2048 DOM.
 *
 * Aligned with Phase 2 of the 2048 Bot Roadmap:
 * - 1-based grid coordinates (col: 1..4, row: 1..4).
 * - Multi-class sliding tile resolution (final destination class extracted).
 * - Merge detection prioritizing .tile-merged over transient sliding parent tiles.
 */

export const SELECTORS = {
  // Board & Grid Containers
  gameContainer: '.game-container',
  gridContainer: '.grid-container',
  tileContainer: '.tile-container',

  // Tile Elements
  tile: '.tile-container .tile',
  tileInner: '.tile-inner',

  // Score Containers
  scoreContainer: '.score-container',
  scoreAddition: '.score-addition',
  bestContainer: '.best-container',

  // Termination & Modal States
  gameMessage: '.game-message',
  gameOverMessage: '.game-message.game-over',
  gameWonMessage: '.game-message.game-won',

  // Action Buttons
  restartButton: '.restart-button',
  retryButton: '.retry-button',
  keepPlayingButton: '.keep-playing-button',
} as const;

/** Class name constants used by the 2048 engine */
export const CLASSES = {
  tileMerged: 'tile-merged',
  tileNew: 'tile-new',
  gameOver: 'game-over',
  gameWon: 'game-won',
} as const;

/**
 * Regular expressions for extracting numerical values and positions from tile classes.
 */
export const REGEX = {
  /** Matches tile value classes such as 'tile-2', 'tile-2048' */
  tileValue: /\btile-(\d+)\b/,
  /** Matches position classes such as 'tile-position-1-4' (col-row) */
  tilePosition: /\btile-position-(\d+)-(\d+)\b/,
  /** Global matcher for extracting multiple position classes */
  tilePositionGlobal: /\btile-position-(\d+)-(\d+)\b/g,
} as const;

/** Parsed coordinate on the 4x4 matrix (1-indexed) */
export interface TileCoordinate {
  col: number; // 1 to 4 (left to right)
  row: number; // 1 to 4 (top to bottom)
}

/** Parsed tile metadata extracted from a DOM element */
export interface ParsedTile {
  col: number;
  row: number;
  value: number;
  isMerged: boolean;
  isNew: boolean;
}

/**
 * Extracts the numerical value of a tile from its class list or fallback inner text.
 * E.g., "tile tile-16 tile-position-3-4" -> 16
 */
export function extractTileValue(className: string, innerText?: string): number {
  const match = className.match(REGEX.tileValue);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  if (innerText) {
    const parsed = parseInt(innerText.trim(), 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

/**
 * Extracts the final destination coordinate from a tile's class list.
 *
 * During sliding animations, 2048 tiles retain previous position classes
 * alongside their destination class (e.g. "tile-position-1-1 tile-position-1-2").
 * The destination position class is always the LAST position class in the attribute.
 *
 * @param className - Full class attribute string of the tile element.
 * @returns 1-indexed { col, row } destination coordinate or null if missing.
 */
export function extractDestinationCoordinate(className: string): TileCoordinate | null {
  // Use a fresh RegExp instance to prevent shared lastIndex state pollution across calls
  const matches = Array.from(className.matchAll(new RegExp(REGEX.tilePositionGlobal)));
  if (matches.length === 0) return null;

  // The final destination class is the last position class found
  const lastMatch = matches[matches.length - 1];
  const col = parseInt(lastMatch[1], 10);
  const row = parseInt(lastMatch[2], 10);

  return { col, row };
}

/**
 * Formulates the merge and coordinate deduplication rule.
 *
 * When multiple tiles occupy the exact same (col, row) coordinate during a merge
 * animation (e.g., two 4-tiles sliding together into an 8-tile), the tile with
 * the `.tile-merged` class is the authoritative representation of the board state.
 *
 * If no tile has `.tile-merged`, the tile with the highest value is selected to
 * discard transient sliding elements.
 *
 * @param tilesAtCoord - All parsed tiles located at the same (col, row).
 * @returns The authoritative tile for that grid cell.
 */
export function selectAuthoritativeTile(tilesAtCoord: ParsedTile[]): ParsedTile {
  if (tilesAtCoord.length === 0) {
    throw new Error('selectAuthoritativeTile requires at least one tile');
  }
  if (tilesAtCoord.length === 1) return tilesAtCoord[0];

  // Prioritize tile-merged elements (take highest value if multiple exist)
  const mergedTiles = tilesAtCoord.filter((t) => t.isMerged);
  if (mergedTiles.length > 0) {
    return mergedTiles.reduce((best, curr) => (curr.value > best.value ? curr : best));
  }

  // Fallback to highest value
  return tilesAtCoord.reduce((best, curr) => (curr.value > best.value ? curr : best));
}
