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
    this.assetKeywords = {
      'BTC': [/\bbitcoin\b/i, /\bbtc\b/i, /\$btc/i],
      'ETH': [/\bethereum\b/i, /(?<![a-z])eth(?![a-z])/i, /\$eth/i],
      'SOL': [/\bsolana\b/i, /(?<![a-z])sol(?![a-z])/i, /\$sol/i]
    };
  }

  async fetchMarkets(asset, timeframe, startTime, endTime) {
    try {
      const keywords = this.assetKeywords[asset.toUpperCase()] || [asset.toLowerCase()];
      const allMarkets = [];

      for (let offset = 0; offset < 1000; offset += 100) {
        const response = await this.client.get(`${GAMMA_API_BASE}/markets`, {
          params: {
            limit: 100,
            offset,
            active: true,
            closed: false
          }
        });
        const batch = response.data || [];
        if (batch.length === 0) break;
        allMarkets.push(...batch);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`Fetched ${allMarkets.length} total markets from Gamma API`);

      const filtered = allMarkets.filter(market => {
        const searchText = `${market.question || ''} ${market.description || ''}`;
        const assetMatch = keywords.some(kw => kw.test(searchText));
        if (!assetMatch) return false;

        const hasClobTokens = market.clobTokenIds && market.clobTokenIds !== '[]';
        return hasClobTokens;
      });

      console.log(`Found ${filtered.length} markets matching ${asset} with CLOB tokens`);

      return filtered.map(m => {
        let tokenIds = [];
        try {
          tokenIds = JSON.parse(m.clobTokenIds || '[]');
        } catch (e) {
          tokenIds = [];
        }

        return {
          market_id: m.conditionId || m.id,
          question: m.question,
          asset,
          timeframe,
          start_time: m.startDate ? Math.floor(new Date(m.startDate).getTime() / 1000) : startTime,
          end_time: m.endDate ? Math.floor(new Date(m.endDate).getTime() / 1000) : endTime,
          status: m.closed ? 'closed' : 'active',
          fee_regime: 'fee_free',
          clob_token_ids: tokenIds
        };
      });
    } catch (error) {
      console.error('Error fetching markets:', error.message);
      return [];
    }
  }

  async fetchSnapshots(market, startTime, endTime) {
    try {
      const tokenIds = market.clob_token_ids || [];
      if (tokenIds.length === 0) {
        console.warn(`No CLOB token IDs for market ${market.market_id}`);
        return [];
      }

      const allSnapshots = [];

      for (let i = 0; i < tokenIds.length; i++) {
        const tokenId = tokenIds[i];
        const side = i === 0 ? 'YES' : 'NO';

        const response = await this.client.get(`${POLYMARKET_API_BASE}/prices-history`, {
          params: {
            market: tokenId,
            interval: 'max',
            fidelity: 5
          }
        });

        const data = response.data?.history || [];
        console.log(`  Token ${side} (${tokenId.substring(0, 20)}...): ${data.length} price points`);

        const BUCKET_SIZE = 300;
        for (const point of data) {
          const rawTimestamp = point.t;
          const timestamp = Math.round(rawTimestamp / BUCKET_SIZE) * BUCKET_SIZE;
          const price = typeof point.p === 'string' ? parseFloat(point.p) : point.p;
          if (rawTimestamp && price !== undefined) {
            allSnapshots.push({
              market_id: market.market_id,
              timestamp,
              side,
              mid: price,
              last: price,
              is_tradable: 1
            });
          }
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return allSnapshots;
    } catch (error) {
      console.error(`Error fetching snapshots for ${market.market_id}:`, error.message);
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

  async generateSyntheticData(asset, startTime, endTime, tickIntervalSeconds = 5) {
    const market = this.getMarketInfo(asset, startTime, endTime);
    const snapshots = [];

    for (const tick of this.generateSyntheticTicks(asset, startTime, endTime, tickIntervalSeconds)) {
      snapshots.push(tick);
    }

    return {
      markets: [market],
      snapshots
    };
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
