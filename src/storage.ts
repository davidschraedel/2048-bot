import { Page } from '@playwright/test';

/**
 * Neutralizes the commercial canvas redirect on gabrielecirulli.github.io
 * and blocks slow third-party ad network scripts.
 *
 * This guarantees the clean, original DOM-based 2048 game loads directly.
 *
 * @param page - Active Playwright Page instance.
 */
export async function setupGameRouting(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = route.request().url();

    // Abort commercial canvas redirect destination
    if (url.includes('play2048.co')) {
      return route.abort();
    }

    // Block third-party ad/analytics domains for speed and stability
    if (
      url.includes('google-analytics') ||
      url.includes('googletagmanager') ||
      url.includes('pagead2') ||
      url.includes('doubleclick') ||
      url.includes('twitter.com')
    ) {
      return route.abort();
    }

    // Only intercept HTML document responses to strip the inline redirect
    if (
      route.request().resourceType() === 'document' &&
      url.includes('gabrielecirulli.github.io/2048')
    ) {
      try {
        const response = await route.fetch();
        let body = await response.text();
        // Replace play2048 redirect target and disable hostname check
        body = body.replace(/play2048\.co/g, 'localhost');
        body = body.replace(
          /window\.location\.hostname\s*===\s*["']gabrielecirulli\.github\.io["']/g,
          'false'
        );
        return route.fulfill({ response, body });
      } catch {
        return route.continue();
      }
    }

    return route.continue();
  });
}

/**
 * Storage isolation helper that clears localStorage, sessionStorage, and cookies.
 * Ensures tests run in a pristine environment and prevents loading stale 2048
 * game sessions, previous high scores, or partially completed boards.
 *
 * @param page - Active Playwright Page instance.
 */
export async function clearLocalStorageAndCookies(page: Page): Promise<void> {
  // Clear all browser cookies across the current context
  await page.context().clearCookies();

  // Clear web storage if the page is currently on an active origin
  try {
    await page.evaluate(() => {
      try {
        if (typeof window !== 'undefined') {
          window.localStorage?.clear();
          window.sessionStorage?.clear();
        }
      } catch {
        // Catch SecurityError when document origin is about:blank or opaque
      }
    });
  } catch {
    // Ignore execution context destruction or pre-navigation evaluate errors
  }
}

/**
 * Navigates to the specified game URL and guarantees a pristine board session
 * by installing routing guards, clearing all storage/cookies, and reloading.
 *
 * @param page - Active Playwright Page instance.
 * @param gameUrl - Target 2048 game URL.
 */
export async function initCleanSession(page: Page, gameUrl: string): Promise<void> {
  await setupGameRouting(page);
  await page.goto(gameUrl);
  await clearLocalStorageAndCookies(page);
  // Reload to ensure 2048 game manager boots from zeroed storage
  await page.reload();
}
