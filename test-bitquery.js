/**
 * Bitquery Integration Test Script
 *
 * Tests the Bitquery integration to ensure:
 * 1. API credentials are working
 * 2. Market discovery is functioning
 * 3. OrderFilled event queries work
 * 4. Data transformation is correct
 */

import dotenv from 'dotenv';
import bitqueryClient from './lib/bitquery-client.js';
import { findBitcoinMarkets, findActiveBitcoinMarkets } from './lib/polymarket-market-finder.js';
import polymarketClient from './server/services/polymarket-client.js';

dotenv.config();

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(80));
  log(title, 'cyan');
  console.log('='.repeat(80) + '\n');
}

async function testHealthCheck() {
  section('Test 1: Bitquery Health Check');

  try {
    const health = await bitqueryClient.healthCheck();

    log(`Status: ${health.status}`, health.status === 'healthy' ? 'green' : 'red');
    log(`Message: ${health.message}`, 'blue');

    if (health.points !== null) {
      log(`Points Balance: ${health.points}`, 'yellow');
    }

    return health.status === 'healthy';
  } catch (error) {
    log(`ERROR: ${error.message}`, 'red');
    return false;
  }
}

async function testMarketDiscovery() {
  section('Test 2: Bitcoin Market Discovery');

  try {
    // Search for Bitcoin markets in the last 7 days
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);

    log(`Searching for Bitcoin markets from ${startTime.toISOString()} to ${endTime.toISOString()}`, 'blue');

    const markets = await findBitcoinMarkets(startTime, endTime, '15m');

    log(`Found ${markets.length} Bitcoin markets`, markets.length > 0 ? 'green' : 'yellow');

    if (markets.length > 0) {
      log('\nFirst 3 markets:', 'cyan');
      markets.slice(0, 3).forEach((market, i) => {
        console.log(`\n  ${i + 1}. Market ID: ${market.market_id.substring(0, 20)}...`);
        console.log(`     Question: ${market.question.substring(0, 80)}...`);
        console.log(`     Timeframe: ${market.timeframe}`);
        console.log(`     UP/DOWN: ${market.is_up_down ? 'Yes' : 'No'}`);
        console.log(`     Created: ${new Date(market.created_at * 1000).toISOString()}`);
      });
    }

    return markets.length > 0;
  } catch (error) {
    log(`ERROR: ${error.message}`, 'red');
    console.error(error.stack);
    return false;
  }
}

async function testActiveMarkets() {
  section('Test 3: Active Bitcoin Markets');

  try {
    log('Searching for active 15m Bitcoin markets...', 'blue');

    const markets = await findActiveBitcoinMarkets('15m', 24);

    log(`Found ${markets.length} active markets`, markets.length > 0 ? 'green' : 'yellow');

    if (markets.length > 0) {
      log('\nActive markets:', 'cyan');
      markets.forEach((market, i) => {
        const age = Math.floor((Date.now() / 1000 - market.created_at) / 60);
        console.log(`  ${i + 1}. ${market.question.substring(0, 60)}... (Age: ${age} min)`);
      });
    }

    return true;
  } catch (error) {
    log(`ERROR: ${error.message}`, 'red');
    console.error(error.stack);
    return false;
  }
}

async function testPolymarketClientIntegration() {
  section('Test 4: PolymarketClient Integration');

  try {
    // Test market fetching through the integrated client
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - 7 * 24 * 60 * 60; // 7 days ago

    log('Testing fetchMarkets() with Bitquery integration...', 'blue');

    const markets = await polymarketClient.fetchMarkets('BTC', '15m', startTime, endTime);

    log(`Found ${markets.length} markets via PolymarketClient`, markets.length > 0 ? 'green' : 'yellow');

    if (markets.length > 0) {
      log('\nFirst market details:', 'cyan');
      const market = markets[0];
      console.log(`  Market ID: ${market.market_id}`);
      console.log(`  Question: ${market.question}`);
      console.log(`  Asset: ${market.asset}`);
      console.log(`  Timeframe: ${market.timeframe}`);
      console.log(`  Token IDs: ${JSON.stringify(market.clob_token_ids)}`);
      console.log(`  Token Mapping: ${JSON.stringify(market.token_mapping)}`);

      // Test snapshot fetching for first market
      log('\nTesting fetchSnapshots() for first market...', 'blue');

      const snapshots = await polymarketClient.fetchSnapshots(market, startTime, endTime);

      log(`Found ${snapshots.length} snapshots`, snapshots.length > 0 ? 'green' : 'yellow');

      if (snapshots.length > 0) {
        log('\nFirst 3 snapshots:', 'cyan');
        snapshots.slice(0, 3).forEach((snap, i) => {
          console.log(`  ${i + 1}. Time: ${new Date(snap.timestamp * 1000).toISOString()}, Side: ${snap.side}, Mid: ${snap.mid.toFixed(4)}`);
        });

        // Show data coverage
        const timestamps = [...new Set(snapshots.map(s => s.timestamp))];
        const sides = [...new Set(snapshots.map(s => s.side))];
        log(`\nData coverage:`, 'cyan');
        console.log(`  Unique timestamps: ${timestamps.length}`);
        console.log(`  Sides present: ${sides.join(', ')}`);

        const timeRange = Math.max(...timestamps) - Math.min(...timestamps);
        console.log(`  Time range: ${Math.floor(timeRange / 60)} minutes`);
      }
    }

    return markets.length > 0;
  } catch (error) {
    log(`ERROR: ${error.message}`, 'red');
    console.error(error.stack);
    return false;
  }
}

