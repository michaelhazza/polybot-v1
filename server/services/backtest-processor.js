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
      // Get run configuration
      const run = db.prepare('SELECT * FROM backtests WHERE id = ?').get(runId);
      if (!run) {
        throw new Error(`Backtest run ${runId} not found`);
      }

      // Update status to running
      this.updateProgress(runId, 0, 'running', 'Initializing');

      // Step 1: Fetch or generate market data (10%)
      this.updateProgress(runId, 10, 'running', 'Fetching markets');
      const { markets, snapshots } = await this.fetchMarketData(run);

      if (Date.now() - startProcessingTime > maxRuntimeMs) {
        throw new Error('Maximum runtime exceeded during market fetch');
      }

      // Step 2: Store data in database (20%)
      this.updateProgress(runId, 20, 'running', 'Storing market data');
      this.storeMarketData(markets, snapshots);

      // Step 3: Detect windows (50%)
      this.updateProgress(runId, 50, 'running', 'Detecting windows');
      const detectionResult = windowDetector.detectWindows(
        snapshots,
        run.analysis_start,
        run.analysis_end
      );

      if (Date.now() - startProcessingTime > maxRuntimeMs) {
        throw new Error('Maximum runtime exceeded during window detection');
      }

      // Step 4: Simulate trades (70%)
      this.updateProgress(runId, 70, 'running', 'Simulating trades');
      const simulationResult = tradeSimulator.simulateTrades(
        detectionResult.windows,
        run.trade_size
      );

      // Step 5: Store results (85%)
      this.updateProgress(runId, 85, 'running', 'Storing results');
      this.storeResults(runId, markets[0]?.market_id, detectionResult, simulationResult);

      // Step 6: Calculate final metrics (95%)
      this.updateProgress(runId, 95, 'running', 'Calculating metrics');
      const finalMetrics = this.calculateFinalMetrics(
        detectionResult,
        simulationResult,
        run.analysis_start,
        run.analysis_end
      );

      // Step 7: Update backtest record with results (100%)
      this.updateProgress(runId, 100, 'completed', 'Completed');
      this.updateBacktestResults(runId, finalMetrics);

      return { success: true, metrics: finalMetrics };

    } catch (error) {
      console.error(`Error processing backtest ${runId}:`, error);

      // Mark as failed
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

      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch market data from Polymarket or generate synthetic
   */
  async fetchMarketData(run) {
    // For Phase 1A, use synthetic data for reliable testing
    // In production, this would call polymarketClient.fetchMarkets()
    const useSynthetic = true; // Toggle for real API usage

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
