const { launchBrowser } = require('./browserHelper');
const jobManager = require('./jobManager');

/**
 * Random delay to mimic human behavior
 */
function randomDelay(min = 1000, max = 3000) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );
}

/**
 * Format phone number to standard Indonesian format (08xxxxxxxxxx)
 */
function formatPhoneID(raw) {
  if (!raw) return '';

  // Strip everything except digits
  let num = raw.replace(/\D/g, '');
  if (!num || num.length < 9) return ''; // too short for ID mobile

  // Convert 62 to 0
  if (num.startsWith('62')) {
    num = '0' + num.slice(2);
  }

  // Ensure starts with 0
  if (!num.startsWith('0')) {
    num = '0' + num;
  }

  // Indonesian mobile numbers usually start with 08 and have 10-13 digits
  if (!num.startsWith('08') || num.length < 10 || num.length > 14) {
    return ''; // Not a valid ID mobile number
  }

  // Pretty-print: 0812 3456 7890
  const core = num.slice(2);
  const g1 = core.slice(0, 3);
  const g2 = core.slice(3, 7);
  const g3 = core.slice(7);
  return `08${g1} ${g2} ${g3}`.trim();
}

/**
 * Extract phone numbers from snippet/title text
 */
function extractPhones(text) {
  if (!text) return [];

  // Match common Indonesian phone formats, including wa.me links
  // Patterns like: 0812-3456-7890, 6281234567890, +62 812 3456 7890, wa.me/628123456789, 081234567890
  const candidates = text.match(/(?:\+?62|0)[ -]?8[1-9][0-9 -]{7,15}/g) || [];
  const waCandidates = text.match(/wa\.me\/(?:62|0)?8[1-9][0-9]+/gi) || [];

  const foundPhones = new Set();

  // Process standard numbers
  for (const cand of candidates) {
    const cleaned = formatPhoneID(cand);
    if (cleaned) foundPhones.add(cleaned);
  }

  // Process wa.me numbers
  for (const cand of waCandidates) {
    const cleaned = formatPhoneID(cand.replace(/wa\.me\//i, ''));
    if (cleaned) foundPhones.add(cleaned);
  }

  return [...foundPhones];
}

/**
 * Main Google Search Scraping function
 */
async function scrapeGoogleSearch(jobId, platform, category, location, contactPrefix, maxResults = 100) {
  const headless = process.env.BROWSER_HEADLESS !== 'false';
  let browser = null;

  try {
    jobManager.updateStatus(jobId, 'scraping');
    jobManager.updateProgress(jobId, 5, '🚀 Launching browser for Google Search...');

    browser = await launchBrowser({ headless });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'id-ID',
    });

    const page = await context.newPage();

    // Stealth: override navigator.webdriver
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    // Formulate query: site:instagram.com "coffee" "bogor" "whatsapp"
    const platformQuery = platform.includes('.') ? platform : `${platform}.com`;
    const searchString = `site:${platformQuery} "${category}" "${location}" "${contactPrefix}"`;
    
    // We append &num=100 to get up to 100 results per page, which is fast and prevents too much pagination
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchString)}&num=100`;

    jobManager.updateProgress(jobId, 15, `🔍 Searching Google: ${searchString}`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2500, 4000);

    // Check for Google Cookie/Consent popup
    try {
      const consentBtn = page.locator(
        'button:has-text("Accept all"), button:has-text("Terima semua"), button:has-text("I agree"), button:has-text("Setuju")'
      );
      if (await consentBtn.first().isVisible({ timeout: 3000 })) {
        await consentBtn.first().click();
        await randomDelay(1500, 2500);
      }
    } catch {
      // No consent popup, proceed
    }

    // Check if CAPTCHA is detected
    const isCaptcha = await page.locator('iframe[src*="recaptcha"], form#captcha-form, div#recaptcha').count();
    if (isCaptcha > 0) {
      throw new Error('Google CAPTCHA / Robot Verification detected. Try again later or deploy with a different IP/proxy.');
    }

    let currentPage = 1;
    let resultsCount = 0;
    let hasNextPage = true;

    while (resultsCount < maxResults && hasNextPage) {
      // Check for cancellation
      const currentJob = jobManager.getJob(jobId);
      if (!currentJob || currentJob.status === 'failed') {
        throw new Error('Job cancelled');
      }

      jobManager.updateProgress(
        jobId,
        Math.min(20 + (resultsCount / maxResults) * 70, 90),
        `📄 Processing search page ${currentPage}...`
      );

      // Extract results from current page
      const searchResults = await page.evaluate(() => {
        // Selector for organic google search results container
        const items = document.querySelectorAll('div.g, div.MjjYud');
        const data = [];

        items.forEach((item) => {
          const titleEl = item.querySelector('h3');
          const linkEl = item.querySelector('a');
          
          // Google snippets can be inside various containers, let's grab the description texts
          const descEl = item.querySelector('div[style*="-webkit-line-clamp"], div.VwiC3b, span.aCOp2e');
          
          if (titleEl && linkEl) {
            data.push({
              title: titleEl.textContent.trim(),
              url: linkEl.href,
              snippet: descEl ? descEl.textContent.trim() : '',
            });
          }
        });

        return data;
      });

      if (searchResults.length === 0) {
        jobManager.updateProgress(jobId, 95, '⚠️ No more results found on this page.');
        break;
      }

      jobManager.updateProgress(
        jobId,
        Math.min(25 + (resultsCount / maxResults) * 70, 92),
        `🔍 Analyzing ${searchResults.length} listings from page ${currentPage}...`
      );

      // Process and filter each result
      for (const res of searchResults) {
        // Check for cancellation
        const currentJob = jobManager.getJob(jobId);
        if (!currentJob || currentJob.status === 'failed') {
          throw new Error('Job cancelled');
        }

        if (resultsCount >= maxResults) break;

        // Combine title and snippet to extract phone numbers
        const combinedText = `${res.title} ${res.snippet}`;
        const phones = extractPhones(combinedText);

        // If no phone number is found, we skip it as requested!
        if (phones.length === 0) {
          continue;
        }

        // Add result row for each unique phone number found
        for (const phone of phones) {
          if (resultsCount >= maxResults) break;

          const job = jobManager.getJob(jobId);
          // Check for duplicate phone/url combination
          const isDuplicate = job.results.some(
            (r) => r.phone === phone || (r.url === res.url && r.title === res.title)
          );

          if (!isDuplicate) {
            resultsCount++;
            const item = {
              index: resultsCount,
              title: res.title,
              url: res.url,
              phone: phone,
              snippet: res.snippet,
              platform: platformQuery,
            };
            jobManager.addResult(jobId, item);
            jobManager.updateProgress(
              jobId,
              Math.min(25 + (resultsCount / maxResults) * 70, 95),
              `✅ [${resultsCount}] Found: ${res.title} (${phone})`
            );
          }
        }
      }

      // Check for "Next" / "Berikutnya" page button if we need more results
      if (resultsCount < maxResults) {
        const nextButton = page.locator('a#pnnext, a:has-text("Berikutnya"), a:has-text("Next")');
        if (await nextButton.isVisible()) {
          currentPage++;
          await nextButton.click();
          await randomDelay(3000, 5000); // larger delay between search pages
        } else {
          hasNextPage = false;
        }
      } else {
        hasNextPage = false;
      }
    }

    const job = jobManager.getJob(jobId);
    jobManager.updateProgress(
      jobId,
      100,
      `🎉 Google Search scraping complete! Extracted ${job.results.length} leads with phone numbers.`
    );
    jobManager.updateStatus(jobId, 'completed');
  } catch (err) {
    console.error('Google Search Scraping error:', err);
    jobManager.setError(jobId, err.message);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // already closed
      }
    }
  }
}

module.exports = { scrapeGoogleSearch };
