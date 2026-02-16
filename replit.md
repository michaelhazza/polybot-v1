# Polymarket Arbitrage MVP - Phase 1A

## Overview
Backtest management system for validating arbitrage opportunities in Polymarket prediction markets. Features backtest configuration, background job processing, window detection, trade simulation, and a metrics dashboard.

## Project Architecture
- **Frontend**: React + Vite (port 5000 in dev, served by Express in production)
- **Backend**: Express.js API (port 3001 in dev, port 5000 in production)
- **Database**: SQLite via better-sqlite3, stored at `data/polymarket.db`
- **Build**: Vite builds to `dist/`
- **Data Sources**: Hybrid architecture (real data only, no synthetic fallback)
  - **Polymarket Gamma API**: Market discovery (has human-readable market names/questions)
  - **Polymarket CLOB API**: Primary price history source (free, ~30 day retention for active markets, tries multiple fidelities for closed markets)
  - **Bitquery V2 GraphQL**: Fallback for recent data (Feb 2026+) via DEXTradeByTokens on Polygon

## Key Directories
- `src/` - React frontend components
- `server/` - Express backend (routes, services, middleware, database)
- `lib/` - Shared libraries (Bitquery client, market finder, data mappers)
- `config/` - Configuration files (Bitquery GraphQL queries)
- `data/` - SQLite database files (gitignored)

## Development
- `npm run dev` starts both frontend and backend via concurrently
- Vite proxies `/api` requests to backend on port 3001
- Database initialized via `node server/database/init.js`

## Deployment
- Build: `npm run build` + `node server/database/init.js`
- Run: `PORT=5000 node server/index.js` (serves both API and static frontend)
- Target: autoscale

## Data Flow
- **Market Discovery**: Gamma API finds markets by asset keyword (e.g., "BTC"), returns CLOB token IDs (capped at 3000 per batch for performance)
- **Price Data (Hybrid)**: CLOB API tried first (free, no credits needed), Bitquery as fallback for recent data
- **CLOB API**: Tries multiple fidelity values (720min, 60min, 5min) for closed markets, filters to requested time range
- **Token Mapping**: On-chain tokens lack human-readable names; Gamma API provides the mapping between token IDs and market questions
- **Snapshot Processing**: Trades bucketed into configurable intervals, YES/NO sides determined by token ID matching
- **Deduplication**: Before API calls, checks existing DB coverage per market; skips API for markets already downloaded, copies cached data instead
- Backtesting: Uses downloaded data; timeframe (5min/15min/1hr) selected at backtest time
- Stop/Resume: Downloads can be stopped mid-progress and resumed later
- Clear Data: Users can clear downloaded data for specific asset/period combinations

## Bitquery Integration (V2 Schema) - Fallback Only
- **Endpoint**: `https://streaming.bitquery.io/graphql`
- **Auth**: OAuth token (Bearer prefix auto-added by client)
- **Role**: Fallback data source when CLOB API returns no data
- **Limitation**: Polymarket data only available from ~Feb 2026 onward
- **V2 Schema Notes**:
  - Uses `is` instead of `eq` for Name filters
  - Never use `dataset: combined` (causes timeouts)
  - Uses `DateTime` type for time variables
  - `Block.Time` (ISO string) instead of `Block.Timestamp`
  - Trade IDs in `Trade.Ids` array for token identification
- **Rate Limiting**: API has points-based quota; heavy testing can hit 402 errors
- **Credit Protection**: Market discovery no longer sends Bitquery queries (uses CLOB API for snapshots instead)

## UI Components
- ConfirmDialog: Reusable modal dialog for confirmations (replaces browser confirm())
- DataDownload: Download, persist, and inspect market data grouped by asset with expandable views
- BacktestConfigForm: Configure and run backtests with timeframe selection

## Recent Changes
- **Hybrid data pipeline (CLOB primary, Bitquery fallback)**: CLOB API tried first for all markets (free, no credits). Falls back to Bitquery only when CLOB returns no data. Saves Bitquery credits.
- **Skipped Bitquery during market discovery**: Market finder no longer sends Bitquery queries to fetch trades. Markets returned from Gamma with empty trades, CLOB API provides snapshot data during download phase.
- **Optimized Gamma API pagination**: Capped at 30 pages (3000 markets) per batch instead of 100 pages (10K). Reduces discovery time significantly.
- **CLOB API multi-fidelity**: For closed markets, tries fidelity 720 (12hr), 60 (1hr), 5 (5min). For active markets, tries 60, 5. Returns first successful result.
- **CLOB API time filtering**: Filters returned data to requested start/end time range before processing.
- **Fixed Bitquery API timeout**: Removed `dataset: combined` from all GraphQL queries - this parameter caused the Bitquery V2 API to timeout/return empty. Without it, queries respond instantly with real trade data.
- **Improved Gamma market filtering**: Added creation date filter to exclude very old markets (>2 years before query start). Prevents 2020-era markets from being included.
- **Future date validation**: Download endpoint now clamps end dates to current time and rejects invalid date ranges.
- **Removed all synthetic data**: System now only works with real Bitquery/Gamma API data. No synthetic fallback. If no markets are found, download reports failure instead of generating fake data.
- **Snapshot interval**: Default 1-minute (60s) intervals for trade bucketing
- **Market date filtering**: Gamma API results now filtered by endDate to exclude markets that ended before the query start time (prevents querying irrelevant old markets like 2020 election markets)
- **Bitquery credit protection**: When batch Bitquery query returns 0 trades for all markets, returns empty instead of sending hundreds of individual queries that waste API credits
- **Cross-download analysis**: Analyse Data section on Data Download tab combines data from all completed downloads for a custom date range
- **Custom time period**: Date picker UI for arbitrary start/end date ranges on Data Download tab
- **Unique constraint**: downloaded_snapshots table enforces UNIQUE(download_id, market_id, timestamp, side) to prevent duplicates at the DB level
- **INSERT OR IGNORE**: All snapshot inserts use OR IGNORE for safety with the unique constraint
- **DB init on startup**: server/database/init.js now runs automatically when server starts (imported in server/index.js)
- **Gamma API now fetches both active AND closed/resolved markets** for historical coverage (12+ months)
- Refactored market finder: Gamma markets fetched once, only Bitquery trade queries chunked by 7-day windows
- Added period options: 7d, 30d, 60d, 3m, 6m, 12m, 24m, 36m
- All date displays use Australian format (DD/MM/YYYY) via 'en-AU' locale
- Implemented hybrid data pipeline: Gamma API for market discovery + Bitquery for trade data
- Migrated Bitquery integration from V1 to V2 streaming schema
- Refactored from raw blockchain Events to efficient DEXTradeByTokens API
- Auto-prefixes "Bearer " to Bitquery OAuth token in bitquery-client.js
- Updated all GraphQL queries for V2: `is` filters, `DateTime` types (no `dataset: combined` - causes timeouts)
- Token ID matching: maps on-chain trade Ids to YES/NO outcomes via Gamma CLOB token IDs
- Redesigned DataDownload with expandable inspection (Arbitrage View, Price Chart, Raw Data)
- Added stop/resume functionality and clear data for downloads
- Configured Vite for Replit (port 5000, host 0.0.0.0, allowedHosts)
- Database files excluded from git
