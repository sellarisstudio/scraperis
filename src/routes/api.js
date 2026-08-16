const express = require('express');
const router = express.Router();
const jobManager = require('../scraper/jobManager');
const { scrapeGoogleMaps } = require('../scraper/mapsScraper');
const { scrapeSearch } = require('../scraper/searchScraper');
const { Parser } = require('json2csv');
const XLSX = require('xlsx');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS) || 2;

/**
 * POST /api/scrape - Start a new scraping job
 */
router.post('/scrape', (req, res) => {
  try {
    const { query, location, maxResults, mode, platform, contactPrefix, searchTarget, serpApiKey, headless, captchaTimeout, usePersistent, skipNoPhone } = req.body;

    if (!query || !location) {
      return res.status(400).json({
        error: 'Missing required fields: query and location',
      });
    }

    // Check concurrent job limit
    if (jobManager.getActiveJobCount() >= MAX_CONCURRENT) {
      return res.status(429).json({
        error: `Maximum concurrent jobs (${MAX_CONCURRENT}) reached. Please wait for a job to finish.`,
      });
    }

    const activeMode = mode === 'search' ? 'search' : 'maps';
    const max = Math.min(parseInt(maxResults) || 40, 500);
    const job = jobManager.createJob(query, location, max, activeMode);

    const isHeadless = headless !== undefined ? !!headless : (process.env.BROWSER_HEADLESS !== 'false');
    const activeCaptchaTimeout = parseInt(captchaTimeout) || 60;
    const activeUsePersistent = usePersistent !== undefined ? !!usePersistent : true;
    const activeSkipNoPhone = skipNoPhone !== undefined ? !!skipNoPhone : true;

    if (activeMode === 'search') {
      const activePlatform = platform || 'instagram.com';
      const activeContactPrefix = contactPrefix || 'whatsapp';

      const activeSearchTarget = searchTarget || 'google';

      // Start search scraping (Google, DuckDuckGo, Bing, Yahoo, SerpApi)
      scrapeSearch(job.id, activePlatform, query, location, activeContactPrefix, max, activeSearchTarget, serpApiKey, isHeadless, activeCaptchaTimeout, activeUsePersistent, activeSkipNoPhone).catch((err) => {
        console.error('Unhandled Search scraper error:', err);
        jobManager.setError(job.id, err.message);
      });
    } else {
      // Start google maps scraping
      scrapeGoogleMaps(job.id, query, location, max, isHeadless, activeCaptchaTimeout, activeUsePersistent, activeSkipNoPhone).catch((err) => {
        console.error('Unhandled Maps scraper error:', err);
        jobManager.setError(job.id, err.message);
      });
    }

    res.status(201).json({
      id: job.id,
      status: job.status,
      query: job.query,
      location: job.location,
      maxResults: max,
      mode: activeMode,
    });
  } catch (err) {
    console.error('Error creating scrape job:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/scrape/:jobId/stream - SSE stream for real-time progress
 */
router.get('/scrape/:jobId/stream', (req, res) => {
  const job = jobManager.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Setup SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable Nginx buffering
  });

  // Send current state immediately
  res.write(
    `data: ${JSON.stringify({
      event: 'init',
      data: {
        status: job.status,
        progress: job.progress,
        totalFound: job.totalFound,
        results: job.results,
        logs: job.logs,
      },
    })}\n\n`
  );

  // Listen for updates
  const onUpdate = (update) => {
    res.write(`data: ${JSON.stringify(update)}\n\n`);

    // Close stream if job completed or failed
    if (update.event === 'status' && (update.data.status === 'completed' || update.data.status === 'failed')) {
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ event: 'done' })}\n\n`);
        res.end();
      }, 500);
    }
  };

  job.emitter.on('update', onUpdate);

  // If job already finished, close the stream
  if (job.status === 'completed' || job.status === 'failed') {
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ event: 'done' })}\n\n`);
      res.end();
    }, 100);
  }

  // Cleanup on client disconnect
  req.on('close', () => {
    job.emitter.removeListener('update', onUpdate);
  });
});

