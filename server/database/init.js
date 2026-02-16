import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/polymarket.db');
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Foreign keys are already enabled in db.js
// No need to set again here

// Create tables
db.exec(`
-- Backtest runs (main management table)
CREATE TABLE IF NOT EXISTS backtests (
  id TEXT PRIMARY KEY,
  name TEXT,
  asset TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  period TEXT NOT NULL,
  trade_size REAL NOT NULL,
  status TEXT NOT NULL,
  parameters_json TEXT,

  analysis_start INTEGER NOT NULL,
  analysis_end INTEGER NOT NULL,

  progress_pct REAL DEFAULT 0,
  stage TEXT DEFAULT 'queued',

  windows_detected INTEGER DEFAULT 0,
  trades_completed INTEGER DEFAULT 0,
  fill_success_rate REAL DEFAULT 0,
  avg_execution_adjusted_edge REAL DEFAULT 0,
  data_coverage_pct REAL DEFAULT 0,
  windows_per_analysis_hour REAL DEFAULT 0,
  duration_p50 REAL DEFAULT 0,

  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT,

  CONSTRAINT valid_asset CHECK (asset IN ('BTC', 'ETH', 'SOL')),
  CONSTRAINT valid_status CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CONSTRAINT valid_timeframe CHECK (timeframe IN ('5min', '15min', '1hr')),
  CONSTRAINT valid_period CHECK (period IN ('7d', '30d', '60d', '3m', '6m', '12m', '24m', '36m')),
  CONSTRAINT valid_analysis_period CHECK (analysis_end > analysis_start),
  CONSTRAINT valid_trade_size CHECK (trade_size > 0)
);

-- Markets (classification only)
CREATE TABLE IF NOT EXISTS markets (
  market_id TEXT PRIMARY KEY,
  asset TEXT,
  timeframe TEXT,
  start_time INTEGER,
  end_time INTEGER,
  status TEXT,
  fee_regime TEXT DEFAULT 'fee_free'
);

-- Price data (Tier B - mid/last prices)
CREATE TABLE IF NOT EXISTS snapshots (
  market_id TEXT,
  timestamp INTEGER,
  side TEXT,
  mid REAL,
  last REAL,
  is_tradable INTEGER,
  PRIMARY KEY (market_id, timestamp, side)
);

-- Windows found per run
CREATE TABLE IF NOT EXISTS windows (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  market_id TEXT,
  start_time INTEGER,
  end_time INTEGER,
  duration INTEGER,
  entry_combined_price REAL,
  min_combined_price REAL,
  exit_combined_price REAL,
  tick_count INTEGER
);

-- Simulated trades per run
CREATE TABLE IF NOT EXISTS trades_sim (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  window_id TEXT,
  result TEXT,
  profit REAL,
  fees REAL
);

-- Background jobs (source of truth for progress)
CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  status TEXT,
  progress_pct REAL,
  stage TEXT,
  error_message TEXT
);

-- Data downloads (standalone data fetching)
CREATE TABLE IF NOT EXISTS data_downloads (
  id TEXT PRIMARY KEY,
  asset TEXT NOT NULL,
  period TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_pct REAL DEFAULT 0,
  stage TEXT DEFAULT 'queued',
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT,

  CONSTRAINT valid_download_asset CHECK (asset IN ('BTC', 'ETH', 'SOL')),
  CONSTRAINT valid_download_status CHECK (status IN ('queued', 'running', 'completed', 'failed', 'stopped')),
  CONSTRAINT valid_download_period CHECK (period IN ('7d', '30d', '60d', '3m', '6m', '12m', '24m', '36m', 'custom'))
);

-- Downloaded markets (per download session)
CREATE TABLE IF NOT EXISTS downloaded_markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  download_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  asset TEXT,
  timeframe TEXT,
  start_time INTEGER,
  end_time INTEGER,
  status TEXT,
  fee_regime TEXT DEFAULT 'fee_free',
  FOREIGN KEY (download_id) REFERENCES data_downloads(id) ON DELETE CASCADE
);

-- Downloaded snapshots (per download session)
CREATE TABLE IF NOT EXISTS downloaded_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  download_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  side TEXT NOT NULL,
  mid REAL,
  last REAL,
  is_tradable INTEGER,
  FOREIGN KEY (download_id) REFERENCES data_downloads(id) ON DELETE CASCADE,
  UNIQUE (download_id, market_id, timestamp, side)
);
`);

