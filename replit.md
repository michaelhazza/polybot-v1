# Polymarket Arbitrage MVP - Phase 1A

## Overview
Backtest management system for validating arbitrage opportunities in Polymarket prediction markets. Features backtest configuration, background job processing, window detection, trade simulation, and a metrics dashboard.

## Project Architecture
- **Frontend**: React + Vite (port 5000 in dev, served by Express in production)
- **Backend**: Express.js API (port 3001 in dev, port 5000 in production)
- **Database**: SQLite via better-sqlite3, stored at `data/polymarket.db`
- **Build**: Vite builds to `dist/`
- **Data Sources**: Dual-source architecture (real data only, no synthetic fallback)
  - **Polymarket Gamma API**: Market discovery (has human-readable market names/questions)
  - **Bitquery V2 GraphQL**: Historical trade data via DEXTradeByTokens on Polygon (blockchain records)
  - **Polymarket CLOB API**: Alternative price history source (not currently active)

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
- **Market Discovery**: Gamma API finds markets by asset keyword (e.g., "BTC"), returns CLOB token IDs
- **Trade Data**: Bitquery DEXTradeByTokens fetches historical trades from Polygon blockchain
- **Token Mapping**: On-chain tokens lack human-readable names; Gamma API provides the mapping between token IDs and market questions
- **Snapshot Processing**: Trades bucketed into 5-minute intervals, YES/NO sides determined by token ID matching
- **Deduplication**: Before Bitquery API calls, checks existing DB coverage per market; skips API for markets already downloaded, copies cached data instead
- Backtesting: Uses downloaded data; timeframe (5min/15min/1hr) selected at backtest time
- Stop/Resume: Downloads can be stopped mid-progress and resumed later
- Clear Data: Users can clear downloaded data for specific asset/period combinations

## Bitquery Integration (V2 Schema)
- **Endpoint**: `https://streaming.bitquery.io/graphql`
- **Auth**: OAuth token (Bearer prefix auto-added by client)
- **V2 Schema Notes**:
  - Uses `is` instead of `eq` for Name filters
  - Requires `dataset: combined` parameter
  - Uses `DateTime` type for time variables
  - `Block.Time` (ISO string) instead of `Block.Timestamp`
  - Trade IDs in `Trade.Ids` array for token identification
- **Rate Limiting**: API has points-based quota; heavy testing can hit 402 errors

## UI Components
- ConfirmDialog: Reusable modal dialog for confirmations (replaces browser confirm())
- DataDownload: Download, persist, and inspect market data grouped by asset with expandable views
- BacktestConfigForm: Configure and run backtests with timeframe selection

## Recent Changes
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
- Updated all GraphQL queries for V2: `is` filters, `dataset: combined`, `DateTime` types
- Token ID matching: maps on-chain trade Ids to YES/NO outcomes via Gamma CLOB token IDs
- Redesigned DataDownload with expandable inspection (Arbitrage View, Price Chart, Raw Data)
- Added stop/resume functionality and clear data for downloads
- Configured Vite for Replit (port 5000, host 0.0.0.0, allowedHosts)
- Database files excluded from git
