# Playwright Closed-Loop Synchronization & Timing Findings
## Empirical Reference Guide for High-Frequency Browser Automation

---

## 1. Executive Summary & Mission Context

This reference catalog documents the empirical findings, synchronization limits, and architectural failure modes observed while building and benchmarking the **2048 Playwright Bot**.

The project challenged Playwright with an intensive, real-time closed-loop automation workload:
* Operating strictly as an external agent reading live DOM elements and dispatching authentic keyboard inputs (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`).
* Maintaining a continuous cycle of **DOM Read -> Pure Move Validation -> Algorithmic Decision -> Keystroke Dispatch -> State Settling** across hundreds to thousands of moves.
* Zero internal game-engine variable hooks (no access to `window.gameManager`).
* Zero arbitrary sleeps for state synchronization (`page.waitForTimeout()` strictly prohibited; optional `MOVE_DELAY_MS` pacing is used only for human visual observation and set to `0` during benchmarks).
* Zero external computer vision models or AI solvers.

### Primary Insights Summary

| Synchronization Dimension | Observed Reality & Constraint | Architectural Resolution |
| :--- | :--- | :--- |
| **DOM Mutation Timing** | 2048 retains multiple coordinate classes (`tile-position-1-2 tile-position-1-3`) on moving tiles and creates 3 simultaneous DOM elements at a single coordinate during merges. | Multi-class extraction targeting the final position token; merge deduplication schema prioritizing `.tile-merged` and falling back to `Math.max()`. |
| **CDP Roundtrip Overhead** | Querying individual tiles via Playwright `Locator` APIs incurs a **7x to 9.3x latency penalty** (~7.0–8.4ms vs ~0.9–1.0ms) due to repeated Chrome DevTools Protocol serialization hops. | Single batch `page.evaluate()` call that executes inside Chromium's V8 engine and returns the entire serialized board state in <1ms. |
| **Animation Settling** | Fixed timeout sleeps either introduce idle latency or risk race conditions when frame drops occur. Polling via CDP floods the WebSocket pipe. | In-browser `page.waitForFunction()` polling on `requestAnimationFrame` with in-page board differencing, settled by a double `rAF` layout commit barrier. |
| **Headed vs. Headless** | Raw throughput is nearly identical (**19.12 MPS headed vs. 19.35 MPS headless**, ~1.01x speedup). Headless Chromium still synchronizes to a virtual 60Hz compositor clock. | Headless eliminates OS display compositor overhead, reducing frame delta jitter by **8.3x** (0.06ms vs 0.50ms) and stabilizing p90 latency. |
| **Input Queue Saturation** | Dispatching keystrokes before the previous move mutates the board causes 2048's `InputManager` or timing windows to drop/miss updates, creating state desynchronization. | Synchronous state settling barrier enforcing that every keystroke awaits DOM mutation before subsequent moves are evaluated. |
| **Runner Memory Safety** | Recording full Playwright traces or wrapping every move in `test.step()` causes step/snapshot metadata to grow linearly across multi-thousand-move games. | Trace capture disabled (`trace: 'off'`) and `test.step()` throttled to macro milestones (initialization, every 100 moves, final run summary). |

---

## 2. System Architecture & Testing Environment

### Benchmark Hardware & Software Configuration

All empirical metrics and timing distributions were recorded on the following baseline environment:

* **Hardware Platform**: Apple Silicon (`darwin arm64`, 8-core CPU)
* **Runtime**: Node.js `v24.13.0`
* **Test Framework**: `@playwright/test` `^1.65.0`
* **Browser Engine**: Chromium 143+ (Playwright bundled build)
* **Target Application**: Original Gabriele Cirulli DOM 2048 engine ([gabrielecirulli.github.io/2048/](https://gabrielecirulli.github.io/2048/), with `setupGameRouting()` blocking the client-side redirect to `play2048.co` and third-party ad/analytics domains)
* **Active Decision Strategy**: Lookahead Heuristic (smoothness, monotonicity, corner anchoring, empty cell maximization)
* **Visual Pacing**: `MOVE_DELAY_MS=0` (raw browser throughput; defaults to `100` ms during interactive `npm run play` runs)

### Closed-Loop Automation Flow

```text
  ┌───────────────────────────────────────────────────────────────┐
  │                   Host Process (Node.js)                      │
  │                                                               │
  │   ┌──────────────┐     ┌──────────────┐     ┌─────────────┐   │
  │   │ In-Memory    │     │ Deterministic│     │ Authentic   │   │
  │   │ Move Pruning │────▶│ Decision     │────▶│ Keystroke   │   │
  │   │ getValidMoves│     │ Strategy     │     │ Dispatch    │   │
  │   └──────────────┘     └──────────────┘     └──────┬──────┘   │
  │          ▲                                         │          │
  │          │                                         │          │
  │   ┌──────┴───────┐                          CDP    │          │
  │   │ Batch Board  │◀──────────────────────── Protocol│          │
  │   │ Parser       │                    (page.keyboard.press)   │
  │   └──────────────┘                                 │          │
  └──────────▲─────────────────────────────────────────┼──────────┘
             │                                         │
═════════════╪═════════════════════════════════════════╪════════════
             │ WebSocket / CDP Boundary                │
═════════════╪═════════════════════════════════════════╪════════════
  ┌──────────┴─────────────────────────────────────────▼──────────┐
  │                 Target Browser (Chromium V8)                  │
  │                                                               │
  │   ┌───────────────────────────────────────────────────────┐   │
  │   │   In-Browser State Differencing & Settling            │   │
  │   │   page.waitForFunction({ polling: 'raf' })            │   │
  │   │   ├── 1. DOM Tile & Message Differencing              │   │
  │   │   └── 2. Double requestAnimationFrame Settling Barrier│   │
  │   └───────────────────────────────────────────────────────┘   │
  │                               ▲                               │
  │                               │ CSS Transitions & Layout      │
  │   ┌───────────────────────────┴───────────────────────────┐   │
  │   │   Live 2048 DOM Grid (.tile-container, .game-message) │   │
  │   └───────────────────────────────────────────────────────┘   │
  └───────────────────────────────────────────────────────────────┘
```

---

## 3. Animation & DOM Mutation Race Conditions

The Gabriele Cirulli 2048 engine uses CSS3 transforms and dynamic class assignments to animate tile movements and merges. In high-frequency automation, these animations produce several critical DOM timing hazards.

### 3.1. Transient Multi-Class Position Residue

#### Observed Phenomenon
When a tile slides between coordinates (e.g., from column 1, row 2 to column 1, row 3), the engine updates the DOM element's class list by appending the new position class before the CSS transition finishes. During the slide, the element contains both classes:

```html
<div class="tile tile-4 tile-position-1-2 tile-position-1-3">
  <div class="tile-inner">4</div>
</div>
```

#### The Race Condition
A naive selector or regular expression matching the first occurrence of `tile-position-(\d+)-(\d+)` extracts `(col: 1, row: 2)`—the stale starting coordinate. If the bot reads this state, it calculates valid moves based on a phantom board layout.

#### Empirical Resolution
The destination coordinate is **always the final position token** in the class list. By extracting all matches via `matchAll` and reading `matches[matches.length - 1]`, the parser reliably retrieves the true destination coordinate:

```typescript
export function extractDestinationCoordinate(className: string): TileCoordinate | null {
  const matches = Array.from(className.matchAll(/\btile-position-(\d+)-(\d+)\b/g));
  if (matches.length === 0) return null;
  const lastMatch = matches[matches.length - 1];
  return { col: parseInt(lastMatch[1], 10), row: parseInt(lastMatch[2], 10) };
}
```

---

### 3.2. Merge Collisions & Triplicate Elements

#### Observed Phenomenon
When two tiles merge (e.g., two `4` tiles combining into an `8` tile at coordinate `(1, 4)`), the DOM temporarily contains **three distinct elements** mapping to the exact same destination coordinate:

1. `div.tile.tile-4.tile-position-1-3.tile-position-1-4` (Sliding parent 1)
2. `div.tile.tile-4.tile-position-1-4` (Stationary parent 2)
3. `div.tile.tile-8.tile-position-1-4.tile-merged` (Newly spawned merge result)

```text
DOM Snapshot at (1, 4) during merge animation:
├── Element A: [tile-4] (parent entering cell)
├── Element B: [tile-4] (parent previously in cell)
└── Element C: [tile-8, tile-merged] (authoritative merged product)
```

#### The Race Condition
* If a parser reads the first element it finds, it records a `4`.
* If a parser sums all values at that coordinate, it computes `4 + 4 + 8 = 16`.
* If a parser overwrites cells sequentially without priority, the board fluctuates randomly between `4` and `8` depending on DOM node ordering.

#### Empirical Resolution
Authoritative tile selection requires a strict priority hierarchy:
1. **First Priority**: Any tile possessing the `.tile-merged` class.
2. **Tie-Breaker / Fallback**: If multiple tiles have `.tile-merged` (rare engine glitch) or neither has it (two sliding tiles converging on a non-merged cell), select `Math.max(values)`.

```typescript
export function selectAuthoritativeTile(tilesAtCoord: ParsedTile[]): ParsedTile {
  if (tilesAtCoord.length === 1) return tilesAtCoord[0];
  const merged = tilesAtCoord.filter((t) => t.isMerged);
  if (merged.length > 0) {
    return merged.reduce((best, curr) => (curr.value > best.value ? curr : best));
  }
  return tilesAtCoord.reduce((best, curr) => (curr.value > best.value ? curr : best));
}
```

---

### 3.3. Delayed Element Destruction (Ghost Tiles)

#### Observed Phenomenon
Parent tiles consumed in a merge are not removed from the DOM synchronously. The engine relies on a CSS transition timeout (typically 100ms) before invoking `element.remove()`.

#### The Hazard
Querying the DOM by raw tile count (`document.querySelectorAll('.tile').length`) does not correlate with the number of occupied grid cells. A board with 10 occupied cells may contain 14 `.tile` elements in the DOM.

#### Resolution
Never assume a 1:1 mapping between DOM elements and board cells. Parsing must group elements into a coordinate map (`Map<string, ParsedTile[]>`) keyed by `col-row` and project them down onto the 4x4 matrix through the deduplication rule.

---

### 3.4. Transient Score Addition Bubbles

#### Observed Phenomenon
When score points are awarded, the 2048 engine injects a transient container `.score-addition` inside `.score-container` that floats upward and fades out:

```html
<div class="score-container">
  1024
  <div class="score-addition">+16</div>
</div>
```

#### The Hazard
Reading `scoreContainer.textContent` directly produces `"1024+16"`. `parseInt("1024+16", 10)` yields `1024`, but string splitting or text assertions fail unpredictably when multiple additions overlap (e.g. `"1024+16+8"`).

#### Resolution
In the batch evaluate script, clone the score container and purge all `.score-addition` descendants before reading text content:

```javascript
const scoreEl = document.querySelector(sel.scoreContainer);
if (scoreEl) {
  const clone = scoreEl.cloneNode(true);
  clone.querySelectorAll(sel.scoreAddition).forEach((el) => el.remove());
  scoreText = clone.textContent.trim() || '0';
}
```

---

## 4. Playwright Synchronization Boundaries & Closed-Loop Limits

Closed-loop automation differs fundamentally from standard end-to-end testing. While typical E2E tests execute a sequence of distinct actions with human-scale pacing, a game bot executes thousands of rapid cycles where every action depends strictly on the settled result of the previous action.

### 4.1. The Failure of `page.waitForTimeout()` for Synchronization

Using fixed sleep timers for state synchronization (e.g. `await page.waitForTimeout(50)`) represents a major anti-pattern in browser automation (whereas explicit, optional visual pacing delays like `MOVE_DELAY_MS=100` in headed play run *after* DOM settling solely for human observation):

1. **Throughput Destruction**: Adding 50ms of static sleep limits the theoretical maximum throughput to 20 MPS. In practice, with CDP overhead, throughput collapses to 5–8 MPS. Over a 2,000-move game, static sleeps introduce over **100 seconds of pure idle waste**.
2. **Brittleness Under Frame Jitter**: If the browser experiences a garbage collection pause or background CPU spike, an animation may take 65ms instead of 50ms. The sleep expires prematurely, the bot reads an unsettled intermediate state, and the decision algorithm fails.

---

### 4.2. CDP WebSocket Flooding from Host Polling Loops

Attempting to poll DOM states from Node.js via rapid iterations of `page.evaluate()` or locator checks creates severe CDP saturation:

```typescript
// ANTI-PATTERN: Host-side polling loop
while (!hasStateChanged(previousBoard)) {
  currentBoard = await readBoard(page); // Floods CDP with 100+ requests/sec
}
```

* **CDP Queue Saturation**: Each call to `page.evaluate()` serializes arguments, sends a JSON-RPC message over WebSocket, triggers a V8 evaluation in Chromium, serializes the return value, and sends a JSON-RPC response back to Node.js.
* **Elevated Latency**: High-frequency ping-ponging congests the Node.js event loop and Chromium IPC thread, ballooning roundtrip latency from ~40ms to >150ms per move.

---

### 4.3. In-Browser Synchronization via `page.waitForFunction`

The robust architectural solution executes the polling predicate **inside the browser's V8 event loop** (as implemented in `waitForStateSettling()` in `src/sync.ts`), delegating the scheduling to the browser itself:

```typescript
await page.waitForFunction(
  (args) => {
    // 1. Check terminal messages (with double rAF settling)
    if (
      document.querySelector(args.sel.gameOverMessage) ||
      document.querySelector(args.sel.gameWonMessage)
    ) {
      return new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      });
    }
    // 2. Parse .tile-container .tile classes in-page using destination coordinate +
    //    .tile-merged deduplication, and diff against args.previousBoard
    const mutated = hasBoardMutatedInDom(args.previousBoard, args.sel, args.classes);
    if (mutated) {
      // 3. Double rAF layout commit barrier
      return new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      });
    }
    return false;
  },
  { previousBoard, sel: SELECTORS, classes: CLASSES },
  { polling: 'raf', timeout: 5000 }
);
```

*(Note: `src/sync.ts` inlines the DOM tile parser directly inside the `page.waitForFunction` callback so it has zero external helper dependencies inside the browser context.)*

#### Why This Works
1. **Zero CDP Roundtrips During Waiting**: While waiting for the board to change, zero WebSocket messages cross the network boundary. Chromium checks the condition on every animation frame natively.
2. **`polling: 'raf'`**: Aligns checks directly with Chromium's display refresh cycle (16.67ms at 60Hz), eliminating unnecessary CPU spinning between frames.

---

### 4.4. The Double `requestAnimationFrame` Layout Commit Barrier

Why is a single `requestAnimationFrame` insufficient, and what does double `rAF` actually guarantee?

* **Frame 1**: Triggered before the browser completes layout and paint for the upcoming frame after a DOM mutation.
* **Frame 2**: Executes after the layout recalculation and style commit of the first frame have completed. Waiting for the second `rAF` guarantees that the browser has flushed pending DOM class/attribute updates and layout geometry before control returns to Node.js.

Importantly, double `rAF` (~17–33 ms depending on frame phase) does **not** wait for 2048's full 100ms CSS slide/merge transition or delayed parent-element destruction (`element.remove()` at ~100ms) to finish—which is why our benchmark runs achieve ~49ms average roundtrips despite 100ms CSS transitions. Rather, double `rAF` ensures the DOM class updates have committed cleanly, while our parser (`extractDestinationCoordinate` + `selectAuthoritativeTile`) handles any still-animating or ghost DOM nodes deterministically. Across all recorded benchmark runs (574 moves: 391 headed + 183 headless) and integration test runs, this combination produced zero transient-position parsing errors.

---

### 4.5. The Physical Throughput Ceiling

Under authentic closed-loop automation synchronized to `rAF`, cycle latency is governed by frame boundaries:

$$\text{Minimum Cycle Latency} = \Delta t_{\text{dispatch}} + \Delta t_{\text{engine}} + \Delta t_{\text{double-rAF}} + \Delta t_{\text{batch-eval}}$$

* Keystroke dispatch over CDP: ~1–3 ms
* 2048 game engine step & DOM write: ~2–5 ms
* Double `rAF` synchronization at 60Hz:
  * **From an external CDP keypress** (arriving mid-frame): the first `rAF` waits only the remainder of the current frame (`0–16.67 ms`), plus `16.67 ms` for the second `rAF` (`~16.7–33.3 ms`, ~25 ms expected; or ~33.3–50 ms if the engine write misses the current frame deadline).
  * **From inside an active `rAF` callback** (as measured by `measureRenderingPerformance()`): `~33.3 ms` (`2 × 16.67 ms`).
* Batch evaluate state readback: ~1 ms
* **Best-Case Cycle Floor**: $\approx 21\text{ ms to } 36\text{ ms}$ (observed benchmark minimums: **35.54 ms** headed, **36.31 ms** headless), with typical 3-frame closed-loop cycles averaging **49.15–49.65 ms** (~20 MPS).

Our empirical benchmark achieved **19.12 to 19.35 MPS**, matching a steady 3-frame (~50ms) cadence at 60Hz.

---

## 5. Headed vs. Headless Empirical Performance Comparison

A core research question was whether headless Chromium provides substantial speed advantages over headed Chromium for high-speed closed-loop automation.

### 5.1. Comparative Benchmark Dataset

Data captured across complete autonomous runs under identical conditions (`MOVE_DELAY_MS=0`, Lookahead Strategy, Darwin arm64):

| Metric | Headed Chromium | Headless Chromium | Delta / Ratio | Empirical Takeaway |
| :--- | :--- | :--- | :--- | :--- |
| **Total Moves Analyzed** | 391 moves | 183 moves | — | Full game runs to game-over |
| **Throughput (MPS)** | **19.12 MPS** | **19.35 MPS** | **+0.23 MPS (1.01x)** | Headless is essentially identical in raw throughput |
| **Average Move Latency** | **49.65 ms** | **49.15 ms** | **-0.50 ms** | Only 0.5ms difference in mean roundtrip |
| **Median Latency (p50)** | **48.19 ms** | **48.03 ms** | **-0.16 ms** | Identical median performance |
| **90th Percentile (p90)** | **63.32 ms** | **53.04 ms** | **-10.28 ms** | Headless exhibits significantly tighter upper bound |
| **95th Percentile (p95)** | **65.15 ms** | **65.03 ms** | **-0.12 ms** | Outliers converge at ~65ms (4 frames) |
| **Latency Std Deviation** | **5.82 ms** | **6.07 ms** | +0.25 ms | Comparable statistical dispersion |
| **Compositor Frame Rate**| **60.0 FPS** | **60.0 FPS** | 0.0 FPS | Both lock to 60Hz compositor schedule |
| **Frame Delta Jitter** | **0.50 ms** | **0.06 ms** | **-0.44 ms (8.3x less)**| Headless frame clock is extraordinarily steady |
| **Double-rAF Settling** | **33.33 ms** | **33.28 ms** | -0.05 ms | Matches exact 2-frame interval ($2 \times 16.67\text{ms}$) |

---

### 5.2. Analysis of the Headed vs. Headless Discrepancy

#### 1. Why Headless Is Not 10x Faster
Many engineers assume headless browser execution will run orders of magnitude faster than headed mode. In closed-loop DOM automation, this assumption is false.
Chromium in headless mode retains its internal rendering pipeline:
* `requestAnimationFrame` continues to fire at standard display intervals (~16.66ms / 60Hz).
* CSS animations and transitions are driven by this internal compositor timer.
* Because state synchronization relies on authentic CSS transition settling and double `rAF`, the bot cannot advance faster than Chromium's internal clock.

#### 2. The Real Benefit: Jitter Reduction
While mean throughput is nearly identical (19.12 vs 19.35 MPS), headless execution provides superior timing consistency:
* **Frame Jitter**: Headed Chromium experiences 0.50ms of frame delta jitter due to OS window compositing, retina scaling, and display V-Sync interrupts. Headless Chromium operates with an isolated software compositor, dropping jitter to **0.06ms (an 8.3x stability improvement)**.
* **p90 Tail Latency**: Headless mode reduces 90th percentile latency by over **10ms** (53.04ms vs 63.32ms), eliminating frame hitching caused by OS window server contention.

---

## 6. DOM Query Overhead: Locators vs. Batch `evaluate()`

Playwright's modern documentation strongly encourages the use of `Locator` objects (`page.locator('.tile')`, `getByRole()`). While locators are superior for standard asynchronous assertion-driven end-to-end tests, they introduce crippling overhead in high-frequency closed-loop loops.

### 6.1. Empirical Overhead Measurements

We benchmarked reading the active board state via individual `Locator` element queries against a single batch `page.evaluate()` call across 15 iterations per browser mode (30 total trials across headed and headless):

| Browser Mode | Single Batch `page.evaluate()` | Playwright `Locator` Queries | Overhead Ratio |
| :--- | :--- | :--- | :--- |
| **Headed Mode** | **0.90 ms** | **8.36 ms** | **9.32x slower** |
| **Headless Mode** | **0.99 ms** | **6.97 ms** | **7.01x slower** |
| **Aggregate Mean**| **~0.95 ms** | **~7.67 ms** | **8.16x slower** |

```text
Latency Comparison for Reading 4x4 Grid State:
Batch evaluate():  ██ (0.95 ms)
Locator queries:   ████████████████ (7.67 ms) — 8.16x Overhead Penalty
```

---

### 6.2. Why Locators Incur Severe Closed-Loop Penalties

#### 1. Multiple CDP Roundtrips
* **Batch `evaluate()`**: Sends 1 JSON-RPC command (`Runtime.evaluate`). Chromium executes a single querySelectorAll loop in V8, packages the raw classes and text into a lightweight JSON payload, and returns it over the WebSocket in **1 network roundtrip**.
* **Locators**: Calling `locator.all()` followed by inspecting each element's class list and text content requires:
  1. `DOM.querySelectorAll` to find element handles.
  2. Individual `DOM.getAttribute` or `DOM.getBoxModel` calls per element handle.
  3. Serialization and garbage collection of 16+ remote `ElementHandle` references across the CDP bridge.

#### 2. Closed-Loop Budget Impact
In a closed loop targeting 20 MPS, the total cycle budget is **50ms**:
* If reading the board takes **0.95ms**, DOM parsing consumes **1.9%** of the frame budget.
* If reading the board takes **7.67ms**, DOM parsing consumes **15.3%** of the frame budget.
* Over a 3,000-move game, using Locators injects **20.1 seconds of pure CDP communication overhead**.

#### 3. Architectural Recommendation
* **Use Locators For**: Single-element user interactions, navigation, actionability checks, and standard UI test assertions (`expect(btn).toBeVisible()`).
* **Use Batch `evaluate()` For**: Real-time state extraction, bulk grid/table parsing, canvas/game reading, and closed-loop feedback loops where sub-millisecond execution is mandatory.

---

## 7. Input Throttling & Keystroke Queue Saturation

Dispatching keyboard events via Playwright's `page.keyboard.press()` interacts with Chromium's native input pipeline. High-speed testing revealed several critical input constraints.

### 7.1. Event Queue Flooding vs. Game Engine Rejection

In early bot iterations without strict settling barriers, directional keystrokes were dispatched at maximum speed (over 50 keystrokes/sec). This exposed a failure mode in the target application:

1. **Input Dropping in 2048**: The 2048 `InputManager` listens for `keydown` events. If a keypress is received while a previous move's sliding animation is active, the game engine drops the input.
2. **State Divergence**: The host process believes it sent `ArrowDown` and calculates that the board must have shifted down. However, the browser dropped the event. The bot then attempts subsequent moves based on an invalid mental model, triggering timeout exceptions or infinite move loops.

#### Architectural Rule
Never implement "fire-and-forget" input dispatch in game automation. **Every keystroke must be paired with an explicit mutation settling barrier.**

---

### 7.2. OS Window Focus & Background Tab Throttling

When running in headed mode, OS-level window interactions can silently disrupt keyboard event delivery:

1. **Focus Loss**: If the user clicks into another application during a headed run, Chromium loses OS window focus.
2. **Keystroke Deflection**: While Playwright dispatches input events at the CDP level (`Input.dispatchKeyEvent`), Chromium's internal event dispatcher may refuse to route keys to `document.body` if focus is blurred or trapped in an unrelated element.
3. **Timer Throttling**: Backgrounded browser tabs are throttled by Chromium's power management, dropping `requestAnimationFrame` from 60Hz to 1Hz (1 tick per second).

#### Defensive Focus Maintenance Pattern
To guarantee long-running stability (e.g. 3,000+ continuous moves), the bot must periodically enforce window and container focus:

```typescript
export async function ensureActiveFocus(page: Page): Promise<void> {
  await page.bringToFront().catch(() => {});
  await page.evaluate(() => {
    window.focus();
    if (document.activeElement && document.activeElement !== document.body) {
      (document.activeElement as HTMLElement).blur?.();
    }
  }).catch(() => {});
  await page.locator('.game-container').focus().catch(() => {});
}
```

Running this routine during session initialization and defensively every 25 moves prevented all occurrences of focus-related input dropping.

---

## 8. Memory Management & Playwright Trace Safety

Playwright includes powerful tracing capabilities (`trace: 'on'`, `test.step()`) that record screenshots, DOM snapshots, and action metadata for post-mortem debugging. In high-frequency automation, tracing becomes a critical failure vector.

### 8.1. Trace Buffer Growth in High-Cycle Automations

When running a 2048 game to completion or up to the `MAX_MOVES = 3000` safety cap, the bot executes hundreds to thousands of move cycles:

```text
Action Count in Standard E2E Test vs. Closed-Loop Bot:
Standard E2E Test:   10 – 50 actions
Closed-Loop Bot:     Up to 3,000 moves × multiple Playwright calls/move -> ~10,000+ actions
```

#### The Hazard
If Playwright tracing is enabled (`trace: 'on'`) or the test wraps every individual move in `test.step('Move X: ArrowDown', ...)`:
* Playwright accumulates step entries, serialized action metadata, and (when tracing is enabled) DOM snapshots/screenshots in memory for every step/action.
* Memory consumption grows linearly with move count over multi-thousand-move sessions, risking trace buffer bloat and Node.js heap pressure.

---

### 8.2. Macro Milestone Throttling Pattern

To keep Playwright runner overhead bounded across 3,000+ move runs without disabling high-level observability:
1. Disable Playwright trace recording in `playwright.config.ts` (`trace: 'off'`).
2. Throttle `test.step()` to **macro milestones** (every 100 moves in full play, as configured in `tests/bot-2048.spec.ts`), while streaming lightweight single-line telemetry directly to `stdout`:

```typescript
// ANTI-PATTERN: Wrapping every move
for (let move = 0; move < maxMoves; move++) {
  await test.step(`Move ${move}`, async () => { /* Accumulates per-move step metadata */ });
}