// Create migrations tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_name TEXT UNIQUE NOT NULL,
    applied_at INTEGER NOT NULL
  );
`);

/**
 * Helper function to check if a migration has been applied
 */
function isMigrationApplied(name) {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM schema_migrations WHERE migration_name = ?
  `).get(name);
  return result.count > 0;
}

/**
 * Helper function to record a migration as applied
 */
function recordMigration(name) {
  db.prepare(`
    INSERT INTO schema_migrations (migration_name, applied_at) VALUES (?, ?)
  `).run(name, Math.floor(Date.now() / 1000));
}

// Migration: Fix CHECK constraint to include 'stopped' status
if (!isMigrationApplied('add_stopped_status_to_downloads')) {
  const constraintCheck = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type='table' AND name='data_downloads'
  `).get();

  if (constraintCheck && constraintCheck.sql && !constraintCheck.sql.includes("'stopped'")) {
    console.log('[Migration] Adding "stopped" status to data_downloads...');

    // Preserve existing data
    const existingData = db.prepare('SELECT * FROM data_downloads').all();
    const existingMarkets = db.prepare('SELECT * FROM downloaded_markets').all();
    const existingSnapshots = db.prepare('SELECT * FROM downloaded_snapshots').all();

    const transaction = db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS downloaded_snapshots;
        DROP TABLE IF EXISTS downloaded_markets;
        DROP TABLE IF EXISTS data_downloads;
      `);

      db.exec(`
        CREATE TABLE data_downloads (
          id TEXT PRIMARY KEY,
          asset TEXT NOT NULL,
          period TEXT NOT NULL,
          status TEXT NOT NULL,
          progress_pct REAL DEFAULT 0,
          stage TEXT DEFAULT 'queued',
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          error_message TEXT,
          CONSTRAINT valid_download_asset CHECK (asset IN ('BTC', 'ETH', 'SOL')),
          CONSTRAINT valid_download_status CHECK (status IN ('queued', 'running', 'completed', 'failed', 'stopped')),
          CONSTRAINT valid_download_period CHECK (period IN ('7d', '30d', '60d', '3m', '6m', '12m', '24m', '36m'))
        );
        CREATE TABLE downloaded_markets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          download_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          asset TEXT,
          timeframe TEXT,
          start_time INTEGER,
          end_time INTEGER,
          status TEXT,
          fee_regime TEXT DEFAULT 'fee_free',
          FOREIGN KEY (download_id) REFERENCES data_downloads(id) ON DELETE CASCADE
        );
        CREATE TABLE downloaded_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          download_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          side TEXT NOT NULL,
          mid REAL,
          last REAL,
          is_tradable INTEGER,
          FOREIGN KEY (download_id) REFERENCES data_downloads(id) ON DELETE CASCADE
        );
      `);

      // Restore data
      const insertDl = db.prepare('INSERT INTO data_downloads VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const row of existingData) {
        insertDl.run(row.id, row.asset, row.period, row.status, row.progress_pct, row.stage,
                     row.start_time, row.end_time, row.created_at, row.completed_at, row.error_message);
      }

      const insertMkt = db.prepare('INSERT INTO downloaded_markets VALUES (?,?,?,?,?,?,?,?,?)');
      for (const row of existingMarkets) {
        insertMkt.run(row.id, row.download_id, row.market_id, row.asset, row.timeframe,
                      row.start_time, row.end_time, row.status, row.fee_regime);
      }

      const insertSnap = db.prepare('INSERT INTO downloaded_snapshots VALUES (?,?,?,?,?,?,?,?)');
      for (const row of existingSnapshots) {
        insertSnap.run(row.id, row.download_id, row.market_id, row.timestamp, row.side,
                       row.mid, row.last, row.is_tradable);
      }
    });

    transaction();
    recordMigration('add_stopped_status_to_downloads');
    console.log('[Migration] Successfully added "stopped" status (preserved existing data)');
  } else {
    recordMigration('add_stopped_status_to_downloads');
  }
}

