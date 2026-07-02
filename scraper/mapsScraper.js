const { chromium } = require('playwright');
const jobManager = require('./jobManager');

/**
 * Random delay to mimic human behavior
 */
function randomDelay(min = 800, max = 2000) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );
}

/**
 * Format Indonesian phone number to +62 format
 */
function formatPhoneID(raw) {
  if (!raw) return '';

  // Strip everything except digits
  let num = raw.replace(/\D/g, '');
  if (!num || num.length < 7) return ''; // too short to be valid

  // If starts with 62, replace with 0
  if (num.startsWith('62')) {
    num = '0' + num.slice(2);
  }

  // If it doesn't start with 0, prefix with 0
  if (!num.startsWith('0')) {
    num = '0' + num;
  }

  // Pretty-print: 0812 3456 7890
  if (num.startsWith('08') && num.length >= 10) {
    const core = num.slice(2); // e.g. 1234567890
    const g1 = core.slice(0, 3);
    const g2 = core.slice(3, 7);
    const g3 = core.slice(7);
    num = `08${g1} ${g2} ${g3}`.trim();
  }

  return num;
}

/**
 * Extract business data from a single Google Maps listing panel
 */
async function extractBusinessDetail(page) {
  try {
    return await page.evaluate(() => {
      const getText = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim()) return el.textContent.trim();
        }
        return '';
      };

      const getAttr = (selector, attr) => {
        const el = document.querySelector(selector);
        return el ? el.getAttribute(attr) || '' : '';
      };

      // Business name
      const name = getText([
        'h1.DUwDvf',
        'h1.fontHeadlineLarge',
        'div.tAiQdd h1',
        'h1',
      ]);

      // Rating
      const ratingText = getText([
        'div.F7nice span[aria-hidden="true"]',
        'span.ceNzKf',
        'div.F7nice span',
      ]);
      const rating = ratingText ? parseFloat(ratingText) : null;

      // Review count
      const reviewEl = document.querySelector(
        'div.F7nice span[aria-label*="review"], div.F7nice span[aria-label*="ulasan"]'
      );
      let reviewCount = null;
      if (reviewEl) {
        const match = reviewEl.getAttribute('aria-label')?.match(/[\d,.]+/);
        if (match) reviewCount = parseInt(match[0].replace(/[,.]/g, ''));
      }

      // Category
      const category = getText([
        'button.DkEaL',
        'span.DkEaL',
        'button[jsaction*="category"]',
      ]);

      // Address
      const addressEl = document.querySelector(
        'button[data-item-id="address"] div.fontBodyMedium, ' +
        'div[data-item-id="address"] div.fontBodyMedium, ' +
        'button[aria-label*="Address"] div.fontBodyMedium, ' +
        'button[aria-label*="Alamat"] div.fontBodyMedium'
      );
      const address = addressEl ? addressEl.textContent.trim() : '';

      // Phone
      const phoneEl = document.querySelector(
        'button[data-item-id*="phone"] div.fontBodyMedium, ' +
        'button[aria-label*="Phone"] div.fontBodyMedium, ' +
        'button[aria-label*="Telepon"] div.fontBodyMedium'
      );
      const phone = phoneEl ? phoneEl.textContent.trim() : '';

      // Website
      const websiteEl = document.querySelector(
        'a[data-item-id="authority"], ' +
        'button[data-item-id="authority"] div.fontBodyMedium, ' +
        'a[aria-label*="Website"] div.fontBodyMedium'
      );
      const website = websiteEl
        ? websiteEl.href || websiteEl.textContent.trim()
        : '';

      // Plus code
      const plusCodeEl = document.querySelector(
        'button[data-item-id="oloc"] div.fontBodyMedium'
      );
      const plusCode = plusCodeEl ? plusCodeEl.textContent.trim() : '';

      // Hours
      const hoursEl = document.querySelector(
        'button[data-item-id*="hour"], div[aria-label*="Hours"], div[aria-label*="Jam"]'
      );
      const hours = hoursEl ? hoursEl.getAttribute('aria-label') || '' : '';

      // Coordinates from URL
      let lat = null;
      let lng = null;
      const url = window.location.href;
      const coordMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (coordMatch) {
        lat = parseFloat(coordMatch[1]);
        lng = parseFloat(coordMatch[2]);
      }

      // Google Maps URL
      const mapsUrl = url.split('?')[0];

      return {
        name,
        rating,
        reviewCount,
        category,
        address,
        phone: phone || '',
        website: website.startsWith('http') ? website : '',
        plusCode,
        hours,
        lat,
        lng,
        mapsUrl,
      };
    });
  } catch (err) {
    console.error('Error extracting business detail:', err.message);
    return null;
  }
}