// RECOMMENDED PATTERN: Macro milestone throttling (tests/bot-2048.spec.ts)
if (moveCount % 100 === 0) {
  await test.step(`Macro Milestone: Move ${moveCount} (Score: ${score}, Highest: ${highestTile})`, async () => {
    console.log(formatMilestoneBanner(milestone));
  });
}
```

#### Verified Safeguards
* **Playwright Config (`playwright.config.ts`)**: `timeout: 0`, `trace: 'off'`.
* **Macro Throttling (`tests/bot-2048.spec.ts`)**: `milestoneInterval = isFullPlay ? 100 : 10` (caps `test.step()` calls to <=30 across a 3,000-move run).
* **Bounded Heap Growth (`tests/acceptance.spec.ts`)**: Verified `< 64 MB` steady-state Node.js heap growth between consecutive 3,200+ move `runBot()` passes (6,400+ total moves with per-move telemetry formatting and 100-move milestone callbacks).

---

## 9. Actionable Design Patterns & Anti-Patterns

Based on the empirical findings cataloged above, this section provides an actionable design guide for engineering fast, closed-loop browser automation.

### Patterns & Anti-Patterns Reference

| Category | Anti-Pattern (Do NOT Do) | Recommended Design Pattern (DO) | Rationale |
| :--- | :--- | :--- | :--- |
| **Waiting** | `await page.waitForTimeout(100)` for sync | `await page.waitForFunction(predicate, args, { polling: 'raf' })` | Eliminates idle sync latency waste; adapts dynamically to actual browser render speed. |
| **Settling** | Single `requestAnimationFrame` check | Double `requestAnimationFrame` commit barrier | Guarantees DOM class updates and layout calculations have committed for paint before readback. |
| **DOM Queries** | Looping over individual `page.locator()` elements in closed loops | Single batch `page.evaluate()` returning a serialized plain object | Avoids 7x–9x CDP roundtrip latency penalty; executes state parsing in <1ms. |
| **Coord Extraction** | Matching first occurrence of coordinate class (`tile-position-(\d+)-(\d+)`) | Extracting all position matches and selecting the **last** match | Captures final destination coordinate, ignoring transient departure classes. |
| **Merge Detection** | Summing all DOM tiles at a coordinate or reading first element | Prioritizing `.tile-merged` and breaking ties with `Math.max()` | Resolves the 3-element merge collision state deterministically. |
| **Move Validation** | Trial-and-error keystrokes against the browser | Pure in-memory move simulator (`getValidMoves(board)`) | Eliminates blocked keystrokes; guarantees 100% of dispatched moves cause board mutations. |
| **Session State** | Reusing browser storage across test executions | Explicit storage isolation (`clearLocalStorageAndCookies`) | Prevents loading stale game-over states or dirty boards on test startup. |
| **Focus Handling** | Assuming headless/headed tab always retains focus | Periodic `ensureActiveFocus()` and modal clearance | Prevents OS-level keystroke drops and background tab rAF throttling. |
| **Tracing** | Calling `test.step()` for every single micro-action in long loops | Throttling `test.step()` to macro milestones (every 100 moves) | Prevents fatal Playwright trace buffer exhaustion and Node.js V8 heap OOM crashes. |
| **Termination** | Single `while(true)` loop relying solely on browser game-over modal | Triple Safety Guards: (1) Win, (2) Loss/Deadlock, (3) Move Cap | Guarantees the automation loop always halts cleanly under any unexpected condition. |

---

## 10. Conclusion & Architectural Takeaways

1. **Playwright is Exceptionally Capable for High-Frequency Automation**: When architected correctly, Playwright operates at **19+ moves per second** in standard Chromium, hovering near the theoretical ceiling imposed by the 60Hz display refresh cycle.
2. **The Bottleneck is Almost Never V8 Execution**: JavaScript execution inside the browser (`page.evaluate()`) takes <1ms. The primary sources of latency are **CDP communication roundtrips** and **waiting for CSS transition animations**.
3. **Headless Mode Yields Predictability, Not Raw Speed**: Headless Chromium runs at the same 60Hz compositor rate as headed Chromium, but it eliminates display server jitter (0.06ms vs 0.50ms), producing highly consistent, reproducible automation timing.
4. **Closed-Loop Demands In-Browser Differencing**: Moving state-differencing predicates inside Chromium via `page.waitForFunction()` is the single most impactful architectural decision for high-speed automation, eliminating CDP queue congestion and ensuring rock-solid synchronization.