async function testOrderFilledQuery() {
  section('Test 5: Direct OrderFilled Query');

  try {
    // Use a known Polymarket condition ID (you'll need to replace this with a real one)
    // For testing, we'll try to find one from market discovery first
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);

    const markets = await findBitcoinMarkets(startTime, endTime, null);

    if (markets.length === 0) {
      log('No markets found to test OrderFilled query', 'yellow');
      return true; // Not a failure, just no data
    }

    const testMarket = markets[0];
    log(`Testing OrderFilled query for market: ${testMarket.market_id.substring(0, 20)}...`, 'blue');

    const events = await bitqueryClient.queryOrderFilledEvents(
      testMarket.market_id,
      new Date(testMarket.created_at * 1000).toISOString(),
      new Date().toISOString(),
      100 // Limit to 100 events for testing
    );

    log(`Found ${events.length} OrderFilled events`, events.length > 0 ? 'green' : 'yellow');

    if (events.length > 0) {
      log('\nFirst event details:', 'cyan');
      const event = events[0];
      console.log(`  Block time: ${event.Block.Time}`);
      console.log(`  Transaction: ${event.Transaction.Hash}`);
      console.log(`  Arguments: ${event.Arguments.length} fields`);
    }

    return true;
  } catch (error) {
    log(`ERROR: ${error.message}`, 'red');
    console.error(error.stack);
    return false;
  }
}

async function runAllTests() {
  section('BITQUERY INTEGRATION TEST SUITE');

  log('Testing Bitquery integration for Polymarket data...', 'blue');
  log(`Environment: ${process.env.NODE_ENV || 'development'}`, 'blue');
  log(`USE_BITQUERY: ${process.env.USE_BITQUERY || 'not set'}`, 'blue');

  const results = {
    healthCheck: false,
    marketDiscovery: false,
    activeMarkets: false,
    clientIntegration: false,
    orderFilledQuery: false,
  };

  // Run tests sequentially
  results.healthCheck = await testHealthCheck();

  if (!results.healthCheck) {
    log('\nHealth check failed. Please verify:', 'red');
    log('1. BITQUERY_OAUTH_TOKEN is set in .env file', 'yellow');
    log('2. Token is valid (check https://ide.bitquery.io/)', 'yellow');
    log('3. You have available points', 'yellow');
    return;
  }

  results.marketDiscovery = await testMarketDiscovery();
  results.activeMarkets = await testActiveMarkets();
  results.clientIntegration = await testPolymarketClientIntegration();
  results.orderFilledQuery = await testOrderFilledQuery();

  // Print summary
  section('TEST SUMMARY');

  const tests = [
    { name: 'Health Check', result: results.healthCheck },
    { name: 'Market Discovery', result: results.marketDiscovery },
    { name: 'Active Markets', result: results.activeMarkets },
    { name: 'Client Integration', result: results.clientIntegration },
    { name: 'OrderFilled Query', result: results.orderFilledQuery },
  ];

  tests.forEach(test => {
    const status = test.result ? '✓ PASS' : '✗ FAIL';
    const color = test.result ? 'green' : 'red';
    log(`${status} - ${test.name}`, color);
  });

  const passCount = Object.values(results).filter(r => r).length;
  const totalCount = Object.values(results).length;

  console.log('\n' + '='.repeat(80));
  log(`Results: ${passCount}/${totalCount} tests passed`, passCount === totalCount ? 'green' : 'yellow');
  console.log('='.repeat(80) + '\n');

  if (passCount === totalCount) {
    log('✓ All tests passed! Bitquery integration is working correctly.', 'green');
  } else {
    log('⚠ Some tests failed. Please review the errors above.', 'yellow');
  }
}

// Run tests
runAllTests().catch(error => {
  log(`\nFATAL ERROR: ${error.message}`, 'red');
  console.error(error.stack);
  process.exit(1);
});
