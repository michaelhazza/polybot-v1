# Polymarket Arbitrage MVP - Phase 1A

## Overview
Backtest management system for validating arbitrage opportunities in Polymarket prediction markets. Features backtest configuration, background job processing, window detection, trade simulation, and a metrics dashboard.

## Project Architecture
- **Frontend**: React + Vite (port 5000 in dev, served by Express in production)
- **Backend**: Express.js API (port 3001 in dev, port 5000 in production)
- **Database**: SQLite via better-sqlite3, stored at `data/polymarket.db`
- **Build**: Vite builds to `dist/`

## Key Directories
- `src/` - React frontend components
- `server/` - Express backend (routes, services, middleware, database)
- `data/` - SQLite database files

## Development
- `npm run dev` starts both frontend and backend via concurrently
- Vite proxies `/api` requests to backend on port 3001
- Database initialized via `node server/database/init.js`

## Deployment
- Build: `npm run build` + `node server/database/init.js`
- Run: `PORT=5000 node server/index.js` (serves both API and static frontend)
- Target: autoscale

## Recent Changes
- Configured Vite for Replit (port 5000, host 0.0.0.0, allowedHosts)
- Updated Express CORS to allow all origins for Replit proxy
- Added static file serving to Express for production deployment
