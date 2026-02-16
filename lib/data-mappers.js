/**
 * Data Transformation Mappers
 *
 * Transforms Bitquery event data into the existing database schema format.
 * Maintains compatibility with existing window detection and arbitrage logic.
 */

import { parseOrderFilledArgs } from '../config/bitquery-queries.js';

/**
 * USDC has 6 decimal places on Polygon
 */
const USDC_DECIMALS = 1000000;

/**
 * Bucket size for timestamp rounding (5 seconds)
 */
const BUCKET_SIZE = 5;

/**
 * Calculate price from OrderFilled event
 *
 * @param {string} makerAmountStr - USDC amount paid (in wei, 6 decimals)
 * @param {string} takerAmountStr - Tokens received
 * @returns {number} Price per token
 */
export function calculatePriceFromOrderFilled(makerAmountStr, takerAmountStr) {
  // Validate inputs
  if (!makerAmountStr || !takerAmountStr) {
    console.error('[DataMapper] Invalid input: makerAmount or takerAmount is missing');
    return null;
  }

  try {
    // Convert string amounts to BigInt (handles large numbers safely)
    const makerAmount = BigInt(makerAmountStr);
    const takerAmount = BigInt(takerAmountStr);

    // Prevent division by zero
    if (takerAmount === 0n) {
      console.warn('[DataMapper] Division by zero: takerAmount is 0');
      return null;
    }

    // Validate non-negative amounts
    if (makerAmount < 0n || takerAmount < 0n) {
      console.error('[DataMapper] Invalid amounts: negative values not allowed');
      return null;
    }

    // Calculate price: USDC_paid / tokens_received
    // Convert USDC from wei (divide by 10^6)
    const usdcPaid = Number(makerAmount) / USDC_DECIMALS;
    const tokensReceived = Number(takerAmount);

    const price = usdcPaid / tokensReceived;

    // Sanity check: price should be between 0 and 1 for Polymarket
    if (price < 0 || price > 1) {
      console.warn(`[DataMapper] Price out of range [0,1]: ${price} (USDC: ${usdcPaid}, Tokens: ${tokensReceived})`);
      // Clamp to valid range rather than rejecting
      return Math.max(0, Math.min(1, price));
    }

    // Check for NaN or Infinity
    if (!isFinite(price)) {
      console.error('[DataMapper] Invalid price calculation result:', price);
      return null;
    }

    return price;
  } catch (error) {
    console.error('[DataMapper] Error calculating price:', error.message);
    return null;
  }
}

/**
 * Round timestamp to bucket interval
 *
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {number} Rounded timestamp
 */
export function roundTimestampToBucket(timestamp) {
  return Math.round(timestamp / BUCKET_SIZE) * BUCKET_SIZE;
}

/**
 * Determine side (UP/DOWN or YES/NO) from token ID
 *
 * For binary markets:
 * - tokenId 0 or 1 typically represents one outcome
 * - We'll need to map this based on market metadata
 *
 * @param {string} tokenIdStr - Token ID from event
 * @param {object} tokenMapping - Map of tokenId -> side ('UP'|'DOWN')
 * @returns {string} Side ('UP', 'DOWN', 'YES', 'NO')
 */
export function determineSide(tokenIdStr, tokenMapping = {}) {
  const tokenId = tokenIdStr.toString();

  // Check if we have a mapping for this token
  if (tokenMapping[tokenId]) {
    return tokenMapping[tokenId];
  }

  // Default fallback: use tokenId 0 as YES/UP, tokenId 1 as NO/DOWN
  // This is a simplification - real mapping should come from market metadata
  const tokenIdNum = parseInt(tokenId, 10);

  if (tokenIdNum === 0 || tokenIdNum === 1) {
    return tokenIdNum === 0 ? 'UP' : 'DOWN';
  }

  console.warn(`[DataMapper] Unknown tokenId: ${tokenId}. Defaulting to 'UP'.`);
  return 'UP';
}

/**
 * Transform OrderFilled event to snapshot record
 *
 * Output format matches existing snapshots table schema:
 * {
 *   market_id: string,
 *   timestamp: number (Unix seconds),
 *   side: 'UP'|'DOWN'|'YES'|'NO',
 *   mid: number (price),
 *   last: number (price),
 *   is_tradable: 1
 * }
 *
 * @param {object} event - OrderFilled event from Bitquery
 * @param {string} conditionId - Market condition ID
 * @param {object} tokenMapping - Map of tokenId -> side
 * @returns {object} Snapshot record
 */
