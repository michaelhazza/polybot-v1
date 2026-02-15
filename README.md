# Polymarket Arbitrage MVP - Phase 1A

Backtest management system for validating arbitrage opportunities in Polymarket prediction markets.

## Features

- Backtest configuration and management UI
- Background job processing
- Window detection with realistic execution constraints
- Conservative trade simulation
- Comprehensive metrics dashboard
- Run comparison and debugging tools

## Setup

1. Install dependencies:
```bash
npm install
```

2. Initialize database:
```bash
npm run db:init
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Run development server:
```bash
npm run dev
```

## API Endpoints

- `POST /api/backtests` - Create new backtest run
- `GET /api/backtests` - List all runs
- `GET /api/backtests/:id` - Get run details
- `GET /api/backtests/:id/status` - Progress tracking
- `DELETE /api/backtests/:id` - Delete run
- `GET /api/backtests/:id/export/trades.csv` - Export trades
- `GET /api/backtests/:id/debug/top-windows` - Debug window data

## Go/No-Go Metrics

1. **windows_per_analysis_hour** ≥ 0.1
2. **duration_p50** ≥ 10 seconds
3. **fill_success_rate** ≥ 20%
4. **avg_execution_adjusted_edge** ≥ 0.5%
5. **data_coverage_pct** ≥ 90%
