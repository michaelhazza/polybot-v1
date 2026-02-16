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

const ASSET_KEYWORDS = {
  BTC: [/\bbitcoin\b/i, /\bbtc\b/i, /\$btc/i],
  ETH: [/\bethereum\b/i, /(?<![a-z])eth(?![a-z])/i, /\$eth/i],
  SOL: [/\bsolana\b/i, /(?<![a-z])sol(?![a-z])/i, /\$sol/i],
};

/**
 * Fetch markets from Gamma API with pagination (active + closed)
 */
async function fetchGammaMarkets(asset, startTime) {
  const keywords = ASSET_KEYWORDS[asset.toUpperCase()] || [new RegExp(asset, 'i')];
  const client = axios.create({ timeout: 30000 });

  console.log(`[MarketFinder] Fetching markets from Gamma API (active + closed)...`);

  const MAX_GAMMA_PAGES = 30;
  const fetchBatch = async (params, label) => {
    const markets = [];
    for (let offset = 0; offset < MAX_GAMMA_PAGES * 100; offset += 100) {
      const response = await client.get(`${GAMMA_API_BASE}/markets`, {
        params: { limit: 100, offset, ...params },
      });
      const batch = response.data || [];
      if (batch.length === 0) break;
      markets.push(...batch);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    console.log(`[MarketFinder] Fetched ${markets.length} ${label} markets from Gamma`);
    return markets;
  };

  const [activeMarkets, closedMarkets] = await Promise.all([
    fetchBatch({ active: true, closed: false }, 'active'),
    fetchBatch({ closed: true, end_date_min: startTime.toISOString().split('T')[0] }, 'closed'),
  ]);

  const seenIds = new Set();
  const allMarkets = [];
  for (const m of [...activeMarkets, ...closedMarkets]) {
    const id = m.conditionId || m.id;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      allMarkets.push(m);
    }
  }

  console.log(`[MarketFinder] Total unique Gamma markets: ${allMarkets.length}`);

  const startTs = startTime.getTime();

  const filtered = allMarkets.filter(market => {
    const searchText = `${market.question || ''} ${market.description || ''}`;
    const assetMatch = keywords.some(kw => kw.test(searchText));
    if (!assetMatch) return false;
    if (!market.clobTokenIds || market.clobTokenIds === '[]') return false;

    const endDateStr = market.endDate || market.end_date_iso;
    if (endDateStr) {
      const endDate = new Date(endDateStr);
      if (!isNaN(endDate.getTime()) && endDate.getTime() < startTs) {
        return false;
      }
    }

    const createdStr = market.createdAt || market.startDate;
    if (createdStr) {
      const createdDate = new Date(createdStr);
      const twoYearsBeforeStart = new Date(startTs - 2 * 365 * 24 * 60 * 60 * 1000);
      if (!isNaN(createdDate.getTime()) && createdDate < twoYearsBeforeStart) {
        return false;
      }
    }

    return true;
  });

  console.log(`[MarketFinder] Found ${filtered.length} ${asset} markets after keyword + date filter`);
  return filtered;
}

/**
 * Extract all unique token IDs from Gamma markets
 */
function extractTokenIds(gammaMarkets) {
  const tokenIds = new Set();
  for (const market of gammaMarkets) {
    try {
      const ids = JSON.parse(market.clobTokenIds || '[]');
      ids.forEach(id => tokenIds.add(id));
    } catch (e) { /* skip */ }
  }
  return [...tokenIds];
}

/**
 * Fetch Bitquery trades in time-range chunks to manage query costs
 */
async function fetchBitqueryTradesChunked(tokenIds, startTime, endTime, chunkSizeDays = 7) {
  if (tokenIds.length === 0) {
    console.warn('[MarketFinder] No token IDs to query');
    return [];
  }

  const allTrades = [];
  let currentStart = new Date(startTime);
  const finalEnd = new Date(endTime);
  const totalDays = Math.ceil((finalEnd - currentStart) / (1000 * 60 * 60 * 24));

  console.log(`[MarketFinder] Fetching Bitquery trades for ${tokenIds.length} tokens over ${totalDays} days in ${chunkSizeDays}-day chunks...`);

  let chunkNum = 0;
  while (currentStart < finalEnd) {
    const currentEnd = new Date(
      Math.min(
        currentStart.getTime() + chunkSizeDays * 24 * 60 * 60 * 1000,
        finalEnd.getTime()
      )
    );

    chunkNum++;
    console.log(`[MarketFinder] Bitquery chunk ${chunkNum}: ${currentStart.toISOString().split('T')[0]} to ${currentEnd.toISOString().split('T')[0]}`);

    try {
      const trades = await bitqueryClient.queryAllPolymarketTradesByTokens(
        currentStart.toISOString(),
        currentEnd.toISOString(),
        tokenIds,
        5000
      );
      allTrades.push(...trades);
      console.log(`[MarketFinder] Chunk ${chunkNum}: ${trades.length} trades`);
    } catch (error) {
      if (error.code === 'QUOTA_EXCEEDED') {
        console.warn(`[MarketFinder] Bitquery quota exceeded at chunk ${chunkNum}. Continuing with data collected so far.`);
        break;
      }
      console.error(`[MarketFinder] Error in chunk ${chunkNum}:`, error.message);
      throw error;
    }

    currentStart = currentEnd;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`[MarketFinder] Total trades fetched from Bitquery: ${allTrades.length}`);
  return allTrades;
}

