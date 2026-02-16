# Polymarket Arbitrage MVP - Phase 1A

Backtest management system for validating arbitrage opportunities in Polymarket prediction markets.

## Features

- Backtest configuration and management UI
- Background job processing
- Window detection with realistic execution constraints
- Conservative trade simulation
- Comprehensive metrics dashboard
- Run comparison and debugging tools
- **NEW:** Bitquery blockchain integration for granular on-chain data

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

4. Configure Bitquery (optional):
   - Sign up at https://ide.bitquery.io/
   - Get your OAuth token from Account → Profile → API Keys
   - Add to `.env`: `BITQUERY_OAUTH_TOKEN=Bearer your-token-here`
   - See [BITQUERY_INTEGRATION.md](./BITQUERY_INTEGRATION.md) for details

5. Run development server:
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

## Data Sources

### Bitquery Integration (Recommended)

The system now supports Bitquery for accessing Polymarket data directly from the blockchain:

- **Benefits:** More granular data, full historical access, no API limitations
- **Setup:** See [BITQUERY_INTEGRATION.md](./BITQUERY_INTEGRATION.md)
- **Testing:** Run `node test-bitquery.js` to verify integration
- **Toggle:** Set `USE_BITQUERY=true` in `.env` (default)

### Polymarket API (Legacy)

Original data source using Polymarket's REST API:

- **Benefits:** Simple setup, no account required
- **Limitations:** Rate limits, limited historical data
- **Toggle:** Set `USE_BITQUERY=false` in `.env`

## Go/No-Go Metrics

1. **windows_per_analysis_hour** ≥ 0.1
2. **duration_p50** ≥ 10 seconds
3. **fill_success_rate** ≥ 20%
4. **avg_execution_adjusted_edge** ≥ 0.5%
5. **data_coverage_pct** ≥ 90%

## Testing

### Bitquery Integration Test

```bash
node test-bitquery.js
```

Expected: All 5 tests should pass

### Full System Test

```bash
npm run test
```
