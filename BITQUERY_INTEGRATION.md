# Bitquery-Polymarket Integration Documentation

## Overview

This integration replaces the Polymarket API data source with Bitquery's comprehensive blockchain indexing to access granular Bitcoin UP/DOWN prediction market data for arbitrage detection.

**Key Benefits:**
- Direct blockchain data access (no API limitations)
- Historical data availability
- Real-time event streaming capability
- More granular price data from OrderFilled events

## Architecture

### Data Flow

```
Bitquery GraphQL API
  ↓
BitqueryClient (lib/bitquery-client.js)
  ↓
Market Finder (lib/polymarket-market-finder.js)
  ↓
Data Mappers (lib/data-mappers.js)
  ↓
PolymarketClient (server/services/polymarket-client.js)
  ↓
Existing Backtest Pipeline (unchanged)
```

### Components

#### 1. BitqueryClient (`/lib/bitquery-client.js`)
- GraphQL client wrapper
- Authentication handling
- Rate limiting (50 req/min)
- Retry logic with exponential backoff
- Query methods for Polymarket events

#### 2. Query Templates (`/config/bitquery-queries.js`)
- Pre-built GraphQL queries
- OrderFilled events (price data)
- ConditionPreparation events (market creation)
- QuestionInitialized events (market metadata)
- Helper functions for query building

#### 3. Data Mappers (`/lib/data-mappers.js`)
- Transform Bitquery events → database schema
- Price calculation from OrderFilled events
- Token ID → UP/DOWN mapping
- Market question parsing
- Bitcoin market filtering

#### 4. Market Finder (`/lib/polymarket-market-finder.js`)
- Discovers Bitcoin markets on-chain
- Filters by timeframe (5m, 15m, etc.)
- Maps market metadata
- Batch discovery for large date ranges

## Setup Instructions

### 1. Create Bitquery Account

1. Visit https://ide.bitquery.io/
2. Sign up for a free account
3. Navigate to: **Account → Profile → API Keys**
4. Copy your OAuth token (format: `Bearer your-token-here`)

### 2. Configure Environment Variables

Add the following to your `.env` file:

```bash
# Data Source Selection
USE_BITQUERY=true

# Bitquery API Configuration
BITQUERY_OAUTH_TOKEN=Bearer your-token-here
BITQUERY_STREAMING_ENDPOINT=https://streaming.bitquery.io/graphql
BITQUERY_STANDARD_ENDPOINT=https://graphql.bitquery.io/
```

**Important:** Replace `your-token-here` with your actual Bitquery OAuth token.

### 3. Install Dependencies

```bash
npm install graphql graphql-request
```

### 4. Test Integration

Run the test script to verify everything is working:

```bash
node test-bitquery.js
```

Expected output:
```
✓ PASS - Health Check
✓ PASS - Market Discovery
✓ PASS - Active Markets
✓ PASS - Client Integration
✓ PASS - OrderFilled Query

Results: 5/5 tests passed
```

## Usage

### Switching Between Data Sources

The integration supports both Bitquery and Polymarket API:

```bash
# Use Bitquery (blockchain data)
USE_BITQUERY=true

# Use Polymarket API (legacy)
USE_BITQUERY=false
```

No code changes required - the `PolymarketClient` automatically switches based on the environment variable.

### Running Backtests

Backtests work exactly the same as before:

```javascript
// Via API
POST /api/backtests
{
  "name": "BTC 30d Backtest",
  "asset": "BTC",
  "timeframe": "15m",
  "period": "30d",
  "trade_size": 100
}
```

The backtest will now use Bitquery data if `USE_BITQUERY=true`.

### Market Discovery

Find Bitcoin markets programmatically:

```javascript
import { findBitcoinMarkets, findActiveBitcoinMarkets } from './lib/polymarket-market-finder.js';

// Find all Bitcoin markets in date range
const markets = await findBitcoinMarkets(
  new Date('2024-01-01'),
  new Date('2024-01-31'),
  '15m' // Optional: filter by timeframe
);

// Find currently active markets
const activeMarkets = await findActiveBitcoinMarkets('15m', 24); // Last 24 hours
```

### Direct Bitquery Queries

Query blockchain events directly:

```javascript
import bitqueryClient from './lib/bitquery-client.js';

// Get OrderFilled events (trades)
const events = await bitqueryClient.queryOrderFilledEvents(
  'condition_id_here',
  '2024-01-01T00:00:00Z',
  '2024-01-31T23:59:59Z',
  1000 // limit
);

// Get account points balance
const points = await bitqueryClient.getPointsBalance();
console.log(`Points remaining: ${points}`);
```

## How It Works

### 1. Market Discovery

