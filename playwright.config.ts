import { defineConfig, devices } from '@playwright/test';
import { GAME_URL } from './src/config';

/**
 * Playwright Test Configuration for 2048 Autonomous Bot.
 *
 * Aligned with the Steering Ladder and Project Plan:
 * - Timeout set to 0 (disabled) to allow uninterrupted, long-running game sessions.
 * - Targets Chromium exclusively.
 * - Fast-fails on startup via GAME_URL validation from src/config.
 */
export default defineConfig({
  testDir: './tests',

  /* Autonomous bot runs sequentially */
  fullyParallel: false,
  workers: 1,

  /* Disable test execution timeout (0) to permit long-running bot sessions */
  timeout: 0,

  /* Fail build on CI if test.only is left in source */
  forbidOnly: !!process.env.CI,

  /* Retries disabled for deterministic autonomous runs */
  retries: 0,

  /* Reporters: 'list' for live console output and 'html' for summary reports */
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  use: {
    /* Base target URL validated from .env */
    baseURL: GAME_URL,

    /* Default headless, can be run headed with --headed flag */
    headless: true,

    /* Trace recorded only on retry if retries ever enabled, preventing buffer memory bloat */
    trace: 'off',

    /* Standard action timeout */
    actionTimeout: 10000,
  },

  /* Chromium project configuration */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
});
