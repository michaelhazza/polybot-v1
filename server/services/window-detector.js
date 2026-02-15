/**
 * Window Detection Engine - Phase 1A
 * Implements deterministic pairing, stitching, and window validation
 */

const TARGET_TICK_INTERVAL = 5; // seconds - fixed for Phase 1A
const MAX_PAIRING_DELTA_SECONDS = 5;
const SPREAD_PROXY = 0.002; // half-spread per side (20 bps)
const MIN_WINDOW_DURATION = 5; // seconds
const MIN_TICK_COUNT = 3;

class WindowDetector {
  constructor() {}

  /**
   * Detect arbitrage windows from snapshot data
   * @param {Array} snapshots - Raw price snapshots from database
   * @param {number} analysisStart - Unix timestamp (seconds)
   * @param {number} analysisEnd - Unix timestamp (seconds)
   * @returns {Object} { windows, pairedTicks, stats }
   */
  detectWindows(snapshots, analysisStart, analysisEnd) {
    // Step 1: Create fixed anchor grid
    const anchors = this.createAnchorGrid(analysisStart, analysisEnd);

    // Step 2: Organize snapshots by side
    const upTicks = snapshots
      .filter(s => s.side === 'UP')
      .sort((a, b) => a.timestamp - b.timestamp);
    const downTicks = snapshots
      .filter(s => s.side === 'DOWN')
      .sort((a, b) => a.timestamp - b.timestamp);

    // Step 3: Pair ticks at each anchor
    const pairedTicks = this.pairTicksAtAnchors(anchors, upTicks, downTicks);

    // Step 4: Calculate combined prices and detect threshold crossings
    const ticksWithPrices = this.calculateCombinedPrices(pairedTicks);

    // Step 5: Stitch continuous sequences into windows
    const rawWindows = this.stitchWindows(ticksWithPrices);

    // Step 6: Validate windows (duration, tick count, no stale/missing)
    const validWindows = this.validateWindows(rawWindows);

    // Step 7: Calculate statistics
    const stats = this.calculateStats(pairedTicks, validWindows, analysisStart, analysisEnd);

    return {
      windows: validWindows,
      pairedTicks: ticksWithPrices,
      stats
    };
  }

  /**
   * Create fixed anchor grid from start to end
   */
  createAnchorGrid(start, end) {
    const anchors = [];
    let current = start;
    while (current < end) {
      anchors.push(current);
      current += TARGET_TICK_INTERVAL;
    }
    return anchors;
  }

  /**
   * Pair UP and DOWN ticks at each anchor timestamp
   */
  pairTicksAtAnchors(anchors, upTicks, downTicks) {
    const paired = [];

    for (const anchor of anchors) {
      // Find closest UP tick within ±MAX_PAIRING_DELTA_SECONDS
      const upMatch = this.findClosestTick(anchor, upTicks, MAX_PAIRING_DELTA_SECONDS);

      // Find closest DOWN tick within ±MAX_PAIRING_DELTA_SECONDS
      const downMatch = this.findClosestTick(anchor, downTicks, MAX_PAIRING_DELTA_SECONDS);

      // Check if pairing is valid
      const isMissing = !upMatch || !downMatch;
      const isStalePair = !isMissing && Math.abs(upMatch.timestamp - downMatch.timestamp) > MAX_PAIRING_DELTA_SECONDS;

      paired.push({
        anchor,
        upTick: upMatch,
        downTick: downMatch,
        isMissing,
        isStalePair,
        isValid: !isMissing && !isStalePair
      });
    }

    return paired;
  }

  /**
   * Find closest tick to anchor within max delta
   * Tie-breaker: choose earlier timestamp if equidistant
   */
  findClosestTick(anchor, ticks, maxDelta) {
    let closest = null;
    let minDistance = Infinity;

    for (const tick of ticks) {
      const distance = Math.abs(tick.timestamp - anchor);

      if (distance <= maxDelta) {
        if (distance < minDistance || (distance === minDistance && tick.timestamp < closest.timestamp)) {
          closest = tick;
          minDistance = distance;
        }
      }
    }

    return closest;
  }

