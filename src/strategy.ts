import { Direction, DIRECTIONS, isDirection } from './input';
import { Board, cloneBoard, createEmptyBoard } from './board';

// Re-export Direction contract so consumers can import directly from strategy
export { Direction } from './input';

/**
 * Pure move validator contract: given a 4x4 board, returns all legal directions
 * that would cause at least one tile to slide or merge.
 */
export type MoveValidator = (board: Board) => Direction[];

/**
 * Autonomous decision strategy contract: given a 4x4 board and optional precomputed
 * valid moves, returns the chosen directional move to dispatch.
 */
export type Strategy = (board: Board, validMoves?: Direction[]) => Direction;

/**
 * Outcome of simulating a directional move on a 4x4 board in memory.
 */
export interface SimulatedMoveResult {
  /** Resulting 4x4 board after sliding and merging (without random tile spawn) */
  board: Board;
  /** Whether the board mutated (at least one tile moved or merged) */
  moved: boolean;
  /** Total score gained from tile merges during this single move */
  scoreGained: number;
}

/**
 * Weighting configuration for the board evaluation heuristic.
 */
export interface HeuristicWeights {
  /** Weight multiplied by count of empty cells (0s) */
  emptyCells: number;
  /** Weight for corner tile magnitude / locking highest tile to anchor corner */
  cornerMagnitude: number;
  /** Weight for row and column monotonicity */
  monotonicity: number;
  /** Weight for adjacent tile similarity / merge potential */
  smoothness: number;
  /** Weight for immediate score gained from merges */
  scoreWeight: number;
}

/**
 * Default heuristic weights tuned for 2048 corner anchoring and smooth gradients.
 */
export const DEFAULT_HEURISTIC_WEIGHTS: HeuristicWeights = {
  emptyCells: 270,
  cornerMagnitude: 1000,
  monotonicity: 100,
  smoothness: 50,
  scoreWeight: 1.0,
};

/**
 * Fixed preference hierarchy for the Phase 1 Corner Priority Cycling strategy:
 * Down -> Left -> Right -> Up (anchors tiles naturally toward bottom-left).
 */
export const CORNER_CYCLE_ORDER: readonly Direction[] = [
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
] as const;

/**
 * Validates that an object conforms to a valid 4x4 board matrix.
 * Throws a descriptive Error if dimensions are invalid.
 */
export function validateBoardStructure(board: Board): void {
  if (!board || !Array.isArray(board) || board.length !== 4) {
    throw new Error('validateBoardStructure: Board must be a 4x4 matrix.');
  }
  for (let r = 0; r < 4; r++) {
    if (!Array.isArray(board[r]) || board[r].length !== 4) {
      throw new Error(
        `validateBoardStructure: Row ${r} must be an array of length 4.`
      );
    }
  }
}

/**
 * Pure 1D line slider and merger towards index 0 (representing the leading edge).
 *
 * Rules:
 * 1. Non-zero numbers slide towards index 0.
 * 2. Adjacent identical numbers merge into their sum.
 * 3. Each tile can participate in at most one merge per shift (from index 0 forward).
 * 4. Remaining trailing slots are filled with zeros.
 *
 * @param line - 4-element number array.
 * @returns Object with merged 4-element line, points gained, and whether the line changed.
 */
export function slideAndMergeLine(line: readonly number[]): {
  line: number[];
  scoreGained: number;
  changed: boolean;
} {
  const nonZeros = line.filter((v) => v !== 0);
  const result: number[] = [];
  let scoreGained = 0;
  let i = 0;

  while (i < nonZeros.length) {
    if (i + 1 < nonZeros.length && nonZeros[i] === nonZeros[i + 1]) {
      const mergedVal = nonZeros[i] * 2;
      result.push(mergedVal);
      scoreGained += mergedVal;
      i += 2; // Both tiles consumed in merge
    } else {
      result.push(nonZeros[i]);
      i += 1;
    }
  }

  while (result.length < 4) {
    result.push(0);
  }

  let changed = false;
  for (let j = 0; j < 4; j++) {
    if (result[j] !== line[j]) {
      changed = true;
      break;
    }
  }

  return { line: result, scoreGained, changed };
}

/**
 * Simulates a directional move on a 4x4 board in memory without browser interaction
 * or synthetic tile spawning.
 *
 * @param board - Current 4x4 matrix representation.
 * @param direction - Direction to slide ('ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp').
 * @returns SimulatedMoveResult containing updated board, moved flag, and score gained.
 */
