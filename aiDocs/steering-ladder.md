# 2048 Playwright Bot — Steering Ladder

---

## 1. Problem
An engineer demonstrating deterministic Playwright automation and state synchronization lacks empirical insight into how effective Playwright is for rapid, closed-loop UI automation and what specific failure modes emerge under real-time DOM mutations. Without a dedicated, interactive testbed, there is no documented evidence or catalog of timing and synchronization pitfalls to inform future automation projects.

## 2. Vision
The engineer has clear, evidence-based insight into Playwright's capabilities and limits in fast-cycle, closed-loop browser automation, demonstrated by a bot that plays 2048 autonomously and deterministically without AI or human intervention. A well-documented catalog of observed edge cases, timing bottlenecks, and synchronization patterns exists to directly de-risk and inform future automation projects.

## 3. Mission
We build an autonomous, deterministic 2048 bot using Playwright and TypeScript that continuously reads the live DOM board state and dispatches directional keystrokes without AI or external solvers. In doing so, we stress-test and document Playwright's synchronization limits, animation handling, and failure modes to produce an empirical reference guide for future browser automation systems.

## 4. Strategy (Guiding Policy / claude.md)
We operate strictly as an external user via deterministic Playwright automation, parsing live DOM elements into a 4x4 matrix and dispatching keyboard events guided by algorithmic decision rules and hard loop termination guards. We explicitly reject AI models, computer-vision solvers, internal game-engine JavaScript injection, and arbitrary sleep timers, requiring all synchronization to be solved through authentic DOM state transitions. Every animation race condition, timing bottleneck, or Playwright constraint encountered is systematically surfaced and logged as an architectural finding rather than bypassed with fragile workarounds.

## 5. Plan
1. Set up the TypeScript and Playwright environment, map live 2048 DOM selectors, and construct an animation-tolerant parser that translates active tile elements into a clean 4x4 matrix.
2. Implement pure directional move strategies, keystroke dispatch, and an automated game loop with state-change verification and triple termination guards (win, loss, move cap).
3. Run execution benchmarks in both headed and headless modes to capture performance metrics and compile an empirical findings document detailing observed Playwright synchronization quirks, bottlenecks, and design recommendations.

## 6. State
The project is currently at the architectural specification phase with an active git repository on branch `dev` and design blueprints in place ([README.md](../README.md), [aiDocs/context.md](./context.md), and [ai/2026-11-09_v1_plan.md](../ai/2026-11-09_v1_plan.md)). Based on repository inspection, no `package.json`, Playwright configuration, DOM parser, or test specs have been implemented yet. All implementation milestones in the Plan remain unexecuted (Step 0 of 3).

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
        ||  "Blueprints are on the table, but the robot   ||
        ||   pieces haven't been put together yet!"       ||
        ||================================================||
```

