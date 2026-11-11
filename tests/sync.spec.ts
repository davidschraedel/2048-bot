import { test, expect } from '@playwright/test';
import { areBoardsEqual, waitForStateSettling, dispatchMoveAndSync } from '../src/sync';
import { dispatchKeypress, isDirection, DIRECTIONS, Direction } from '../src/input';
import { Board, createEmptyBoard, cloneBoard, readBoard } from '../src/board';
import { initCleanSession } from '../src/storage';
import { GAME_URL } from '../src/config';

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
});

test.describe('Phase 4: Input & State Synchronization - Live Browser Integration', () => {
  test('dispatches keystroke, waits for state settling, and measures latency', async ({ page }) => {
    // 1. Initialize clean session
    await initCleanSession(page, GAME_URL);

    // 2. Read initial pristine board
    const initialState = await readBoard(page);
    expect(initialState.board.flat().filter((v) => v > 0).length).toBeGreaterThanOrEqual(2);

    // 3. Dispatch a move and deterministically sync settled state
    const moveResult = await dispatchMoveAndSync(page, 'ArrowDown', initialState.board);

    // 4. Verify settling metrics and latency
    expect(moveResult.direction).toBe('ArrowDown');
    expect(moveResult.latencyMs).toBeGreaterThan(0);
    // Latency should be reasonable under local execution (typically 10ms - 500ms)
    expect(moveResult.latencyMs).toBeLessThan(3000);

    // 5. Read settled board and confirm mutation
    const afterFirstMove = await readBoard(page);
    expect(areBoardsEqual(initialState.board, afterFirstMove.board)).toBe(false);
    expect(afterFirstMove.score).toBeGreaterThanOrEqual(initialState.score);

    // 6. Execute a second move (e.g. ArrowLeft) to verify multi-move synchronization stability
    const secondMoveResult = await dispatchMoveAndSync(page, 'ArrowLeft', afterFirstMove.board);
    expect(secondMoveResult.direction).toBe('ArrowLeft');
    expect(secondMoveResult.latencyMs).toBeGreaterThan(0);

    const afterSecondMove = await readBoard(page);
    expect(areBoardsEqual(afterFirstMove.board, afterSecondMove.board)).toBe(false);
  });

  test('waitForStateSettling works when dispatched separately from keypress', async ({ page }) => {
    await initCleanSession(page, GAME_URL);
    const beforeState = await readBoard(page);

    // Dispatch keypress directly
    await dispatchKeypress(page, 'ArrowDown');

    // Await state settling
    const syncResult = await waitForStateSettling(page, beforeState.board);
    expect(syncResult.settled).toBe(true);
    expect(syncResult.latencyMs).toBeGreaterThan(0);

    const afterState = await readBoard(page);
    expect(areBoardsEqual(beforeState.board, afterState.board)).toBe(false);
  });
});
