import axios from 'axios';
import fs from 'fs';
import path from 'path';
import bitqueryClient from '../../lib/bitquery-client.js';
import { discoverMarketsByAsset, batchDiscoverMarkets } from '../../lib/polymarket-market-finder.js';
import { createTokenMapping } from '../../lib/data-mappers.js';

const POLYMARKET_API_BASE = process.env.POLYMARKET_API_BASE || 'https://clob.polymarket.com';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const USE_BITQUERY = process.env.USE_BITQUERY === 'true' || true; // Default to Bitquery

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
    this.useBitquery = USE_BITQUERY;
    console.log(`[PolymarketClient] Data source: ${this.useBitquery ? 'Bitquery (blockchain)' : 'Polymarket API'}`);
  }

  async fetchMarkets(asset, timeframe, startTime, endTime, options = {}) {
    if (this.useBitquery) {
      return this._fetchMarketsBitquery(asset, timeframe, startTime, endTime, options);
    } else {
      return this._fetchMarketsPolymarketAPI(asset, timeframe, startTime, endTime);
    }
  }

  async _fetchMarketsBitquery(asset, timeframe, startTime, endTime, options = {}) {
    try {
      console.log(`[PolymarketClient] Fetching ${asset} markets via Bitquery...`);

      const startDate = new Date(startTime * 1000);
      const endDate = new Date(endTime * 1000);

      const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
      let markets;

      if (daysDiff > 7) {
        console.log(`[PolymarketClient] Large time range (${daysDiff.toFixed(1)} days), using batch discovery`);
        markets = await batchDiscoverMarkets(asset, timeframe, startDate, endDate, 7, options);
      } else {
        markets = await discoverMarketsByAsset(asset, timeframe, startDate, endDate, options);
      }

      console.log(`[PolymarketClient] Found ${markets.length} markets via Bitquery`);

      return markets.map(m => ({
        market_id: m.market_id,
        question: m.question,
        asset,
        timeframe,
        start_time: Math.floor(new Date(m.startDate).getTime() / 1000) || startTime,
        end_time: endTime,
        status: m.closed ? 'closed' : (m.metadata?.status || 'active'),
        fee_regime: 'fee_free',
        clob_token_ids: m.clobTokenIds || ['0', '1'],
        token_mapping: m.metadata?.is_up_down ? { '0': 'UP', '1': 'DOWN' } : { '0': 'YES', '1': 'NO' },
        _trades: m._trades || [],
      }));
    } catch (error) {
      // Special handling for quota errors
      if (error.code === 'QUOTA_EXCEEDED') {
        console.warn('[PolymarketClient] Bitquery quota exceeded.');
        console.warn('[PolymarketClient] Cannot fetch markets. Please wait for quota reset.');
        return [];
      }

      console.error('[PolymarketClient] Error fetching markets via Bitquery:', error.message);
      console.error('[PolymarketClient] Falling back to empty result');
      return [];
    }
  }

  async _fetchMarketsPolymarketAPI(asset, timeframe, startTime, endTime) {
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
    const clobSnapshots = await this._fetchSnapshotsPolymarketAPI(market, startTime, endTime);
    if (clobSnapshots.length > 0) {
      console.log(`[PolymarketClient] Got ${clobSnapshots.length} snapshots from CLOB API for ${market.market_id}`);
      return clobSnapshots;
    }

    if (this.useBitquery) {
      console.log(`[PolymarketClient] CLOB API returned no data, trying Bitquery for ${market.market_id}`);
      return this._fetchSnapshotsBitquery(market, startTime, endTime);
    }

    return [];
  }

  async _fetchSnapshotsBitquery(market, startTime, endTime) {
    try {
      console.log(`[PolymarketClient] Fetching snapshots for ${market.market_id} via Bitquery...`);

      const trades = market._trades || [];

      if (trades.length === 0) {
        console.log(`[PolymarketClient] No pre-loaded trades, fetching from API...`);
        try {
          const startDate = new Date(startTime * 1000).toISOString();
          const endDate = new Date(endTime * 1000).toISOString();

          // OPTIMIZATION: Use token-filtered query if token IDs are available
          const tokenIds = market.clob_token_ids || [];
          let fetched = [];

          if (tokenIds.length > 0) {
            console.log(`[PolymarketClient] Using optimized token-filtered query for ${tokenIds.length} tokens`);
            fetched = await bitqueryClient.queryAllPolymarketTradesByTokens(startDate, endDate, tokenIds, 5000);
          } else {
            console.warn(`[PolymarketClient] No token IDs available, using expensive unfiltered query`);
            fetched = await bitqueryClient.queryAllPolymarketTrades(startDate, endDate, 5000);
            // Filter by market ID in JavaScript (fallback only)
            fetched = fetched.filter(t => t.Trade?.Currency?.SmartContract === market.market_id);
          }

          trades.push(...fetched);
        } catch (error) {
          if (error.code === 'QUOTA_EXCEEDED') {
            console.warn(`[PolymarketClient] Bitquery quota exceeded. Cannot fetch trades for ${market.market_id}`);
            return [];
          }
          throw error;
        }
      }

      console.log(`[PolymarketClient] Processing ${trades.length} trades for ${market.market_id}`);

      if (trades.length === 0) {
        console.warn(`[PolymarketClient] No trades found for market ${market.market_id}`);
        return [];
      }

      const BUCKET_SIZE = this._getSnapshotIntervalSeconds();
      const isTradeLevel = BUCKET_SIZE === 0;
      const snapshots = [];

      const clobTokenIds = market.clob_token_ids || [];
      const firstTokenId = clobTokenIds[0];
      const secondTokenId = clobTokenIds[1];

      for (const trade of trades) {
        const blockTime = trade.Block?.Time;
        if (!blockTime) continue;

        const rawTimestamp = Math.floor(new Date(blockTime).getTime() / 1000);
        const timestamp = isTradeLevel
          ? rawTimestamp
          : Math.round(rawTimestamp / BUCKET_SIZE) * BUCKET_SIZE;

        const price = parseFloat(trade.Trade?.PriceInUSD) || 0;
        const tradeIds = trade.Trade?.Ids || [];
        const sideType = trade.Trade?.Side?.Type || 'buy';

        if (price <= 0 || price > 1) continue;

        let side = 'YES';
        if (tradeIds.length > 0 && secondTokenId && tradeIds.includes(secondTokenId)) {
          side = 'NO';
        } else if (sideType === 'sell') {
          side = 'NO';
        }

        snapshots.push({
          market_id: market.market_id,
          timestamp,
          side,
          mid: price,
          last: price,
          is_tradable: 1,
        });

        const complementPrice = 1 - price;
        if (complementPrice > 0 && complementPrice < 1) {
          snapshots.push({
            market_id: market.market_id,
            timestamp,
            side: side === 'YES' ? 'NO' : 'YES',
            mid: complementPrice,
            last: complementPrice,
            is_tradable: 1,
          });
        }
      }

      if (isTradeLevel) {
        snapshots.sort((a, b) => a.timestamp - b.timestamp);
        console.log(`[PolymarketClient] Transformed to ${snapshots.length} snapshots (trade level)`);
        return snapshots;
      }

      const buckets = new Map();
      for (const snap of snapshots) {
        const key = `${snap.timestamp}_${snap.side}`;
        if (!buckets.has(key)) {
          buckets.set(key, { ...snap, prices: [snap.mid] });
        } else {
          buckets.get(key).prices.push(snap.mid);
        }
      }

      const aggregated = Array.from(buckets.values()).map(b => ({
        market_id: b.market_id,
        timestamp: b.timestamp,
        side: b.side,
        mid: b.prices.reduce((s, p) => s + p, 0) / b.prices.length,
        last: b.prices[b.prices.length - 1],
        is_tradable: b.is_tradable,
      }));

      aggregated.sort((a, b) => a.timestamp - b.timestamp);

      console.log(`[PolymarketClient] Transformed to ${aggregated.length} snapshots (${BUCKET_SIZE}s buckets)`);

      return aggregated;
    } catch (error) {
      console.error(`[PolymarketClient] Error fetching snapshots via Bitquery for ${market.market_id}:`, error.message);
      return [];
    }
  }

  async _fetchSnapshotsPolymarketAPI(market, startTime, endTime) {
    try {
      const tokenIds = market.clob_token_ids || [];
      if (tokenIds.length === 0) {
        console.warn(`No CLOB token IDs for market ${market.market_id}`);
        return [];
      }

      const isClosed = market.status === 'closed' || market.status === 'resolved';
      const allSnapshots = [];

      for (let i = 0; i < tokenIds.length; i++) {
        const tokenId = tokenIds[i];
        const side = i === 0 ? 'YES' : 'NO';

        let data = [];
        const fidelities = isClosed ? [720, 60, 5] : [60, 5];

        for (const fidelity of fidelities) {
          try {
            const response = await this.client.get(`${POLYMARKET_API_BASE}/prices-history`, {
              params: {
                market: tokenId,
                interval: 'max',
                fidelity
              }
            });
            data = response.data?.history || [];
            if (data.length > 0) {
              console.log(`  Token ${side} (${tokenId.substring(0, 20)}...): ${data.length} points (fidelity=${fidelity})`);
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (data.length === 0) {
          continue;
        }

        const filtered = data.filter(p => p.t >= startTime && p.t <= endTime);

        const BUCKET_SIZE = this._getSnapshotIntervalSeconds();
        const isTradeLevel = BUCKET_SIZE === 0;
        for (const point of filtered) {
          const rawTimestamp = point.t;
          const timestamp = isTradeLevel ? rawTimestamp : Math.round(rawTimestamp / BUCKET_SIZE) * BUCKET_SIZE;
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

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      return allSnapshots;
    } catch (error) {
      console.error(`Error fetching snapshots for ${market.market_id}:`, error.message);
      return [];
    }
  }

  _getSnapshotIntervalSeconds() {
    try {
      const settingsPath = path.join(process.cwd(), 'data', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const settings = JSON.parse(raw);
        const minutes = settings.snapshotInterval;
        if (minutes === 0) return 0;
        return (minutes || 1) * 60;
      }
    } catch (e) {}
    return 60;
  }

}

export default new PolymarketClient();
