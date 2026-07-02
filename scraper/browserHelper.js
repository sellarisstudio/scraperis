const { chromium } = require('playwright');

/**
 * Launch a browser using local Chrome/Edge if available to avoid downloading
 * large playwright browser binaries (keeping the installer small).
 */
async function launchBrowser(options = {}) {
  const { headless = true } = options;
  const launchOptions = {
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  };

  // List of channels to try for launching system browsers
  const channels = ['chrome', 'msedge'];

  for (const channel of channels) {
    try {
      console.log(`Trying to launch system browser with channel: ${channel}`);
      const browser = await chromium.launch({
        ...launchOptions,
        channel,
      });
      console.log(`Successfully launched system browser using channel: ${channel}`);
      return browser;
    } catch (err) {
      console.warn(`Failed to launch browser with channel ${channel}: ${err.message}`);
    }
  }

  // Final fallback: try to launch without channel (uses Playwright's downloaded browser if present)
  console.log('Falling back to default Playwright browser launch...');
  return await chromium.launch(launchOptions);
}

module.exports = { launchBrowser };
