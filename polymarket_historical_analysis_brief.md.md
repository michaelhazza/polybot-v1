# Polymarket Arbitrage MVP - Phase 1A Spike Contract

**Objective**: Validate arbitrage edge exists with realistic execution constraints + provide backtest management UI for systematic testing.

**Hard Scope Lock**: Everything not listed below is Phase 1C/Phase 2.

---

## MVP Definition (What Claude Builds)

**Core Question**: Does deterministic arbitrage exist after realistic execution constraints across different asset/timeframe configurations?

**Deliverables**: 
1. Backtest management UI (configure, queue, compare runs)
2. Background processing system  
3. Single data tier (Tier B) ingestion
4. Conservative execution simulator
5. Go/no-go validation metrics

---

## UI Requirements (Your Core Need)

### **Backtest Management Interface**
```jsx
<BacktestConfigForm />
// Form fields: asset (BTC/ETH/SOL), timeframe (5min/15min/1hr), 
//              period (30d/60d/3m/6m), trade_size ($5-$50)

<BacktestRunsTable />
// Table showing: name, asset, timeframe, period, status, fill_rate, 
//                avg_edge, windows_found, created_at, actions
// Features: sortable, filterable, multi-select for comparison
// CLICK ROW → opens detailed results view (primary delivery mechanism)

<RunDetail />
// MAIN RESULTS VIEW (in UI, not files):
// - Summary metrics dashboard (fill rate, edge, coverage, etc.)
// - Window frequency charts and duration histograms
// - Top 10 best edge windows with details
// - Trade simulation results table
// - Data quality indicators
// - Optional: Export buttons for CSV/JSON (secondary feature)

<RunComparison />
// Side-by-side comparison of selected runs (all metrics in UI)

<WindowDebugger />
// Detailed view of individual windows with paired tick data (in UI)
```

### **User Workflow (UI-Centric)** 
1. **"Run BTC 15min 6mo $25"** → Fill form → Submit → Background job → Row appears in table
2. **"View results"** → Click table row → Full results dashboard opens IN THE UI
3. **"Compare BTC vs ETH"** → Select both rows → Side-by-side comparison IN THE UI  
4. **"Debug suspicious window"** → Click window in results → Detailed tick analysis IN THE UI
5. **"Export for external analysis"** → Optional CSV/JSON download (secondary to UI viewing)

---

## Technical Architecture (Minimal)

