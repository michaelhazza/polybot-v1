/**
 * Backtest Processor - Phase 1A
 * Orchestrates data ingestion, window detection, trade simulation, and metrics
 */

import db from '../database/db.js';
import polymarketClient from './polymarket-client.js';
import windowDetector from './window-detector.js';
import tradeSimulator from './trade-simulator.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_MARKETS_PER_RUN = 1000;
const MAX_RUNTIME_MINUTES = 20;

class BacktestProcessor {
  constructor() {
    this.activeJobs = new Map();
  }

  /**
   * Process a backtest run
   */
  async processBacktest(runId) {
    const startProcessingTime = Date.now();
    const maxRuntimeMs = MAX_RUNTIME_MINUTES * 60 * 1000;

    try {
      const run = await this.getRunConfiguration(runId);
      this.updateProgress(runId, 0, 'running', 'Initializing');

      // Step 1: Fetch market data
      const { markets, snapshots } = await this.fetchAndStoreMarketData(run, runId);
      this.checkRuntimeLimit(startProcessingTime, maxRuntimeMs, 'market fetch');

      // Step 2: Detect arbitrage windows
      const detectionResult = await this.detectArbitrageWindows(snapshots, run, runId);
      this.checkRuntimeLimit(startProcessingTime, maxRuntimeMs, 'window detection');

      // Step 3: Simulate and store trades
      const simulationResult = await this.simulateAndStoreTrades(
        detectionResult,
        markets,
        run,
        runId
      );

      // Step 4: Finalize results
      await this.finalizeBacktest(runId, detectionResult, simulationResult, run);

      return { success: true, metrics: this.getMetricsFromResults(detectionResult, simulationResult) };

    } catch (error) {
      this.handleProcessingError(runId, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get run configuration from database
   */
  getRunConfiguration(runId) {
    const run = db.prepare('SELECT * FROM backtests WHERE id = ?').get(runId);
    if (!run) {
      throw new Error(`Backtest run ${runId} not found`);
    }
    return run;
  }

  /**
   * Check if runtime limit has been exceeded
   */
  checkRuntimeLimit(startTime, maxRuntimeMs, stage) {
    if (Date.now() - startTime > maxRuntimeMs) {
      throw new Error(`Maximum runtime exceeded during ${stage}`);
    }
  }

  /**
   * Fetch market data and store in database
   */
  async fetchAndStoreMarketData(run, runId) {
    this.updateProgress(runId, 10, 'running', 'Fetching markets');
    const { markets, snapshots } = await this.fetchMarketData(run);

    this.updateProgress(runId, 20, 'running', 'Storing market data');
    this.storeMarketData(markets, snapshots);

    return { markets, snapshots };
  }

  /**
   * Detect arbitrage windows from snapshots
   */
  async detectArbitrageWindows(snapshots, run, runId) {
    this.updateProgress(runId, 50, 'running', 'Detecting windows');
    return windowDetector.detectWindows(
      snapshots,
      run.analysis_start,
      run.analysis_end
    );
  }

  /**
   * Simulate trades and store results
   */
  async simulateAndStoreTrades(detectionResult, markets, run, runId) {
    this.updateProgress(runId, 70, 'running', 'Simulating trades');
    const simulationResult = tradeSimulator.simulateTrades(
      detectionResult.windows,
      run.trade_size
    );

    this.updateProgress(runId, 85, 'running', 'Storing results');
    this.storeResults(runId, markets[0]?.market_id, detectionResult, simulationResult);

    return simulationResult;
  }

  /**
   * Finalize backtest with metrics and completion status
   */
  async finalizeBacktest(runId, detectionResult, simulationResult, run) {
    this.updateProgress(runId, 95, 'running', 'Calculating metrics');
    const finalMetrics = this.calculateFinalMetrics(
      detectionResult,
      simulationResult,
      run.analysis_start,
      run.analysis_end
    );

    this.updateProgress(runId, 100, 'completed', 'Completed');
    this.updateBacktestResults(runId, finalMetrics);
  }

  /**
   * Extract metrics from results (helper for return value)
   */
  getMetricsFromResults(detectionResult, simulationResult) {
    return {
      windowsDetected: detectionResult.stats.windowsDetected,
      tradesCompleted: simulationResult.metrics.tradesCompleted,
      fillSuccessRate: simulationResult.metrics.fillSuccessRate
    };
  }

  /**
   * Handle processing errors and update database
   */
  handleProcessingError(runId, error) {
    console.error(`Error processing backtest ${runId}:`, error);

    db.prepare(`
      UPDATE backtests
      SET status = 'failed',
          error_message = ?,
          completed_at = ?
      WHERE id = ?
    `).run(error.message, Math.floor(Date.now() / 1000), runId);

    db.prepare(`
      UPDATE jobs
      SET status = 'failed',
          error_message = ?
      WHERE run_id = ?
    `).run(error.message, runId);
  }

  /**
   * Fetch market data from Polymarket or generate synthetic
   */
  async fetchMarketData(run) {
    // Use live Polymarket API for production data
    const useSynthetic = false; // Toggle for synthetic testing data

    if (useSynthetic) {
      return await polymarketClient.generateSyntheticData(
        run.asset,
        run.analysis_start,
        run.analysis_end,
        5 // tick interval
      );
    } else {
      const markets = await polymarketClient.fetchMarkets(
        run.asset,
        run.timeframe,
        run.analysis_start,
        run.analysis_end
      );

      // Limit markets to prevent runaway jobs
      const limitedMarkets = markets.slice(0, MAX_MARKETS_PER_RUN);

      if (limitedMarkets.length === 0) {
        console.warn(`No markets found for ${run.asset} from ${run.analysis_start} to ${run.analysis_end}`);
        // Fall back to synthetic data if no live markets found
        console.log('Falling back to synthetic data');
        return await polymarketClient.generateSyntheticData(
          run.asset,
          run.analysis_start,
          run.analysis_end,
          5 // tick interval
        );
      }

      // Fetch snapshots for each market
      const allSnapshots = [];
      for (const market of limitedMarkets) {
        const snapshots = await polymarketClient.fetchSnapshots(
          market.market_id,
          run.analysis_start,
          run.analysis_end
        );
        allSnapshots.push(...snapshots);
      }

      return { markets: limitedMarkets, snapshots: allSnapshots };
    }
  }

  /**
   * Store market data in database
   */
  storeMarketData(markets, snapshots) {
    const insertMarket = db.prepare(`
      INSERT OR REPLACE INTO markets
      (market_id, asset, timeframe, start_time, end_time, status, fee_regime)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSnapshot = db.prepare(`
      INSERT OR REPLACE INTO snapshots
      (market_id, timestamp, side, mid, last, is_tradable)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      for (const market of markets) {
        insertMarket.run(
          market.market_id,
          market.asset,
          market.timeframe,
          market.start_time,
          market.end_time,
          market.status,
          market.fee_regime
        );
      }

      for (const snapshot of snapshots) {
        insertSnapshot.run(
          snapshot.market_id,
          snapshot.timestamp,
          snapshot.side,
          snapshot.mid,
          snapshot.last,
          snapshot.is_tradable
        );
      }
    });

    transaction();
  }

  /**
   * Store window and trade results
   */
  storeResults(runId, marketId, detectionResult, simulationResult) {
    const insertWindow = db.prepare(`
      INSERT INTO windows
      (id, run_id, market_id, start_time, end_time, duration,
       entry_combined_price, min_combined_price, exit_combined_price, tick_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTrade = db.prepare(`
      INSERT INTO trades_sim
      (id, run_id, window_id, result, profit, fees)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      for (let i = 0; i < detectionResult.windows.length; i++) {
        const window = detectionResult.windows[i];
        const windowId = uuidv4();

        insertWindow.run(
          windowId,
          runId,
          marketId,
          window.startTime,
          window.endTime,
          window.duration,
          window.entryCombinedPrice,
          window.minCombinedPrice,
          window.exitCombinedPrice,
          window.tickCount
        );

        // Store corresponding trade
        const trade = simulationResult.trades[i];
        insertTrade.run(
          uuidv4(),
          runId,
          windowId,
          trade.result,
          trade.profit,
          trade.fees
        );
      }
    });

    transaction();
  }

  /**
   * Calculate final go/no-go metrics
   */
  calculateFinalMetrics(detectionResult, simulationResult, analysisStart, analysisEnd) {
    const analysisHours = (analysisEnd - analysisStart) / 3600;

    return {
      windowsDetected: detectionResult.stats.windowsDetected,
      tradesCompleted: simulationResult.metrics.tradesCompleted,
      fillSuccessRate: simulationResult.metrics.fillSuccessRate,
      avgExecutionAdjustedEdge: simulationResult.metrics.avgExecutionAdjustedEdge,
      dataCoveragePct: detectionResult.stats.dataCoveragePct,
      windowsPerAnalysisHour: detectionResult.stats.windowsPerAnalysisHour,
      durationP50: detectionResult.stats.durationP50
    };
  }

  /**
   * Update backtest record with final results
   */
  updateBacktestResults(runId, metrics) {
    db.prepare(`
      UPDATE backtests
      SET status = 'completed',
          windows_detected = ?,
          trades_completed = ?,
          fill_success_rate = ?,
          avg_execution_adjusted_edge = ?,
          data_coverage_pct = ?,
          windows_per_analysis_hour = ?,
          duration_p50 = ?,
          completed_at = ?
      WHERE id = ?
    `).run(
      metrics.windowsDetected,
      metrics.tradesCompleted,
      metrics.fillSuccessRate,
      metrics.avgExecutionAdjustedEdge,
      metrics.dataCoveragePct,
      metrics.windowsPerAnalysisHour,
      metrics.durationP50,
      Math.floor(Date.now() / 1000),
      runId
    );
  }

  /**
   * Update progress (mirrors to both jobs and backtests tables)
   */
  updateProgress(runId, progressPct, status, stage) {
    // Update jobs table (source of truth)
    db.prepare(`
      UPDATE jobs
      SET progress_pct = ?, status = ?, stage = ?
      WHERE run_id = ?
    `).run(progressPct, status, stage, runId);

    // Mirror to backtests table for fast UI queries
    db.prepare(`
      UPDATE backtests
      SET progress_pct = ?, stage = ?, status = ?
      WHERE id = ?
    `).run(progressPct, stage, status, runId);
  }
}

export default new BacktestProcessor();
