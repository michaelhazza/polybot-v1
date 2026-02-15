import axios from 'axios';

const POLYMARKET_API_BASE = process.env.POLYMARKET_API_BASE || 'https://clob.polymarket.com';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

class PolymarketClient {
  constructor() {
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Fetch markets by asset and timeframe
   * @param {string} asset - BTC, ETH, or SOL
   * @param {string} timeframe - 5min, 15min, 1hr
   * @param {number} startTime - Unix timestamp in seconds
   * @param {number} endTime - Unix timestamp in seconds
   * @returns {Promise<Array>} List of markets
   */
  async fetchMarkets(asset, timeframe, startTime, endTime) {
    try {
      // Search for markets matching the criteria
      // This is a simplified version - actual implementation would need to handle
      // Polymarket's market structure and filtering
      const response = await this.client.get(`${GAMMA_API_BASE}/markets`, {
        params: {
          active: false,
          closed: true,
          limit: 1000
        }
      });

      // Filter markets by asset and timeframe criteria
      const markets = response.data || [];
      const filtered = markets.filter(market => {
        const question = market.question?.toLowerCase() || '';
        const assetMatch = question.includes(asset.toLowerCase());

        // Check if market falls within our time range
        const marketStart = market.startDate ? new Date(market.startDate).getTime() / 1000 : 0;
        const marketEnd = market.endDate ? new Date(market.endDate).getTime() / 1000 : Date.now() / 1000;

        const timeMatch = marketEnd >= startTime && marketStart <= endTime;

        return assetMatch && timeMatch;
      });

      return filtered.map(m => ({
        market_id: m.condition_id || m.id,
        asset,
        timeframe,
        start_time: m.startDate ? Math.floor(new Date(m.startDate).getTime() / 1000) : startTime,
        end_time: m.endDate ? Math.floor(new Date(m.endDate).getTime() / 1000) : endTime,
        status: m.closed ? 'closed' : 'active',
        fee_regime: 'fee_free'
      }));
    } catch (error) {
      console.error('Error fetching markets:', error.message);
      return [];
    }
  }

  /**
   * Fetch price snapshots for a market (Tier B: mid/last prices)
   * @param {string} marketId - Market condition ID
   * @param {number} startTime - Unix timestamp in seconds
   * @param {number} endTime - Unix timestamp in seconds
   * @returns {Promise<Array>} List of price snapshots
   */
  async fetchSnapshots(marketId, startTime, endTime) {
    try {
      // Fetch orderbook snapshots or trades
      // This is a placeholder - actual implementation depends on Polymarket's API
      const response = await this.client.get(`${POLYMARKET_API_BASE}/prices`, {
        params: {
          market: marketId,
          startTs: startTime,
          endTs: endTime
        }
      });

      const snapshots = [];
      const data = response.data?.history || [];

      // Process data into snapshots for UP and DOWN sides
      for (const point of data) {
        const timestamp = Math.floor(point.t || point.timestamp || Date.now() / 1000);

        // UP side (YES outcome)
        if (point.p !== undefined || point.price !== undefined) {
          const mid = point.p || point.price;
          snapshots.push({
            market_id: marketId,
            timestamp,
            side: 'UP',
            mid,
            last: mid, // Use mid as last for Tier B
            is_tradable: 1
          });

          // DOWN side (NO outcome) - inverse price
          snapshots.push({
            market_id: marketId,
            timestamp,
            side: 'DOWN',
            mid: 1 - mid,
            last: 1 - mid,
            is_tradable: 1
          });
        }
      }

      return snapshots;
    } catch (error) {
      console.error(`Error fetching snapshots for ${marketId}:`, error.message);
      return [];
    }
  }

  /**
   * Generate synthetic market data for testing
   * This creates realistic price movements for development/testing
   */
  async generateSyntheticData(asset, startTime, endTime, tickIntervalSeconds = 5) {
    const markets = [];
    const snapshots = [];

    // Create a synthetic market
    const marketId = `synthetic_${asset}_${startTime}`;
    markets.push({
      market_id: marketId,
      asset,
      timeframe: '15min',
      start_time: startTime,
      end_time: endTime,
      status: 'closed',
      fee_regime: 'fee_free'
    });

    // Generate price data with occasional arbitrage windows
    let currentTime = startTime;
    let basePrice = 0.5; // Start at 50/50

    while (currentTime <= endTime) {
      // Random walk with mean reversion
      const drift = (0.5 - basePrice) * 0.01;
      const volatility = 0.002;
      basePrice += drift + (Math.random() - 0.5) * volatility;
      basePrice = Math.max(0.3, Math.min(0.7, basePrice));

      // Occasionally create arbitrage windows (combined price < 1.00)
      let upMid = basePrice;
      let downMid = 1 - basePrice;

      // 5% chance of creating an arbitrage window
      if (Math.random() < 0.05) {
        const discount = 0.003 + Math.random() * 0.007; // 0.3% to 1.0% discount
        upMid = basePrice - discount / 2;
        downMid = (1 - basePrice) - discount / 2;
      }

      snapshots.push({
        market_id: marketId,
        timestamp: currentTime,
        side: 'UP',
        mid: upMid,
        last: upMid,
        is_tradable: 1
      });

      snapshots.push({
        market_id: marketId,
        timestamp: currentTime,
        side: 'DOWN',
        mid: downMid,
        last: downMid,
        is_tradable: 1
      });

      currentTime += tickIntervalSeconds;
    }

    return { markets, snapshots };
  }
}

export default new PolymarketClient();