### **Data Model (SQLite Only)**
```sql
-- Backtest runs (your main management table)
CREATE TABLE backtests (
  id TEXT PRIMARY KEY,
  name TEXT, -- "BTC 15min 6mo $25" 
  asset TEXT NOT NULL, timeframe TEXT NOT NULL, period TEXT NOT NULL,
  trade_size REAL NOT NULL, status TEXT NOT NULL,
  parameters_json TEXT, -- stores all run parameters for future expansion
  
  -- Analysis period boundaries (for reproducible metric calculations)
  analysis_start INTEGER NOT NULL, -- UTC epoch seconds
  analysis_end INTEGER NOT NULL,   -- UTC epoch seconds; anchor grid is [start, end) stepping by 5s
  
  -- UI progress visibility (mirrored from jobs table for fast UI queries)
  progress_pct REAL DEFAULT 0, -- copied from jobs.progress_pct
  stage TEXT DEFAULT 'queued', -- copied from jobs.stage
  
  -- Results summary (precisely defined metrics)
  windows_detected INTEGER DEFAULT 0,
  trades_completed INTEGER DEFAULT 0,
  fill_success_rate REAL DEFAULT 0, -- trades_completed / windows_detected
  avg_execution_adjusted_edge REAL DEFAULT 0, -- total_profit / total_notional_deployed
  data_coverage_pct REAL DEFAULT 0, -- actual_paired_ticks / expected_ticks
  windows_per_analysis_hour REAL DEFAULT 0, -- total_windows_detected / analysis_hours (name corrected)
  duration_p50 REAL DEFAULT 0, -- median window duration in seconds
  
  created_at INTEGER NOT NULL, completed_at INTEGER,
  error_message TEXT, -- populated when max_runtime_minutes exceeded or other failures
  
  -- Operational constraints (enforced in application logic, not DB constraints)
  CONSTRAINT valid_asset CHECK (asset IN ('BTC', 'ETH', 'SOL')),
  CONSTRAINT valid_status CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CONSTRAINT valid_timeframe CHECK (timeframe IN ('5min', '15min', '1hr')),
  CONSTRAINT valid_period CHECK (period IN ('30d', '60d', '3m', '6m')),
  CONSTRAINT valid_analysis_period CHECK (analysis_end > analysis_start),
  CONSTRAINT valid_trade_size CHECK (trade_size > 0)
);

-- Markets (classification only)
CREATE TABLE markets (
  market_id TEXT PRIMARY KEY,
  asset TEXT, timeframe TEXT, start_time INTEGER, end_time INTEGER,
  status TEXT, fee_regime TEXT DEFAULT 'fee_free'
);

-- Price data (Tier B only - mid/last prices)
CREATE TABLE snapshots (
  market_id TEXT, timestamp INTEGER, side TEXT, -- 'UP' or 'DOWN'
  mid REAL, last REAL, is_tradable INTEGER,
  PRIMARY KEY (market_id, timestamp, side)
);

-- Windows found per run
CREATE TABLE windows (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, market_id TEXT,
  start_time INTEGER, end_time INTEGER, duration INTEGER,
  entry_combined_price REAL, -- combined_price at window start (used for profit calculation)
  min_combined_price REAL,   -- lowest combined_price in window (best edge)
  exit_combined_price REAL,  -- combined_price at window end
  tick_count INTEGER
);

-- Simulated trades per run  
CREATE TABLE trades_sim (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, window_id TEXT,
  result TEXT, -- completed | failed (removed partial - impossible under current model)
  profit REAL, fees REAL
);

-- Background jobs (source of truth for progress tracking)
CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
  status TEXT, progress_pct REAL, stage TEXT,
  error_message TEXT
);

-- Job runner must write progress/stage to jobs table first, 
-- then mirror latest values to backtests table for fast UI table rendering

-- Performance indexes (after all tables created)
CREATE INDEX idx_snapshots_lookup ON snapshots (market_id, timestamp);
CREATE INDEX idx_windows_by_run ON windows (run_id);
CREATE INDEX idx_windows_run_minprice ON windows (run_id, min_combined_price); -- For RunDetail top windows sorting
CREATE INDEX idx_trades_by_run ON trades_sim (run_id);
CREATE INDEX idx_jobs_run ON jobs (run_id);  -- For UI status polling
CREATE INDEX idx_backtests_status ON backtests (status, created_at);
```

**<RunDetail />**
```jsx
// Individual run results + export buttons
// "Top 10 Windows" = lowest min_combined_price (best edge)
// Include paired ticks data for debug analysis
```

### **API Endpoints**
```javascript
POST /api/backtests           // Create new backtest run
GET  /api/backtests           // List all runs for table
GET  /api/backtests/:id       // Get run details  
GET  /api/backtests/:id/status // Progress tracking
DELETE /api/backtests/:id     // Delete run
GET  /api/backtests/:id/export/trades.csv
GET  /api/backtests/:id/debug/top-windows?limit=10  // Consistent with other endpoints
```

### **Operational Constraints (Replit-Safe)**
```javascript
// Per-run limits to prevent runaway jobs (enforced in application logic)
max_markets_per_run: 1000        // prevent memory overflow
max_runtime_minutes: 20          // job fails with error_message if exceeded  
target_tick_interval: 5          // seconds, fixed for Phase 1A determinism
// Runtime limits enforced by job runner, not database constraints
```

---

## Processing Logic (Simplified)

