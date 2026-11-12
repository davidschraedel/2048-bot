import { test, expect } from '@playwright/test';
import { areBoardsEqual, waitForStateSettling, dispatchMoveAndSync } from '../src/sync';
import { dispatchKeypress, isDirection, DIRECTIONS, Direction } from '../src/input';
import { Board, createEmptyBoard, cloneBoard, readBoard } from '../src/board';
import { initCleanSession } from '../src/storage';
import { GAME_URL } from '../src/config';

/**
 * Helper determining a direction that is guaranteed to cause a tile slide or merge
 * on an initial board. Eliminates intermittent test flakiness if initial tiles
 * happen to spawn along a single blocked boundary.
 */
function findGuaranteedMove(board: Board): Direction {
  // Check ArrowDown: valid if any column has a tile with an empty cell or equal tile below it
  for (let c = 0; c < 4; c++) {
    let seenTile = false;
    for (let r = 0; r < 4; r++) {
      if (board[r][c] > 0) seenTile = true;
      else if (seenTile) return 'ArrowDown';
    }
    for (let r = 0; r < 3; r++) {
      if (board[r][c] > 0 && board[r][c] === board[r + 1][c]) return 'ArrowDown';
    }
  }

  // Check ArrowUp: valid if any column has a tile with an empty cell or equal tile above it
  for (let c = 0; c < 4; c++) {
    let seenTile = false;
    for (let r = 3; r >= 0; r--) {
      if (board[r][c] > 0) seenTile = true;
      else if (seenTile) return 'ArrowUp';
    }
    for (let r = 3; r > 0; r--) {
      if (board[r][c] > 0 && board[r][c] === board[r - 1][c]) return 'ArrowUp';
    }
  }

  // Check ArrowLeft: valid if any row has a tile with an empty cell or equal tile to its left
  for (let r = 0; r < 4; r++) {
    let seenTile = false;
    for (let c = 3; c >= 0; c--) {
      if (board[r][c] > 0) seenTile = true;
      else if (seenTile) return 'ArrowLeft';
    }
    for (let c = 3; c > 0; c--) {
      if (board[r][c] > 0 && board[r][c] === board[r - 1][c]) return 'ArrowLeft';
    }
  }

  return 'ArrowRight';
}

