import { test, expect } from '@playwright/test';
import {
  Board,
  GameState,
  RawDomState,
  createEmptyBoard,
  cloneBoard,
  parseScore,
  parseTilesToBoard,
  parseGameStateFromRaw,
  readBoard,
  renderBoardAscii,
  formatGameState,
} from '../src/board';
import { initCleanSession } from '../src/storage';
import { GAME_URL } from '../src/config';
import {
  SELECTORS,
  extractDestinationCoordinate,
  extractTileValue,
} from '../src/selectors';

test.describe('Board Parser - Pure Unit Tests', () => {
  test('creates an empty 4x4 board initialized to 0', () => {
    const board = createEmptyBoard();
    expect(board.length).toBe(4);
    for (const row of board) {
      expect(row.length).toBe(4);
      expect(row).toEqual([0, 0, 0, 0]);
    }
  });

  test('clones a board independently without reference sharing', () => {
    const original = createEmptyBoard();
    original[1][2] = 64;
    const clone = cloneBoard(original);
    expect(clone[1][2]).toBe(64);

    clone[1][2] = 128;
    expect(original[1][2]).toBe(64);
  });

  test('parses empty DOM state into zeroed GameState without errors', () => {
    const raw: RawDomState = {
      tiles: [],
      scoreText: '0',
      isGameOver: false,
      isGameWon: false,
    };

    const state = parseGameStateFromRaw(raw);
    expect(state.board).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(state.score).toBe(0);
    expect(state.highestTile).toBe(0);
    expect(state.isGameOver).toBe(false);
    expect(state.isGameWon).toBe(false);
  });

  test('parses initial 2-tile board layout accurately', () => {
    const raw: RawDomState = {
      tiles: [
        { className: 'tile tile-2 tile-position-1-2 tile-new', innerText: '2' },
        { className: 'tile tile-4 tile-position-3-4 tile-new', innerText: '4' },
      ],
      scoreText: '0',
      isGameOver: false,
      isGameWon: false,
    };

    const state = parseGameStateFromRaw(raw);
    // col 1, row 2 -> board[row - 1][col - 1] = board[1][0]
    expect(state.board[1][0]).toBe(2);
    // col 3, row 4 -> board[3][2]
    expect(state.board[3][2]).toBe(4);
    expect(state.highestTile).toBe(4);
    expect(state.score).toBe(0);
  });

  test('extracts destination coordinate from multi-class sliding tiles', () => {
    // A tile sliding from (1, 1) to (4, 2)
    const raw: RawDomState = {
      tiles: [
        {
          className: 'tile tile-16 tile-position-1-1 tile-position-4-2',
          innerText: '16',
        },
      ],
      scoreText: '48',
      isGameOver: false,
      isGameWon: false,
    };

    const state = parseGameStateFromRaw(raw);
    // Destination is col 4, row 2 -> board[1][3]
    expect(state.board[1][3]).toBe(16);
    // Ensure origin (col 1, row 1) is not populated by the sliding tile
    expect(state.board[0][0]).toBe(0);
    expect(state.highestTile).toBe(16);
    expect(state.score).toBe(48);

    // Verify coordinate extraction is stateless and immune to lastIndex state pollution
    const c1 = extractDestinationCoordinate('tile tile-2 tile-position-1-2');
    const c2 = extractDestinationCoordinate('tile tile-4 tile-position-3-4 tile-position-4-4');
    expect(c1).toEqual({ col: 1, row: 2 });
    expect(c2).toEqual({ col: 4, row: 4 });
  });

  test('resolves merge conflicts by prioritizing .tile-merged over transient parents', () => {
    // Two 4-tiles sliding together into an 8-tile at coordinate (2, 3)
    const raw: RawDomState = {
      tiles: [
        {
          className: 'tile tile-4 tile-position-1-3 tile-position-2-3',
          innerText: '4',
        },
        {
          className: 'tile tile-4 tile-position-2-2 tile-position-2-3',
          innerText: '4',
        },
        {
          className: 'tile tile-8 tile-position-2-3 tile-merged',
          innerText: '8',
        },
      ],
      scoreText: '128',
      isGameOver: false,
      isGameWon: false,
    };

    const state = parseGameStateFromRaw(raw);
    // Col 2, Row 3 -> board[2][1]
    expect(state.board[2][1]).toBe(8);
    expect(state.highestTile).toBe(8);
  });

  test('falls back to Math.max() when deduplicating transient tiles without .tile-merged', () => {
    const raw: RawDomState = {
      tiles: [
        { className: 'tile tile-2 tile-position-1-1', innerText: '2' },
        { className: 'tile tile-4 tile-position-1-1', innerText: '4' },
      ],
      scoreText: '10',
      isGameOver: false,
      isGameWon: false,
    };

    const state = parseGameStateFromRaw(raw);
    expect(state.board[0][0]).toBe(4);
    expect(state.highestTile).toBe(4);
  });

  test('parses score correctly across variations and ignores animation addition bubbles', () => {
    expect(parseScore('256')).toBe(256);
    expect(parseScore('1024\n+32')).toBe(1024);
    expect(parseScore('1024+32')).toBe(1024);
    expect(parseScore('+16\n1024')).toBe(1024);
    expect(parseScore('  2048  ')).toBe(2048);
    expect(parseScore('+16')).toBe(16);
    expect(parseScore('')).toBe(0);
    expect(parseScore(null)).toBe(0);
    expect(parseScore(undefined)).toBe(0);
    expect(parseScore('non-numeric')).toBe(0);
  });

  test('handles terminal game over and game won states', () => {
    const gameOverState = parseGameStateFromRaw({
      tiles: [{ className: 'tile tile-2 tile-position-1-1', innerText: '2' }],
      scoreText: '500',
      isGameOver: true,
      isGameWon: false,
    });
    expect(gameOverState.isGameOver).toBe(true);
    expect(gameOverState.isGameWon).toBe(false);

    const gameWonState = parseGameStateFromRaw({
      tiles: [{ className: 'tile tile-2048 tile-position-4-4', innerText: '2048' }],
      scoreText: '20000',
      isGameOver: false,
      isGameWon: true,
    });
    expect(gameWonState.isGameOver).toBe(false);
    expect(gameWonState.isGameWon).toBe(true);
    expect(gameWonState.highestTile).toBe(2048);
  });

  test('resilient against malformed or out-of-bounds tile records', () => {
    const raw: RawDomState = {
      tiles: [
        { className: 'tile tile-2 tile-position-5-1', innerText: '2' }, // col 5 out of bounds
        { className: 'tile tile-4 tile-position-1-0', innerText: '4' }, // row 0 out of bounds
        { className: 'tile tile-bogus', innerText: '?' }, // no position or valid value
        { className: '', innerText: '' },
      ],
      scoreText: '0',
      isGameOver: false,
      isGameWon: false,
    };

    const state = parseGameStateFromRaw(raw);
    expect(state.board).toEqual(createEmptyBoard());
    expect(state.highestTile).toBe(0);
  });

  test('parses a full 16-tile dense board fixture with diverse values', () => {
    // Simulated dense board snapshot with all 16 cells populated
    const fixtureTiles: RawDomState['tiles'] = [];
    const expectedBoard: Board = [
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2048, 4096],
      [2, 4, 8, 16],
    ];

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = expectedBoard[r][c];
        const colClass = c + 1;
        const rowClass = r + 1;
        fixtureTiles.push({
          className: `tile tile-${val} tile-position-${colClass}-${rowClass}`,
          innerText: `${val}`,
        });
      }
    }

    const state = parseGameStateFromRaw({
      tiles: fixtureTiles,
      scoreText: '35420',
      isGameOver: false,
      isGameWon: true,
    });

    expect(state.board).toEqual(expectedBoard);
    expect(state.score).toBe(35420);
    expect(state.highestTile).toBe(4096);
    expect(state.isGameOver).toBe(false);
    expect(state.isGameWon).toBe(true);
  });

  test('renders board to clean ASCII table', () => {
    const board = createEmptyBoard();
    board[0][0] = 2;
    board[0][1] = 4;
    board[2][2] = 2048;

    const ascii = renderBoardAscii(board);
    expect(ascii).toContain('|    2 |    4 |    . |    . |');
    expect(ascii).toContain('|    . |    . | 2048 |    . |');

    const formatted = formatGameState({
      board,
      score: 120,
      highestTile: 2048,
      isGameOver: false,
      isGameWon: false,
    });
    expect(formatted).toContain('Score: 120');
    expect(formatted).toContain('Highest Tile: 2048');
    expect(formatted).toContain('Status: Playing');
  });
});