### **Single Data Tier (Tier B Primary)**
- Fetch mid/last prices from Polymarket API
- Store as two rows per timestamp (UP/DOWN sides)  
- No spread calibration complexity
- No Tier A/C fallback logic

### **Window Detection (Essential Rules Only)**
```javascript
// DETERMINISTIC TIMESTAMP RULE
// All timestamps stored as UTC epoch seconds (no timezone conversion, no millisecond precision)

// TARGET TICK INTERVAL (for coverage calculation)
const target_tick_interval = 5; // seconds - fixed for Phase 1A determinism

// PAIRING RULE & ANCHORING (FIXED GRID APPROACH)
const max_pairing_delta_seconds = 5;
// anchor_timeline = fixed grid from analysis_start to analysis_end in steps of target_tick_interval
// Create anchors every 5 seconds across [analysis_start, analysis_end) interval
// For each anchor timestamp t:
// - Find closest UP and DOWN ticks within ±5 seconds
// - TIE-BREAKER: If two ticks are equally close, choose the earlier timestamp
// - If abs(up_ts - down_ts) > 5 → discard tick (is_stale_pair = true)
// - If either side missing within ±5s → discard tick (is_missing = true)
// - Pairing must NEVER forward-fill to create new window start

// WINDOW STITCHING RULE (prevents accidental merging across gaps)
// A window continues only across consecutive anchors (no gaps)
// If an anchor is discarded (missing/stale), the window ends
// Windows cannot merge across discarded anchors

// STALE/MISSING DEFINITION (Tier B specific)
// is_missing = either UP or DOWN side has no tick within ±5s of anchor
// is_stale_pair = abs(up_ts - down_ts) > max_pairing_delta_seconds
// stale/missing paired tick = is_missing OR is_stale_pair

// SPREAD PROXY RULE (CRITICAL: half-spread per side)
const spread_proxy = 0.002; // half-spread per side (20 bps)
// proxy_ask = mid + spread_proxy
// combined_price = proxy_up_ask + proxy_down_ask = (up_mid + 0.002) + (down_mid + 0.002)
// Units: combined prices in contract dollars where 1.00 = $1 payout

// WINDOW VALIDITY  
// window_valid if:
//   duration_seconds >= 5 
//   AND tick_count >= 3
//   AND no stale/missing paired ticks inside window

// Window = continuous sequence where combined_price < 1.00
// CRITICAL: windows_detected counts only windows that pass window_valid rules
// (duration ≥ 5s, tick_count ≥ 3, no stale/missing ticks) after stitching
// NOT raw threshold crossings - prevents metric reconciliation issues
```

### **Progress Mirroring Rules (Source of Truth)**
```javascript
// SOURCE OF TRUTH: jobs table contains real-time progress
// UI OPTIMIZATION: backtests table mirrors latest values for fast table rendering

// Job runner must:
// 1. Update jobs.progress_pct and jobs.stage first
// 2. Mirror into backtests.progress_pct and backtests.stage in same transaction
// 
// UI behavior:
// - Table view reads backtests.progress_pct (fast)  
// - Status polling reads jobs table (source of truth)
// - Prevents "table says 80% but status says 55%" problems
```

### **Conservative Simulator Only**
```javascript
// DETERMINISTIC FILL MODEL (Tier B feasibility filter)
const latency_seconds = 0.2; // 200ms
const min_fill_time_seconds = 1; 
const settlement_delay_seconds = 60;

// FILL LOGIC
// A trade "completes" if window remains valid for required duration
// completed if: window_duration_seconds >= (latency_seconds + min_fill_time_seconds) 
// Otherwise mark as "failed" 

// PROFIT & EDGE CALCULATIONS (uses entry price for determinism)
// raw_edge = 1.00 - entry_combined_price  // uses price at window start
// fee_bps = 0 (no fees for Phase 1A)
// fees = 0
// profit = trade_size * (1.00 - entry_combined_price) - fees
// capital_deployed_per_trade = trade_size * entry_combined_price  // actual cost paid at entry
// total_capital_deployed = Σ(capital_deployed_per_trade) over completed trades
```