export function transformOrderFilledToSnapshot(event, conditionId, tokenMapping = {}) {
  try {
    // Validate inputs
    if (!event || !conditionId) {
      console.error('[DataMapper] Invalid input: event or conditionId is missing');
      return null;
    }

    if (!event.Arguments || !event.Block || !event.Block.Time) {
      console.error('[DataMapper] Invalid event structure: missing required fields');
      return null;
    }

    // Parse event arguments
    const args = parseOrderFilledArgs(event.Arguments);

    // Extract relevant fields
    const makerAmount = args.makerAmount || args.makerAssetAmount || '0';
    const takerAmount = args.takerAmount || args.takerAssetAmount || '0';
    const tokenId = args.tokenId || '0';

    // Calculate price
    const price = calculatePriceFromOrderFilled(makerAmount, takerAmount);

    // Skip this event if price calculation failed
    if (price === null || price === undefined) {
      console.warn('[DataMapper] Skipping event due to invalid price calculation');
      return null;
    }

    // Validate price range
    if (price < 0 || price > 1) {
      console.warn(`[DataMapper] Skipping event with out-of-range price: ${price}`);
      return null;
    }

    // Determine side
    const side = determineSide(tokenId, tokenMapping);

    const rawTimestamp = Math.floor(new Date(event.Block.Time).getTime() / 1000);
    const timestamp = roundTimestampToBucket(rawTimestamp);

    // Validate timestamp
    if (!timestamp || timestamp <= 0) {
      console.error('[DataMapper] Invalid timestamp:', timestamp);
      return null;
    }

    // Return snapshot in existing schema format
    return {
      market_id: conditionId,
      timestamp,
      side,
      mid: price,
      last: price,
      is_tradable: 1,
    };
  } catch (error) {
    console.error('[DataMapper] Failed to transform OrderFilled event:', error.message);
    if (event) {
      console.error('[DataMapper] Event condition_id:', conditionId);
      console.error('[DataMapper] Event block time:', event.Block?.Time);
    }
    return null;
  }
}

/**
 * Aggregate multiple OrderFilled events into price snapshots
 *
 * Groups events by timestamp bucket and calculates average prices.
 * This reduces data volume and smooths out price fluctuations.
 *
 * @param {Array} events - Array of OrderFilled events
 * @param {string} conditionId - Market condition ID
 * @param {object} tokenMapping - Map of tokenId -> side
 * @returns {Array} Array of snapshot records
 */
export function aggregateOrderFilledEvents(events, conditionId, tokenMapping = {}) {
  // Validate inputs
  if (!events || !Array.isArray(events)) {
    console.error('[DataMapper] Invalid events input: must be an array');
    return [];
  }

  if (!conditionId) {
    console.error('[DataMapper] Invalid conditionId: must be provided');
    return [];
  }

  if (events.length === 0) {
    console.warn('[DataMapper] No events to aggregate');
    return [];
  }

  const buckets = new Map();
  let skippedCount = 0;

  // Transform and group events by bucket
  for (const event of events) {
    const snapshot = transformOrderFilledToSnapshot(event, conditionId, tokenMapping);

    if (!snapshot) {
      skippedCount++;
      continue;
    }

    // Create bucket key: timestamp + side
    const key = `${snapshot.timestamp}_${snapshot.side}`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        market_id: snapshot.market_id,
        timestamp: snapshot.timestamp,
        side: snapshot.side,
        prices: [],
        is_tradable: 1,
      });
    }

    buckets.get(key).prices.push(snapshot.mid);
  }

  if (skippedCount > 0) {
    console.warn(`[DataMapper] Skipped ${skippedCount} invalid events out of ${events.length}`);
  }

  // Calculate average price for each bucket
  const snapshots = [];

  for (const bucket of buckets.values()) {
    if (bucket.prices.length === 0) {
      console.warn('[DataMapper] Bucket has no prices, skipping');
      continue;
    }

    const avgPrice = bucket.prices.reduce((sum, p) => sum + p, 0) / bucket.prices.length;

    // Validate average price
    if (!isFinite(avgPrice) || avgPrice < 0 || avgPrice > 1) {
      console.warn(`[DataMapper] Invalid average price: ${avgPrice}, skipping bucket`);
      continue;
    }

    snapshots.push({
      market_id: bucket.market_id,
      timestamp: bucket.timestamp,
      side: bucket.side,
      mid: avgPrice,
      last: bucket.prices[bucket.prices.length - 1], // Use last price in bucket
      is_tradable: bucket.is_tradable,
    });
  }

  // Sort by timestamp
  snapshots.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`[DataMapper] Aggregated ${events.length} events into ${snapshots.length} snapshots`);

  return snapshots;
}

/**
 * Transform ConditionPreparation event to market metadata
 *
 * @param {object} event - ConditionPreparation event from Bitquery
 * @returns {object} Market metadata
 */