/**
 * GET /api/scrape/:jobId/results - Get job results
 */
router.get('/scrape/:jobId/results', (req, res) => {
  const job = jobManager.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    id: job.id,
    status: job.status,
    query: job.query,
    location: job.location,
    progress: job.progress,
    totalFound: job.totalFound,
    results: job.results,
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  });
});

/**
 * GET /api/export/:jobId/:format - Export results
 */
router.get('/export/:jobId/:format', (req, res) => {
  const job = jobManager.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.results.length === 0) {
    return res.status(400).json({ error: 'No results to export' });
  }

  const format = req.params.format.toLowerCase();
  const filename = `scrapmap_${job.query}_${job.location}_${Date.now()}`.replace(
    /[^a-zA-Z0-9_]/g,
    '_'
  );

  const { columns } = req.query;

  // Clean results for export based on scraper mode
  let exportData = job.mode === 'search'
    ? job.results.map((r) => ({
        No: r.index,
        'Page Title': r.title,
        Platform: r.platform,
        Link: r.url,
        Phone: r.phone,
        Email: r.email || '',
        Snippet: r.snippet,
      }))
    : job.results.map((r) => ({
        No: r.index,
        'Business Name': r.name,
        Category: r.category,
        Daerah: r.daerah || '',
        Rating: r.rating,
        'Reviews Count': r.reviewCount,
        Address: r.address,
        Phone: r.phone,
        Website: r.website,
        'Description / About': r.description || '',
        'Price Range': r.priceRange || '',
        'Operational Status': r.status || '',
        'Claimed Status': r.claimed || '',
        'Social Media': r.socialMedia || '',
        'Menu URL': r.menuUrl || '',
        'Reservation URL': r.reservationUrl || '',
        'Cover Image URL': r.thumbnail || '',
        'Plus Code': r.plusCode,
        'Opening Hours': r.hours,
        Latitude: r.lat != null ? r.lat : '',
        Longitude: r.lng != null ? r.lng : '',
        'Google Maps URL': r.mapsUrl,
      }));

  // Filter columns if specified
  if (columns) {
    const activeCols = columns.split(',');
    exportData = exportData.map((row) => {
      const filtered = {};
      activeCols.forEach((col) => {
        if (col in row) {
          filtered[col] = row[col];
        }
      });
      return filtered;
    });
  }

  const colWidths = {
    // Maps
    'No': 5,
    'Business Name': 35,
    'Category': 20,
    'Daerah': 20,
    'Rating': 8,
    'Reviews Count': 12,
    'Address': 50,
    'Phone': 18,
    'Website': 35,
    'Description / About': 45,
    'Price Range': 15,
    'Operational Status': 18,
    'Claimed Status': 18,
    'Social Media': 40,
    'Menu URL': 35,
    'Reservation URL': 35,
    'Cover Image URL': 40,
    'Plus Code': 15,
    'Opening Hours': 30,
    'Latitude': 14,
    'Longitude': 14,
    'Google Maps URL': 50,
    // Search
    'Page Title': 45,
    'Platform': 20,
    'Link': 50,
    'Phone': 18,
    'Email': 25,
    'Snippet': 75,
  };

  if (format === 'csv') {
    try {
      const parser = new Parser();
      const csv = parser.parse(exportData);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}.csv"`
      );
      // Add BOM for Excel UTF-8 compatibility
      res.send('\ufeff' + csv);
    } catch (err) {
      console.error('CSV export error:', err);
      res.status(500).json({ error: 'Failed to generate CSV' });
    }
  } else if (format === 'xlsx' || format === 'excel') {
    try {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);

      // Set column widths dynamically based on active keys
      const activeKeys = Object.keys(exportData[0] || {});
      ws['!cols'] = activeKeys.map((key) => ({ wch: colWidths[key] || 15 }));

      XLSX.utils.book_append_sheet(wb, ws, 'Results');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}.xlsx"`
      );
      res.send(buffer);
    } catch (err) {
      console.error('Excel export error:', err);
      res.status(500).json({ error: 'Failed to generate Excel file' });
    }
  } else {
    res.status(400).json({ error: 'Unsupported format. Use csv or xlsx.' });
  }
});

