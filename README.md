# 2048 Playwright Bot

An automated bot that plays the original DOM-based web version of [2048](https://classic.play2048.co/) dynamically using [Playwright](https://playwright.dev/) and TypeScript, without LLMs, external solvers, or human intervention.

---

## Goal

Practice and benchmark deterministic, closed-loop browser automation. The bot launches Chromium, reads the live DOM board, prunes illegal moves in memory, picks a direction, sends arrow keystrokes, waits for the DOM and animations to settle, and repeats until the game ends or a safety cap is reached.

---

## How It Works

The bot operates on a closed feedback loop:

```text
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Read Board     │ ───> │  Prune & Pick   │ ───> │  Press Arrow    │
│  from Live DOM  │      │  Valid Move     │      │  (Playwright)   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
        ▲                                                  │
        └───────────── Wait for rAF settle / ──────────────┘
                       Check stop guards
```

1. **Observe**: Batch-read the 4x4 grid, score, and game status from the live DOM via `page.evaluate()`.
2. **Prune & Decide**: Filter out blocked directions in memory (`getValidMoves`) and select a legal move (`ArrowDown`, `ArrowLeft`, `ArrowRight`, `ArrowUp`).
3. **Act**: Dispatch an authentic keypress via `page.keyboard.press()`.
4. **Sync & Guard**: Wait for DOM mutation and double-`requestAnimationFrame` settling (no `waitForTimeout()` sleeps), stopping on win (`.game-won`), loss/deadlock (`.game-over` or no legal moves), or `MAX_MOVES`.

---

## Move Strategies

Select via `STRATEGY` in `.env` (defaults to `lookahead`):

- **`lookahead` (Default)**: Simulates legal moves in memory and scores outcomes on empty cells, bottom-left corner anchoring, monotonicity, and smoothness.
- **`corner`**: Cycles through `Down -> Left -> Right -> Up` to keep high-value tiles anchored in the bottom-left corner.

---

## Stack & Setup

- **Language & Runner**: TypeScript, `@playwright/test` (Chromium)
- **Configuration**: Copy `.env.example` to `.env` (`GAME_URL` required; optional `STRATEGY`, `MAX_MOVES`, `MOVE_DELAY_MS`)

```bash
# Watch the bot play to completion in a real browser window
npm run play

# Run the test suite (110 tests across 8 files)
npm test

# Run headed vs. headless comparative benchmarks
npm run benchmark
```

---

## Documentation & Empirical Findings

- [Steering Ladder](aiDocs/steering-ladder.md) — Strategic alignment, mission, and progress state.
- [Playwright Synchronization Findings](aiDocs/playwright-synchronization-findings.md) — Empirical research guide on closed-loop DOM synchronization, animation race conditions, and performance benchmarks.
- [Engineering Conventions & Coding Style](aiDocs/coding-style.md) — Architecture and Playwright conventions.
- [Implementation Roadmap](ai/roadmaps/2026-11-09_v1_roadmap.md) — Phase-by-phase execution tracking.
