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

  async fetchMarkets(asset, timeframe, startTime, endTime) {
    try {
      const response = await this.client.get(`${GAMMA_API_BASE}/markets`, {
        params: {
          active: false,
          closed: true,
          limit: 1000
        }
      });

      const markets = response.data || [];
      const filtered = markets.filter(market => {
        const question = market.question?.toLowerCase() || '';
        const assetMatch = question.includes(asset.toLowerCase());
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

  async fetchSnapshots(marketId, startTime, endTime) {
    try {
      const response = await this.client.get(`${POLYMARKET_API_BASE}/prices`, {
        params: {
          market: marketId,
          startTs: startTime,
          endTs: endTime
        }
      });

      const snapshots = [];
      const data = response.data?.history || [];

      for (const point of data) {
        const timestamp = Math.floor(point.t || point.timestamp || Date.now() / 1000);
        if (point.p !== undefined || point.price !== undefined) {
          const mid = point.p || point.price;
          snapshots.push({
            market_id: marketId,
            timestamp,
            side: 'UP',
            mid,
            last: mid,
            is_tradable: 1
          });
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

  _seededRandom(seed) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  _hashSeed(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) || 1;
  }

  getMarketInfo(asset, startTime, endTime) {
    const marketId = `synthetic_${asset}_${startTime}`;
    return {
      market_id: marketId,
      asset,
      timeframe: '15min',
      start_time: startTime,
      end_time: endTime,
      status: 'closed',
      fee_regime: 'fee_free'
    };
  }

  getTotalTickCount(startTime, endTime, tickIntervalSeconds = 5) {
    return Math.floor((endTime - startTime) / tickIntervalSeconds) + 1;
  }

  *generateSyntheticTicks(asset, startTime, endTime, tickIntervalSeconds = 5, resumeFromTimestamp = null) {
    const seed = this._hashSeed(`${asset}_${startTime}_${endTime}`);
    const random = this._seededRandom(seed);
    const marketId = `synthetic_${asset}_${startTime}`;

    let currentTime = startTime;
    let basePrice = 0.5;

    while (currentTime <= endTime) {
      const drift = (0.5 - basePrice) * 0.01;
      const volatility = 0.002;
      basePrice += drift + (random() - 0.5) * volatility;
      basePrice = Math.max(0.3, Math.min(0.7, basePrice));

      let upMid = basePrice;
      let downMid = 1 - basePrice;

      if (random() < 0.05) {
        const discount = 0.003 + random() * 0.007;
        upMid = basePrice - discount / 2;
        downMid = (1 - basePrice) - discount / 2;
      }

      if (resumeFromTimestamp === null || currentTime > resumeFromTimestamp) {
        yield {
          market_id: marketId,
          timestamp: currentTime,
          side: 'UP',
          mid: upMid,
          last: upMid,
          is_tradable: 1
        };

        yield {
          market_id: marketId,
          timestamp: currentTime,
          side: 'DOWN',
          mid: downMid,
          last: downMid,
          is_tradable: 1
        };
      }

      currentTime += tickIntervalSeconds;
    }
  }
}

export default new PolymarketClient();