export function simulateMove(
  board: Board,
  direction: Direction
): SimulatedMoveResult {
  validateBoardStructure(board);

  if (!isDirection(direction)) {
    throw new Error(
      `simulateMove: Invalid direction "${direction}". Supported directions: ${DIRECTIONS.join(', ')}`
    );
  }

  const newBoard: Board = createEmptyBoard();
  let anyMoved = false;
  let totalScoreGained = 0;

  switch (direction) {
    case 'ArrowLeft': {
      for (let r = 0; r < 4; r++) {
        const { line, scoreGained, changed } = slideAndMergeLine(board[r]);
        newBoard[r] = line;
        if (changed) anyMoved = true;
        totalScoreGained += scoreGained;
      }
      break;
    }

    case 'ArrowRight': {
      for (let r = 0; r < 4; r++) {
        const reversed = [board[r][3], board[r][2], board[r][1], board[r][0]];
        const { line, scoreGained, changed } = slideAndMergeLine(reversed);
        newBoard[r] = [line[3], line[2], line[1], line[0]];
        if (changed) anyMoved = true;
        totalScoreGained += scoreGained;
      }
      break;
    }

    case 'ArrowUp': {
      for (let c = 0; c < 4; c++) {
        const colLine = [board[0][c], board[1][c], board[2][c], board[3][c]];
        const { line, scoreGained, changed } = slideAndMergeLine(colLine);
        for (let r = 0; r < 4; r++) {
          newBoard[r][c] = line[r];
        }
        if (changed) anyMoved = true;
        totalScoreGained += scoreGained;
      }
      break;
    }

    case 'ArrowDown': {
      for (let c = 0; c < 4; c++) {
        const colLine = [board[3][c], board[2][c], board[1][c], board[0][c]];
        const { line, scoreGained, changed } = slideAndMergeLine(colLine);
        for (let r = 0; r < 4; r++) {
          newBoard[3 - r][c] = line[r];
        }
        if (changed) anyMoved = true;
        totalScoreGained += scoreGained;
      }
      break;
    }

    default: {
      throw new Error(
        `simulateMove: Unsupported direction "${direction}". Supported directions: ${DIRECTIONS.join(', ')}`
      );
    }
  }

  return {
    board: newBoard,
    moved: anyMoved,
    scoreGained: totalScoreGained,
  };
}

/**
 * Checks if a specific directional move is legal on the current board (i.e. would
 * cause at least one tile to slide or merge).
 *
 * @param board - Current 4x4 matrix.
 * @param direction - Direction to test.
 * @returns True if the move is legal.
 */
export function canMove(board: Board, direction: Direction): boolean {
  return simulateMove(board, direction).moved;
}

/**
 * Pure in-memory move validator: calculates all legal directional moves for a 4x4 board.
 * Returns directions ordered by standard priority (ArrowDown, ArrowLeft, ArrowRight, ArrowUp).
 *
 * Discards all blocked directions to guarantee zero wasteful keystrokes and zero timeout latencies.
 *
 * @param board - Current 4x4 matrix.
 * @returns Array of valid Direction keys (empty if deadlocked/game over).
 */
export function getValidMoves(board: Board): Direction[] {
  validateBoardStructure(board);

  const valid: Direction[] = [];
  for (const dir of CORNER_CYCLE_ORDER) {
    if (canMove(board, dir)) {
      valid.push(dir);
    }
  }
  return valid;
}

/**
 * Counts empty (zero-value) cells on a 4x4 board.
 */
export function countEmptyCells(board: Board): number {
  let count = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (board[r][c] === 0) count++;
    }
  }
  return count;
}

/**
 * Finds the highest tile value currently present on the board.
 */
export function getHighestTile(board: Board): number {
  let max = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (board[r][c] > max) max = board[r][c];
    }
  }
  return max;
}

/**
 * Calculates corner magnitude and anchor score.
 * Strongly rewards anchoring the highest tile in the designated anchor corner (bottom-left: row 3, col 0).
 * Penalizes boards where the highest tile is stranded in the interior.
 */
export function calculateCornerScore(board: Board): number {
  const maxTile = getHighestTile(board);
  if (maxTile <= 0) return 0;

  const maxLog = Math.log2(maxTile);
  const anchorVal = board[3][0];

  // Best: highest tile locked securely in primary anchor corner (bottom-left)
  if (anchorVal === maxTile) {
    return maxLog * 2.0;
  }

  // Next best: highest tile in another corner
  if (
    board[0][0] === maxTile ||
    board[0][3] === maxTile ||
    board[3][3] === maxTile
  ) {
    return maxLog * 0.8;
  }

  // Trapped on an edge or interior
  return -maxLog * 1.5;
}

/**
 * Calculates row and column monotonicity.
 * Monotonicity measures whether tile values decrease smoothly along rows towards the left
 * and increase downwards along columns, allowing smooth merges without trapped smaller tiles.
 * Evaluates adjacent non-zero tiles along each line, avoiding distortions from empty cells.
 */