/**
 * GET /api/jobs - List recent jobs
 */
router.get('/jobs', (req, res) => {
  const jobs = jobManager.listJobs();
  res.json({ jobs });
});

/**
 * DELETE /api/scrape/:jobId - Cancel/delete a job
 */
router.delete('/scrape/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  job.emitter.removeAllListeners();
  jobManager.updateStatus(req.params.jobId, 'failed');
  res.json({ message: 'Job cancelled' });
});

/**
 * POST /api/export/basket/:format - Export accumulated basket leads
 */
router.post('/export/basket/:format', (req, res) => {
  try {
    const { leads, basketColumns } = req.body;
    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'No leads data to export' });
    }

    const format = req.params.format.toLowerCase();
    const filename = `scrapmap_basket_${Date.now()}`;

    // Map basket fields to neat export columns
    let exportData = leads.map((r, i) => {
      const formattedDate = r.savedAt 
        ? new Date(r.savedAt).toLocaleString('en-US')
        : '—';
      return {
        No: i + 1,
        'Name/Title': r.name,
        'Category/Platform': r.category,
        Daerah: r.daerah || '',
        Rating: r.rating != null ? r.rating : '',
        'Reviews Count': r.reviewCount != null ? r.reviewCount : '',
        Phone: r.phone,
        Email: r.email || '',
        'Address/Snippet': r.address,
        Website: r.website || '',
        'Description / About': r.description || '',
        'Price Range': r.priceRange || '',
        'Operational Status': r.status || '',
        'Claimed Status': r.claimed || '',
        'Social Media': r.socialMedia || '',
        'Menu URL': r.menuUrl || '',
        'Reservation URL': r.reservationUrl || '',
        'Cover Image URL': r.thumbnail || '',
        'Plus Code': r.plusCode || '',
        'Opening Hours': r.hours || '',
        Latitude: r.lat != null ? r.lat : '',
        Longitude: r.lng != null ? r.lng : '',
        Source: r.source || '',
        Link: r.url || r.mapsUrl || '',
        'Date Saved': formattedDate
      };
    });

    // Filter columns if specified
    if (basketColumns && Array.isArray(basketColumns)) {
      exportData = exportData.map((row) => {
        const filtered = {};
        basketColumns.forEach((col) => {
          if (col in row) {
            filtered[col] = row[col];
          }
        });
        return filtered;
      });
    }

    if (format === 'csv') {
      const parser = new Parser();
      const csv = parser.parse(exportData);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}.csv"`
      );
      res.send('\ufeff' + csv);
    } else if (format === 'xlsx' || format === 'excel') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);

      // Define default widths
      const colWidths = {
        'No': 5,
        'Name/Title': 35,
        'Category/Platform': 25,
        'Daerah': 20,
        'Rating': 10,
        'Reviews Count': 14,
        'Phone': 20,
        'Email': 25,
        'Address/Snippet': 50,
        'Website': 35,
        'Description / About': 40,
        'Price Range': 15,
        'Operational Status': 18,
        'Claimed Status': 18,
        'Social Media': 35,
        'Menu URL': 30,
        'Reservation URL': 30,
        'Cover Image URL': 30,
        'Plus Code': 18,
        'Opening Hours': 30,
        'Latitude': 14,
        'Longitude': 14,
        'Source': 15,
        'Link': 50,
        'Date Saved': 22,
      };

      // Set column widths dynamically based on active keys
      const activeKeys = Object.keys(exportData[0] || {});
      ws['!cols'] = activeKeys.map((key) => ({ wch: colWidths[key] || 15 }));

      XLSX.utils.book_append_sheet(wb, ws, 'Saved Leads');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}.xlsx"`
      );
      res.send(buffer);
    } else {
      res.status(400).json({ error: 'Unsupported format. Use csv or xlsx.' });
    }
  } catch (err) {
    console.error('Basket export error:', err);
    res.status(500).json({ error: 'Failed to generate export file' });
  }
});

module.exports = router;