  /**
   * Calculate combined prices with spread proxy
   */
  calculateCombinedPrices(pairedTicks) {
    return pairedTicks.map(pt => {
      if (!pt.isValid) {
        return { ...pt, combinedPrice: null, isArbitrageOpportunity: false };
      }

      // Apply spread proxy to mid prices
      const upAsk = pt.upTick.mid + SPREAD_PROXY;
      const downAsk = pt.downTick.mid + SPREAD_PROXY;
      const combinedPrice = upAsk + downAsk;

      return {
        ...pt,
        combinedPrice,
        isArbitrageOpportunity: combinedPrice < 1.00
      };
    });
  }

  /**
   * Stitch continuous sequences into windows
   * Windows end when: no arbitrage opportunity OR invalid tick
   */
  stitchWindows(ticksWithPrices) {
    const windows = [];
    let currentWindow = null;

    for (let i = 0; i < ticksWithPrices.length; i++) {
      const tick = ticksWithPrices[i];

      // Check if this tick can continue or start a window
      const canContinue = tick.isValid && tick.isArbitrageOpportunity;

      if (canContinue) {
        if (!currentWindow) {
          // Start new window
          currentWindow = {
            ticks: [tick],
            startTime: tick.anchor,
            startCombinedPrice: tick.combinedPrice
          };
        } else {
          // Continue existing window
          currentWindow.ticks.push(tick);
        }
      } else {
        // End current window if exists
        if (currentWindow) {
          const lastTick = currentWindow.ticks[currentWindow.ticks.length - 1];
          windows.push({
            ...currentWindow,
            endTime: lastTick.anchor,
            endCombinedPrice: lastTick.combinedPrice,
            duration: lastTick.anchor - currentWindow.startTime,
            tickCount: currentWindow.ticks.length
          });
          currentWindow = null;
        }
      }
    }

    // Close final window if still open
    if (currentWindow) {
      const lastTick = currentWindow.ticks[currentWindow.ticks.length - 1];
      windows.push({
        ...currentWindow,
        endTime: lastTick.anchor,
        endCombinedPrice: lastTick.combinedPrice,
        duration: lastTick.anchor - currentWindow.startTime,
        tickCount: currentWindow.ticks.length
      });
    }

    return windows;
  }

  /**
   * Validate windows against Phase 1A criteria
   */
  validateWindows(rawWindows) {
    return rawWindows
      .filter(w => {
        // Must meet duration requirement
        if (w.duration < MIN_WINDOW_DURATION) return false;

        // Must meet tick count requirement
        if (w.tickCount < MIN_TICK_COUNT) return false;

        // Must not contain any invalid ticks (stale/missing are already excluded by stitching)
        const hasInvalidTick = w.ticks.some(t => !t.isValid);
        if (hasInvalidTick) return false;

        return true;
      })
      .map(w => {
        // Calculate min combined price (best edge in window)
        const minCombinedPrice = Math.min(...w.ticks.map(t => t.combinedPrice));

        return {
          startTime: w.startTime,
          endTime: w.endTime,
          duration: w.duration,
          tickCount: w.tickCount,
          entryCombinedPrice: w.startCombinedPrice,
          minCombinedPrice,
          exitCombinedPrice: w.endCombinedPrice,
          ticks: w.ticks
        };
      });
  }

  /**
   * Calculate detection statistics
   */
  calculateStats(pairedTicks, validWindows, analysisStart, analysisEnd) {
    const totalPairedTicks = pairedTicks.filter(pt => pt.isValid).length;
    const expectedTicks = Math.floor((analysisEnd - analysisStart) / TARGET_TICK_INTERVAL);
    const dataCoveragePct = expectedTicks > 0 ? (totalPairedTicks / expectedTicks) * 100 : 0;

    // Calculate duration percentiles
    const durations = validWindows.map(w => w.duration).sort((a, b) => a - b);
    const durationP50 = durations.length > 0
      ? durations[Math.floor(durations.length * 0.5)]
      : 0;

    const analysisHours = (analysisEnd - analysisStart) / 3600;
    const windowsPerAnalysisHour = analysisHours > 0 ? validWindows.length / analysisHours : 0;

    return {
      totalPairedTicks,
      expectedTicks,
      dataCoveragePct,
      windowsDetected: validWindows.length,
      durationP50,
      windowsPerAnalysisHour
    };
  }
}

export default new WindowDetector();
