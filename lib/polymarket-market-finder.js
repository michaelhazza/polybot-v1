/**
 * Polymarket Market Finder (Bitquery Integration)
 *
 * Discovers Bitcoin UP/DOWN prediction markets using Bitquery's blockchain indexing.
 * Replaces the existing Polymarket API market discovery with on-chain event data.
 */

import bitqueryClient from './bitquery-client.js';
import {
  parseAncillaryData,
  isBitcoinMarket,
  isUpDownMarket,
  extractTimeframe,
  createTokenMapping,
  transformConditionPreparationToMarket,
} from './data-mappers.js';

/**
 * Find Bitcoin markets within a time range
 *
 * @param {Date} startTime - Start of search period
 * @param {Date} endTime - End of search period
 * @param {string} timeframe - Market timeframe filter ('5m', '15m', etc.)
 * @returns {Promise<Array>} Array of Bitcoin market metadata
 */
export async function findBitcoinMarkets(startTime, endTime, timeframe = null) {
  console.log(`[MarketFinder] Searching for Bitcoin markets from ${startTime.toISOString()} to ${endTime.toISOString()}`);

  try {
    // Step 1: Query ConditionPreparation events to find all markets
    const conditionEvents = await bitqueryClient.queryConditionPreparationEvents(
      startTime.toISOString(),
      endTime.toISOString(),
      500 // Fetch up to 500 markets
    );

    console.log(`[MarketFinder] Found ${conditionEvents.length} ConditionPreparation events`);

    // Step 2: Query QuestionInitialized events to get market metadata
    const questionEvents = await bitqueryClient.queryQuestionInitializedEvents(
      startTime.toISOString(),
      endTime.toISOString(),
      500
    );

    console.log(`[MarketFinder] Found ${questionEvents.length} QuestionInitialized events`);

    // Step 3: Map questions to conditions
    const questionMap = new Map();

    for (const event of questionEvents) {
      try {
        const args = event.Arguments.reduce((acc, arg) => {
          acc[arg.Name] = arg.Value;
          return acc;
        }, {});

        const questionId = args.identifier?.hex || args.questionId?.hex;
        const ancillaryData = args.ancillaryData?.hex;

        if (questionId && ancillaryData) {
          const questionText = parseAncillaryData(ancillaryData);
          questionMap.set(questionId, questionText);
        }
      } catch (error) {
        console.warn('[MarketFinder] Failed to parse QuestionInitialized event:', error.message);
      }
    }

    console.log(`[MarketFinder] Parsed ${questionMap.size} market questions`);

    // Step 4: Filter for Bitcoin markets
    const bitcoinMarkets = [];

    for (const event of conditionEvents) {
      try {
        const market = transformConditionPreparationToMarket(event);

        if (!market || !market.question_id) {
          continue;
        }

        // Get the question text
        const question = questionMap.get(market.question_id) || '';

        // Check if it's a Bitcoin market
        if (!isBitcoinMarket(question)) {
          continue;
        }

        // Extract timeframe
        const marketTimeframe = extractTimeframe(question);

        // Filter by timeframe if specified
        if (timeframe && marketTimeframe !== timeframe && marketTimeframe !== 'unknown') {
          continue;
        }

        // Check if it's UP/DOWN format
        const isUpDown = isUpDownMarket(question);

        // Create token mapping
        const tokenMapping = createTokenMapping(market.condition_id, question);

        // Add market metadata
        bitcoinMarkets.push({
          market_id: market.condition_id,
          condition_id: market.condition_id,
          question,
          timeframe: marketTimeframe,
          is_up_down: isUpDown,
          token_mapping: tokenMapping,
          created_at: market.created_at,
          oracle: market.oracle,
          tx_hash: market.tx_hash,
        });
      } catch (error) {
        console.warn('[MarketFinder] Failed to process ConditionPreparation event:', error.message);
      }
    }

    console.log(`[MarketFinder] Found ${bitcoinMarkets.length} Bitcoin markets`);

    // Sort by creation time (newest first)
    bitcoinMarkets.sort((a, b) => b.created_at - a.created_at);

    return bitcoinMarkets;
  } catch (error) {
    console.error('[MarketFinder] Failed to find Bitcoin markets:', error);
    throw error;
  }
}

/**
 * Find active Bitcoin markets for a specific timeframe
 *
 * Focuses on markets that should still be active (created recently).
 *
 * @param {string} timeframe - Market timeframe ('5m', '15m', etc.)
 * @param {number} lookbackHours - How many hours to look back for markets
 * @returns {Promise<Array>} Array of active market metadata
 */
