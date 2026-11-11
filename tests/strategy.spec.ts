import { test, expect } from '@playwright/test';
import {
  Direction,
  CORNER_CYCLE_ORDER,
  DEFAULT_HEURISTIC_WEIGHTS,
  validateBoardStructure,
  slideAndMergeLine,
  simulateMove,
  canMove,
  getValidMoves,
  countEmptyCells,
  getHighestTile,
  calculateCornerScore,
  calculateMonotonicity,
  calculateSmoothness,
  evaluateBoard,
  cornerPriorityStrategy,
  cornerCycleStrategy,
  createLookaheadStrategy,
  lookaheadHeuristicStrategy,
  lookaheadStrategy,
  STRATEGIES,
  getStrategy,
} from '../src/strategy';
import { Board, createEmptyBoard, cloneBoard } from '../src/board';

test.describe('Phase 5: Deterministic Decision Strategies - Unit Tests', () => {
  test.describe('validateBoardStructure', () => {
    test('accepts valid 4x4 matrix', () => {
      const board = createEmptyBoard();
      expect(() => validateBoardStructure(board)).not.toThrow();
    });

    test('rejects null, undefined, or non-array board inputs', () => {
      expect(() => validateBoardStructure(null as unknown as Board)).toThrow();
      expect(() => validateBoardStructure(undefined as unknown as Board)).toThrow();
      expect(() => validateBoardStructure([] as unknown as Board)).toThrow();
      expect(() => validateBoardStructure([[0, 0, 0, 0]] as unknown as Board)).toThrow();
    });

    test('rejects board with invalid row lengths', () => {
      const badBoard = [
        [0, 0, 0, 0],
        [0, 0, 0], // length 3
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
      expect(() => validateBoardStructure(badBoard)).toThrow(/Row 1 must be an array of length 4/);
    });
  });

  test.describe('slideAndMergeLine', () => {
    test('handles empty line without mutation or score', () => {
      const res = slideAndMergeLine([0, 0, 0, 0]);
      expect(res.line).toEqual([0, 0, 0, 0]);
      expect(res.changed).toBe(false);
      expect(res.scoreGained).toBe(0);
    });

    test('slides isolated tile to index 0', () => {
      const res = slideAndMergeLine([0, 0, 2, 0]);
      expect(res.line).toEqual([2, 0, 0, 0]);
      expect(res.changed).toBe(true);
      expect(res.scoreGained).toBe(0);
    });

    test('detects unchanged line when tile is already at index 0', () => {
      const res = slideAndMergeLine([4, 0, 0, 0]);
      expect(res.line).toEqual([4, 0, 0, 0]);
      expect(res.changed).toBe(false);
      expect(res.scoreGained).toBe(0);
    });

    test('merges two adjacent identical tiles and scores points', () => {
      const res = slideAndMergeLine([2, 2, 0, 0]);
      expect(res.line).toEqual([4, 0, 0, 0]);
      expect(res.changed).toBe(true);
      expect(res.scoreGained).toBe(4);
    });

    test('merges tiles separated by empty cells', () => {
      const res = slideAndMergeLine([2, 0, 2, 0]);
      expect(res.line).toEqual([4, 0, 0, 0]);
      expect(res.changed).toBe(true);
      expect(res.scoreGained).toBe(4);
    });

    test('enforces single merge per shift (3 identical tiles: [2, 2, 2, 0] -> [4, 2, 0, 0])', () => {
      const res = slideAndMergeLine([2, 2, 2, 0]);
      expect(res.line).toEqual([4, 2, 0, 0]);
      expect(res.changed).toBe(true);
      expect(res.scoreGained).toBe(4);
    });

    test('performs double merges in a single row ([2, 2, 2, 2] -> [4, 4, 0, 0])', () => {
      const res = slideAndMergeLine([2, 2, 2, 2]);
      expect(res.line).toEqual([4, 4, 0, 0]);
      expect(res.changed).toBe(true);
      expect(res.scoreGained).toBe(8);
    });

    test('handles distinct numbers without false merges', () => {
      const res = slideAndMergeLine([2, 4, 2, 4]);
      expect(res.line).toEqual([2, 4, 2, 4]);
      expect(res.changed).toBe(false);
      expect(res.scoreGained).toBe(0);
    });

    test('merges distinct pairs correctly ([4, 4, 8, 8] -> [8, 16, 0, 0])', () => {
      const res = slideAndMergeLine([4, 4, 8, 8]);
      expect(res.line).toEqual([8, 16, 0, 0]);
      expect(res.changed).toBe(true);
      expect(res.scoreGained).toBe(24);
    });
  });

  test.describe('simulateMove', () => {
    test('simulates ArrowLeft correctly', () => {
      const board: Board = [
        [0, 2, 0, 2],
        [4, 0, 4, 0],
        [2, 4, 8, 16],
        [0, 0, 0, 0],
      ];

      const res = simulateMove(board, 'ArrowLeft');
      expect(res.moved).toBe(true);
      expect(res.scoreGained).toBe(12); // 4 + 8
      expect(res.board).toEqual([
        [4, 0, 0, 0],
        [8, 0, 0, 0],
        [2, 4, 8, 16],
        [0, 0, 0, 0],
      ]);
    });

    test('simulates ArrowRight correctly', () => {
      const board: Board = [
        [2, 0, 2, 0],
        [0, 4, 0, 4],
        [0, 0, 0, 2],
        [0, 0, 0, 0],
      ];

      const res = simulateMove(board, 'ArrowRight');
      expect(res.moved).toBe(true);
      expect(res.scoreGained).toBe(12);
      expect(res.board).toEqual([
        [0, 0, 0, 4],
        [0, 0, 0, 8],
        [0, 0, 0, 2],
        [0, 0, 0, 0],
      ]);
    });

    test('simulates ArrowUp correctly', () => {
      const board: Board = [
        [0, 4, 0, 0],
        [2, 4, 0, 0],
        [2, 0, 0, 0],
        [0, 0, 0, 0],
      ];

      const res = simulateMove(board, 'ArrowUp');
      expect(res.moved).toBe(true);
      expect(res.scoreGained).toBe(12); // 4 (2+2) + 8 (4+4)
      expect(res.board).toEqual([
        [4, 8, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]);
    });

    test('simulates ArrowDown correctly', () => {
      const board: Board = [
        [2, 4, 0, 0],
        [2, 4, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];

      const res = simulateMove(board, 'ArrowDown');
      expect(res.moved).toBe(true);
      expect(res.scoreGained).toBe(12); // 4 + 8
      expect(res.board).toEqual([
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [4, 8, 0, 0],
      ]);
    });

    test('does not mutate original board input', () => {
      const original: Board = [
        [2, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
      const copy = cloneBoard(original);
      simulateMove(original, 'ArrowDown');
      expect(original).toEqual(copy);
    });

    test('reports moved: false when direction is completely blocked', () => {
      const blockedDown: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [2, 4, 8, 16],
      ];
      const res = simulateMove(blockedDown, 'ArrowDown');
      expect(res.moved).toBe(false);
      expect(res.scoreGained).toBe(0);
      expect(res.board).toEqual(blockedDown);
    });

    test('rejects invalid or unsupported directions with descriptive error', () => {
      const board = createEmptyBoard();
      expect(() =>
        simulateMove(board, 'InvalidDirection' as unknown as Direction)
      ).toThrow(/Invalid direction "InvalidDirection"/);
    });
  });

  test.describe('getValidMoves & canMove', () => {
    test('returns empty array on completely empty board (no tiles to move)', () => {
      const empty = createEmptyBoard();
      expect(getValidMoves(empty)).toEqual([]);
    });

    test('returns all 4 directions for centered isolated tile', () => {
      const board = createEmptyBoard();
      board[1][1] = 2;
      const valid = getValidMoves(board);
      expect(valid).toEqual([
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
      ]);
    });

    test('accurately identifies blocked directions for corner-packed tiles', () => {
      // Tiles pinned at bottom-left corner with distinct values
      const board: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [4, 0, 0, 0],
        [8, 16, 0, 0],
      ];

      // Down is blocked (tiles already at bottom)
      expect(canMove(board, 'ArrowDown')).toBe(false);
      // Left is blocked (tiles already at left)
      expect(canMove(board, 'ArrowLeft')).toBe(false);
      // Right is valid (can slide right into empty cells)
      expect(canMove(board, 'ArrowRight')).toBe(true);
      // Up is valid (can slide up into empty cells)
      expect(canMove(board, 'ArrowUp')).toBe(true);

      expect(getValidMoves(board)).toEqual(['ArrowRight', 'ArrowUp']);
    });

    test('returns empty array on full board with no possible merges (game over/deadlock)', () => {
      const deadlocked: Board = [
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 2],
      ];

      expect(getValidMoves(deadlocked)).toEqual([]);
      expect(canMove(deadlocked, 'ArrowDown')).toBe(false);
      expect(canMove(deadlocked, 'ArrowLeft')).toBe(false);
      expect(canMove(deadlocked, 'ArrowRight')).toBe(false);
      expect(canMove(deadlocked, 'ArrowUp')).toBe(false);
    });

    test('identifies horizontal-only merges on full board', () => {
      const horizontalMerges: Board = [
        [2, 2, 4, 8],
        [4, 8, 16, 32],
        [2, 4, 8, 16],
        [4, 8, 16, 32],
      ];

      const valid = getValidMoves(horizontalMerges);
      expect(valid).toContain('ArrowLeft');
      expect(valid).toContain('ArrowRight');
      expect(valid).not.toContain('ArrowDown');
      expect(valid).not.toContain('ArrowUp');
    });

    test('identifies vertical-only merges on full board', () => {
      const verticalMerges: Board = [
        [2, 4, 2, 4],
        [2, 8, 4, 8],
        [4, 16, 8, 16],
        [8, 32, 16, 32],
      ];

      const valid = getValidMoves(verticalMerges);
      expect(valid).toContain('ArrowDown');
      expect(valid).toContain('ArrowUp');
      expect(valid).not.toContain('ArrowLeft');
      expect(valid).not.toContain('ArrowRight');
    });
  });

  test.describe('Phase 1 Strategy: Corner Priority Cycling', () => {
    test('selects ArrowDown when all directions are valid', () => {
      const board = createEmptyBoard();
      board[1][1] = 2;
      const valid = getValidMoves(board);
      expect(cornerPriorityStrategy(board, valid)).toBe('ArrowDown');
    });

    test('selects ArrowLeft when ArrowDown is blocked', () => {
      const board: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 2, 4, 8],
      ];

      const valid = getValidMoves(board); // Down is blocked, Left/Right/Up valid
      expect(valid).not.toContain('ArrowDown');
      expect(valid).toContain('ArrowLeft');
      expect(cornerPriorityStrategy(board, valid)).toBe('ArrowLeft');
    });

    test('selects ArrowRight when ArrowDown and ArrowLeft are blocked', () => {
      const board: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [4, 0, 0, 0],
        [8, 16, 0, 0],
      ];

      const valid = getValidMoves(board); // ['ArrowRight', 'ArrowUp']
      expect(cornerPriorityStrategy(board, valid)).toBe('ArrowRight');
    });

    test('selects ArrowUp when only ArrowUp is valid', () => {
      const board: Board = [
        [0, 0, 0, 0],
        [2, 4, 8, 16],
        [4, 8, 16, 32],
        [8, 16, 32, 64],
      ];

      const valid = getValidMoves(board); // Only ArrowUp can move into row 0
      expect(valid).toEqual(['ArrowUp']);
      expect(cornerPriorityStrategy(board, valid)).toBe('ArrowUp');
    });

    test('throws descriptive error on deadlocked board with zero valid moves', () => {
      const deadlocked: Board = [
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 2],
      ];

      expect(() => cornerPriorityStrategy(deadlocked, [])).toThrow(
        /No valid moves available/
      );
    });

    test('computes validMoves on the fly if not provided', () => {
      const board = createEmptyBoard();
      board[1][1] = 2;
      expect(cornerPriorityStrategy(board)).toBe('ArrowDown');
    });

    test('verifies cornerCycleStrategy alias works identically', () => {
      const board = createEmptyBoard();
      board[1][1] = 2;
      expect(cornerCycleStrategy(board)).toBe('ArrowDown');
    });
  });

  test.describe('Phase 2 Strategy: Lookahead Heuristic', () => {
    test('countEmptyCells accurately counts open grid cells', () => {
      const empty = createEmptyBoard();
      expect(countEmptyCells(empty)).toBe(16);

      empty[0][0] = 2;
      empty[3][3] = 4;
      expect(countEmptyCells(empty)).toBe(14);
    });

    test('getHighestTile extracts the largest number on the board', () => {
      const board = createEmptyBoard();
      board[1][2] = 128;
      board[3][0] = 512;
      expect(getHighestTile(board)).toBe(512);
    });

    test('calculateCornerScore rewards highest tile locked in bottom-left anchor', () => {
      const anchoredBoard: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [512, 0, 0, 0],
      ];

      const nonAnchoredBoard: Board = [
        [0, 0, 0, 0],
        [0, 512, 0, 0], // trapped in center
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];

      const scoreAnchored = calculateCornerScore(anchoredBoard);
      const scoreNonAnchored = calculateCornerScore(nonAnchoredBoard);

      expect(scoreAnchored).toBeGreaterThan(0);
      expect(scoreNonAnchored).toBeLessThan(0);
      expect(scoreAnchored).toBeGreaterThan(scoreNonAnchored);
    });

    test('calculateMonotonicity scores organized boards higher than chaotic boards', () => {
      // Smoothly descending along bottom row and ascending down left column
      const monotonicBoard: Board = [
        [32, 0, 0, 0],
        [64, 0, 0, 0],
        [128, 0, 0, 0],
        [256, 128, 64, 32],
      ];

      // Scrambled / zigzagging values
      const chaoticBoard: Board = [
        [128, 0, 0, 0],
        [32, 0, 0, 0],
        [256, 0, 0, 0],
        [32, 256, 32, 128],
      ];

      const scoreMonotonic = calculateMonotonicity(monotonicBoard);
      const scoreChaotic = calculateMonotonicity(chaoticBoard);

      expect(scoreMonotonic).toBeGreaterThan(scoreChaotic);
    });

    test('ignores empty cells between non-zero tiles when calculating monotonicity', () => {
      // Row 3: [256, 0, 128, 64] should be cleanly monotonic (descending rightwards)
      const boardWithGaps: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [256, 0, 128, 64],
      ];

      const score = calculateMonotonicity(boardWithGaps);
      // Non-zeros are 256 -> 128 -> 64 (drops of 1 and 1). Row 3 score = 1 + 1 = 2
      expect(score).toBe(2);
    });

    test('avoids false zero-drop inflation on isolated corner tile', () => {
      const singleCorner: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [512, 0, 0, 0],
      ];

      const fullyPopulated: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [512, 256, 128, 64],
      ];

      // Single tile has no relative monotonicity (score = 0)
      expect(calculateMonotonicity(singleCorner)).toBe(0);
      // Fully populated monotonic line has positive score (+3)
      expect(calculateMonotonicity(fullyPopulated)).toBe(3);
    });

    test('calculateSmoothness rewards adjacent identical mergeable pairs', () => {
      const smoothBoard: Board = [
        [2, 2, 0, 0],
        [4, 4, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];

      const jaggedBoard: Board = [
        [2, 128, 0, 0],
        [4, 512, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];

      expect(calculateSmoothness(smoothBoard)).toBeGreaterThan(
        calculateSmoothness(jaggedBoard)
      );
    });

    test('evaluateBoard produces higher score for cleaner, well-structured states', () => {
      const strongState: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [32, 16, 0, 0],
        [256, 128, 64, 32],
      ];

      const fragmentedState: Board = [
        [2, 4, 8, 2],
        [16, 2, 32, 4],
        [4, 256, 2, 8],
        [2, 4, 8, 16],
      ];

      expect(evaluateBoard(strongState)).toBeGreaterThan(
        evaluateBoard(fragmentedState)
      );
    });

    test('lookaheadHeuristicStrategy selects a legal move among validMoves', () => {
      const board: Board = [
        [0, 0, 0, 0],
        [0, 2, 0, 0],
        [0, 0, 4, 0],
        [128, 0, 0, 0],
      ];

      const valid = getValidMoves(board);
      const chosen = lookaheadHeuristicStrategy(board, valid);
      expect(valid).toContain(chosen);
    });

    test('lookaheadHeuristicStrategy protects highest tile in corner against risky moves', () => {
      // Highest tile 512 is in bottom-left corner (3, 0).
      // Row 2 has uncompressed tiles [0, 2, 4, 0] that can slide Left or Down.
      // Moving ArrowLeft or ArrowDown keeps 512 anchored at (3, 0).
      // Moving ArrowUp would dislodge 512 from bottom-left corner into row 0.
      // Moving ArrowRight would shift 512 away from the left edge.
      const board: Board = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 2, 4, 0],
        [512, 16, 0, 0],
      ];

      const valid = getValidMoves(board);
      expect(valid).toContain('ArrowLeft');
      expect(valid).toContain('ArrowUp');
      expect(valid).toContain('ArrowRight');

      const chosen = lookaheadHeuristicStrategy(board, valid);

      // Should choose a safe move (ArrowLeft or ArrowDown), never ArrowUp or ArrowRight
      expect(chosen).not.toBe('ArrowUp');
      expect(chosen).not.toBe('ArrowRight');
      expect(['ArrowLeft', 'ArrowDown']).toContain(chosen);
    });

    test('lookaheadHeuristicStrategy chooses the only move when validMoves length is 1', () => {
      const board: Board = [
        [0, 0, 0, 0],
        [2, 4, 8, 16],
        [4, 8, 16, 32],
        [8, 16, 32, 64],
      ];

      const valid = getValidMoves(board); // ['ArrowUp']
      expect(valid.length).toBe(1);
      expect(lookaheadHeuristicStrategy(board, valid)).toBe('ArrowUp');
    });

    test('lookaheadHeuristicStrategy throws descriptive error when no moves are valid', () => {
      const deadlocked: Board = [
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 2],
      ];

      expect(() => lookaheadHeuristicStrategy(deadlocked, [])).toThrow(
        /No valid moves available/
      );
    });

    test('createLookaheadStrategy supports custom depth and weights', () => {
      const customStrat = createLookaheadStrategy({
        depth: 1,
        weights: {
          emptyCells: 500,
          cornerMagnitude: 2000,
          monotonicity: 200,
          smoothness: 100,
          scoreWeight: 2.0,
        },
      });

      const board: Board = [
        [0, 0, 0, 0],
        [0, 2, 0, 0],
        [4, 0, 0, 0],
        [64, 32, 0, 0],
      ];

      const move = customStrat(board);
      expect(['ArrowDown', 'ArrowLeft']).toContain(move);
    });
  });

  test.describe('Strategy Registry & Lookup', () => {
    test('exposes corner and lookahead strategies in registry', () => {
      expect(STRATEGIES.corner).toBeDefined();
      expect(STRATEGIES.lookahead).toBeDefined();
    });

    test('resolves strategy by case-insensitive name', () => {
      expect(getStrategy('corner')).toBe(cornerPriorityStrategy);
      expect(getStrategy('CORNER')).toBe(cornerPriorityStrategy);
      expect(getStrategy('lookahead')).toBe(lookaheadHeuristicStrategy);
      expect(getStrategy('LOOKAHEAD')).toBe(lookaheadHeuristicStrategy);
    });

    test('throws descriptive error on invalid strategy name', () => {
      expect(() => getStrategy('minimax')).toThrow(/Unknown strategy "minimax"/);
    });

    test('rejects null, undefined, or empty strategy names with descriptive error', () => {
      expect(() => getStrategy('')).toThrow(
        /Strategy name must be a non-empty string/
      );
      expect(() => getStrategy('   ')).toThrow(
        /Strategy name must be a non-empty string/
      );
      expect(() => getStrategy(null as unknown as string)).toThrow(
        /Strategy name must be a non-empty string/
      );
      expect(() => getStrategy(undefined as unknown as string)).toThrow(
        /Strategy name must be a non-empty string/
      );
    });
  });

  test.describe('Simulated Multi-Step Game', () => {
    test('plays simulated game with lookahead strategy and achieves merges cleanly', () => {
      // Deterministic pseudo-random number generator for tile spawning
      let seed = 42;
      function pseudoRandom(): number {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      }

      function spawnTile(b: Board): void {
        const empties: { r: number; c: number }[] = [];
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            if (b[r][c] === 0) empties.push({ r, c });
          }
        }
        if (empties.length === 0) return;
        const idx = Math.floor(pseudoRandom() * empties.length);
        const cell = empties[idx];
        b[cell.r][cell.c] = pseudoRandom() < 0.9 ? 2 : 4;
      }

      // Initialize board with 2 tiles
      const board = createEmptyBoard();
      spawnTile(board);
      spawnTile(board);

      let moves = 0;
      let totalScore = 0;
      const MAX_SIM_MOVES = 100;

      while (moves < MAX_SIM_MOVES) {
        const valid = getValidMoves(board);
        if (valid.length === 0) break;

        const chosen = lookaheadHeuristicStrategy(board, valid);
        expect(valid).toContain(chosen);

        const sim = simulateMove(board, chosen);
        expect(sim.moved).toBe(true);

        // Apply simulated move and spawn next tile
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            board[r][c] = sim.board[r][c];
          }
        }
        totalScore += sim.scoreGained;
        spawnTile(board);
        moves++;
      }

      // Verify game progressed smoothly
      expect(moves).toBeGreaterThan(30);
      expect(totalScore).toBeGreaterThan(100);
      expect(getHighestTile(board)).toBeGreaterThanOrEqual(64);
    });
  });
});
