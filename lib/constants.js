/**
 * Application Constants
 *
 * Centralized configuration and magic numbers used throughout the application.
 * This makes it easier to maintain and update values consistently.
 */

// Asset Configuration
export const VALID_ASSETS = ['BTC', 'ETH', 'SOL'];

// Period Configuration
export const VALID_PERIODS = ['7d', '30d', '60d', '3m', '6m', '12m', '24m', '36m'];

export const PERIOD_TO_DAYS = {
  '7d': 7,
  '30d': 30,
  '60d': 60,
  '3m': 90,
  '6m': 180,
  '12m': 365,
  '24m': 730,
  '36m': 1095,
};

// Timeframe Configuration
export const VALID_TIMEFRAMES = ['5min', '15min', '1hr'];

// Status Values
export const DOWNLOAD_STATUSES = ['queued', 'running', 'completed', 'failed', 'stopped'];
export const BACKTEST_STATUSES = ['queued', 'running', 'completed', 'failed'];

// Blockchain Configuration
export const USDC_DECIMALS = 1000000; // 6 decimal places on Polygon
export const USDC_CONTRACTS = [
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC (Bridged)
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // USDC Native
  '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
  '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', // WETH
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
];

// Polymarket Contract Addresses
export const POLYMARKET_CONTRACTS = {
  CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
  CONDITIONAL_TOKENS: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
};

// Data Processing Configuration
export const BUCKET_SIZE_SECONDS = 5; // Timestamp rounding bucket (5 seconds)
export const SNAPSHOT_BUCKET_SIZE_SECONDS = 300; // Snapshot aggregation bucket (5 minutes)

// Batch Processing Configuration
export const BATCH_SIZE = 1000; // Number of records per database batch insert
export const MARKET_DISCOVERY_CHUNK_DAYS = 7; // Days per chunk when discovering markets

// Rate Limiting Configuration
export const BITQUERY_RATE_LIMIT = 50; // Requests per minute
export const BITQUERY_RATE_WINDOW_MS = 60000; // 1 minute
export const BITQUERY_MAX_RETRIES = 4;
export const BITQUERY_BASE_DELAY_MS = 2000; // Base delay for exponential backoff

// API Limits
export const MAX_TRADES_PER_QUERY = 10000;
export const MAX_EVENTS_PER_QUERY = 10000;
export const DEFAULT_QUERY_LIMIT = 1000;

// Price Validation
export const MIN_VALID_PRICE = 0;
export const MAX_VALID_PRICE = 1;

// Asset Search Keywords
export const ASSET_KEYWORDS = {
  BTC: [/\bbitcoin\b/i, /\bbtc\b/i, /\$btc/i, /BTC-/i],
  ETH: [/\bethereum\b/i, /(?<![a-z])eth(?![a-z])/i, /\$eth/i],
  SOL: [/\bsolana\b/i, /(?<![a-z])sol(?![a-z])/i, /\$sol/i],
};

// Timeframe Detection Patterns
export const TIMEFRAME_PATTERNS = [
  { pattern: /5\s*min/i, value: '5m' },
  { pattern: /15\s*min/i, value: '15m' },
  { pattern: /30\s*min/i, value: '30m' },
  { pattern: /1\s*hour/i, value: '1h' },
  { pattern: /2\s*hour/i, value: '2h' },
  { pattern: /4\s*hour/i, value: '4h' },
  { pattern: /daily/i, value: '1d' },
];

// Market Type Detection Patterns
export const UP_DOWN_PATTERNS = [
  /\bup\b/i,
  /\bdown\b/i,
  /will.*rise/i,
  /will.*fall/i,
  /higher/i,
  /lower/i,
];

// API Endpoints
export const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
export const POLYMARKET_CLOB_BASE = 'https://clob.polymarket.com';
export const BITQUERY_STREAMING_ENDPOINT = 'https://streaming.bitquery.io/graphql';

// Retry Configuration
export const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000]; // Exponential backoff delays

// Logging Levels
export const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
};

export default {
  VALID_ASSETS,
  VALID_PERIODS,
  PERIOD_TO_DAYS,
  VALID_TIMEFRAMES,
  DOWNLOAD_STATUSES,
  BACKTEST_STATUSES,
  USDC_DECIMALS,
  USDC_CONTRACTS,
  POLYMARKET_CONTRACTS,
  BUCKET_SIZE_SECONDS,
  SNAPSHOT_BUCKET_SIZE_SECONDS,
  BATCH_SIZE,
  MARKET_DISCOVERY_CHUNK_DAYS,
  BITQUERY_RATE_LIMIT,
  BITQUERY_RATE_WINDOW_MS,
  BITQUERY_MAX_RETRIES,
  BITQUERY_BASE_DELAY_MS,
  MAX_TRADES_PER_QUERY,
  MAX_EVENTS_PER_QUERY,
  DEFAULT_QUERY_LIMIT,
  MIN_VALID_PRICE,
  MAX_VALID_PRICE,
  ASSET_KEYWORDS,
  TIMEFRAME_PATTERNS,
  UP_DOWN_PATTERNS,
  GAMMA_API_BASE,
  POLYMARKET_CLOB_BASE,
  BITQUERY_STREAMING_ENDPOINT,
  RETRY_DELAYS_MS,
  LOG_LEVELS,
};
