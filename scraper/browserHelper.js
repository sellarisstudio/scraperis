const { chromium } = require('playwright');
const path = require('path');

/**
 * Launch a unified Playwright BrowserContext, either persistent (retaining cache/cookies/sessions)
 * or ephemeral, with automatic failover fallback if profile directories are locked by concurrent runs.
 */
async function launchBrowserContext(options = {}) {
  const {
    headless = true,
    usePersistent = false,
    jobId = '',
    userAgent,
    viewport,
    locale,
    ignoreHTTPSErrors = true,
    geolocation,
    permissions
  } = options;

  const launchOptions = {
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
    // Options consumed by launchPersistentContext or fallback newContext
    userAgent,
    viewport,
    locale,
    ignoreHTTPSErrors,
    geolocation,
    permissions
  };

  const channels = ['chrome', 'msedge'];

  if (usePersistent) {
    const mainProfilePath = path.join(process.cwd(), 'user_data', 'profile');
    const tempProfilePath = path.join(process.cwd(), 'user_data', `profile_temp_${jobId || Date.now()}`);

    // Try main profile
    for (const channel of channels) {
      try {
        console.log(`Trying to launch persistent context with channel: ${channel}`);
        const context = await chromium.launchPersistentContext(mainProfilePath, {
          ...launchOptions,
          channel,
        });
        console.log(`Successfully launched persistent context using channel: ${channel}`);
        return { context, isPersistent: true, profilePath: mainProfilePath, isTemp: false };
      } catch (err) {
        console.warn(`Failed to launch persistent context (locked or channel missing): ${err.message}`);
      }
    }

    // Try temp fallback profile if main is locked
    for (const channel of channels) {
      try {
        console.log(`Trying temporary persistent context fallback: ${tempProfilePath}`);
        const context = await chromium.launchPersistentContext(tempProfilePath, {
          ...launchOptions,
          channel,
        });
        console.log(`Successfully launched temporary persistent context using channel: ${channel}`);
        return { context, isPersistent: true, profilePath: tempProfilePath, isTemp: true };
      } catch (err) {
        console.warn(`Failed temp fallback: ${err.message}`);
      }
    }
  }

  // Ephemeral context launch (No persistent profile)
  for (const channel of channels) {
    try {
      console.log(`Launching ephemeral browser with channel: ${channel}`);
      const browser = await chromium.launch({
        headless,
        channel,
        args: launchOptions.args,
      });
      const context = await browser.newContext({
        userAgent,
        viewport,
        locale,
        ignoreHTTPSErrors,
        geolocation,
        permissions
      });
      console.log(`Successfully launched ephemeral context using channel: ${channel}`);
      return { context, browser, isPersistent: false };
    } catch (err) {
      console.warn(`Failed ephemeral launch: ${err.message}`);
    }
  }

  // Final fallback: try to launch without channel (uses Playwright's downloaded browser)
  console.log('Falling back to default Playwright browser launch...');
  const browser = await chromium.launch({
    headless,
    args: launchOptions.args,
  });
  const context = await browser.newContext({
    userAgent,
    viewport,
    locale,
    ignoreHTTPSErrors,
    geolocation,
    permissions
  });
  return { context, browser, isPersistent: false };
}

module.exports = { launchBrowserContext };
