/**
 * Polymarket Market Finder (Hybrid: Gamma API + Bitquery V2)
 *
 * Uses Polymarket's Gamma API for market discovery (has market names/questions),
 * then Bitquery's DEXTradeByTokens for historical price data.
 *
 * This hybrid approach is needed because Polymarket outcome tokens on-chain
 * don't have human-readable names - they're identified by numeric token IDs.
 */

import axios from 'axios';
import bitqueryClient from './bitquery-client.js';
import {
  isBitcoinMarket,
  isUpDownMarket,
  extractTimeframe,
  createTokenMapping,
} from './data-mappers.js';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

/**
 * Discover markets by asset using Gamma API for names, Bitquery for trade data
 *
 * @param {string} asset - Asset keyword ('BTC', 'ETH', 'SOL')
 * @param {string} timeframe - Market timeframe filter
 * @param {Date} startTime - Start of search period
 * @param {Date} endTime - End of search period
 * @returns {Promise<Array>} Array of market metadata with trade data
 */
export async function discoverMarketsByAsset(asset, timeframe, startTime, endTime) {
  console.log(`[MarketFinder] Discovering ${asset} markets (Gamma + Bitquery)...`);
  console.log(`[MarketFinder] Period: ${startTime.toISOString()} to ${endTime.toISOString()}`);

  try {
    const assetKeywords = {
      BTC: [/\bbitcoin\b/i, /\bbtc\b/i, /\$btc/i],
      ETH: [/\bethereum\b/i, /(?<![a-z])eth(?![a-z])/i, /\$eth/i],
      SOL: [/\bsolana\b/i, /(?<![a-z])sol(?![a-z])/i, /\$sol/i],
    };

    const keywords = assetKeywords[asset.toUpperCase()] || [new RegExp(asset, 'i')];
    const client = axios.create({ timeout: 30000 });

    console.log(`[MarketFinder] Fetching markets from Gamma API...`);
    const allGammaMarkets = [];

    for (let offset = 0; offset < 500; offset += 100) {
      const response = await client.get(`${GAMMA_API_BASE}/markets`, {
        params: { limit: 100, offset, active: true, closed: false },
      });
      const batch = response.data || [];
      if (batch.length === 0) break;
      allGammaMarkets.push(...batch);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`[MarketFinder] Fetched ${allGammaMarkets.length} markets from Gamma API`);

    const filteredMarkets = allGammaMarkets.filter(market => {
      const searchText = `${market.question || ''} ${market.description || ''}`;
      const assetMatch = keywords.some(kw => kw.test(searchText));
      if (!assetMatch) return false;
      const hasClobTokens = market.clobTokenIds && market.clobTokenIds !== '[]';
      return hasClobTokens;
    });

    console.log(`[MarketFinder] Found ${filteredMarkets.length} ${asset} markets from Gamma API`);

    if (filteredMarkets.length === 0) {
      return [];
    }

    let tokenIds = [];
    for (const market of filteredMarkets) {
      try {
        const ids = JSON.parse(market.clobTokenIds || '[]');
        tokenIds.push(...ids);
      } catch (e) { /* skip */ }
    }

    console.log(`[MarketFinder] Fetching Bitquery trade data for ${tokenIds.length} token IDs...`);

    const trades = await bitqueryClient.queryAllPolymarketTrades(
      startTime.toISOString(),
      endTime.toISOString(),
      10000
    );

    console.log(`[MarketFinder] Fetched ${trades.length} total Polymarket trades from Bitquery`);

    const tokenIdSet = new Set(tokenIds);
    const tradesByTokenId = new Map();

    for (const trade of trades) {
      const tradeIds = trade.Trade?.Ids || [];
      for (const id of tradeIds) {
        if (tokenIdSet.has(id)) {
          if (!tradesByTokenId.has(id)) {
            tradesByTokenId.set(id, []);
          }
          tradesByTokenId.get(id).push(trade);
        }
      }
    }

    console.log(`[MarketFinder] Matched trades for ${tradesByTokenId.size} of ${tokenIds.length} token IDs`);

    const markets = filteredMarkets.map(market => {
      let parsedTokenIds = [];
      try {
        parsedTokenIds = JSON.parse(market.clobTokenIds || '[]');
      } catch (e) { /* skip */ }

      const marketTrades = [];
      for (const tokenId of parsedTokenIds) {
        const tokenTrades = tradesByTokenId.get(tokenId) || [];
        marketTrades.push(...tokenTrades);
      }

      const question = market.question || '';
      const isUpDown = isUpDownMarket(question);
      const tokenMapping = createTokenMapping(market.conditionId || market.id, question);

      return {
        id: market.conditionId || market.id,
        market_id: market.conditionId || market.id,
        condition_id: market.conditionId || market.id,
        question,
        description: market.description || question,
        active: true,
        closed: false,
        tokens: [
          { token_id: parsedTokenIds[0] || '0', outcome: tokenMapping['0'] },
          { token_id: parsedTokenIds[1] || '1', outcome: tokenMapping['1'] },
        ],
        clobTokenIds: parsedTokenIds,
        startDate: market.startDate || startTime.toISOString(),
        endDate: market.endDate || null,
        metadata: {
          timeframe: extractTimeframe(question),
          is_up_down: isUpDown,
          trade_count: marketTrades.length,
          token_symbol: market.symbol || '',
        },
        _trades: marketTrades,
      };
    });

    const marketsWithTrades = markets.filter(m => m._trades.length > 0);
    const marketsWithoutTrades = markets.filter(m => m._trades.length === 0);

    console.log(`[MarketFinder] ${marketsWithTrades.length} markets have Bitquery trade data`);
    console.log(`[MarketFinder] ${marketsWithoutTrades.length} markets have no trade data in range`);

    marketsWithTrades.sort((a, b) => (b.metadata.trade_count || 0) - (a.metadata.trade_count || 0));

    return marketsWithTrades.length > 0 ? marketsWithTrades : markets;
  } catch (error) {
    console.error(`[MarketFinder] Failed to discover ${asset} markets:`, error.message);
    throw error;
  }
}