export function transformConditionPreparationToMarket(event) {
  try {
    const args = parseOrderFilledArgs(event.Arguments);

    const conditionId = args.conditionId || args.condition;
    const oracle = args.oracle;
    const questionId = args.questionId;
    const outcomeSlotCount = args.outcomeSlotCount || 2;

    const timestamp = Math.floor(new Date(event.Block.Time).getTime() / 1000);

    return {
      condition_id: conditionId,
      oracle,
      question_id: questionId,
      outcome_slot_count: parseInt(outcomeSlotCount, 10),
      created_at: timestamp,
      tx_hash: event.Transaction.Hash,
    };
  } catch (error) {
    console.error('[DataMapper] Failed to transform ConditionPreparation event:', error);
    return null;
  }
}

/**
 * Parse ancillary data to extract market question
 *
 * Polymarket stores market questions in ancillaryData field as hex-encoded strings.
 *
 * @param {string} ancillaryDataHex - Hex-encoded ancillary data
 * @returns {string} Decoded question string
 */
export function parseAncillaryData(ancillaryDataHex) {
  try {
    if (!ancillaryDataHex || ancillaryDataHex === '0x') {
      return '';
    }

    // Remove '0x' prefix
    const hex = ancillaryDataHex.startsWith('0x') ? ancillaryDataHex.slice(2) : ancillaryDataHex;

    // Convert hex to string
    const decoded = Buffer.from(hex, 'hex').toString('utf8');

    return decoded;
  } catch (error) {
    console.error('[DataMapper] Failed to parse ancillary data:', error);
    return '';
  }
}

/**
 * Check if market is Bitcoin-related
 *
 * @param {string} question - Market question text
 * @returns {boolean} True if Bitcoin-related
 */
export function isBitcoinMarket(question) {
  const btcPatterns = [
    /\bbitcoin\b/i,
    /\bbtc\b/i,
    /\$btc/i,
    /BTC-/i,
    /bitcoin/i,
  ];

  return btcPatterns.some(pattern => pattern.test(question));
}

/**
 * Check if market is UP/DOWN format (vs YES/NO)
 *
 * @param {string} question - Market question text
 * @returns {boolean} True if UP/DOWN market
 */
export function isUpDownMarket(question) {
  const upDownPatterns = [
    /\bup\b/i,
    /\bdown\b/i,
    /will.*rise/i,
    /will.*fall/i,
    /higher/i,
    /lower/i,
  ];

  return upDownPatterns.some(pattern => pattern.test(question));
}

/**
 * Extract market timeframe from question
 *
 * @param {string} question - Market question text
 * @returns {string} Timeframe ('5m', '15m', '1h', etc.) or 'unknown'
 */
export function extractTimeframe(question) {
  const timeframePatterns = [
    { pattern: /5\s*min/i, value: '5m' },
    { pattern: /15\s*min/i, value: '15m' },
    { pattern: /30\s*min/i, value: '30m' },
    { pattern: /1\s*hour/i, value: '1h' },
    { pattern: /2\s*hour/i, value: '2h' },
    { pattern: /4\s*hour/i, value: '4h' },
    { pattern: /daily/i, value: '1d' },
  ];

  for (const { pattern, value } of timeframePatterns) {
    if (pattern.test(question)) {
      return value;
    }
  }

  return 'unknown';
}

/**
 * Create token ID mapping for a market
 *
 * For Polymarket binary markets, we need to map token IDs to UP/DOWN or YES/NO.
 * This is typically derived from market metadata or contract events.
 *
 * @param {string} conditionId - Market condition ID
 * @param {string} marketQuestion - Market question text
 * @returns {object} Token ID mapping { tokenId: 'UP'|'DOWN'|'YES'|'NO' }
 */
export function createTokenMapping(conditionId, marketQuestion) {
  // Determine if this is UP/DOWN or YES/NO market
  const isUpDown = isUpDownMarket(marketQuestion);

  // For binary markets, Polymarket typically uses:
  // - Token 0: First outcome (YES or UP)
  // - Token 1: Second outcome (NO or DOWN)
  return {
    '0': isUpDown ? 'UP' : 'YES',
    '1': isUpDown ? 'DOWN' : 'NO',
  };
}

export default {
  calculatePriceFromOrderFilled,
  roundTimestampToBucket,
  determineSide,
  transformOrderFilledToSnapshot,
  aggregateOrderFilledEvents,
  transformConditionPreparationToMarket,
  parseAncillaryData,
  isBitcoinMarket,
  isUpDownMarket,
  extractTimeframe,
  createTokenMapping,
  BUCKET_SIZE,
};
