const { launchBrowserContext } = require('./browserHelper');
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
 * Simulate human interactions like scrolling and random mouse movements
 */
async function simulateHumanInteraction(page) {
  try {
    // Random delay (2000ms - 5000ms)
    await page.waitForTimeout(2000 + Math.random() * 3000);

    // Smooth mouse movement
    const x = Math.floor(100 + Math.random() * 400);
    const y = Math.floor(100 + Math.random() * 400);
    await page.mouse.move(x, y, { steps: 10 });

    // Scroll down slightly
    const scrollAmount = Math.floor(300 + Math.random() * 400);
    await page.mouse.wheel(0, scrollAmount);

    // Random wait after scroll
    await page.waitForTimeout(1000 + Math.random() * 1500);
  } catch (err) {
    console.error('Error simulating human interaction:', err);
  }
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
 * Extract email addresses from snippet/title text
 */
function extractEmails(text) {
  if (!text) return '';
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  const matches = text.match(emailRegex) || [];
  const valid = matches.filter((e) => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.webp'));
  return valid.length > 0 ? [...new Set(valid)].join(', ') : '';
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
 * Unified Search Scraping function supporting Google, DuckDuckGo, Bing, Yahoo, and SerpApi
 */
async function scrapeSearch(jobId, platform, category, location, contactPrefix, maxResults = 100, searchTarget = 'google', serpApiKey = '', headless = true, captchaTimeout = 60, usePersistent = true, skipNoPhone = true) {
  const platformQuery = platform.includes('.') ? platform : `${platform}.com`;
  const searchString = `site:${platformQuery} "${category}" "${location}" "${contactPrefix}"`;

  // SERPAPI implementation (No browser needed)
  if (searchTarget === 'serpapi') {
    try {
      jobManager.updateStatus(jobId, 'scraping');
      jobManager.updateProgress(jobId, 10, '🔑 Initiating request to SerpApi...');

      const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchString)}&api_key=${serpApiKey}`;
      const response = await fetch(serpUrl);
      
      if (!response.ok) {
        throw new Error(`SerpApi response error: ${response.statusText}`);
      }

      const data = await response.json();
      const organic = data.organic_results || [];

      jobManager.updateProgress(jobId, 45, `✅ SerpApi returned ${organic.length} listings. Parsing...`);

      let resultsCount = 0;
      for (const res of organic) {
        const combinedText = `${res.title || ''} ${res.snippet || ''}`;
        const phones = extractPhones(combinedText);
        const email = extractEmails(combinedText);

        if (phones.length === 0) {
          if (skipNoPhone) continue;

          const job = jobManager.getJob(jobId);
          const isDuplicate = job.results.some(
            (r) => r.url === res.link && r.title === res.title
          );
          if (!isDuplicate && resultsCount < maxResults) {
            resultsCount++;
            jobManager.addResult(jobId, {
              index: resultsCount,
              title: res.title || '',
              url: res.link || '',
              phone: '',
              email,
              snippet: res.snippet || '',
              platform: platformQuery
            });
            jobManager.updateProgress(
              jobId,
              Math.min(45 + (resultsCount / maxResults) * 50, 95),
              `✅ [${resultsCount}] Found: ${res.title}`
            );
          }
          continue;
        }

        for (const phone of phones) {
          if (resultsCount >= maxResults) break;

          const job = jobManager.getJob(jobId);
          const isDuplicate = job.results.some(
            (r) => r.phone === phone || (r.url === res.link && r.title === res.title)
          );

          if (!isDuplicate) {
            resultsCount++;
            jobManager.addResult(jobId, {
              index: resultsCount,
              title: res.title || '',
              url: res.link || '',
              phone,
              email,
              snippet: res.snippet || '',
              platform: platformQuery
            });
            jobManager.updateProgress(
              jobId,
              Math.min(45 + (resultsCount / maxResults) * 50, 95),
              `✅ [${resultsCount}] Found: ${res.title} (${phone})`
            );
          }
        }
      }

      const job = jobManager.getJob(jobId);
      jobManager.updateProgress(
        jobId,
        100,
        `🎉 SerpApi Google Search scraping complete! Extracted ${job.results.length} leads.`
      );
      jobManager.updateStatus(jobId, 'completed');
      return;
    } catch (err) {
      console.error('SerpApi search error:', err);
      jobManager.setError(jobId, err.message);
      return;
    }
  }

  // Playwright browsers (Google, DuckDuckGo, Bing, Yahoo)
  let browser = null;
  let context = null;
  let isTempProfile = false;
  let tempProfilePath = '';

  try {
    jobManager.updateStatus(jobId, 'scraping');
    jobManager.updateProgress(jobId, 5, `🚀 Launching browser for ${searchTarget.toUpperCase()}...`);

    const launchResult = await launchBrowserContext({
      headless,
      usePersistent,
      jobId,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'id-ID',
      ignoreHTTPSErrors: true,
    });

    context = launchResult.context;
    browser = launchResult.browser;
    isTempProfile = !!launchResult.isTemp;
    tempProfilePath = launchResult.profilePath || '';

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    // Stealth: override navigator.webdriver
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchString)}&num=100`;

    jobManager.updateProgress(jobId, 15, `🔍 Searching ${searchTarget.toUpperCase()}: ${searchString}`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await simulateHumanInteraction(page);

    // Consent button handling
    try {
      const consentBtn = page.locator(
        'button:has-text("Accept all"), button:has-text("Terima semua"), button:has-text("I agree"), button:has-text("Setuju")'
      );
      if (await consentBtn.first().isVisible({ timeout: 3000 })) {
        await consentBtn.first().click();
        await randomDelay(1500, 2500);
      }
    } catch {}

    // Google captcha checking
    if (searchTarget === 'google') {
      let isCaptcha = await page.locator('iframe[src*="recaptcha"], form#captcha-form, div#recaptcha').count();
      if (isCaptcha > 0) {
        if (headless) {
          throw new Error('Google CAPTCHA / Robot Verification detected. Try running with Headless mode OFF to solve it manually.');
        } else {
          jobManager.updateProgress(jobId, 18, `⚠️ CAPTCHA terdeteksi! Harap selesaikan CAPTCHA di jendela browser Anda. Menunggu hingga ${captchaTimeout} detik...`);
          
          let waited = 0;
          let solved = false;
          while (waited < captchaTimeout) {
            // Check for cancel request
            const currentJob = jobManager.getJob(jobId);
            if (!currentJob || currentJob.status === 'failed') {
              throw new Error('Job cancelled');
            }
            
            await page.waitForTimeout(2000);
            waited += 2;
            
            isCaptcha = await page.locator('iframe[src*="recaptcha"], form#captcha-form, div#recaptcha').count();
            if (isCaptcha === 0) {
              solved = true;
              break;
            }
            
            jobManager.updateProgress(jobId, 18, `⏳ Menunggu penyelesaian CAPTCHA... (${waited}/${captchaTimeout} detik berlalu)`);
          }
          
          if (!solved) {
            throw new Error(`Google CAPTCHA tidak diselesaikan dalam ${captchaTimeout} detik.`);
          }
          
          jobManager.updateProgress(jobId, 19, '✅ CAPTCHA selesai diselesaikan! Melanjutkan scraping...');
          await randomDelay(2000, 3000);
        }
      }
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
        `📄 Processing page ${currentPage}...`
      );

      // Extract results from current page
      const searchResults = await page.evaluate(() => {
        const items = document.querySelectorAll('div.g, div.MjjYud');
        const data = [];

        items.forEach((item) => {
          const titleEl = item.querySelector('h3');
          const linkEl = item.querySelector('a');
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

        const combinedText = `${res.title} ${res.snippet}`;
        const phones = extractPhones(combinedText);
        const email = extractEmails(combinedText);

        if (phones.length === 0) {
          if (skipNoPhone) {
            continue;
          }
          const job = jobManager.getJob(jobId);
          const isDuplicate = job.results.some(
            (r) => r.url === res.url && r.title === res.title
          );
          if (!isDuplicate && resultsCount < maxResults) {
            resultsCount++;
            const item = {
              index: resultsCount,
              title: res.title,
              url: res.url,
              phone: '',
              email: email,
              snippet: res.snippet,
              platform: platformQuery,
            };
            jobManager.addResult(jobId, item);
            jobManager.updateProgress(
              jobId,
              Math.min(25 + (resultsCount / maxResults) * 70, 95),
              `✅ [${resultsCount}] Found: ${res.title}`
            );
          }
          continue;
        }

        // Add result row for each unique phone number found
        for (const phone of phones) {
          if (resultsCount >= maxResults) break;

          const job = jobManager.getJob(jobId);
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
              email: email,
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

      // Handle next page navigation
      if (resultsCount < maxResults) {
        const nextPageBtn = page.locator('a#pnnext, a:has-text("Berikutnya"), a:has-text("Next")');

        if (nextPageBtn && await nextPageBtn.first().isVisible()) {
          currentPage++;
          await nextPageBtn.first().click();
          await simulateHumanInteraction(page);
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
      `🎉 ${searchTarget.toUpperCase()} Search scraping complete! Extracted ${job.results.length} leads with phone numbers.`
    );
    jobManager.updateStatus(jobId, 'completed');
  } catch (err) {
    console.error(`${searchTarget.toUpperCase()} Search Scraping error:`, err);
    jobManager.setError(jobId, err.message);
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    if (isTempProfile && tempProfilePath) {
      const fs = require('fs');
      try {
        fs.rmSync(tempProfilePath, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to clean temp profile:', e.message);
      }
    }
  }
}

module.exports = { scrapeSearch };
