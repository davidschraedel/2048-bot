# 2048 Playwright Bot

An automated bot designed to play the web version of [2048](https://play2048.co/) dynamically using [Playwright](https://playwright.dev/), without LLMs, external solvers, or human intervention.

---

## Goal

Practice end-to-end browser automation and state-driven decision loops. The script launches a browser, observes the board state in the DOM, chooses a move according to a deterministic strategy, sends arrow keystrokes, and repeats until the game ends or a safety limit is reached.

---

## How It Works

The bot operates on a simple feedback loop:

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Read Board     │ ───> │   Pick Move     │ ───> │  Press Arrow    │
│  from Live DOM  │      │   (Strategy)    │      │  (Playwright)   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
        ▲                                                  │
        └───────────── Wait for animations / ──────────────┘
                       Check stop conditions
```

1. **Observe**: Inspect DOM tile elements to parse current 4x4 grid values and positions.
2. **Decide**: Pass board state to a strategy function to pick the next direction (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`).
3. **Act**: Dispatch keypress via `page.keyboard.press()`.
4. **Evaluate & Loop**:
   - Re-check board state.
   - If move resulted in no change, try an alternate direction.
   - Detect game win (`.game-won`), game over (`.game-over`), or maximum move cap.

---

## Move Strategies

- **Phase 1 (Corner / Priority Cycling)**:
  - Prioritize `Down` and `Left` to keep higher-value tiles clustered in a corner.
  - Fall back to `Right` when locked. Avoid `Up` unless no other move is valid.
- **Phase 2 (Optional Lookahead / Heuristics)**:
  - Simulate possible board outcomes.
  - Score moves based on empty cell count, corner tile weight, and monotonicity.

---

## Stack & Setup

- **Language & Runner**: TypeScript, `@playwright/test` (Chromium)
- **Configuration**: Target URL configured via `.env` (`GAME_URL`)

### Running the Bot

```bash
# Watch the bot play to completion in a real browser window
npm run play

# Or directly with Playwright:
npx playwright test tests/bot-2048.spec.ts --headed
```