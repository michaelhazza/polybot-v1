/**
 * Bitquery V2 GraphQL Client
 *
 * Handles authentication, rate limiting, and error handling for Bitquery V2 Streaming API.
 * Uses DEXTradeByTokens API for efficient Polymarket data access.
 *
 * Documentation: https://docs.bitquery.io/docs/examples/polymarket-api/polymarket-ctf-exchange/
 */

import { GraphQLClient } from 'graphql-request';
import dotenv from 'dotenv';

dotenv.config();

const USDC_CONTRACTS = [
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
];

class BitqueryClient {
  constructor() {
    this.endpoint = process.env.BITQUERY_STREAMING_ENDPOINT || 'https://streaming.bitquery.io/graphql';
    const rawToken = process.env.BITQUERY_OAUTH_TOKEN || '';
    this.oauthToken = rawToken.startsWith('Bearer ') ? rawToken : `Bearer ${rawToken}`;

    if (!rawToken) {
      console.warn('[BitqueryClient] Warning: BITQUERY_OAUTH_TOKEN not set. Bitquery queries will fail.');
    }

    this.client = new GraphQLClient(this.endpoint, {
      headers: {
        'Authorization': this.oauthToken,
        'Content-Type': 'application/json',
      },
    });

    this.requestCount = 0;
    this.requestLimit = 50;
    this.requestWindow = 60000;
    this.lastResetTime = Date.now();

    this.maxRetries = 4;
    this.baseDelay = 2000;

    // Statistics tracking
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      quotaErrors: 0,
      networkErrors: 0,
      lastQuotaError: null,
      lastSuccessfulRequest: null,
    };
  }

  async checkRateLimit() {
    const now = Date.now();
    if (now - this.lastResetTime >= this.requestWindow) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    if (this.requestCount >= this.requestLimit) {
      const waitTime = this.requestWindow - (now - this.lastResetTime);
      console.log(`[BitqueryClient] Rate limit reached. Waiting ${waitTime}ms...`);
      await this.sleep(waitTime);
      this.requestCount = 0;
      this.lastResetTime = Date.now();
    }
    this.requestCount++;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async executeQuery(query, variables = {}, retryCount = 0) {
    await this.checkRateLimit();

    this.stats.totalRequests++;

    try {
      const data = await this.client.request(query, variables);
      this.stats.successfulRequests++;
      this.stats.lastSuccessfulRequest = new Date().toISOString();
      return data;
    } catch (error) {
      // Handle HTTP 429 (Too Many Requests)
      if (error.response?.status === 429 && retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount);
        console.log(`[BitqueryClient] Rate limit error (429). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${this.maxRetries})`);
        await this.sleep(delay);
        return this.executeQuery(query, variables, retryCount + 1);
      }

      // Handle HTTP 402 (Payment Required - Quota Exceeded)
      if (error.response?.status === 402) {
        this.stats.quotaErrors++;
        this.stats.failedRequests++;
        this.stats.lastQuotaError = new Date().toISOString();
        const errorMsg = 'Bitquery API quota exceeded. Please check your subscription or wait for quota reset.';
        console.error(`[BitqueryClient] ${errorMsg}`);
        console.error(`[BitqueryClient] Quota errors: ${this.stats.quotaErrors}, Total requests: ${this.stats.totalRequests}`);
        const quotaError = new Error(errorMsg);
        quotaError.code = 'QUOTA_EXCEEDED';
        quotaError.status = 402;
        throw quotaError;
      }

      // Handle network errors with retry
      if ((error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') && retryCount < this.maxRetries) {
        this.stats.networkErrors++;
        const delay = this.baseDelay * Math.pow(2, retryCount);
        console.log(`[BitqueryClient] Network error (${error.code}). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${this.maxRetries})`);
        await this.sleep(delay);
        return this.executeQuery(query, variables, retryCount + 1);
      }

      // Handle GraphQL errors
      if (error.response?.errors) {
        const errors = error.response.errors;
        console.error('[BitqueryClient] GraphQL errors:', JSON.stringify(errors, null, 2));

        // Check for specific error types
        const firstError = errors[0];
        if (firstError?.message?.includes('quota') || firstError?.message?.includes('limit')) {
          const quotaError = new Error(`Bitquery API quota/limit error: ${firstError.message}`);
          quotaError.code = 'QUOTA_EXCEEDED';
          throw quotaError;
        }

        throw new Error(`Bitquery GraphQL error: ${firstError?.message || 'Unknown error'}`);
      }

      // Log and re-throw unknown errors
      this.stats.failedRequests++;
      console.error(`[BitqueryClient] Query failed:`, error.message);
      console.error(`[BitqueryClient] Error details:`, {
        code: error.code,
        status: error.response?.status,
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Get statistics about Bitquery API usage
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalRequests > 0
        ? ((this.stats.successfulRequests / this.stats.totalRequests) * 100).toFixed(2) + '%'
        : 'N/A',
      quotaErrorRate: this.stats.totalRequests > 0
        ? ((this.stats.quotaErrors / this.stats.totalRequests) * 100).toFixed(2) + '%'
        : 'N/A',
    };
  }

  /**
   * Reset statistics (useful for testing or monitoring)
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      quotaErrors: 0,
      networkErrors: 0,
      lastQuotaError: null,
      lastSuccessfulRequest: null,
    };
    console.log('[BitqueryClient] Statistics reset');
  }

  /**
   * Estimate query cost in Bitquery points
   * This is a rough estimate based on observed patterns
   */
  estimateQueryCost(startTime, endTime, tokenCount = 0, limit = 1000) {
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const dayRange = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

    // Base cost: ~100 points per day for filtered queries
    // Unfiltered queries (no token IDs): ~300 points per day
    const costPerDay = tokenCount > 0 ? 100 : 300;
    const estimatedCost = dayRange * costPerDay;

    return {
      estimatedPoints: estimatedCost,
      dayRange,
      tokenCount,
      limit,
      warning: estimatedCost > 500 ? 'High cost query - consider reducing time range or using token filters' : null
    };
  }

  /**
   * Query Polymarket trades filtered by specific token IDs (OPTIMIZED - Server-side filtering)
   * This method filters by token IDs in the GraphQL query itself, reducing data transfer and costs.
   *
   * @param {string} startTime - ISO 8601 timestamp
   * @param {string} endTime - ISO 8601 timestamp
   * @param {Array<string>} tokenIds - Array of token IDs to filter by (e.g., ['123456', '789012'])
   * @param {number} limit - Maximum trades to fetch
   * @param {number} offset - Pagination offset
   * @returns {Promise<Array>} Array of trade objects
   */
  async queryPolymarketTradesByTokens(startTime, endTime, tokenIds = [], limit = 1000, offset = 0) {
    // Validate inputs
    if (!startTime || !endTime) {
      throw new Error('[BitqueryClient] startTime and endTime are required');
    }

    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      throw new Error('[BitqueryClient] tokenIds must be a non-empty array');
    }

    // Validate ISO 8601 format
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('[BitqueryClient] Invalid date format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)');
    }

    if (startDate >= endDate) {
      throw new Error('[BitqueryClient] startTime must be before endTime');
    }

    // Warn about large time ranges
    const dayRange = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const MAX_RECOMMENDED_DAYS = 30;
    if (dayRange > MAX_RECOMMENDED_DAYS) {
      console.warn(`[BitqueryClient] Large time range (${dayRange} days). Consider chunking queries to reduce costs.`);
    }

    // Validate limit and offset
    if (limit <= 0 || limit > 10000) {
      throw new Error('[BitqueryClient] limit must be between 1 and 10000');
    }

    if (offset < 0) {
      throw new Error('[BitqueryClient] offset must be non-negative');
    }

    // Estimate and log query cost
    const costEstimate = this.estimateQueryCost(startTime, endTime, tokenIds.length, limit);
    console.log(`[BitqueryClient] Estimated query cost: ${costEstimate.estimatedPoints} points (${costEstimate.dayRange} days, ${tokenIds.length} tokens)`);
    if (costEstimate.warning) {
      console.warn(`[BitqueryClient] ${costEstimate.warning}`);
    }

    const tokenIdsJson = JSON.stringify(tokenIds);

    const query = `
      query ($startTime: DateTime, $endTime: DateTime, $limit: Int!, $offset: Int!) {
        EVM(network: matic) {
          DEXTradeByTokens(
            orderBy: {ascending: Block_Time}
            limit: {count: $limit, offset: $offset}
            where: {
              TransactionStatus: {Success: true}
              Trade: {
                Side: {
                  Currency: {
                    SmartContract: {
                      in: ${JSON.stringify(USDC_CONTRACTS)}
                    }
                  }
                }
                Dex: {ProtocolName: {is: "polymarket"}}
                Ids: {includes: {in: ${tokenIdsJson}}}
              }
              Block: {Time: {since: $startTime, till: $endTime}}
            }
          ) {
            Block {
              Time
            }
            Trade {
              PriceInUSD
              Ids
              Side {
                Type
              }
            }
          }
        }
      }
    `;

    const variables = { startTime, endTime, limit, offset };

    try {
      const data = await this.executeQuery(query, variables);
      const trades = data?.EVM?.DEXTradeByTokens || [];
      console.log(`[BitqueryClient] Fetched ${trades.length} trades for ${tokenIds.length} token IDs`);
      return trades;
    } catch (error) {
      console.error('[BitqueryClient] Failed to fetch Polymarket trades by tokens:', error.message);
      throw error;
    }
  }

  /**
   * Query Polymarket trades using DEXTradeByTokens API (LEGACY - Unfiltered)
   * WARNING: This fetches ALL Polymarket trades and is expensive. Use queryPolymarketTradesByTokens() instead.
   *
   * @param {string} startTime - ISO 8601 timestamp
   * @param {string} endTime - ISO 8601 timestamp
   * @param {number} limit - Maximum trades to fetch
   * @param {number} offset - Pagination offset
   * @returns {Promise<Array>} Array of trade objects
   */
  async queryPolymarketTrades(startTime, endTime, limit = 1000, offset = 0) {
    // Validate inputs
    if (!startTime || !endTime) {
      throw new Error('[BitqueryClient] startTime and endTime are required');
    }

    // Validate ISO 8601 format
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('[BitqueryClient] Invalid date format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)');
    }

    if (startDate >= endDate) {
      throw new Error('[BitqueryClient] startTime must be before endTime');
    }

    // Warn about unfiltered query
    const dayRange = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    console.warn(`[BitqueryClient] UNFILTERED query for ${dayRange} days. This is expensive! Use queryPolymarketTradesByTokens() instead.`);

    // Estimate and log query cost
    const costEstimate = this.estimateQueryCost(startTime, endTime, 0, limit);
    console.warn(`[BitqueryClient] Estimated cost: ${costEstimate.estimatedPoints} points`);

    // Validate limit and offset
    if (limit <= 0 || limit > 10000) {
      throw new Error('[BitqueryClient] limit must be between 1 and 10000');
    }

    if (offset < 0) {
      throw new Error('[BitqueryClient] offset must be non-negative');
    }
    // Reduced fields query - only fetch what we actually use
    const query = `
      query ($startTime: DateTime, $endTime: DateTime, $limit: Int!, $offset: Int!) {
        EVM(network: matic) {
          DEXTradeByTokens(
            orderBy: {ascending: Block_Time}
            limit: {count: $limit, offset: $offset}
            where: {
              TransactionStatus: {Success: true}
              Trade: {
                Side: {
                  Currency: {
                    SmartContract: {
                      in: ${JSON.stringify(USDC_CONTRACTS)}
                    }
                  }
                }
                Dex: {ProtocolName: {is: "polymarket"}}
              }
              Block: {Time: {since: $startTime, till: $endTime}}
            }
          ) {
            Block {
              Time
            }
            Trade {
              PriceInUSD
              Ids
              Side {
                Type
              }
            }
          }
        }
      }
    `;

    const variables = { startTime, endTime, limit, offset };

    try {
      const data = await this.executeQuery(query, variables);
      return data?.EVM?.DEXTradeByTokens || [];
    } catch (error) {
      console.error('[BitqueryClient] Failed to fetch Polymarket trades:', error.message);
      throw error;
    }
  }

  /**
   * Query all Polymarket trades with automatic pagination (OPTIMIZED - Token filtered)
   *
   * @param {string} startTime - ISO 8601 timestamp
   * @param {string} endTime - ISO 8601 timestamp
   * @param {Array<string>} tokenIds - Array of token IDs to filter by
   * @param {number} maxTrades - Maximum total trades to fetch
   * @returns {Promise<Array>} Array of all trade objects
   */
  async queryAllPolymarketTradesByTokens(startTime, endTime, tokenIds = [], maxTrades = 5000) {
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      throw new Error('[BitqueryClient] tokenIds must be a non-empty array. Use queryAllPolymarketTrades() for unfiltered queries.');
    }

    const allTrades = [];
    const pageSize = 1000;
    let offset = 0;

    console.log(`[BitqueryClient] Fetching trades for ${tokenIds.length} token IDs (max: ${maxTrades})...`);

    while (offset < maxTrades) {
      const trades = await this.queryPolymarketTradesByTokens(startTime, endTime, tokenIds, pageSize, offset);

      if (trades.length === 0) break;

      allTrades.push(...trades);
      console.log(`[BitqueryClient] Fetched ${trades.length} trades (total: ${allTrades.length})`);

      if (trades.length < pageSize) break;
      offset += pageSize;

      await this.sleep(500);
    }

    console.log(`[BitqueryClient] Finished fetching ${allTrades.length} total trades`);
    return allTrades;
  }

  /**
   * Query all Polymarket trades with automatic pagination (LEGACY - Unfiltered)
   * WARNING: This is expensive and should be avoided. Use queryAllPolymarketTradesByTokens() instead.
   *
   * @param {string} startTime - ISO 8601 timestamp
   * @param {string} endTime - ISO 8601 timestamp
   * @param {number} maxTrades - Maximum total trades to fetch (reduced from 10000 to 5000)
   * @returns {Promise<Array>} Array of all trade objects
   */
  async queryAllPolymarketTrades(startTime, endTime, maxTrades = 5000) {
    console.warn(`[BitqueryClient] WARNING: Using unfiltered queryAllPolymarketTrades(). This is expensive!`);
    console.warn(`[BitqueryClient] Consider using queryAllPolymarketTradesByTokens() with specific token IDs instead.`);

    const allTrades = [];
    const pageSize = 1000;
    let offset = 0;

    while (offset < maxTrades) {
      console.log(`[BitqueryClient] Fetching unfiltered trades offset=${offset}...`);
      const trades = await this.queryPolymarketTrades(startTime, endTime, pageSize, offset);

      if (trades.length === 0) break;

      allTrades.push(...trades);
      console.log(`[BitqueryClient] Fetched ${trades.length} trades (total: ${allTrades.length})`);

      if (trades.length < pageSize) break;
      offset += pageSize;

      await this.sleep(500);
    }

    return allTrades;
  }

  /**
   * Query ConditionPreparation events for market discovery
   */
  async queryConditionPreparationEvents(startTime, endTime, limit = 100) {
    // Validate inputs
    if (!startTime || !endTime) {
      throw new Error('[BitqueryClient] startTime and endTime are required');
    }

    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('[BitqueryClient] Invalid date format. Use ISO 8601 format');
    }

    if (limit <= 0 || limit > 10000) {
      throw new Error('[BitqueryClient] limit must be between 1 and 10000');
    }
    const query = `
      query ($startTime: DateTime, $endTime: DateTime, $limit: Int!) {
        EVM(network: matic) {
          Events(
            where: {
              Block: {Time: {since: $startTime, till: $endTime}}
              Log: {Signature: {Name: {is: "ConditionPreparation"}}}
              LogHeader: {Address: {is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045"}}
            }
            orderBy: {ascending: Block_Time}
            limit: {count: $limit}
          ) {
            Block {
              Time
              Number
            }
            Transaction {
              Hash
            }
            Arguments {
              Name
              Value {
                ... on EVM_ABI_Integer_Value_Arg {
                  integer
                }
                ... on EVM_ABI_Address_Value_Arg {
                  address
                }
                ... on EVM_ABI_BigInt_Value_Arg {
                  bigInteger
                }
                ... on EVM_ABI_Bytes_Value_Arg {
                  hex
                }
              }
            }
          }
        }
      }
    `;

    const variables = { startTime, endTime, limit };

    try {
      const data = await this.executeQuery(query, variables);
      return data?.EVM?.Events || [];
    } catch (error) {
      console.error('[BitqueryClient] Failed to fetch ConditionPreparation events:', error.message);
      throw error;
    }
  }

  async healthCheck() {
    try {
      const query = `
        query {
          EVM(network: matic) {
            DEXTradeByTokens(
              limit: { count: 1 }
              orderBy: { descending: Block_Time }
              where: {
                Trade: { Dex: { ProtocolName: { is: "polymarket" } } }
              }
            ) {
              Block {
                Time
                Number
              }
            }
          }
        }
      `;
      const data = await this.executeQuery(query);
      const trades = data?.EVM?.DEXTradeByTokens || [];
      if (trades.length > 0) {
        return {
          status: 'healthy',
          message: `Bitquery V2 API connected. Latest Polymarket trade at: ${trades[0].Block.Time}`,
          lastTradeBlock: trades[0].Block.Number,
          timestamp: new Date().toISOString(),
        };
      }
      return {
        status: 'degraded',
        message: 'Bitquery V2 API connected but no Polymarket trades found',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      // Special handling for quota errors
      if (error.code === 'QUOTA_EXCEEDED' || error.status === 402) {
        return {
          status: 'quota_exceeded',
          message: 'Bitquery API quota exceeded. Service will use fallback data sources.',
          error: error.message,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        status: 'unhealthy',
        message: `Bitquery V2 API connection failed: ${error.message}`,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

const bitqueryClient = new BitqueryClient();
export default bitqueryClient;