test.describe('Board Parser - Live Browser Integration', () => {
  test('readBoard accurately captures live 2048 game DOM state', async ({ page }) => {
    await initCleanSession(page, GAME_URL);

    // Read live board state via single-batch evaluate
    const gameState = await readBoard(page);

    // Verify 4x4 matrix structure
    expect(gameState.board.length).toBe(4);
    for (const row of gameState.board) {
      expect(row.length).toBe(4);
    }

    // Verify initial tiles (canonical 2048 starts with at least 2 tiles)
    const activeTiles = gameState.board.flat().filter((val) => val > 0);
    expect(activeTiles.length).toBeGreaterThanOrEqual(2);

    for (const val of activeTiles) {
      expect([2, 4]).toContain(val);
    }

    expect([2, 4]).toContain(gameState.highestTile);
    expect(gameState.score).toBeGreaterThanOrEqual(0);
    expect(gameState.isGameOver).toBe(false);
    expect(gameState.isGameWon).toBe(false);

    // Perform a move and wait for double rAF settling to ensure DOM actuation has rendered
    await page.keyboard.press('ArrowDown');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        })
    );

    const updatedState = await readBoard(page);
    expect(updatedState.board.length).toBe(4);
    const updatedActiveTiles = updatedState.board.flat().filter((val) => val > 0);
    expect(updatedActiveTiles.length).toBeGreaterThanOrEqual(2);
    expect(updatedState.highestTile).toBeGreaterThanOrEqual(gameState.highestTile);
  });
});