/**
 * Build market objects by combining Gamma metadata with Bitquery trades
 */
function buildMarketObjects(gammaMarkets, trades, { returnAllIfNoTrades = false } = {}) {
  const tradesByTokenId = new Map();
  for (const trade of trades) {
    const tradeIds = trade.Trade?.Ids || [];
    for (const id of tradeIds) {
      if (!tradesByTokenId.has(id)) {
        tradesByTokenId.set(id, []);
      }
      tradesByTokenId.get(id).push(trade);
    }
  }

  const markets = gammaMarkets.map(market => {
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
      active: market.active !== false,
      closed: market.closed === true || market.closed === 'true',
      tokens: [
        { token_id: parsedTokenIds[0] || '0', outcome: tokenMapping['0'] },
        { token_id: parsedTokenIds[1] || '1', outcome: tokenMapping['1'] },
      ],
      clobTokenIds: parsedTokenIds,
      startDate: market.startDate || null,
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
  console.log(`[MarketFinder] ${marketsWithoutTrades.length} markets have no trade data in range (will try CLOB API)`);

  markets.sort((a, b) => (b.metadata.trade_count || 0) - (a.metadata.trade_count || 0));

  return markets;
}

/**
 * Discover markets by asset using Gamma API for names, Bitquery for trade data
 *
 * @param {string} asset - Asset keyword ('BTC', 'ETH', 'SOL')
 * @param {string} timeframe - Market timeframe filter
 * @param {Date} startTime - Start of search period
 * @param {Date} endTime - End of search period
 * @returns {Promise<Array>} Array of market metadata with trade data
 */
export async function discoverMarketsByAsset(asset, timeframe, startTime, endTime, options = {}) {
  if (!asset || typeof asset !== 'string') {
    throw new Error('[MarketFinder] Invalid asset: must be a non-empty string');
  }
  if (!startTime || !endTime) {
    throw new Error('[MarketFinder] Invalid time range: startTime and endTime are required');
  }
  if (!(startTime instanceof Date) || !(endTime instanceof Date)) {
    throw new Error('[MarketFinder] Invalid time format: startTime and endTime must be Date objects');
  }
  if (startTime >= endTime) {
    throw new Error('[MarketFinder] Invalid time range: startTime must be before endTime');
  }

  const excludeMarketIds = options.excludeMarketIds || new Set();

  const dayRange = Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24));
  console.log(`[MarketFinder] Discovering ${asset} markets (Gamma + Bitquery)...`);
  console.log(`[MarketFinder] Period: ${startTime.toISOString()} to ${endTime.toISOString()} (${dayRange} days)`);

  try {
    const gammaMarkets = await fetchGammaMarkets(asset, startTime);

    if (gammaMarkets.length === 0) {
      return [];
    }

    const marketsNeedingFetch = gammaMarkets.filter(m => {
      const id = m.conditionId || m.id;
      return !excludeMarketIds.has(id);
    });
    const marketsAlreadyCovered = gammaMarkets.filter(m => {
      const id = m.conditionId || m.id;
      return excludeMarketIds.has(id);
    });

    if (marketsAlreadyCovered.length > 0) {
      console.log(`[MarketFinder] Skipping Bitquery for ${marketsAlreadyCovered.length} markets (already have data)`);
    }

    console.log(`[MarketFinder] ${marketsNeedingFetch.length} markets to process (CLOB API primary, Bitquery fallback)`);

    const fetchedResults = buildMarketObjects(marketsNeedingFetch, []);
    const coveredResults = buildMarketObjects(marketsAlreadyCovered, []);

    return [...fetchedResults, ...coveredResults];
  } catch (error) {
    console.error(`[MarketFinder] Failed to discover ${asset} markets:`, error.message);
    throw error;
  }
}

export async function batchDiscoverMarkets(asset, timeframe, startTime, endTime, chunkSizeDays = 7, options = {}) {
  return discoverMarketsByAsset(asset, timeframe, startTime, endTime, options);
}

export default {
  discoverMarketsByAsset,
  batchDiscoverMarkets,
};