export async function findActiveBitcoinMarkets(timeframe = '15m', lookbackHours = 24) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - lookbackHours * 60 * 60 * 1000);

  const markets = await findBitcoinMarkets(startTime, endTime, timeframe);

  // Filter for markets that should still be active
  // For 5-minute markets, they expire quickly
  // For 15-minute markets, they last longer
  const timeframeMinutes = {
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '2h': 120,
    '4h': 240,
    '1d': 1440,
  };

  const expiryMinutes = timeframeMinutes[timeframe] || 15;
  const currentTimestamp = Math.floor(Date.now() / 1000);

  const activeMarkets = markets.filter(market => {
    const marketAge = currentTimestamp - market.created_at;
    const maxAge = expiryMinutes * 60 * 2; // Allow 2x the timeframe for safety
    return marketAge <= maxAge;
  });

  console.log(`[MarketFinder] ${activeMarkets.length} of ${markets.length} markets still active`);

  return activeMarkets;
}

/**
 * Get market details including token IDs
 *
 * @param {string} conditionId - Market condition ID
 * @returns {Promise<object>} Market details with token information
 */
export async function getMarketDetails(conditionId) {
  console.log(`[MarketFinder] Fetching details for market ${conditionId}`);

  try {
    // Query PositionSplit events to get token IDs
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days back

    // Note: We'll need to add a queryPositionSplitEvents method to bitqueryClient
    // For now, return basic structure
    return {
      condition_id: conditionId,
      token_ids: ['0', '1'], // Default binary market tokens
      status: 'active',
    };
  } catch (error) {
    console.error(`[MarketFinder] Failed to fetch market details for ${conditionId}:`, error);
    throw error;
  }
}

/**
 * Discover markets by asset keyword
 *
 * This is the main entry point that matches the existing API interface.
 *
 * @param {string} asset - Asset keyword ('BTC', 'ETH', 'SOL')
 * @param {string} timeframe - Market timeframe ('5m', '15m', etc.)
 * @param {Date} startTime - Start of search period
 * @param {Date} endTime - End of search period
 * @returns {Promise<Array>} Array of market metadata in existing format
 */
export async function discoverMarketsByAsset(asset, timeframe, startTime, endTime) {
  console.log(`[MarketFinder] Discovering ${asset} ${timeframe} markets`);

  // Map asset to market filter
  const assetFilters = {
    BTC: findBitcoinMarkets,
    // TODO: Add ETH and SOL filters when needed
  };

  const filterFn = assetFilters[asset];

  if (!filterFn) {
    console.warn(`[MarketFinder] No filter function for asset: ${asset}`);
    return [];
  }

  const markets = await filterFn(startTime, endTime, timeframe);

  // Transform to match existing polymarket-client format
  return markets.map(market => ({
    id: market.market_id,
    market_id: market.market_id,
    condition_id: market.condition_id,
    question: market.question,
    description: market.question,
    active: true,
    closed: false,
    tokens: [
      {
        token_id: '0',
        outcome: market.token_mapping['0'],
      },
      {
        token_id: '1',
        outcome: market.token_mapping['1'],
      },
    ],
    clobTokenIds: ['0', '1'],
    startDate: new Date(market.created_at * 1000).toISOString(),
    endDate: null,
    metadata: {
      timeframe: market.timeframe,
      is_up_down: market.is_up_down,
      oracle: market.oracle,
      tx_hash: market.tx_hash,
    },
  }));
}

/**
 * Batch discover markets with pagination
 *
 * Handles large time ranges by breaking them into smaller chunks.
 *
 * @param {string} asset - Asset keyword
 * @param {string} timeframe - Market timeframe
 * @param {Date} startTime - Start of search period
 * @param {Date} endTime - End of search period
 * @param {number} chunkSizeDays - Size of each time chunk in days
 * @returns {Promise<Array>} Combined array of all discovered markets
 */
export async function batchDiscoverMarkets(
  asset,
  timeframe,
  startTime,
  endTime,
  chunkSizeDays = 7
) {
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

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`[MarketFinder] Total markets discovered: ${allMarkets.length}`);

  return allMarkets;
}

export default {
  findBitcoinMarkets,
  findActiveBitcoinMarkets,
  getMarketDetails,
  discoverMarketsByAsset,
  batchDiscoverMarkets,
};
