import express from 'express';
import db from '../database/db.js';
import polymarketClient from '../services/polymarket-client.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const activeDownloads = new Set();
const cancelledDownloads = new Set();

function parsePeriod(period) {
  const map = {
    '7d': 7,
    '30d': 30,
    '60d': 60,
    '3m': 90,
    '6m': 180,
    '12m': 365,
    '24m': 730,
    '36m': 1095
  };
  return map[period] || 30;
}

router.get('/', (req, res) => {
  try {
    const downloads = db.prepare(`
      SELECT d.id, d.asset, d.period, d.status, d.progress_pct, d.stage, d.error_message,
             d.start_time, d.end_time, d.created_at, d.completed_at,
             (SELECT COUNT(*) FROM downloaded_markets WHERE download_id = d.id) as market_count,
             (SELECT COUNT(*) FROM downloaded_snapshots WHERE download_id = d.id) as snapshot_count
      FROM data_downloads d
      ORDER BY d.created_at DESC
    `).all();

    res.json(downloads);
  } catch (error) {
    console.error('Error listing downloads:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { asset, period, customStart, customEnd } = req.body;

    if (!asset || !period) {
      return res.status(400).json({ error: 'Missing required fields: asset, period' });
    }

    const validAssets = ['BTC', 'ETH', 'SOL'];
    if (!validAssets.includes(asset)) {
      return res.status(400).json({ error: `Invalid asset. Must be one of: ${validAssets.join(', ')}` });
    }

    const validPeriods = ['7d', '30d', '60d', '3m', '6m', '12m', '24m', '36m', 'custom'];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({ error: `Invalid period. Must be one of: ${validPeriods.join(', ')}` });
    }

    if (period === 'custom') {
      if (!customStart || !customEnd) {
        return res.status(400).json({ error: 'Custom period requires customStart and customEnd timestamps' });
      }
      if (typeof customStart !== 'number' || typeof customEnd !== 'number') {
        return res.status(400).json({ error: 'customStart and customEnd must be unix timestamps (numbers)' });
      }
      if (customEnd <= customStart) {
        return res.status(400).json({ error: 'customEnd must be after customStart' });
      }
      const maxRange = 1095 * 24 * 60 * 60;
      if (customEnd - customStart > maxRange) {
        return res.status(400).json({ error: 'Custom range cannot exceed 3 years' });
      }
    }

    let existing;
    if (period === 'custom') {
      existing = db.prepare(`
        SELECT id, start_time, end_time, status FROM data_downloads
        WHERE asset = ? AND period = 'custom' AND status IN ('running', 'stopped')
          AND start_time = ? AND end_time = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(asset, customStart, customEnd);
    } else {
      existing = db.prepare(`
        SELECT id, start_time, end_time, status FROM data_downloads
        WHERE asset = ? AND period = ? AND status IN ('running', 'stopped')
        ORDER BY created_at DESC
        LIMIT 1
      `).get(asset, period);
    }

    if (existing) {
      if (activeDownloads.has(existing.id)) {
        return res.json({
          success: true,
          downloadId: existing.id,
          resumed: true,
          message: 'Download already in progress'
        });
      }

      activeDownloads.add(existing.id);
      db.prepare(`UPDATE data_downloads SET status = 'running' WHERE id = ?`).run(existing.id);
      processDataDownload(existing.id, asset, existing.start_time, existing.end_time).catch(err => {
        console.error(`Error resuming download ${existing.id}:`, err);
        db.prepare(`
          UPDATE data_downloads SET status = ?, error_message = ? WHERE id = ?
        `).run('failed', err.message, existing.id);
      }).finally(() => {
        activeDownloads.delete(existing.id);
      });

      return res.json({
        success: true,
        downloadId: existing.id,
        resumed: true,
        message: 'Resuming interrupted download'
      });
    }

    const downloadId = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    let startTime, endTime;
    if (period === 'custom') {
      startTime = customStart;
      endTime = customEnd;
    } else {
      const periodDays = parsePeriod(period);
      startTime = now - (periodDays * 24 * 60 * 60);
      endTime = now;
    }

    db.prepare(`
      INSERT INTO data_downloads
      (id, asset, period, status, progress_pct, stage, start_time, end_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(downloadId, asset, period, 'running', 0, 'Initializing', startTime, endTime, now);

    activeDownloads.add(downloadId);
    processDataDownload(downloadId, asset, startTime, endTime).catch(err => {
      console.error(`Error processing download ${downloadId}:`, err);
      db.prepare(`
        UPDATE data_downloads SET status = ?, error_message = ? WHERE id = ?
      `).run('failed', err.message, downloadId);
    }).finally(() => {
      activeDownloads.delete(downloadId);
    });

    res.json({
      success: true,
      downloadId,
      resumed: false,
      message: 'Data download started'
    });

  } catch (error) {
    console.error('Error starting data download:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/analyze/range', (req, res) => {
  try {
    const { asset, start, end } = req.query;

    if (!asset || !start || !end) {
      return res.status(400).json({ error: 'Missing required query params: asset, start, end' });
    }

    const startTime = parseInt(start, 10);
    const endTime = parseInt(end, 10);

    if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) {
      return res.status(400).json({ error: 'Invalid start/end timestamps' });
    }

    const completedDownloads = db.prepare(`
      SELECT id FROM data_downloads
      WHERE asset = ? AND status = 'completed'
    `).all(asset);

    if (completedDownloads.length === 0) {
      return res.json({ snapshots: [], markets: [], meta: { asset, start_time: startTime, end_time: endTime, total_snapshots: 0, total_markets: 0, source_downloads: 0 } });
    }

    const ids = completedDownloads.map(d => d.id);
    const placeholders = ids.map(() => '?').join(',');

    const totalCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM downloaded_snapshots
      WHERE download_id IN (${placeholders})
        AND timestamp >= ? AND timestamp <= ?
    `).all(...ids, startTime, endTime)[0].cnt;

    const MAX_SNAPSHOTS = 50000;
    let snapshots;

    if (totalCount <= MAX_SNAPSHOTS) {
      snapshots = db.prepare(`
        SELECT market_id, timestamp, side, mid, last, is_tradable
        FROM downloaded_snapshots
        WHERE download_id IN (${placeholders})
          AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
      `).all(...ids, startTime, endTime);
    } else {
      const sampleRate = Math.ceil(totalCount / MAX_SNAPSHOTS);
      snapshots = db.prepare(`
        SELECT market_id, timestamp, side, mid, last, is_tradable
        FROM downloaded_snapshots
        WHERE download_id IN (${placeholders})
          AND timestamp >= ? AND timestamp <= ?
          AND rowid % ? = 0
        ORDER BY timestamp ASC
      `).all(...ids, startTime, endTime, sampleRate);
    }

    const seen = new Set();
    const dedupedSnapshots = [];
    for (const s of snapshots) {
      const key = `${s.market_id}_${s.timestamp}_${s.side}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedSnapshots.push(s);
      }
    }

    const markets = db.prepare(`
      SELECT DISTINCT dm.market_id, dm.asset, dm.timeframe, dm.status, dm.fee_regime
      FROM downloaded_markets dm
      WHERE dm.download_id IN (${placeholders})
    `).all(...ids);

    const seenMarkets = new Set();
    const dedupedMarkets = [];
    for (const m of markets) {
      if (!seenMarkets.has(m.market_id)) {
        seenMarkets.add(m.market_id);
        dedupedMarkets.push(m);
      }
    }

    res.json({
      snapshots: dedupedSnapshots,
      markets: dedupedMarkets,
      meta: {
        asset,
        start_time: startTime,
        end_time: endTime,
        total_snapshots: totalCount,
        returned_snapshots: dedupedSnapshots.length,
        total_markets: dedupedMarkets.length,
        source_downloads: completedDownloads.length,
        sampled: totalCount > MAX_SNAPSHOTS
      }
    });
  } catch (error) {
    console.error('Error analyzing range:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/status', (req, res) => {
  try {
    const { id } = req.params;

    const download = db.prepare(`
      SELECT id, asset, period, status, progress_pct, stage, error_message, created_at, completed_at
      FROM data_downloads WHERE id = ?
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

    const markets = db.prepare(`
      SELECT * FROM downloaded_markets WHERE download_id = ?
    `).all(id);

    const totalCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM downloaded_snapshots WHERE download_id = ?
    `).get(id).cnt;

    const MAX_SNAPSHOTS = 50000;
    let snapshots;

    if (totalCount <= MAX_SNAPSHOTS) {
      snapshots = db.prepare(`
        SELECT market_id, timestamp, side, mid, last, is_tradable
        FROM downloaded_snapshots WHERE download_id = ?
        ORDER BY timestamp ASC
      `).all(id);
    } else {
      const sampleRate = Math.ceil(totalCount / MAX_SNAPSHOTS);
      snapshots = db.prepare(`
        SELECT market_id, timestamp, side, mid, last, is_tradable
        FROM downloaded_snapshots WHERE download_id = ?
        AND rowid % ? = 0
        ORDER BY timestamp ASC
      `).all(id, sampleRate);
    }

    res.json({
      download: {
        id: download.id,
        asset: download.asset,
        period: download.period,
        start_time: download.start_time,
        end_time: download.end_time
      },
      markets,
      snapshots,
      meta: {
        total_snapshots: totalCount,
        returned_snapshots: snapshots.length,
        sampled: totalCount > MAX_SNAPSHOTS
      }
    });
  } catch (error) {
    console.error('Error fetching download data:', error);
    res.status(500).json({ error: error.message });
  }
});

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

    const headers = [
      'timestamp', 'datetime', 'market_id', 'side',
      'mid_price', 'last_price', 'is_tradable'
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

router.delete('/by-asset', (req, res) => {
  try {
    const { asset, period } = req.body;

    if (!asset) {
      return res.status(400).json({ error: 'Missing required field: asset' });
    }

    let downloads;
    if (period) {
      downloads = db.prepare(`
        SELECT id FROM data_downloads WHERE asset = ? AND period = ?
      `).all(asset, period);
    } else {
      downloads = db.prepare(`
        SELECT id FROM data_downloads WHERE asset = ?
      `).all(asset);
    }

    if (downloads.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No data found to clear' });
    }

    const ids = downloads.map(d => d.id);

    const transaction = db.transaction(() => {
      for (const id of ids) {
        db.prepare('DELETE FROM downloaded_snapshots WHERE download_id = ?').run(id);
        db.prepare('DELETE FROM downloaded_markets WHERE download_id = ?').run(id);
        db.prepare('DELETE FROM data_downloads WHERE id = ?').run(id);
      }
    });

    transaction();

    const label = period ? `${asset} / ${period}` : asset;
    res.json({ success: true, deleted: ids.length, message: `Cleared ${ids.length} download(s) for ${label}` });
  } catch (error) {
    console.error('Error clearing data:', error);
    res.status(500).json({ error: error.message });
  }
});

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

router.post('/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;

    const download = db.prepare(`
      SELECT id, asset, period, status, start_time, end_time FROM data_downloads WHERE id = ?
    `).get(id);

    if (!download) {
      return res.status(404).json({ error: 'Download not found' });
    }

    if (!['running', 'stopped', 'failed'].includes(download.status)) {
      return res.status(400).json({ error: 'Download cannot be resumed (already completed)' });
    }

    if (activeDownloads.has(id)) {
      return res.json({ success: true, downloadId: id, message: 'Download already in progress' });
    }

    activeDownloads.add(id);
    db.prepare(`UPDATE data_downloads SET status = 'running', error_message = NULL WHERE id = ?`).run(id);

    processDataDownload(id, download.asset, download.start_time, download.end_time).catch(err => {
      console.error(`Error resuming download ${id}:`, err);
      db.prepare(`
        UPDATE data_downloads SET status = ?, error_message = ? WHERE id = ?
      `).run('failed', err.message, id);
    }).finally(() => {
      activeDownloads.delete(id);
    });

    res.json({ success: true, downloadId: id, message: 'Resuming download' });
  } catch (error) {
    console.error('Error resuming download:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/stop', (req, res) => {
  try {
    const { id } = req.params;

    const download = db.prepare(`
      SELECT id, status FROM data_downloads WHERE id = ?
    `).get(id);

    if (!download) {
      return res.status(404).json({ error: 'Download not found' });
    }

    if (download.status !== 'running') {
      return res.status(400).json({ error: 'Download is not running' });
    }

    cancelledDownloads.add(id);

    res.json({ success: true, message: 'Stop signal sent' });
  } catch (error) {
    console.error('Error stopping download:', error);
    res.status(500).json({ error: error.message });
  }
});

function getExistingCoverage(asset, startTime, endTime) {
  const existingDownloads = db.prepare(`
    SELECT id FROM data_downloads
    WHERE asset = ? AND status = 'completed'
  `).all(asset);

  if (existingDownloads.length === 0) return new Map();

  const ids = existingDownloads.map(d => d.id);
  const placeholders = ids.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT market_id, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts, COUNT(*) as cnt
    FROM downloaded_snapshots
    WHERE download_id IN (${placeholders})
      AND timestamp >= ? AND timestamp <= ?
    GROUP BY market_id
  `).all(...ids, startTime, endTime);

  const coverage = new Map();
  for (const row of rows) {
    coverage.set(row.market_id, {
      minTs: row.min_ts,
      maxTs: row.max_ts,
      count: row.cnt,
    });
  }
  return coverage;
}

function copyExistingSnapshots(downloadId, asset, marketId, startTime, endTime) {
  const existingDownloads = db.prepare(`
    SELECT id FROM data_downloads
    WHERE asset = ? AND status = 'completed'
  `).all(asset);

  if (existingDownloads.length === 0) return 0;

  const ids = existingDownloads.map(d => d.id);
  const placeholders = ids.map(() => '?').join(',');

  const snapshots = db.prepare(`
    SELECT market_id, timestamp, side, mid, last, is_tradable
    FROM downloaded_snapshots
    WHERE download_id IN (${placeholders}) AND market_id = ?
      AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(...ids, marketId, startTime, endTime);

  const seen = new Set();
  const unique = [];
  for (const s of snapshots) {
    const key = `${s.timestamp}_${s.side}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }

  if (unique.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO downloaded_snapshots (download_id, market_id, timestamp, side, mid, last, is_tradable)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const s of unique) {
      insert.run(downloadId, s.market_id, s.timestamp, s.side, s.mid, s.last, s.is_tradable);
    }
  });
  tx();

  return unique.length;
}

async function processDataDownload(downloadId, asset, startTime, endTime) {
  const updateProgress = (progress, stage) => {
    db.prepare(`
      UPDATE data_downloads SET progress_pct = ?, stage = ? WHERE id = ?
    `).run(progress, stage, downloadId);
  };

  try {
      updateProgress(-1, 'Checking existing data coverage...');
      const existingCoverage = getExistingCoverage(asset, startTime, endTime);

      if (existingCoverage.size > 0) {
        console.log(`[DataDownload] Found existing data for ${existingCoverage.size} markets`);
      }

      updateProgress(-1, 'Pulling Polymarket data...');
      const excludeMarketIds = new Set(existingCoverage.keys());
      const markets = await polymarketClient.fetchMarkets(asset, '15min', startTime, endTime, { excludeMarketIds });

      if (markets.length === 0) {
        console.warn(`[DataDownload] No markets found for ${asset}`);
        console.warn(`[DataDownload] This may be due to Bitquery quota limits or no matching markets in this date range`);

        updateProgress(100, 'No markets found for this asset/date range');
        db.prepare(`
          UPDATE data_downloads SET status = ?, completed_at = ?, error_message = ? WHERE id = ?
        `).run('failed', Math.floor(Date.now() / 1000), 'No markets found for this asset and date range. Check that Bitquery quota is available and the date range contains active markets.', downloadId);
        return;
      }

      const marketsToFetch = [];
      const marketsAlreadyCovered = [];

      for (const market of markets) {
        const cov = existingCoverage.get(market.market_id);
        if (cov && cov.minTs <= startTime + 86400 && cov.maxTs >= endTime - 86400 && cov.count > 10) {
          marketsAlreadyCovered.push(market);
        } else {
          marketsToFetch.push(market);
        }
      }

      console.log(`[DataDownload] ${marketsAlreadyCovered.length} markets already covered, ${marketsToFetch.length} need Bitquery fetch`);

      updateProgress(-1, `Found ${markets.length} market(s) (${marketsAlreadyCovered.length} cached, ${marketsToFetch.length} new)...`);

      const insertMarket = db.prepare(`
        INSERT OR IGNORE INTO downloaded_markets
        (download_id, market_id, asset, timeframe, start_time, end_time, status, fee_regime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const saveMarkets = db.transaction((marketList) => {
        for (const market of marketList) {
          insertMarket.run(
            downloadId, market.market_id, market.asset, market.timeframe,
            market.start_time, market.end_time, market.status, market.fee_regime
          );
        }
      });

      try {
        saveMarkets(markets);
        console.log(`[DataDownload] Saved ${markets.length} markets for download ${downloadId}`);
      } catch (error) {
        console.error(`[DataDownload] Error saving markets:`, error.message);
        throw new Error(`Failed to save market metadata: ${error.message}`);
      }

      const insertSnapshot = db.prepare(`
        INSERT OR IGNORE INTO downloaded_snapshots
        (download_id, market_id, timestamp, side, mid, last, is_tradable)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      let totalSnapshots = 0;
      let skippedMarkets = 0;
      const totalMarkets = markets.length;

      for (let i = 0; i < marketsAlreadyCovered.length; i++) {
        const market = marketsAlreadyCovered[i];

        if (cancelledDownloads.has(downloadId)) {
          cancelledDownloads.delete(downloadId);
          db.prepare(`UPDATE data_downloads SET status = 'stopped' WHERE id = ?`).run(downloadId);
          return;
        }

        const marketLabel = market.question ? market.question.substring(0, 50) : market.market_id;
        updateProgress(-1, `Copying cached data for market ${i + 1}/${marketsAlreadyCovered.length}: ${marketLabel}...`);

        try {
          const copied = copyExistingSnapshots(downloadId, asset, market.market_id, startTime, endTime);
          totalSnapshots += copied;
          skippedMarkets++;
          console.log(`[DataDownload] Copied ${copied} existing snapshots for ${market.market_id} (skipped Bitquery)`);
        } catch (error) {
          console.error(`[DataDownload] Error copying snapshots for ${market.market_id}:`, error.message);
          marketsToFetch.push(market);
        }
      }

      for (let i = 0; i < marketsToFetch.length; i++) {
        const market = marketsToFetch[i];

        if (cancelledDownloads.has(downloadId)) {
          cancelledDownloads.delete(downloadId);
          updateProgress(0, `Stopped (${totalSnapshots.toLocaleString()} snapshots saved)`);
          db.prepare(`UPDATE data_downloads SET status = 'stopped' WHERE id = ?`).run(downloadId);
          console.log(`Download ${downloadId} stopped by user`);
          return;
        }

        const marketLabel = market.question ? market.question.substring(0, 50) : market.market_id;
        updateProgress(
          -1,
          `Pulling data for market ${i + 1}/${marketsToFetch.length}: ${marketLabel}...`
        );

        const snapshots = await polymarketClient.fetchSnapshots(
          market,
          startTime,
          endTime
        );

        if (snapshots.length > 0) {
          const validSnapshots = snapshots.filter(s => {
            if (!s.market_id || !s.timestamp || !s.side) return false;
            if (typeof s.mid !== 'number' || typeof s.last !== 'number') return false;
            if (s.mid < 0 || s.mid > 1 || s.last < 0 || s.last > 1) return false;
            return true;
          });

          if (validSnapshots.length > 0) {
            const transaction = db.transaction(() => {
              for (const snapshot of validSnapshots) {
                insertSnapshot.run(
                  downloadId, snapshot.market_id, snapshot.timestamp,
                  snapshot.side, snapshot.mid, snapshot.last, snapshot.is_tradable
                );
              }
            });
            try {
              transaction();
              totalSnapshots += validSnapshots.length;
            } catch (error) {
              console.error(`[DataDownload] Error inserting snapshots for market ${market.market_id}:`, error.message);
            }
          }

          if (validSnapshots.length < snapshots.length) {
            console.warn(`[DataDownload] Filtered out ${snapshots.length - validSnapshots.length} invalid snapshots`);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const fetchedCount = marketsToFetch.length;
      const cachedCount = skippedMarkets;
      updateProgress(95, 'Finalizing...');
      updateProgress(100, `Completed (${totalSnapshots.toLocaleString()} snapshots, ${cachedCount} cached, ${fetchedCount} fetched)`);
      db.prepare(`
        UPDATE data_downloads SET status = ?, completed_at = ? WHERE id = ?
      `).run('completed', Math.floor(Date.now() / 1000), downloadId);

  } catch (error) {
    console.error('Error in processDataDownload:', error);
    db.prepare(`
      UPDATE data_downloads SET status = ?, error_message = ? WHERE id = ?
    `).run('failed', error.message, downloadId);
    throw error;
  }
}

export default router;
