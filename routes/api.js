const express = require('express');
const router = express.Router();
const jobManager = require('../scraper/jobManager');
const { scrapeGoogleMaps } = require('../scraper/mapsScraper');
const { scrapeGoogleSearch } = require('../scraper/searchScraper');
const { Parser } = require('json2csv');
const XLSX = require('xlsx');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS) || 2;

/**
 * POST /api/scrape - Start a new scraping job
 */
router.post('/scrape', (req, res) => {
  try {
    const { query, location, maxResults, mode, platform, contactPrefix } = req.body;

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

    if (activeMode === 'search') {
      const activePlatform = platform || 'instagram.com';
      const activeContactPrefix = contactPrefix || 'whatsapp';

      // Start google search scraping
      scrapeGoogleSearch(job.id, activePlatform, query, location, activeContactPrefix, max).catch((err) => {
        console.error('Unhandled Search scraper error:', err);
        jobManager.setError(job.id, err.message);
      });
    } else {
      // Start google maps scraping
      scrapeGoogleMaps(job.id, query, location, max).catch((err) => {
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

  // Clean results for export based on scraper mode
  const exportData = job.mode === 'search'
    ? job.results.map((r) => ({
        No: r.index,
        'Judul Halaman': r.title,
        Platform: r.platform,
        Link: r.url,
        Telepon: r.phone,
        Snippet: r.snippet,
      }))
    : job.results.map((r) => ({
        No: r.index,
        'Nama Bisnis': r.name,
        Kategori: r.category,
        Rating: r.rating,
        'Jumlah Review': r.reviewCount,
        Alamat: r.address,
        Telepon: r.phone,
        Website: r.website,
        'Plus Code': r.plusCode,
        'Jam Operasional': r.hours,
        Latitude: r.lat,
        Longitude: r.lng,
        'Google Maps URL': r.mapsUrl,
      }));

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

      // Set column widths based on mode
      if (job.mode === 'search') {
        ws['!cols'] = [
          { wch: 5 },  // No
          { wch: 45 }, // Judul Halaman
          { wch: 20 }, // Platform
          { wch: 50 }, // Link
          { wch: 20 }, // Telepon
          { wch: 75 }, // Snippet
        ];
      } else {
        ws['!cols'] = [
          { wch: 5 },  // No
          { wch: 35 }, // Nama
          { wch: 20 }, // Kategori
          { wch: 8 },  // Rating
          { wch: 12 }, // Reviews
          { wch: 50 }, // Alamat
          { wch: 18 }, // Telepon
          { wch: 35 }, // Website
          { wch: 15 }, // Plus Code
          { wch: 30 }, // Jam
          { wch: 12 }, // Lat
          { wch: 12 }, // Lng
          { wch: 50 }, // URL
        ];
      }

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
    const { leads } = req.body;
    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'No leads data to export' });
    }

    const format = req.params.format.toLowerCase();
    const filename = `scrapmap_basket_${Date.now()}`;

    // Map basket fields to neat export columns
    const exportData = leads.map((r, i) => ({
      No: i + 1,
      'Nama/Judul': r.name,
      'Kategori/Platform': r.category,
      Telepon: r.phone,
      'Alamat/Snippet': r.address,
      Sumber: r.source,
      Link: r.url,
    }));

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

      // Set column widths
      ws['!cols'] = [
        { wch: 5 },  // No
        { wch: 40 }, // Nama/Judul
        { wch: 25 }, // Kategori/Platform
        { wch: 20 }, // Telepon
        { wch: 60 }, // Alamat/Snippet
        { wch: 15 }, // Sumber
        { wch: 60 }, // Link
      ];

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