// Migration: Add 12m, 24m, 36m period options
if (!isMigrationApplied('add_extended_periods_to_downloads')) {
  const periodCheck = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type='table' AND name='data_downloads'
  `).get();

  if (periodCheck && periodCheck.sql && !periodCheck.sql.includes("'12m'")) {
    console.log('[Migration] Adding extended periods (12m/24m/36m) to data_downloads...');

    // Preserve existing data
    const existingData = db.prepare('SELECT * FROM data_downloads').all();
    const existingMarkets = db.prepare('SELECT * FROM downloaded_markets').all();
    const existingSnapshots = db.prepare('SELECT * FROM downloaded_snapshots').all();

    const transaction = db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS downloaded_snapshots;
        DROP TABLE IF EXISTS downloaded_markets;
        DROP TABLE IF EXISTS data_downloads;
      `);

      db.exec(`
        CREATE TABLE data_downloads (
          id TEXT PRIMARY KEY,
          asset TEXT NOT NULL,
          period TEXT NOT NULL,
          status TEXT NOT NULL,
          progress_pct REAL DEFAULT 0,
          stage TEXT DEFAULT 'queued',
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          error_message TEXT,
          CONSTRAINT valid_download_asset CHECK (asset IN ('BTC', 'ETH', 'SOL')),
          CONSTRAINT valid_download_status CHECK (status IN ('queued', 'running', 'completed', 'failed', 'stopped')),
          CONSTRAINT valid_download_period CHECK (period IN ('7d', '30d', '60d', '3m', '6m', '12m', '24m', '36m'))
        );
        CREATE TABLE downloaded_markets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          download_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          asset TEXT,
          timeframe TEXT,
          start_time INTEGER,
          end_time INTEGER,
          status TEXT,
          fee_regime TEXT DEFAULT 'fee_free',
          FOREIGN KEY (download_id) REFERENCES data_downloads(id) ON DELETE CASCADE
        );
        CREATE TABLE downloaded_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          download_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          side TEXT NOT NULL,
          mid REAL,
          last REAL,
          is_tradable INTEGER,
          FOREIGN KEY (download_id) REFERENCES data_downloads(id) ON DELETE CASCADE
        );
      `);

      // Restore data
      const insertDl = db.prepare('INSERT INTO data_downloads VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const row of existingData) {
        insertDl.run(row.id, row.asset, row.period, row.status, row.progress_pct, row.stage,
                     row.start_time, row.end_time, row.created_at, row.completed_at, row.error_message);
      }

      const insertMkt = db.prepare('INSERT INTO downloaded_markets VALUES (?,?,?,?,?,?,?,?,?)');
      for (const row of existingMarkets) {
        insertMkt.run(row.id, row.download_id, row.market_id, row.asset, row.timeframe,
                      row.start_time, row.end_time, row.status, row.fee_regime);
      }

      const insertSnap = db.prepare('INSERT INTO downloaded_snapshots VALUES (?,?,?,?,?,?,?,?)');
      for (const row of existingSnapshots) {
        insertSnap.run(row.id, row.download_id, row.market_id, row.timestamp, row.side,
                       row.mid, row.last, row.is_tradable);
      }
    });

    transaction();
    recordMigration('add_extended_periods_to_downloads');
    console.log('[Migration] Successfully added extended periods (preserved existing data)');
  } else {
    recordMigration('add_extended_periods_to_downloads');
  }
}