/**
 * Batch discover markets with pagination for large time ranges
 */
export async function batchDiscoverMarkets(asset, timeframe, startTime, endTime, chunkSizeDays = 7) {
  const allMarkets = [];
  let currentStart = new Date(startTime);
  const finalEnd = new Date(endTime);

  console.log(`[MarketFinder] Batch discovering markets in ${chunkSizeDays}-day chunks`);

  while (currentStart < finalEnd) {
    const currentEnd = new Date(
      Math.min(
        currentStart.getTime() + chunkSizeDays * 24 * 60 * 60 * 1000,
        finalEnd.getTime()
      )
    );

    console.log(`[MarketFinder] Chunk: ${currentStart.toISOString()} to ${currentEnd.toISOString()}`);

    const chunkMarkets = await discoverMarketsByAsset(asset, timeframe, currentStart, currentEnd);
    allMarkets.push(...chunkMarkets);

    console.log(`[MarketFinder] Found ${chunkMarkets.length} markets in this chunk`);

    currentStart = currentEnd;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const deduped = deduplicateMarkets(allMarkets);
  console.log(`[MarketFinder] Total unique markets discovered: ${deduped.length}`);

  return deduped;
}

function deduplicateMarkets(markets) {
  const map = new Map();

  for (const market of markets) {
    if (map.has(market.market_id)) {
      const existing = map.get(market.market_id);
      existing.metadata.trade_count += market.metadata.trade_count;
      existing._trades = [...(existing._trades || []), ...(market._trades || [])];
    } else {
      map.set(market.market_id, { ...market });
    }
  }

  return Array.from(map.values());
}

export default {
  discoverMarketsByAsset,
  batchDiscoverMarkets,
};
