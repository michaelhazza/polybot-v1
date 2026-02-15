import express from 'express';
import db from '../database/db.js';
import polymarketClient from '../services/polymarket-client.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

/**
 * Parse period string to days
 */
function parsePeriod(period) {
  const map = {
    '7d': 7,
    '30d': 30,
    '60d': 60,
    '3m': 90,
    '6m': 180
  };
  return map[period] || 30;
}

/**
 * POST /api/data-downloads - Start new data download
 */
router.post('/', async (req, res) => {
  try {
    const { asset, period } = req.body;

    if (!asset || !period) {
      return res.status(400).json({ error: 'Missing required fields: asset, period' });
    }

    const downloadId = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const periodDays = parsePeriod(period);
    const startTime = now - (periodDays * 24 * 60 * 60);
    const endTime = now;

    // Create download record
    db.prepare(`
      INSERT INTO data_downloads
      (id, asset, period, status, progress_pct, stage, start_time, end_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      downloadId,
      asset,
      period,
      'running',
      0,
      'Initializing',
      startTime,
      endTime,
      now
    );

    // Start async download process
    processDataDownload(downloadId, asset, startTime, endTime).catch(err => {
      console.error(`Error processing download ${downloadId}:`, err);
      db.prepare(`
        UPDATE data_downloads
        SET status = ?, error_message = ?
        WHERE id = ?
      `).run('failed', err.message, downloadId);
    });

    res.json({
      success: true,
      downloadId,
      message: 'Data download started'
    });

  } catch (error) {
    console.error('Error starting data download:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/data-downloads/:id/status - Get download status
 */
router.get('/:id/status', (req, res) => {
  try {
    const { id } = req.params;

    const download = db.prepare(`
      SELECT id, asset, period, status, progress_pct, stage, error_message, created_at, completed_at
      FROM data_downloads
      WHERE id = ?
    `).get(id);

    if (!download) {
      return res.status(404).json({ error: 'Download not found' });
    }

    res.json(download);
  } catch (error) {
    console.error('Error fetching download status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/data-downloads/:id/data - Get downloaded data
 */
router.get('/:id/data', (req, res) => {
  try {
    const { id } = req.params;

    const download = db.prepare(`
      SELECT * FROM data_downloads WHERE id = ?
    `).get(id);

    if (!download) {
      return res.status(404).json({ error: 'Download not found' });
    }

    if (download.status !== 'completed') {
      return res.status(400).json({ error: 'Download not yet completed' });
    }

    // Fetch markets
    const markets = db.prepare(`
      SELECT * FROM downloaded_markets WHERE download_id = ?
    `).all(id);

    // Fetch snapshots
    const snapshots = db.prepare(`
      SELECT * FROM downloaded_snapshots WHERE download_id = ?
      ORDER BY timestamp ASC
    `).all(id);

    res.json({
      download: {
        id: download.id,
        asset: download.asset,
        period: download.period,
        start_time: download.start_time,
        end_time: download.end_time
      },
      markets,
      snapshots: snapshots.map(s => ({
        market_id: s.market_id,
        timestamp: s.timestamp,
        side: s.side,
        mid: s.mid,
        last: s.last,
        is_tradable: s.is_tradable
      }))
    });
  } catch (error) {
    console.error('Error fetching download data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/data-downloads/:id/export.csv - Export data as CSV
 */
router.get('/:id/export.csv', (req, res) => {
  try {
    const { id } = req.params;

    const download = db.prepare(`
      SELECT * FROM data_downloads WHERE id = ?
    `).get(id);

    if (!download) {
      return res.status(404).json({ error: 'Download not found' });
    }

    if (download.status !== 'completed') {
      return res.status(400).json({ error: 'Download not yet completed' });
    }

    const snapshots = db.prepare(`
      SELECT * FROM downloaded_snapshots
      WHERE download_id = ?
      ORDER BY timestamp ASC, side ASC
    `).all(id);

    if (snapshots.length === 0) {
      return res.status(404).json({ error: 'No data found' });
    }

    // Generate CSV
    const headers = [
      'timestamp',
      'datetime',
      'market_id',
      'side',
      'mid_price',
      'last_price',
      'is_tradable'
    ].join(',');

    const rows = snapshots.map(s => [
      s.timestamp,
      new Date(s.timestamp * 1000).toISOString(),
      s.market_id,
      s.side,
      s.mid,
      s.last,
      s.is_tradable
    ].join(','));

    const csv = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="data_${download.asset}_${download.period}.csv"`);
    res.send(csv);

  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/data-downloads/:id - Delete downloaded data
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM downloaded_snapshots WHERE download_id = ?').run(id);
      db.prepare('DELETE FROM downloaded_markets WHERE download_id = ?').run(id);
      db.prepare('DELETE FROM data_downloads WHERE id = ?').run(id);
    });

    transaction();

    res.json({ success: true, message: 'Download deleted' });
  } catch (error) {
    console.error('Error deleting download:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Process data download asynchronously
 */
async function processDataDownload(downloadId, asset, startTime, endTime) {
  const updateProgress = (progress, stage) => {
    db.prepare(`
      UPDATE data_downloads
      SET progress_pct = ?, stage = ?
      WHERE id = ?
    `).run(progress, stage, downloadId);
  };

  try {
    // Stage 1: Fetch markets (20%)
    updateProgress(5, 'Fetching markets...');
    const { markets, snapshots } = await polymarketClient.generateSyntheticData(
      asset,
      startTime,
      endTime,
      5 // 5 second intervals
    );

    updateProgress(20, 'Processing markets...');

    // Stage 2: Save markets (30%)
    const insertMarket = db.prepare(`
      INSERT INTO downloaded_markets
      (download_id, market_id, asset, timeframe, start_time, end_time, status, fee_regime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    markets.forEach(market => {
      insertMarket.run(
        downloadId,
        market.market_id,
        market.asset,
        market.timeframe,
        market.start_time,
        market.end_time,
        market.status,
        market.fee_regime
      );
    });

    updateProgress(30, `Downloading snapshots (0/${snapshots.length})...`);

    // Stage 3: Save snapshots with progress updates (30% -> 90%)
    const insertSnapshot = db.prepare(`
      INSERT INTO downloaded_snapshots
      (download_id, market_id, timestamp, side, mid, last, is_tradable)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const batchSize = 100;
    for (let i = 0; i < snapshots.length; i += batchSize) {
      const batch = snapshots.slice(i, i + batchSize);
      const transaction = db.transaction(() => {
        batch.forEach(snapshot => {
          insertSnapshot.run(
            downloadId,
            snapshot.market_id,
            snapshot.timestamp,
            snapshot.side,
            snapshot.mid,
            snapshot.last,
            snapshot.is_tradable
          );
        });
      });
      transaction();

      const saved = Math.min(i + batch.length, snapshots.length);
      const snapshotPct = Math.round((saved / snapshots.length) * 100);
      updateProgress(snapshotPct, `Downloading snapshots (${saved.toLocaleString()}/${snapshots.length.toLocaleString()})...`);

      // Small delay to make progress visible
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Stage 4: Complete (100%)
    updateProgress(100, 'Completed');
    db.prepare(`
      UPDATE data_downloads
      SET status = ?, completed_at = ?
      WHERE id = ?
    `).run('completed', Math.floor(Date.now() / 1000), downloadId);

  } catch (error) {
    console.error('Error in processDataDownload:', error);
    db.prepare(`
      UPDATE data_downloads
      SET status = ?, error_message = ?
      WHERE id = ?
    `).run('failed', error.message, downloadId);
    throw error;
  }
}

export default router;
