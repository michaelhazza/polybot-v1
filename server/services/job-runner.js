/**
 * Background Job Runner - Phase 1A
 * Simple in-memory job queue for backtest processing
 */

import backtestProcessor from './backtest-processor.js';

class JobRunner {
  constructor() {
    this.queue = [];
    this.running = false;
    this.activeJob = null;
  }

  /**
   * Add job to queue and start processing
   */
  enqueue(runId) {
    this.queue.push(runId);
    console.log(`Job enqueued for run ${runId}. Queue length: ${this.queue.length}`);

    if (!this.running) {
      this.processQueue();
    }
  }

  /**
   * Process jobs from queue sequentially
   */
  async processQueue() {
    if (this.running || this.queue.length === 0) {
      return;
    }

    this.running = true;

    while (this.queue.length > 0) {
      const runId = this.queue.shift();
      this.activeJob = runId;

      console.log(`Starting job for run ${runId}...`);

      try {
        await backtestProcessor.processBacktest(runId);
        console.log(`Job completed for run ${runId}`);
      } catch (error) {
        console.error(`Job failed for run ${runId}:`, error);
      }

      this.activeJob = null;
    }

    this.running = false;
    console.log('Job queue empty');
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      running: this.running,
      activeJob: this.activeJob
    };
  }
}

export default new JobRunner();
