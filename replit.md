# Polymarket Arbitrage MVP - Phase 1A

## Overview
Backtest management system for validating arbitrage opportunities in Polymarket prediction markets. Features backtest configuration, background job processing, window detection, trade simulation, and a metrics dashboard.

## Project Architecture
- **Frontend**: React + Vite (port 5000 in dev, served by Express in production)
- **Backend**: Express.js API (port 3001 in dev, port 5000 in production)
- **Database**: SQLite via better-sqlite3, stored at `data/polymarket.db`
- **Build**: Vite builds to `dist/`
- **Live API**: Polymarket Gamma API (markets) + CLOB API (price history), with synthetic data fallback

## Key Directories
- `src/` - React frontend components
- `server/` - Express backend (routes, services, middleware, database)
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
- Data Download: Fetches real markets from Polymarket Gamma API, then price history from CLOB API at 5-minute granularity
- Backtesting: Uses downloaded data; timeframe (5min/15min/1hr) selected at backtest time to aggregate from granular data
- Synthetic fallback: Automatically generates synthetic data when no live markets found for an asset
- Stop/Resume: Downloads can be stopped mid-progress and resumed later
- Clear Data: Users can clear downloaded data for specific asset/period combinations
- Rate limiting: 100ms delays between API calls to avoid throttling

## UI Components
- ConfirmDialog: Reusable modal dialog for confirmations (replaces browser confirm())
- DataDownload: Download, persist, and inspect market data grouped by asset with expandable views
- BacktestConfigForm: Configure and run backtests with timeframe selection

## Recent Changes
- Redesigned DataDownload to show saved downloads grouped by asset (Bitcoin, etc.) with expandable inspection
- Added GET /api/data-downloads endpoint listing all downloads with market/snapshot counts
- Downloads persist in SQLite across app restarts; click any completed download to expand and inspect
- Expanded view shows Arbitrage View, Price Chart, and Raw Data tabs with per-market analysis
- Fixed timestamp alignment: rounds to 5-minute buckets for perfect YES/NO pairing
- Added reusable ConfirmDialog component for proper UI confirmations
- Changed data fetching to 5-minute fidelity for granular price history
- Integrated live Polymarket API (Gamma + CLOB) for real market data
- Added smart fallback to synthetic data when no live markets found
- Added stop/resume functionality for data downloads
- Configured Vite for Replit (port 5000, host 0.0.0.0, allowedHosts)
- Database files excluded from git (too large for GitHub)