export function calculateMonotonicity(board: Board): number {
  let score = 0;

  // Row monotonicity: prefer values decreasing from left to right (col 0 is larger)
  for (let r = 0; r < 4; r++) {
    const nonZeros: number[] = [];
    for (let c = 0; c < 4; c++) {
      if (board[r][c] > 0) nonZeros.push(board[r][c]);
    }

    if (nonZeros.length > 1) {
      let leftToRightInc = 0;
      let rightToLeftInc = 0;

      for (let i = 0; i < nonZeros.length - 1; i++) {
        const curr = Math.log2(nonZeros[i]);
        const next = Math.log2(nonZeros[i + 1]);
        if (curr > next) {
          rightToLeftInc += curr - next; // Decreases to the right (larger on left)
        } else if (next > curr) {
          leftToRightInc += next - curr; // Increases to the right
        }
      }

      if (r === 3) {
        // Anchor row: strictly reward larger on left, heavily penalize reverse
        score += rightToLeftInc - leftToRightInc * 2;
      } else {
        score +=
          Math.max(rightToLeftInc, leftToRightInc) -
          Math.min(rightToLeftInc, leftToRightInc);
      }
    }
  }

  // Column monotonicity: prefer values increasing from top to bottom (row 3 is larger)
  for (let c = 0; c < 4; c++) {
    const nonZeros: number[] = [];
    for (let r = 0; r < 4; r++) {
      if (board[r][c] > 0) nonZeros.push(board[r][c]);
    }

    if (nonZeros.length > 1) {
      let topToBottomInc = 0;
      let bottomToTopInc = 0;

      for (let i = 0; i < nonZeros.length - 1; i++) {
        const curr = Math.log2(nonZeros[i]);
        const next = Math.log2(nonZeros[i + 1]);
        if (next > curr) {
          topToBottomInc += next - curr; // Increases downwards (larger on bottom)
        } else if (curr > next) {
          bottomToTopInc += curr - next; // Increases upwards
        }
      }

      if (c === 0) {
        // Anchor column: strictly reward larger on bottom, heavily penalize reverse
        score += topToBottomInc - bottomToTopInc * 2;
      } else {
        score +=
          Math.max(topToBottomInc, bottomToTopInc) -
          Math.min(topToBottomInc, bottomToTopInc);
      }
    }
  }

  return score;
}

/**
 * Calculates board smoothness / adjacency merge potential.
 * Rewards adjacent tiles that have identical or close numerical values.
 */
export function calculateSmoothness(board: Board): number {
  let smoothness = 0;

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (board[r][c] > 0) {
        const val = Math.log2(board[r][c]);

        // Horizontal neighbor (right)
        if (c < 3 && board[r][c + 1] > 0) {
          const rightVal = Math.log2(board[r][c + 1]);
          smoothness -= Math.abs(val - rightVal);
          if (val === rightVal) smoothness += 2.0; // Bonus for mergeable pair
        }

        // Vertical neighbor (down)
        if (r < 3 && board[r + 1][c] > 0) {
          const downVal = Math.log2(board[r + 1][c]);
          smoothness -= Math.abs(val - downVal);
          if (val === downVal) smoothness += 2.0; // Bonus for mergeable pair
        }
      }
    }
  }

  return smoothness;
}

/**
 * Heuristic evaluation function: computes a scalar fitness score for a 4x4 board state.
 *
 * Incorporates:
 * - Empty cell count (freedom of movement)
 * - Corner tile magnitude and anchor alignment
 * - Row and column monotonicity
 * - Smoothness / merge potential
 *
 * @param board - 4x4 matrix.
 * @param weights - Heuristic weighting parameters (defaults to DEFAULT_HEURISTIC_WEIGHTS).
 * @returns Numerical fitness score.
 */
export function evaluateBoard(
  board: Board,
  weights: HeuristicWeights = DEFAULT_HEURISTIC_WEIGHTS
): number {
  const emptyCells = countEmptyCells(board);
  const cornerScore = calculateCornerScore(board);
  const monotonicity = calculateMonotonicity(board);
  const smoothness = calculateSmoothness(board);

  return (
    emptyCells * weights.emptyCells +
    cornerScore * weights.cornerMagnitude +
    monotonicity * weights.monotonicity +
    smoothness * weights.smoothness
  );
}

/**
 * Phase 1 Strategy: Corner Priority Cycling.
 *
 * Deterministic cycling through a fixed directional preference hierarchy:
 * ArrowDown -> ArrowLeft -> ArrowRight -> ArrowUp.
 *
 * Selects the highest-priority direction available in validMoves without guessing
 * or trial-and-error keystrokes.
 *
 * @param board - Current 4x4 board.
 * @param validMoves - Precomputed valid directions (if omitted/empty, calculated on the fly).
 * @returns Highest-priority legal Direction.
 */
