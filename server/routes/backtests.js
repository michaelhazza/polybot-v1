import express from 'express';
import db from '../database/db.js';
import jobRunner from '../services/job-runner.js';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';

const router = express.Router();

/**
 * Parse period string to days
 */
function parsePeriod(period) {
  const map = {
    '30d': 30,
    '60d': 60,
    '3m': 90,
    '6m': 180
  };
  return map[period] || 30;
}

/**
 * POST /api/backtests - Create new backtest run
 * Requires authentication
 */
router.post('/', requireAuth, validate(schemas.createBacktest), (req, res) => {
  try {
    const { asset, timeframe, period, tradeSize, name } = req.body;

    // Calculate analysis period
    const now = Math.floor(Date.now() / 1000);
    const periodDays = parsePeriod(period);
    const analysisStart = now - (periodDays * 24 * 60 * 60);
    const analysisEnd = now;

    // Generate IDs
    const runId = uuidv4();
    const jobId = uuidv4();

    // Generate name if not provided
    const runName = name || `${asset} ${timeframe} ${period} $${tradeSize}`;

    // Create backtest record
    db.prepare(`
      INSERT INTO backtests
      (id, name, asset, timeframe, period, trade_size, status,
       analysis_start, analysis_end, created_at, parameters_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      runName,
      asset,
      timeframe,
      period,
      tradeSize,
      'queued',
      analysisStart,
      analysisEnd,
      now,
      JSON.stringify({ asset, timeframe, period, tradeSize })
    );

    // Create job record
    db.prepare(`
      INSERT INTO jobs
      (job_id, run_id, status, progress_pct, stage)
      VALUES (?, ?, ?, ?, ?)
    `).run(jobId, runId, 'queued', 0, 'queued');

    // Enqueue job for processing
    jobRunner.enqueue(runId);

    res.json({
      success: true,
      runId,
      jobId,
      message: 'Backtest queued for processing'
    });

  } catch (error) {
    console.error('Error creating backtest:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtests - List all backtest runs
 */
router.get('/', (req, res) => {
  try {
    const runs = db.prepare(`
      SELECT id, name, asset, timeframe, period, trade_size, status,
             progress_pct, stage, windows_detected, trades_completed,
             fill_success_rate, avg_execution_adjusted_edge,
             data_coverage_pct, windows_per_analysis_hour, duration_p50,
             created_at, completed_at, error_message
      FROM backtests
      ORDER BY created_at DESC
    `).all();

    res.json(runs);
  } catch (error) {
    console.error('Error fetching backtests:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtests/:id - Get backtest run details
 */
router.get('/:id', validate(schemas.uuidParam, 'params'), (req, res) => {
  try {
    const { id } = req.params;

    const run = db.prepare(`
      SELECT * FROM backtests WHERE id = ?
    `).get(id);

    if (!run) {
      return res.status(404).json({ error: 'Backtest not found' });
    }

    // Get windows
    const windows = db.prepare(`
      SELECT * FROM windows WHERE run_id = ?
      ORDER BY min_combined_price ASC
      LIMIT 100
    `).all(id);

    // Get trades
    const trades = db.prepare(`
      SELECT * FROM trades_sim WHERE run_id = ?
    `).all(id);

    res.json({
      run,
      windows,
      trades
    });
  } catch (error) {
    console.error('Error fetching backtest details:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtests/:id/status - Get progress tracking
 */
router.get('/:id/status', validate(schemas.uuidParam, 'params'), (req, res) => {
  try {
    const { id } = req.params;

    const job = db.prepare(`
      SELECT * FROM jobs WHERE run_id = ?
    `).get(id);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('Error fetching job status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/backtests/:id - Delete backtest run
 * Requires authentication
 */
router.delete('/:id', requireAuth, validate(schemas.uuidParam, 'params'), (req, res) => {
  try {
    const { id } = req.params;

    // Delete in transaction
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM trades_sim WHERE run_id = ?').run(id);
      db.prepare('DELETE FROM windows WHERE run_id = ?').run(id);
      db.prepare('DELETE FROM jobs WHERE run_id = ?').run(id);
      db.prepare('DELETE FROM backtests WHERE id = ?').run(id);
    });

    transaction();

    res.json({ success: true, message: 'Backtest deleted' });
  } catch (error) {
    console.error('Error deleting backtest:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtests/:id/export/trades.csv - Export trades as CSV
 * Requires authentication (sensitive data export)
 */
router.get('/:id/export/trades.csv', requireAuth, validate(schemas.uuidParam, 'params'), (req, res) => {
  try {
    const { id } = req.params;

    const trades = db.prepare(`
      SELECT t.*, w.start_time, w.end_time, w.duration,
             w.entry_combined_price, w.min_combined_price
      FROM trades_sim t
      LEFT JOIN windows w ON t.window_id = w.id
      WHERE t.run_id = ?
      ORDER BY w.start_time
    `).all(id);

    if (trades.length === 0) {
      return res.status(404).json({ error: 'No trades found' });
    }

    // Generate CSV
    const headers = [
      'trade_id', 'result', 'profit', 'fees',
      'window_start', 'window_end', 'duration',
      'entry_price', 'min_price'
    ].join(',');

    const rows = trades.map(t => [
      t.id,
      t.result,
      t.profit,
      t.fees,
      t.start_time,
      t.end_time,
      t.duration,
      t.entry_combined_price,
      t.min_combined_price
    ].join(','));

    const csv = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trades_${id}.csv"`);
    res.send(csv);

  } catch (error) {
    console.error('Error exporting trades:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtests/:id/debug/top-windows - Get top arbitrage windows
 */
router.get('/:id/debug/top-windows', validate(schemas.uuidParam, 'params'), validate(schemas.queryLimit, 'query'), (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 10 } = req.query;

    const windows = db.prepare(`
      SELECT * FROM windows
      WHERE run_id = ?
      ORDER BY min_combined_price ASC
      LIMIT ?
    `).all(id, limit);

    res.json(windows);
  } catch (error) {
    console.error('Error fetching top windows:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
