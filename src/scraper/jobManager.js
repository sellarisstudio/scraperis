const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

class JobManager {
  constructor() {
    this.jobs = new Map();
    this.JOB_TTL = parseInt(process.env.JOB_TTL) || 3600000; // 1 hour

    // Cleanup old jobs every 10 minutes
    setInterval(() => this._cleanup(), 600000);
  }

  createJob(query, location, maxResults, mode = 'maps') {
    const id = uuidv4();
    const job = {
      id,
      query,
      location,
      maxResults,
      mode, // maps | search
      status: 'pending', // pending | scraping | completed | failed
      progress: 0,
      totalFound: 0,
      results: [],
      logs: [],
      error: null,
      emitter: new EventEmitter(),
      createdAt: new Date(),
      completedAt: null,
    };

    this.jobs.set(id, job);
    return job;
  }

  /**
   * Get job by ID
   */
  getJob(id) {
    return this.jobs.get(id) || null;
  }

  listJobs() {
    const jobs = [];
    for (const [id, job] of this.jobs) {
      jobs.push({
        id,
        query: job.query,
        location: job.location,
        status: job.status,
        progress: job.progress,
        totalFound: job.totalFound,
        resultCount: job.results.length,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        mode: job.mode,
      });
    }
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Update job status
   */
  updateStatus(id, status) {
    const job = this.jobs.get(id);
    if (!job) return;

    job.status = status;
    if (status === 'completed' || status === 'failed') {
      job.completedAt = new Date();
    }
    this._emit(job, 'status', { status });
  }

  /**
   * Update job progress
   */
  updateProgress(id, progress, message) {
    const job = this.jobs.get(id);
    if (!job) return;

    job.progress = Math.min(progress, 100);
    if (message) {
      const logEntry = {
        time: new Date().toISOString(),
        message,
      };
      job.logs.push(logEntry);
    }
    this._emit(job, 'progress', {
      progress: job.progress,
      message,
    });
  }

  /**
   * Add a scraped result
   */
  addResult(id, result) {
    const job = this.jobs.get(id);
    if (!job) return;

    job.results.push(result);
    job.totalFound = job.results.length;
    this._emit(job, 'result', {
      result,
      totalFound: job.totalFound,
    });
  }

  /**
   * Set job error
   */
  setError(id, error) {
    const job = this.jobs.get(id);
    if (!job) return;

    job.error = error;
    job.status = 'failed';
    job.completedAt = new Date();
    this._emit(job, 'error', { error });
  }

  /**
   * Emit SSE event for a job
   */
  _emit(job, event, data) {
    job.emitter.emit('update', { event, data });
  }

  /**
   * Get the active job count
   */
  getActiveJobCount() {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'scraping' || job.status === 'pending') {
        count++;
      }
    }
    return count;
  }

  /**
   * Cleanup old jobs
   */
  _cleanup() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.createdAt.getTime() > this.JOB_TTL) {
        job.emitter.removeAllListeners();
        this.jobs.delete(id);
      }
    }
  }
}

// Singleton
module.exports = new JobManager();