/**
 * Main scraping function
 */
async function scrapeGoogleMaps(jobId, query, location, maxResults = 40) {
  const headless = process.env.BROWSER_HEADLESS !== 'false';
  let browser = null;

  try {
    jobManager.updateStatus(jobId, 'scraping');
    jobManager.updateProgress(jobId, 5, '🚀 Launching browser...');

    browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'id-ID',
      geolocation: { latitude: -6.2088, longitude: 106.8456 },
      permissions: ['geolocation'],
    });

    const page = await context.newPage();

    // Stealth: override navigator.webdriver
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    // Build search URL
    const searchQuery = encodeURIComponent(`${query} di ${location}`);
    const url = `https://www.google.com/maps/search/${searchQuery}`;

    jobManager.updateProgress(jobId, 10, `🔍 Searching: "${query}" di "${location}"...`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 3500);

    // Handle consent/cookie popup if present
    try {
      const consentBtn = page.locator(
        'button:has-text("Accept"), button:has-text("Terima"), form[action*="consent"] button'
      );
      if (await consentBtn.first().isVisible({ timeout: 3000 })) {
        await consentBtn.first().click();
        await randomDelay(1000, 2000);
      }
    } catch {
      // No consent popup, continue
    }

    jobManager.updateProgress(jobId, 15, '📋 Loading search results...');

    // Wait for results panel
    const resultsSelector = 'div[role="feed"]';
    try {
      await page.waitForSelector(resultsSelector, { timeout: 15000 });
    } catch {
      // Try alternative - might be a single result or no results
      const singleResult = await page.locator('h1.DUwDvf, h1.fontHeadlineLarge').count();
      if (singleResult > 0) {
        // Single result page - extract directly
        jobManager.updateProgress(jobId, 50, '📍 Found single result, extracting...');
        const detail = await extractBusinessDetail(page);
        if (detail && detail.name) {
          detail.phone = formatPhoneID(detail.phone);
          if (!detail.phone) {
            jobManager.updateProgress(jobId, 100, `⚠️ Skipping ${detail.name} (No phone number)`);
          } else {
            jobManager.addResult(jobId, { ...detail, index: 1 });
          }
        }
        jobManager.updateProgress(jobId, 100, '✅ Scraping complete!');
        jobManager.updateStatus(jobId, 'completed');
        await browser.close();
        return;
      }

      jobManager.updateProgress(jobId, 100, '⚠️ No results found for this search.');
      jobManager.updateStatus(jobId, 'completed');
      await browser.close();
      return;
    }

    // Scroll through results to load more
    jobManager.updateProgress(jobId, 20, '📜 Scrolling to load more results...');
    const feed = page.locator(resultsSelector);

    let previousCount = 0;
    let sameCountTimes = 0;
    const scrollTimeout = parseInt(process.env.SCROLL_TIMEOUT) || 30000;
    const startTime = Date.now();

    while (true) {
      // Count current visible listings
      const listings = page.locator('div[role="feed"] > div > div > a[href*="/maps/place"]');
      const currentCount = await listings.count();

      if (currentCount >= maxResults) {
        jobManager.updateProgress(
          jobId,
          30,
          `📋 Found ${currentCount} listings (target: ${maxResults})`
        );
        break;
      }

      if (currentCount === previousCount) {
        sameCountTimes++;
        if (sameCountTimes >= 3) {
          // Check if "end of list" marker is visible
          const endOfList = await page
            .locator('span.HlvSq, p.fontBodyMedium:has-text("end of")')
            .count();
          if (endOfList > 0 || sameCountTimes >= 5) {
            jobManager.updateProgress(
              jobId,
              30,
              `📋 Reached end of results. Found ${currentCount} listings.`
            );
            break;
          }
        }
      } else {
        sameCountTimes = 0;
      }

      if (Date.now() - startTime > scrollTimeout) {
        jobManager.updateProgress(
          jobId,
          30,
          `⏱️ Scroll timeout. Found ${currentCount} listings.`
        );
        break;
      }

      previousCount = currentCount;

      // Scroll the feed
      await feed.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await randomDelay(1200, 2500);

      const scrollProgress = Math.min(30, 20 + (currentCount / maxResults) * 10);
      jobManager.updateProgress(
        jobId,
        scrollProgress,
        `📜 Loading... ${currentCount} listings found`
      );
    }

    // Collect all listing URLs upfront (much more reliable than click-back)
    jobManager.updateProgress(jobId, 33, '🔗 Collecting listing URLs...');

    const listingUrls = await page.evaluate(() => {
      const links = document.querySelectorAll(
        'div[role="feed"] > div > div > a[href*="/maps/place"]'
      );
      return [...links].map((a) => a.href).filter(Boolean);
    });

    const totalListings = Math.min(listingUrls.length, maxResults);

    if (totalListings === 0) {
      jobManager.updateProgress(jobId, 100, '⚠️ No listing URLs found.');
      jobManager.updateStatus(jobId, 'completed');
      await browser.close();
      return;
    }

    jobManager.updateProgress(
      jobId,
      35,
      `🏪 Collected ${totalListings} URLs. Starting extraction...`
    );

    // Visit each listing URL directly — no more click-back dance
    for (let i = 0; i < totalListings; i++) {
      const listingUrl = listingUrls[i];

      try {
        const progress = 35 + ((i + 1) / totalListings) * 60;

        await page.goto(listingUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        // Wait for the detail panel to render
        try {
          await page.waitForSelector('h1.DUwDvf, h1.fontHeadlineLarge', {
            timeout: 10000,
          });
        } catch {
          jobManager.updateProgress(
            jobId,
            progress,
            `⚠️ Skipping listing ${i + 1} - page didn't load`
          );
          continue;
        }

        await randomDelay(800, 1500);

        // Extract business detail
        const detail = await extractBusinessDetail(page);

        if (detail && detail.name) {
          detail.phone = formatPhoneID(detail.phone);

          if (!detail.phone) {
            jobManager.updateProgress(
              jobId,
              progress,
              `⏩ Skipped (No phone): ${detail.name}`
            );
            continue;
          }

          // Check for duplicates
          const job = jobManager.getJob(jobId);
          const isDuplicate = job.results.some(
            (r) => r.name === detail.name && r.address === detail.address
          );

          if (!isDuplicate) {
            jobManager.addResult(jobId, {
              ...detail,
              index: job.results.length + 1,
            });
            jobManager.updateProgress(
              jobId,
              progress,
              `✅ [${job.results.length}/${totalListings}] ${detail.name}`
            );
          } else {
            jobManager.updateProgress(
              jobId,
              progress,
              `⏩ Skipped duplicate: ${detail.name}`
            );
          }
        } else {
          jobManager.updateProgress(
            jobId,
            progress,
            `⚠️ Couldn't extract data from listing ${i + 1}`
          );
        }

        // Small delay between requests to avoid rate-limiting
        await randomDelay(600, 1200);
      } catch (err) {
        jobManager.updateProgress(
          jobId,
          35 + ((i + 1) / totalListings) * 60,
          `⚠️ Error on listing ${i + 1}: ${err.message}`
        );
        // Brief pause then continue to next
        await randomDelay(1000, 2000);
      }
    }

    const job = jobManager.getJob(jobId);
    jobManager.updateProgress(
      jobId,
      100,
      `🎉 Scraping complete! Extracted ${job.results.length} businesses.`
    );
    jobManager.updateStatus(jobId, 'completed');
  } catch (err) {
    console.error('Scraping error:', err);
    jobManager.setError(jobId, err.message);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Browser already closed
      }
    }
  }
}

module.exports = { scrapeGoogleMaps };
