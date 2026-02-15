# Implementation Notes - Polymarket Arbitrage MVP Phase 1A

## Architecture Overview

This implementation follows the Phase 1A specification precisely, focusing on:
- Backtest management UI for systematic testing
- Background job processing
- Single data tier (Tier B) with synthetic data generation
- Conservative execution simulator
- Go/no-go validation metrics

## Key Components

### Backend (`/server`)

1. **Database Layer** (`/server/database`)
   - `db.js` - Database connection
   - `init.js` - Schema initialization with all required tables and indexes

2. **Services** (`/server/services`)
   - `polymarket-client.js` - Polymarket API client with synthetic data generation
   - `window-detector.js` - Window detection algorithm with deterministic pairing and stitching
   - `trade-simulator.js` - Conservative trade simulator with fill logic
   - `backtest-processor.js` - Orchestrates the complete backtest pipeline
   - `job-runner.js` - Background job queue and processing

3. **Routes** (`/server/routes`)
   - `backtests.js` - REST API endpoints for backtest CRUD and exports

### Frontend (`/src`)

1. **Components** (`/src/components`)
   - `BacktestConfigForm.jsx` - Backtest configuration form
   - `BacktestRunsTable.jsx` - Table with sorting, filtering, and multi-select
   - `RunDetail.jsx` - Detailed results dashboard with tabs
   - `RunComparison.jsx` - Side-by-side comparison of multiple runs
   - `WindowDebugger.jsx` - Detailed window analysis view

2. **Styling**
   - `index.css` - Dark theme UI styling

## Implementation Decisions

### 1. Synthetic Data Generation
For Phase 1A, the system uses synthetic data generation instead of live Polymarket API calls. This ensures:
- Reliable testing without API rate limits
- Deterministic results for validation
- Controlled arbitrage window creation (~5% of ticks create windows)

To switch to real API:
- Set `useSynthetic = false` in `server/services/backtest-processor.js:113`
- Implement proper Polymarket API endpoints in `polymarket-client.js`

### 2. Window Detection Algorithm
Implements the exact specification:
- Fixed anchor grid every 5 seconds
- Pairing with ±5s tolerance
- Tie-breaker: earlier timestamp wins
- Stitching only across consecutive valid anchors
- Validation: duration ≥5s, tick count ≥3, no stale/missing ticks

### 3. Progress Mirroring
Jobs table is source of truth for progress:
- Job runner updates jobs table first
- Mirrors to backtests table in same transaction
- UI table reads from backtests (fast)
- Status polling reads from jobs (accurate)

### 4. Metrics Calculation
All go/no-go metrics calculated precisely as specified:
- `windows_per_analysis_hour` = total_windows / analysis_hours
- `duration_p50` = median window duration
- `fill_success_rate` = completed_trades / windows_detected
- `avg_execution_adjusted_edge` = total_profit / total_capital_deployed
- `data_coverage_pct` = paired_ticks / expected_ticks

### 5. Trade Simulation
Conservative model only:
- Latency: 0.2s
- Min fill time: 1.0s
- Total required duration: 1.2s
- Trade completes only if window duration ≥ 1.2s
- Profit uses entry price (deterministic)
- No fees in Phase 1A

## File Structure

```
polybot-v1/
├── server/
│   ├── database/
│   │   ├── init.js          # Database schema
│   │   └── db.js            # Database connection
│   ├── routes/
│   │   └── backtests.js     # API endpoints
│   ├── services/
│   │   ├── polymarket-client.js     # Data ingestion
│   │   ├── window-detector.js       # Window detection
│   │   ├── trade-simulator.js       # Trade simulation
│   │   ├── backtest-processor.js    # Orchestration
│   │   └── job-runner.js            # Background jobs
│   └── index.js             # Express server
├── src/
│   ├── components/
│   │   ├── BacktestConfigForm.jsx
│   │   ├── BacktestRunsTable.jsx
│   │   ├── RunDetail.jsx
│   │   ├── RunComparison.jsx
│   │   └── WindowDebugger.jsx
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── data/
│   └── polymarket.db        # SQLite database
├── package.json
├── vite.config.js
├── index.html
└── README.md
```

## Testing

1. **Manual Testing**
   ```bash
   npm run dev
   ```
   - Navigate to http://localhost:5173
   - Create a backtest using the form
   - Monitor progress in the table
   - Click row to view detailed results
   - Select multiple runs and click "Compare"

2. **Automated Testing**
   ```bash
   # Terminal 1: Start server
   npm run server

   # Terminal 2: Run test script
   node test-workflow.js
   ```

## Go/No-Go Thresholds

| Metric | Threshold | Purpose |
|--------|-----------|---------|
| Windows per Hour | ≥0.1 | Sufficient opportunity frequency |
| Median Duration | ≥10s | Realistic execution time |
| Fill Success Rate | ≥20% | Viable conversion rate |
| Avg Edge | ≥0.5% | Positive returns after costs |
| Data Coverage | ≥90% | Data quality assurance |

**Decision Rule**: If BTC 15min 30-day run fails ANY metric → STOP by design

## What's NOT Implemented (Phase 1C/Phase 2)

- Multi-tier data architecture (A/B/C)
- Spread calibration engine
- Aggressive execution mode
- Clustering analysis
- Lifecycle bucketing
- Liquidity percentiles
- Underlying asset correlation
- Advanced percentile metrics
- Dataset fingerprinting
- Progressive backtest modes
- Cold storage retention

## Performance Considerations

- In-memory job queue (single-threaded)
- SQLite with WAL mode for concurrent reads
- Indexes on all frequently queried columns
- Max 1000 markets per run (prevents runaway jobs)
- Max 20 minute runtime per job (timeout protection)
- Synthetic data generation for reliable testing

## Future Enhancements

1. **Phase 1B**: Add real Polymarket API integration
2. **Phase 1C**: Research platform features (clustering, lifecycle analysis)
3. **Phase 2**: Multi-tier architecture, spread calibration
4. **Phase 3**: Production deployment with Redis job queue