**Process:**
1. Query `ConditionPreparation` events → Find all markets created
2. Query `QuestionInitialized` events → Get market questions
3. Parse `ancillaryData` → Extract question text
4. Filter by keyword (Bitcoin, BTC, etc.)
5. Extract timeframe from question text
6. Map token IDs to UP/DOWN sides

**Example Market Question:**
```
"Will Bitcoin price be UP or DOWN in the next 15 minutes?"
```

**Extracted Metadata:**
- Asset: BTC
- Timeframe: 15m
- Type: UP/DOWN
- Token 0: UP
- Token 1: DOWN

### 2. Price Data Collection

**Process:**
1. Query `OrderFilled` events for market condition ID
2. Extract: `makerAmount` (USDC paid), `takerAmount` (tokens received)
3. Calculate price: `USDC_paid / tokens_received`
4. Group by 5-second buckets (matches existing schema)
5. Aggregate to snapshots table format

**Price Calculation:**
```javascript
// From OrderFilled event:
makerAmount = 10000000 // 10 USDC (6 decimals)
takerAmount = 20       // 20 tokens

price = (10000000 / 1000000) / 20 = 0.50 USDC per token
```

### 3. Data Transformation

**Input** (Bitquery OrderFilled event):
```json
{
  "Block": { "Timestamp": 1704067200 },
  "Arguments": [
    { "Name": "conditionId", "Value": { "address": "0xabc..." } },
    { "Name": "tokenId", "Value": { "integer": 0 } },
    { "Name": "makerAmount", "Value": { "bigInteger": "10000000" } },
    { "Name": "takerAmount", "Value": { "bigInteger": "20" } }
  ]
}
```

**Output** (Snapshot record):
```javascript
{
  market_id: "0xabc...",
  timestamp: 1704067200,
  side: "UP",
  mid: 0.50,
  last: 0.50,
  is_tradable: 1
}
```

## Points Management

Bitquery uses a points system for API access:

- **Free tier:** 10,000 points
- **Standard queries:** ~1-10 points each
- **Streaming:** Higher consumption

### Monitoring Points

```javascript
import bitqueryClient from './lib/bitquery-client.js';

const health = await bitqueryClient.healthCheck();
console.log(`Points: ${health.points}`);
```

### Optimizing Point Usage

1. **Batch queries:** Use `batchDiscoverMarkets()` for large date ranges
2. **Cache results:** Store market discoveries locally
3. **Limit results:** Set reasonable `limit` parameters
4. **Avoid streaming:** Use standard queries for historical data

## Rate Limiting

**Built-in limits:**
- 50 requests per minute (conservative)
- Automatic retry with exponential backoff (2s, 4s, 8s, 16s)
- Rate limit monitoring

**Configuration** (in `BitqueryClient`):
```javascript
this.requestLimit = 50;        // Requests per minute
this.requestWindow = 60000;    // 1 minute
this.maxRetries = 4;           // Retry attempts
this.baseDelay = 2000;         // 2 seconds base
```

## Troubleshooting

### Issue: "BITQUERY_OAUTH_TOKEN not set"

**Solution:**
1. Check `.env` file exists
2. Verify token format: `Bearer your-token-here`
3. Ensure no extra spaces or quotes
4. Restart server after updating `.env`

### Issue: "GraphQL error: Unauthorized"

**Causes:**
- Invalid or expired token
- Token not formatted correctly

**Solution:**
1. Log in to https://ide.bitquery.io/
2. Generate a new OAuth token
3. Update `.env` with new token
4. Test: `node test-bitquery.js`

### Issue: "No markets found"

**Possible reasons:**
1. Date range too narrow
2. No Bitcoin markets in that period
3. Timeframe filter too specific

**Solution:**
- Expand date range (try 30 days)
- Remove timeframe filter (pass `null`)
- Check Bitquery IDE for manual query testing

### Issue: "Rate limit exceeded"

**Solution:**
- Wait for rate limit window to reset (1 minute)
- Reduce concurrent requests
- Adjust `requestLimit` in BitqueryClient

### Issue: "Points balance too low"

**Solution:**
- Upgrade Bitquery account
- Optimize queries (reduce limit, narrow date range)
- Cache results to avoid re-fetching

## Testing

### Unit Testing

Test individual components:

```bash
# Test Bitquery client
node -e "import('./lib/bitquery-client.js').then(m => m.default.healthCheck().then(console.log))"

# Test market finder
node -e "import('./lib/polymarket-market-finder.js').then(m => m.findActiveBitcoinMarkets('15m', 24).then(console.log))"
```

### Integration Testing

Run full test suite:

```bash
node test-bitquery.js
```

