# 2048 Playwright Bot — Steering Ladder

---

## 1. Problem
An engineer demonstrating deterministic Playwright automation and state synchronization lacks empirical insight into how effective Playwright is for rapid, closed-loop UI automation and what specific failure modes emerge under real-time DOM mutations. Without a dedicated, interactive testbed, there is no documented evidence or catalog of timing and synchronization pitfalls to inform future automation projects.

## 2. Vision
The engineer has clear, evidence-based insight into Playwright's capabilities and limits in fast-cycle, closed-loop browser automation, demonstrated by a bot that plays 2048 autonomously and deterministically without AI or human intervention. A well-documented catalog of observed edge cases, timing bottlenecks, and synchronization patterns exists to directly de-risk and inform future automation projects. The solution is simple and straightforward.

## 3. Mission
We build an autonomous, deterministic 2048 bot using Playwright and TypeScript that continuously reads the live DOM board state and dispatches directional keystrokes without AI or external solvers. In doing so, we stress-test and document Playwright's synchronization limits, animation handling, and failure modes to produce an empirical reference guide for future browser automation systems.

## 4. Strategy (Guiding Policy / claude.md)
We operate strictly as an external user via deterministic Playwright automation, parsing live DOM elements into a 4x4 matrix and dispatching keyboard events guided by algorithmic decision rules and hard loop termination guards. We explicitly reject AI models, computer-vision solvers, internal game-engine JavaScript injection, and arbitrary sleep timers, requiring all synchronization to be solved through authentic DOM state transitions. Every animation race condition, timing bottleneck, or Playwright constraint encountered is systematically surfaced and logged as an architectural finding rather than bypassed with fragile workarounds.

## 5. Plan
1. Set up the TypeScript and Playwright environment, map live 2048 DOM selectors, and construct an animation-tolerant parser that translates active tile elements into a clean 4x4 matrix.
2. Implement in-memory move validation, pure directional strategies, keystroke dispatch, and an automated game loop with in-browser animation settling and triple termination guards (win, loss, move cap).
3. Run execution benchmarks in both headed and headless modes to capture performance metrics and compile an empirical findings document detailing observed Playwright synchronization quirks, bottlenecks, and design recommendations.

## 6. State
All 10 phases of the implementation roadmap ([ai/roadmaps/2026-11-09_v1_roadmap.md](../ai/roadmaps/2026-11-09_v1_roadmap.md)) are fully implemented, verified, and audited:
1. **Phase 1 (Environment & Project Setup)**: Complete (`package.json`, `playwright.config.ts`, `tsconfig.json`, `.env`, `src/storage.ts`).
2. **Phase 2 (DOM Inspection & Selector Mapping)**: Complete (`src/selectors.ts`, destination coordinate resolution, merge deduplication schema).
3. **Phase 3 (Board State Representation & Parser)**: Complete (`src/board.ts`, `tests/board.spec.ts`).
4. **Phase 4 (Keypress Dispatch & State Synchronization)**: Complete (`src/input.ts`, `src/sync.ts`, `tests/sync.spec.ts` with zero arbitrary timeouts, double `rAF` settling, latency measurement/logging, and defensive input guards).
5. **Phase 5 (Deterministic Decision Strategies)**: Complete (`src/strategy.ts`, `tests/strategy.spec.ts` with pure in-memory move validator `getValidMoves`, Phase 1 Corner Priority Cycling, Phase 2 Lookahead Heuristic, strategy registry, and 100% test coverage).
6. **Phase 6 (Core Automation Loop & Triple Termination Safety)**: Complete (`src/config.ts`, `src/bot.ts`, `tests/bot-2048.spec.ts`, `tests/guards.spec.ts`, `npm run play` with pristine session setup, triple termination safety guards [Win, Loss/Deadlock, Move Cap], visual pacing, post-game inspection, and end-to-end autonomous loop).
7. **Phase 7 (Observability, Metrics & Telemetry)**: Complete (`src/telemetry.ts`, `tests/telemetry.spec.ts`, `tests/bot-2048.spec.ts` with macro milestone `test.step()` trace memory throttling, live CLI status line with sync latency, comprehensive ASCII board run summary, throughput [MPS] metrics, explicit termination reasons, and automatic board screenshot persistence to `test-results/final-run.png`).
8. **Phase 8 (Execution Benchmarking: Headed vs. Headless)**: Complete (`src/benchmark.ts`, `tests/benchmark.spec.ts`, `test-results/benchmark-data.json`, `test-results/benchmark-history.jsonl`, `package.json` benchmark scripts `test:headed`, `test:headless`, `benchmark`, `benchmark:headed`, `benchmark:headless` with `MOVE_DELAY_MS=0` raw pacing, average move-to-mutation latency percentiles, 6x-10x locator vs. batch `evaluate()` overhead measurement, 60fps rendering frame rate and double-rAF delay sampling, and benchmark milestone tracking for 128, 256, and 512 tiles).
9. **Phase 9 (Empirical Findings Catalog & Reference Guide)**: Complete (`aiDocs/playwright-synchronization-findings.md` authoring complete; documents transient multi-class and merge triplicate race conditions, CDP roundtrip penalties with 8.16x batch `evaluate()` efficiency gain, 19.12 vs 19.35 MPS comparative headless parity with 8.3x frame jitter stability, double-rAF layout settling barriers, input throttling queue saturation, macro milestone trace memory safety, and actionable design patterns vs anti-patterns).
10. **Phase 10 (Acceptance Verification & Final Audit)**: Complete (`tests/acceptance.spec.ts` verifies Steering Ladder alignment, zero-sleep synchronization, zero-waste move legality, zero JS cheating, zero AI/external solvers, triple termination guards, clean session state, 3,000+ move memory safety, recorded headed/headless benchmarks, finalized empirical findings guide, and Phase 1 [128+, max 256] / Phase 2 [256/512+, max 1024] strategy performance).

Current milestone: **Milestone Complete (Phases 1–10)**. All 110 unit, algorithmic, browser synchronization, guard, telemetry, benchmark, and acceptance audit tests pass.

---

## Understanding Test (5-Year-Old Ladder Diagram)

```text
        ||================================================||
        ||  1. PROBLEM                                    ||
        ||  "Can our robot hands play the block game      ||
        ||   fast without getting confused?"              ||
        ||================================================||
        ||                       ||                       ||
        ||================================================||
        ||  2. VISION                                     ||
        ||  "A cool robot playing on its own, and a       ||
        ||   guidebook teaching us how to build more!"    ||
        ||================================================||
        ||                       ||                       ||
        ||================================================||
        ||  3. MISSION                                    ||
        ||  "Build the robot with real keys and eyes,     ||
        ||   and write down every trick and bump it hits."||
        ||================================================||
        ||                       ||                       ||
        ||================================================||
        ||  4. STRATEGY                                   ||
        ||  "Use real eyes on screen and real taps on     ||
        ||   keys! NO cheating, NO peeking in the code!"  ||
        ||================================================||
        ||                       ||                       ||
        ||================================================||
        ||  5. PLAN                                       ||
        ||  "1. Teach eyes.  2. Teach finger taps.        ||
        ||   3. Watch it play & write the guidebook."     ||
        ||================================================||
        ||                       ||                       ||
        ||================================================||
        ||  6. STATE                                      ||
        ||  "Graduation checkup passed! All 110 tests     ||
        ||   say our robot uses real eyes, real keys,     ||
        ||   zero sleeps, zero cheating, and hits big     ||
        ||   blocks (256/512/1024) smoothly!"             ||
        ||================================================||
```


