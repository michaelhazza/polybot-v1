/**
 * Test workflow for Polymarket Arbitrage MVP
 * Tests the complete backtest creation and processing flow
 */

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3001';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testWorkflow() {
  console.log('🧪 Starting Polymarket Arbitrage MVP Test Workflow\n');

  try {
    // Step 1: Check server health
    console.log('1. Checking server health...');
    const healthResponse = await fetch(`${API_BASE}/health`);
    if (!healthResponse.ok) {
      throw new Error('Server health check failed');
    }
    console.log('✓ Server is healthy\n');

    // Step 2: Create a test backtest
    console.log('2. Creating test backtest (BTC 15min 30d $25)...');
    const createResponse = await fetch(`${API_BASE}/api/backtests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset: 'BTC',
        timeframe: '15min',
        period: '30d',
        tradeSize: 25
      })
    });

    if (!createResponse.ok) {
      throw new Error('Failed to create backtest');
    }

    const createResult = await createResponse.json();
    console.log(`✓ Backtest created: ${createResult.runId}\n`);

    const runId = createResult.runId;

    // Step 3: Monitor progress
    console.log('3. Monitoring backtest progress...');
    let completed = false;
    let attempts = 0;
    const maxAttempts = 60; // 60 attempts * 2 seconds = 2 minutes max

    while (!completed && attempts < maxAttempts) {
      await sleep(2000);
      attempts++;

      const statusResponse = await fetch(`${API_BASE}/api/backtests/${runId}/status`);
      if (!statusResponse.ok) {
        throw new Error('Failed to fetch status');
      }

      const status = await statusResponse.json();
      console.log(`   Status: ${status.status} | Progress: ${status.progress_pct}% | Stage: ${status.stage}`);

      if (status.status === 'completed') {
        completed = true;
        console.log('✓ Backtest completed!\n');
      } else if (status.status === 'failed') {
        throw new Error(`Backtest failed: ${status.error_message}`);
      }
    }

    if (!completed) {
      throw new Error('Backtest timed out');
    }

    // Step 4: Fetch results
    console.log('4. Fetching backtest results...');
    const resultsResponse = await fetch(`${API_BASE}/api/backtests/${runId}`);
    if (!resultsResponse.ok) {
      throw new Error('Failed to fetch results');
    }

    const results = await resultsResponse.json();
    console.log('✓ Results fetched\n');

    // Step 5: Display metrics
    console.log('5. Go/No-Go Metrics:');
    console.log('─────────────────────────────────────────────');
    const { run } = results;

    const metrics = [
      { name: 'Windows per Hour', value: run.windows_per_analysis_hour, threshold: 0.1, unit: '' },
      { name: 'Median Duration', value: run.duration_p50, threshold: 10, unit: 's' },
      { name: 'Fill Success Rate', value: run.fill_success_rate, threshold: 20, unit: '%' },
      { name: 'Avg Edge', value: run.avg_execution_adjusted_edge, threshold: 0.5, unit: '%' },
      { name: 'Data Coverage', value: run.data_coverage_pct, threshold: 90, unit: '%' }
    ];

    let allPassed = true;
    for (const metric of metrics) {
      const passed = metric.value >= metric.threshold;
      const status = passed ? '✓' : '✗';
      const color = passed ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';

      console.log(`${color}${status}${reset} ${metric.name.padEnd(20)}: ${metric.value?.toFixed(2) || '-'}${metric.unit} (threshold: ≥${metric.threshold}${metric.unit})`);

      if (!passed) allPassed = false;
    }

    console.log('─────────────────────────────────────────────');
    console.log(`Overall: ${allPassed ? '\x1b[32m✓ GO\x1b[0m' : '\x1b[31m✗ NO-GO\x1b[0m'}\n`);

    // Step 6: Summary
    console.log('6. Summary:');
    console.log(`   Windows Detected: ${run.windows_detected}`);
    console.log(`   Trades Completed: ${run.trades_completed}`);
    console.log(`   Windows: ${results.windows.length}`);
    console.log(`   Trades: ${results.trades.length}`);

    const totalProfit = results.trades
      .filter(t => t.result === 'completed')
      .reduce((sum, t) => sum + t.profit, 0);
    console.log(`   Total Profit: $${totalProfit.toFixed(2)}\n`);

    console.log('✅ Test workflow completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Test workflow failed:', error.message);
    process.exit(1);
  }
}

// Check if server is running
console.log('Waiting for server to be ready...');
setTimeout(testWorkflow, 2000);