// Migration: Add 'custom' period option and unique constraint on snapshots
if (!isMigrationApplied('add_custom_period_and_unique_snapshots')) {
  const periodCheck = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type='table' AND name='data_downloads'
  `).get();

  const needsPeriodUpdate = periodCheck && periodCheck.sql && !periodCheck.sql.includes("'custom'");

  if (needsPeriodUpdate) {
    console.log('[Migration] Adding custom period and unique snapshot constraint...');

    const existingData = db.prepare('SELECT * FROM data_downloads').all();
    const existingMarkets = db.prepare('SELECT * FROM downloaded_markets').all();
    const existingSnapshots = db.prepare('SELECT * FROM downloaded_snapshots').all();

    const uniqueSnapshots = [];
    const seenKeys = new Set();
    for (const row of existingSnapshots) {
      const key = `${row.download_id}_${row.market_id}_${row.timestamp}_${row.side}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueSnapshots.push(row);
      }
    }
    const dupsRemoved = existingSnapshots.length - uniqueSnapshots.length;
    if (dupsRemoved > 0) {
      console.log(`[Migration] Removing ${dupsRemoved} duplicate snapshots`);
    }

    const transaction = db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS downloaded_snapshots;
        DROP TABLE IF EXISTS downloaded_markets;
        DROP TABLE IF EXISTS data_downloads;
      `);

      db.exec(`
        CREATE TABLE data_downloads (
          id TEXT PRIMARY KEY,
          asset TEXT NOT NULL,
          period TEXT NOT NULL,
          status TEXT NOT NULL,
          progress_pct REAL DEFAULT 0,
          stage TEXT DEFAULT 'queued',
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          error_message TEXT,
          CONSTRAINT valid_download_asset CHECK (asset IN ('BTC', 'ETH', 'SOL')),
          CONSTRAINT valid_download_status CHECK (status IN ('queued', 'running', 'completed', 'failed', 'stopped')),
          CONSTRAINT valid_download_period CHECK (period IN ('7d', '30d', '60d', '3m', '6m', '12m', '24m', '36m', 'custom'))
        );
        CREATE TABLE downloaded_markets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          download_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          asset TEXT,
          timeframe TEXT,
          start_time INTEGER,
          end_time INTEGER,
          status TEXT,
          fee_regime TEXT DEFAULT 'fee_free',
          FOREIGN KEY (download_id) REFERENCES data_downloads(id) ON DELETE CASCADE
        );
        CREATE TABLE downloaded_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          download_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          side TEXT NOT NULL,
          mid REAL,
          last REAL,
          is_tradable INTEGER,
          FOREIGN KEY (download_id) REFERENCES data_downloads(id) ON DELETE CASCADE,
          UNIQUE (download_id, market_id, timestamp, side)
        );
      `);

      const insertDl = db.prepare('INSERT INTO data_downloads VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const row of existingData) {
        insertDl.run(row.id, row.asset, row.period, row.status, row.progress_pct, row.stage,
                     row.start_time, row.end_time, row.created_at, row.completed_at, row.error_message);
      }

      const insertMkt = db.prepare('INSERT INTO downloaded_markets VALUES (?,?,?,?,?,?,?,?,?)');
      for (const row of existingMarkets) {
        insertMkt.run(row.id, row.download_id, row.market_id, row.asset, row.timeframe,
                      row.start_time, row.end_time, row.status, row.fee_regime);
      }

      const insertSnap = db.prepare('INSERT INTO downloaded_snapshots VALUES (?,?,?,?,?,?,?,?)');
      for (const row of uniqueSnapshots) {
        insertSnap.run(row.id, row.download_id, row.market_id, row.timestamp, row.side,
                       row.mid, row.last, row.is_tradable);
      }
    });

    transaction();
    recordMigration('add_custom_period_and_unique_snapshots');
    console.log('[Migration] Successfully added custom period and unique constraint');
  } else {
    recordMigration('add_custom_period_and_unique_snapshots');
  }
}

// Create indexes for query performance
db.exec(`
-- Backtest and job indexes
CREATE INDEX IF NOT EXISTS idx_snapshots_lookup ON snapshots (market_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_windows_by_run ON windows (run_id);
CREATE INDEX IF NOT EXISTS idx_windows_run_minprice ON windows (run_id, min_combined_price);
CREATE INDEX IF NOT EXISTS idx_trades_by_run ON trades_sim (run_id);
CREATE INDEX IF NOT EXISTS idx_jobs_run ON jobs (run_id);
CREATE INDEX IF NOT EXISTS idx_backtests_status ON backtests (status, created_at);

-- Download indexes (optimized for common queries)
CREATE INDEX IF NOT EXISTS idx_downloads_status ON data_downloads (status, created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_asset_period ON data_downloads (asset, period, status);
CREATE INDEX IF NOT EXISTS idx_downloaded_markets_download ON downloaded_markets (download_id);
CREATE INDEX IF NOT EXISTS idx_downloaded_markets_asset ON downloaded_markets (asset, timeframe);
CREATE INDEX IF NOT EXISTS idx_downloaded_snapshots_download ON downloaded_snapshots (download_id);
CREATE INDEX IF NOT EXISTS idx_downloaded_snapshots_lookup ON downloaded_snapshots (download_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_downloaded_snapshots_market ON downloaded_snapshots (market_id, timestamp);
`);

console.log('[Database] Indexes created successfully');

console.log('[Database] Initialization complete at:', dbPath);
console.log('[Database] Connection ready for use');

// Don't close the db connection - it's shared across the application
// The connection will be closed when the application exits