### Backtest Comparison

Compare Bitquery vs Polymarket API:

```bash
# 1. Run backtest with Bitquery
USE_BITQUERY=true npm run server

# 2. Create backtest via API, note results

# 3. Switch to Polymarket API
USE_BITQUERY=false npm run server

# 4. Run identical backtest, compare metrics
```

**Expected:** Similar window detection, comparable metrics (±5% variance)

## Performance Considerations

### Query Performance

- **OrderFilled queries:** ~2-5 seconds (1000 events)
- **Market discovery:** ~3-10 seconds (100 markets)
- **Points consumption:** ~10-50 points per backtest

### Optimization Tips

1. **Use batch discovery** for large date ranges (>7 days)
2. **Cache market metadata** to avoid repeated queries
3. **Limit event counts** to reasonable values (1000-10000)
4. **Use date filters** to narrow query scope

### Comparison: Bitquery vs Polymarket API

| Metric | Bitquery | Polymarket API |
|--------|----------|----------------|
| Historical data | Full blockchain history | Limited (varies) |
| Rate limits | 50/min (configurable) | Unknown |
| Cost | Points-based | Free |
| Granularity | Event-level (5s buckets) | 5-minute aggregates |
| Reliability | Blockchain-backed | API availability |

## Contract Addresses

**Polygon (Matic) Network:**

- **CTF Exchange:** `0xC5d563A36AE78145C45a50134d48A1215220f80a`
  - OrderFilled events (trades)

- **Conditional Tokens:** `0x4d97dcd97ec945f40cf65f87097ace5ea0476045`
  - ConditionPreparation events (market creation)
  - QuestionInitialized events (market metadata)
  - PositionSplit events (token creation)

- **USDC:** `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
  - Payment token (6 decimals)

## GraphQL Query Examples

### Find Bitcoin Markets

```graphql
query {
  EVM(network: matic) {
    Events(
      where: {
        Log: {Signature: {Name: {eq: "ConditionPreparation"}}}
        LogHeader: {Address: {is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045"}}
      }
      limit: {count: 100}
    ) {
      Block { Time }
      Arguments { Name Value }
    }
  }
}
```

### Get Trade Data

```graphql
query {
  EVM(network: matic) {
    Events(
      where: {
        Block: {Time: {since: "2024-01-01", till: "2024-01-31"}}
        Log: {Signature: {Name: {eq: "OrderFilled"}}}
        LogHeader: {Address: {in: ["0xC5d563A36AE78145C45a50134d48A1215220f80a"]}}
        Arguments: {
          includes: [
            {Name: {eq: "conditionId"}, Value: {Address: {is: "0xabc..."}}}
          ]
        }
      }
      limit: {count: 1000}
    ) {
      Block { Timestamp }
      Arguments { Name Value }
    }
  }
}
```

## Migration Checklist

- [x] Create Bitquery account
- [x] Add OAuth token to `.env`
- [x] Install dependencies (`graphql`, `graphql-request`)
- [x] Test health check (`node test-bitquery.js`)
- [ ] Run 30-day BTC backtest with Bitquery
- [ ] Compare results with Polymarket API backtest
- [ ] Verify data coverage ≥90%
- [ ] Verify window detection works identically
- [ ] Monitor points consumption
- [ ] Document any discrepancies

## Support & Resources

### Bitquery Documentation
- API Docs: https://docs.bitquery.io/
- GraphQL IDE: https://ide.bitquery.io/
- Schema Explorer: https://docs.bitquery.io/docs/graphql/

### Polymarket Contracts
- Contract Docs: https://docs.polymarket.com/
- CTF Exchange: Polygon Scan
- GitHub: https://github.com/Polymarket

### Troubleshooting
- Check Bitquery status: https://status.bitquery.io/
- Test queries in IDE: https://ide.bitquery.io/
- Review error logs in console

## Next Steps

### Phase 1 (Completed)
- [x] Basic Bitquery integration
- [x] Market discovery
- [x] OrderFilled event queries
- [x] Data transformation
- [x] Testing framework

### Phase 2 (Optional)
- [ ] Real-time streaming subscriptions
- [ ] Advanced caching layer
- [ ] Multi-asset support (ETH, SOL)
- [ ] Position tracking
- [ ] Advanced analytics

### Phase 3 (Future)
- [ ] Custom data aggregations
- [ ] Alternative data sources
- [ ] Machine learning features
- [ ] Performance optimization

## License & Attribution

This integration uses:
- **Bitquery API** - Blockchain data indexing
- **Polymarket Contracts** - Prediction market protocol
- **GraphQL** - Query language

Data sourced from Polygon blockchain via Bitquery indexing.