export const cornerPriorityStrategy: Strategy = (
  board: Board,
  validMoves?: Direction[]
): Direction => {
  const moves =
    validMoves && validMoves.length > 0 ? validMoves : getValidMoves(board);

  if (moves.length === 0) {
    throw new Error(
      'cornerPriorityStrategy: No valid moves available (game over/deadlock).'
    );
  }

  for (const preferred of CORNER_CYCLE_ORDER) {
    if (moves.includes(preferred)) {
      return preferred;
    }
  }

  return moves[0];
};

/**
 * Alias for cornerPriorityStrategy matching common naming conventions.
 */
export const cornerCycleStrategy = cornerPriorityStrategy;

/**
 * Options for lookahead heuristic strategy.
 */
export interface LookaheadOptions {
  /** Search lookahead depth (1 = immediate post-move board; 2 = two-move lookahead). Defaults to 1. */
  depth?: 1 | 2;
  /** Custom heuristic weights */
  weights?: HeuristicWeights;
  /** Discount factor for future lookahead moves (0.0 to 1.0). Defaults to 0.85. */
  discount?: number;
}

/**
 * Creates a configured Lookahead Heuristic Strategy instance.
 */
export function createLookaheadStrategy(options?: LookaheadOptions): Strategy {
  const depth = options?.depth ?? 1;
  const weights = options?.weights ?? DEFAULT_HEURISTIC_WEIGHTS;
  const discount = options?.discount ?? 0.85;

  return (board: Board, validMoves?: Direction[]): Direction => {
    const moves =
      validMoves && validMoves.length > 0 ? validMoves : getValidMoves(board);

    if (moves.length === 0) {
      throw new Error(
        'lookaheadStrategy: No valid moves available (game over/deadlock).'
      );
    }

    if (moves.length === 1) {
      return moves[0];
    }

    let bestMove = moves[0];
    let bestScore = -Infinity;

    for (const dir of moves) {
      const sim1 = simulateMove(board, dir);
      const immediateScore =
        evaluateBoard(sim1.board, weights) +
        sim1.scoreGained * weights.scoreWeight;

      let totalScore = immediateScore;

      if (depth >= 2) {
        const followUpMoves = getValidMoves(sim1.board);
        if (followUpMoves.length > 0) {
          let maxFollowUp = -Infinity;
          for (const nextDir of followUpMoves) {
            const sim2 = simulateMove(sim1.board, nextDir);
            const followUpScore =
              evaluateBoard(sim2.board, weights) +
              sim2.scoreGained * weights.scoreWeight;
            if (followUpScore > maxFollowUp) {
              maxFollowUp = followUpScore;
            }
          }
          totalScore += discount * maxFollowUp;
        }
      }

      // Tie-breaking: preserve corner priority hierarchy on equal scores
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestMove = dir;
      } else if (Math.abs(totalScore - bestScore) < 1e-6) {
        // Tie: prefer higher priority in CORNER_CYCLE_ORDER
        const currentBestIdx = CORNER_CYCLE_ORDER.indexOf(bestMove);
        const candidateIdx = CORNER_CYCLE_ORDER.indexOf(dir);
        if (candidateIdx < currentBestIdx) {
          bestMove = dir;
        }
      }
    }

    return bestMove;
  };
}

/**
 * Phase 2 Strategy: Lookahead Heuristic Strategy (default configuration: depth 1).
 *
 * Pure algorithmic simulation:
 * 1. Simulates valid directional shifts in memory.
 * 2. Evaluates empty cell count, corner tile magnitude, monotonicity, and smoothness.
 * 3. Selects the move yielding the maximum heuristic score.
 */
export const lookaheadHeuristicStrategy: Strategy = createLookaheadStrategy({
  depth: 1,
});

/**
 * Alias for lookaheadHeuristicStrategy.
 */
export const lookaheadStrategy = lookaheadHeuristicStrategy;

/**
 * Available strategy names for configuration and test runners.
 */
export type StrategyName = 'corner' | 'lookahead';

/**
 * Strategy registry mapping strategy names to Strategy implementations.
 */
export const STRATEGIES: Record<StrategyName, Strategy> = {
  corner: cornerPriorityStrategy,
  lookahead: lookaheadHeuristicStrategy,
};

/**
 * Resolves a Strategy implementation by name.
 *
 * @param name - 'corner' or 'lookahead' (case-insensitive).
 * @returns The resolved Strategy function.
 */
export function getStrategy(name: string): Strategy {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    const valid = Object.keys(STRATEGIES).join(', ');
    throw new Error(
      `getStrategy: Strategy name must be a non-empty string. Available strategies: ${valid}`
    );
  }
  const normalized = name.toLowerCase().trim() as StrategyName;
  const strat = STRATEGIES[normalized];
  if (!strat) {
    const valid = Object.keys(STRATEGIES).join(', ');
    throw new Error(
      `getStrategy: Unknown strategy "${name}". Available strategies: ${valid}`
    );
  }
  return strat;
}