### **Go/No-Go Metrics (All Must Pass - Precisely Defined)**

**1. `windows_per_analysis_hour` ≥ 0.1**
```
= total_windows_detected / analysis_hours
where analysis_hours = (analysis_end - analysis_start) / 3600
```

**2. `duration_p50` ≥ 10 seconds**
```
= median window duration across all detected windows
```

**3. `fill_success_rate` ≥ 20%** 
```
= trades_completed / windows_detected
where trades_completed = count of "completed" result trades
```

**4. `avg_execution_adjusted_edge` ≥ 0.5%**
```
= total_profit / total_capital_deployed
where total_capital_deployed = Σ(trade_size * entry_combined_price) over completed trades
(percentage return on actual capital deployed, not max payout exposure)
```

**5. `data_coverage_pct` ≥ 90%**
```
= actual_paired_ticks / expected_ticks_over_period
where expected_ticks = floor((analysis_end - analysis_start) / target_tick_interval)
where target_tick_interval = 5 seconds (fixed grid approach)
```

**If BTC 15min 30-day run fails ANY metric → STOP by design.**

---

## Build Sequence (Disciplined)

**Week 1-2: Core Pipeline**
```javascript
spike-btc-15m.js // Single config script that produces windows.csv, trades.csv
```

**Week 3: Job System** 
```javascript
// Wrap spike into async job processor
// POST /api/backtests creates job, processes in background
```

**Week 4-5: Backtest Management UI**
```jsx
// Config form + runs table + comparison view + detail view + exports
// All focused on your systematic testing workflow
```

**Week 6: Debug & Polish**
```javascript  
// /debug/top-windows endpoint
// Data quality validation
// Error handling
```

---

## What's Explicitly CUT (Phase 1C/Phase 2)

❌ **Multi-tier data architecture** (A/B/C complexity)  
❌ **Spread calibration engine** (fixed proxy only)  
❌ **Aggressive execution mode** (conservative only)  
❌ **Clustering analysis** (no cluster metrics)  
❌ **Lifecycle bucketing** (no early/mid/late)  
❌ **Liquidity percentiles** (basic caps only)  
❌ **Underlying asset correlation** (no correlation tables)  
❌ **Advanced percentile metrics** (basic P50/P10 only)  
❌ **Dataset fingerprinting** (simple versioning only)  
❌ **Progressive backtest modes** (full runs only)  
❌ **Cold storage retention** (local SQLite only)  

---

## Success Criteria

**If BTC 15min 30-day run produces:**
- ✅ Windows exist (≥2 per day average)
- ✅ Realistic durations (≥10s median)  
- ✅ Viable fill rates (≥20% success)
- ✅ Positive edge after costs (≥0.5%)
- ✅ Clean data (≥90% coverage)

**Then**: Fund Phase 1C expansion with research platform features.

**If not**: Pivot strategy or adjust parameters.

---

## File Outputs (Internal Processing + Optional Exports)

**Internal Processing Files** (for job execution):
- `windows.csv` - Generated during processing for internal use
- `trades.csv` - Generated during processing for internal use  
- `run_summary.json` - Feeds the UI dashboard metrics

**Primary Results Delivery: IN THE UI**
- Click backtest row → Full results dashboard opens in web interface
- Summary metrics, charts, window details, trade results all rendered in UI
- No need to download files to see your results

**Optional Export Features** (secondary to UI viewing):
- Export buttons in UI for external analysis (CSV/JSON downloads)
- Debug endpoint for technical analysis
- But main consumption is through web interface

**This gives you immediate visual results plus optional data export for deeper analysis.**

---

**This gives you systematic backtest management to test different configurations while keeping technical complexity minimal for fast delivery.**
