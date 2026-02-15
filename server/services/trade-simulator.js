/**
 * Conservative Trade Simulator - Phase 1A
 * Implements deterministic fill model with realistic execution constraints
 */

const LATENCY_SECONDS = 0.2; // 200ms
const MIN_FILL_TIME_SECONDS = 1;
const SETTLEMENT_DELAY_SECONDS = 60;
const FEE_BPS = 0; // No fees for Phase 1A

class TradeSimulator {
  constructor() {}

  /**
   * Simulate trades for detected windows
   * @param {Array} windows - Valid windows from detector
   * @param {number} tradeSize - Trade size in dollars
   * @returns {Object} { trades, metrics }
   */
  simulateTrades(windows, tradeSize) {
    const trades = [];

    for (const window of windows) {
      const trade = this.simulateTrade(window, tradeSize);
      trades.push(trade);
    }

    const metrics = this.calculateMetrics(trades, windows.length);

    return { trades, metrics };
  }

  /**
   * Simulate a single trade for a window
   */
  simulateTrade(window, tradeSize) {
    // Check if window duration is sufficient for fill
    const requiredDuration = LATENCY_SECONDS + MIN_FILL_TIME_SECONDS;
    const canFill = window.duration >= requiredDuration;

    if (!canFill) {
      return {
        windowId: null, // Will be set when persisted
        result: 'failed',
        profit: 0,
        fees: 0,
        window
      };
    }

    // Calculate profit using entry price (deterministic)
    const rawEdge = 1.00 - window.entryCombinedPrice;
    const fees = tradeSize * (FEE_BPS / 10000);
    const profit = tradeSize * rawEdge - fees;

    return {
      windowId: null,
      result: 'completed',
      profit,
      fees,
      window
    };
  }

  /**
   * Calculate trade metrics
   */
  calculateMetrics(trades, totalWindows) {
    const completedTrades = trades.filter(t => t.result === 'completed');
    const tradesCompleted = completedTrades.length;

    // Fill success rate
    const fillSuccessRate = totalWindows > 0 ? (tradesCompleted / totalWindows) * 100 : 0;

    // Total profit and capital deployed
    let totalProfit = 0;
    let totalCapitalDeployed = 0;

    for (const trade of completedTrades) {
      totalProfit += trade.profit;
      totalCapitalDeployed += trade.window.entryCombinedPrice * (trade.profit / (1.00 - trade.window.entryCombinedPrice));
    }

    // Average execution-adjusted edge
    const avgExecutionAdjustedEdge = totalCapitalDeployed > 0
      ? (totalProfit / totalCapitalDeployed) * 100
      : 0;

    return {
      tradesCompleted,
      fillSuccessRate,
      totalProfit,
      totalCapitalDeployed,
      avgExecutionAdjustedEdge
    };
  }

  /**
   * Calculate detailed trade statistics
   */
  calculateDetailedStats(trades) {
    const completedTrades = trades.filter(t => t.result === 'completed');

    if (completedTrades.length === 0) {
      return {
        avgProfit: 0,
        maxProfit: 0,
        minProfit: 0,
        totalProfit: 0,
        profitP50: 0,
        profitP90: 0
      };
    }

    const profits = completedTrades.map(t => t.profit).sort((a, b) => a - b);
    const totalProfit = profits.reduce((sum, p) => sum + p, 0);
    const avgProfit = totalProfit / profits.length;

    return {
      avgProfit,
      maxProfit: profits[profits.length - 1],
      minProfit: profits[0],
      totalProfit,
      profitP50: profits[Math.floor(profits.length * 0.5)],
      profitP90: profits[Math.floor(profits.length * 0.9)]
    };
  }
}

export default new TradeSimulator();
