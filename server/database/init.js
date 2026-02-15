import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/polymarket.db');
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

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
  CONSTRAINT valid_period CHECK (period IN ('30d', '60d', '3m', '6m')),
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
  CONSTRAINT valid_download_status CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CONSTRAINT valid_download_period CHECK (period IN ('7d', '30d', '60d', '3m', '6m'))
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
  FOREIGN KEY (download_id) REFERENCES data_downloads(id) ON DELETE CASCADE
);
`);

// Create indexes
db.exec(`
CREATE INDEX IF NOT EXISTS idx_snapshots_lookup ON snapshots (market_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_windows_by_run ON windows (run_id);
CREATE INDEX IF NOT EXISTS idx_windows_run_minprice ON windows (run_id, min_combined_price);
CREATE INDEX IF NOT EXISTS idx_trades_by_run ON trades_sim (run_id);
CREATE INDEX IF NOT EXISTS idx_jobs_run ON jobs (run_id);
CREATE INDEX IF NOT EXISTS idx_backtests_status ON backtests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON data_downloads (status, created_at);
CREATE INDEX IF NOT EXISTS idx_downloaded_markets_download ON downloaded_markets (download_id);
CREATE INDEX IF NOT EXISTS idx_downloaded_snapshots_download ON downloaded_snapshots (download_id);
CREATE INDEX IF NOT EXISTS idx_downloaded_snapshots_lookup ON downloaded_snapshots (download_id, timestamp);
`);

console.log('Database initialized successfully at:', dbPath);

db.close();
