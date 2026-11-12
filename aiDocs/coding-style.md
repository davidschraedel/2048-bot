# Engineering Conventions & Coding Style

Standards and conventions for the **2048 Playwright Bot** codebase.

---

## 1. Environment & Stack
- **Language & Runtime**: TypeScript running under `@playwright/test` on Chromium.
- **Target Application**: Original DOM-based public 2048 instance ([classic.play2048.co](https://classic.play2048.co/)); no accounts, credentials, or sessions required.

---

## 2. Modularity & Architecture
- **Strategy Decoupling**: Keep move decision logic isolated from DOM actions so heuristic/algorithmic strategies can be swapped without touching page interactions.
- **Pure Board Representation**: Keep board reading logic pure and unit-testable, parsing DOM state into a clean 4x4 matrix (`number[4][4]`) where `0` represents an empty tile.

---

## 3. Playwright Patterns
- **Structured Steps**: Use `test.step()` to wrap high-level phases (e.g., read board, evaluate move, dispatch key).
- **Direct Keystrokes**: Use `page.keyboard.press()` for directional inputs (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`).
- **No Arbitrary Sleeps**: Rely on observable DOM state changes and transition settling instead of fixed `page.waitForTimeout()` delays.

---

## 4. Error Handling & State Safety
- **Fail Fast**: Halt immediately if required configuration (e.g., `GAME_URL` in `.env`) is missing.
- **No Silent Failures**: Avoid blank `try/catch` blocks around browser interactions; allow Playwright assertions and timeouts to surface genuine failures.