test.describe('Phase 4: Input & State Synchronization - Unit Tests', () => {
  test('areBoardsEqual correctly identifies identical and distinct boards', () => {
    const b1 = createEmptyBoard();
    const b2 = createEmptyBoard();

    expect(areBoardsEqual(b1, b2)).toBe(true);

    b1[0][0] = 2;
    expect(areBoardsEqual(b1, b2)).toBe(false);

    b2[0][0] = 2;
    expect(areBoardsEqual(b1, b2)).toBe(true);

    // Deep cloned board equality
    const cloned = cloneBoard(b1);
    expect(areBoardsEqual(b1, cloned)).toBe(true);

    // Differentiation at other coordinates
    b1[3][3] = 2048;
    expect(areBoardsEqual(b1, cloned)).toBe(false);
  });

  test('areBoardsEqual safely rejects malformed or invalid inputs', () => {
    const valid = createEmptyBoard();

    expect(areBoardsEqual(valid, null as unknown as Board)).toBe(false);
    expect(areBoardsEqual(null as unknown as Board, valid)).toBe(false);
    expect(areBoardsEqual(undefined as unknown as Board, valid)).toBe(false);
    expect(areBoardsEqual([] as unknown as Board, valid)).toBe(false);

    // Incomplete row count
    const shortRows: Board = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(areBoardsEqual(valid, shortRows)).toBe(false);

    // Incomplete column count
    const shortCols: Board = [
      [0, 0, 0, 0],
      [0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(areBoardsEqual(valid, shortCols)).toBe(false);
  });

  test('isDirection accurately validates directional strings', () => {
    for (const dir of DIRECTIONS) {
      expect(isDirection(dir)).toBe(true);
    }

    expect(isDirection('ArrowForward')).toBe(false);
    expect(isDirection('w')).toBe(false);
    expect(isDirection('')).toBe(false);
    expect(isDirection(123)).toBe(false);
    expect(isDirection(null)).toBe(false);
    expect(isDirection(undefined)).toBe(false);
  });

  test('dispatchKeypress rejects invalid inputs with fast-fail errors', async () => {
    await expect(
      dispatchKeypress(null as unknown as any, 'ArrowDown')
    ).rejects.toThrow('Page instance must be provided');

    const fakePage = { keyboard: { press: async () => {} } } as unknown as any;
    await expect(
      dispatchKeypress(fakePage, 'InvalidDirection' as unknown as Direction)
    ).rejects.toThrow('Invalid direction "InvalidDirection"');
  });

  test('waitForStateSettling rejects missing page or invalid previousBoard', async () => {
    await expect(
      waitForStateSettling(null as unknown as any, createEmptyBoard())
    ).rejects.toThrow('Page instance must be provided');

    const fakePage = {} as unknown as any;
    await expect(
      waitForStateSettling(fakePage, null as unknown as Board)
    ).rejects.toThrow('A valid 4x4 previousBoard matrix must be provided');

    await expect(
      waitForStateSettling(fakePage, [] as unknown as Board)
    ).rejects.toThrow('A valid 4x4 previousBoard matrix must be provided');

    await expect(
      waitForStateSettling(fakePage, [[1, 2]] as unknown as Board)
    ).rejects.toThrow('A valid 4x4 previousBoard matrix must be provided');
  });

  test('dispatchMoveAndSync rejects missing page or invalid previousBoard', async () => {
    await expect(
      dispatchMoveAndSync(null as unknown as any, 'ArrowDown', createEmptyBoard())
    ).rejects.toThrow('Page instance must be provided');

    const fakePage = { keyboard: { press: async () => {} } } as unknown as any;
    await expect(
      dispatchMoveAndSync(fakePage, 'ArrowDown', null as unknown as Board)
    ).rejects.toThrow('A valid 4x4 previousBoard matrix must be provided');
  });
});

test.describe('Phase 4: Input & State Synchronization - Live Browser Integration', () => {
  test('dispatches keystroke, waits for state settling, and measures latency', async ({ page }) => {
    // 1. Initialize clean session
    await initCleanSession(page, GAME_URL);

    // 2. Read initial pristine board
    const initialState = await readBoard(page);
    expect(initialState.board.flat().filter((v) => v > 0).length).toBeGreaterThanOrEqual(2);

    // 3. Determine a guaranteed move direction for the initial board
    const firstMoveDir = findGuaranteedMove(initialState.board);

    // 4. Dispatch move with latency logger callback enabled
    const logMessages: string[] = [];
    const moveResult = await dispatchMoveAndSync(page, firstMoveDir, initialState.board, {
      logger: (msg) => logMessages.push(msg),
    });

    // 5. Verify settling metrics and latency
    expect(moveResult.direction).toBe(firstMoveDir);
    expect(moveResult.latencyMs).toBeGreaterThan(0);
    expect(moveResult.latencyMs).toBeLessThan(3000);
    expect(logMessages.length).toBe(2);
    expect(logMessages.some((msg) => msg.includes('StateSettling'))).toBe(true);
    expect(logMessages.some((msg) => msg.includes(`Dispatched ${firstMoveDir}`))).toBe(true);

    // 6. Read settled board and confirm mutation
    const afterFirstMove = await readBoard(page);
    expect(areBoardsEqual(initialState.board, afterFirstMove.board)).toBe(false);
    expect(afterFirstMove.score).toBeGreaterThanOrEqual(initialState.score);

    // 7. Execute a second move to verify multi-move synchronization stability
    const secondMoveDir = findGuaranteedMove(afterFirstMove.board);
    const secondMoveResult = await dispatchMoveAndSync(page, secondMoveDir, afterFirstMove.board);
    expect(secondMoveResult.direction).toBe(secondMoveDir);
    expect(secondMoveResult.latencyMs).toBeGreaterThan(0);

    const afterSecondMove = await readBoard(page);
    expect(areBoardsEqual(afterFirstMove.board, afterSecondMove.board)).toBe(false);
  });

  test('waitForStateSettling works when dispatched separately from keypress', async ({ page }) => {
    await initCleanSession(page, GAME_URL);
    const beforeState = await readBoard(page);

    const validDir = findGuaranteedMove(beforeState.board);

    // Dispatch keypress directly
    await dispatchKeypress(page, validDir);

    // Await state settling
    const syncResult = await waitForStateSettling(page, beforeState.board);
    expect(syncResult.settled).toBe(true);
    expect(syncResult.latencyMs).toBeGreaterThan(0);

    const afterState = await readBoard(page);
    expect(areBoardsEqual(beforeState.board, afterState.board)).toBe(false);
  });
});

