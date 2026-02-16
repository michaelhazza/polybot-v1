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

    try {
      const data = await this.client.request(query, variables);
      return data;
    } catch (error) {
      if (error.response?.status === 429 && retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount);
        console.log(`[BitqueryClient] Rate limit error. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${this.maxRetries})`);
        await this.sleep(delay);
        return this.executeQuery(query, variables, retryCount + 1);
      }

      if ((error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') && retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount);
        console.log(`[BitqueryClient] Network error (${error.code}). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${this.maxRetries})`);
        await this.sleep(delay);
        return this.executeQuery(query, variables, retryCount + 1);
      }

      if (error.response?.errors) {
        console.error('[BitqueryClient] GraphQL errors:', JSON.stringify(error.response.errors, null, 2));
        throw new Error(`Bitquery GraphQL error: ${error.response.errors[0]?.message || 'Unknown error'}`);
      }

      console.error(`[BitqueryClient] Query failed:`, error.message);
      throw error;
    }
  }

  /**
   * Query Polymarket trades using DEXTradeByTokens API
   * This is the recommended way to get Polymarket data from Bitquery V2.
   *
   * @param {string} startTime - ISO 8601 timestamp
   * @param {string} endTime - ISO 8601 timestamp
   * @param {number} limit - Maximum trades to fetch
   * @param {number} offset - Pagination offset
   * @returns {Promise<Array>} Array of trade objects
   */
  async queryPolymarketTrades(startTime, endTime, limit = 1000, offset = 0) {
    const query = `
      query ($startTime: DateTime, $endTime: DateTime, $limit: Int!, $offset: Int!) {
        EVM(dataset: combined, network: matic) {
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
            Transaction {
              Hash
            }
            Trade {
              Dex {
                OwnerAddress
                ProtocolName
              }
              Amount
              AmountInUSD
              PriceInUSD
              Side {
                Type
                Amount
                AmountInUSD
                Currency {
                  Symbol
                  SmartContract
                  Name
                }
                Ids
                OrderId
              }
              Currency {
                Symbol
                SmartContract
                Name
              }
              Ids
              OrderId
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
   * Query all Polymarket trades with automatic pagination
   *
   * @param {string} startTime - ISO 8601 timestamp
   * @param {string} endTime - ISO 8601 timestamp
   * @param {number} maxTrades - Maximum total trades to fetch
   * @returns {Promise<Array>} Array of all trade objects
   */
  async queryAllPolymarketTrades(startTime, endTime, maxTrades = 10000) {
    const allTrades = [];
    const pageSize = 1000;
    let offset = 0;

    while (offset < maxTrades) {
      console.log(`[BitqueryClient] Fetching trades offset=${offset}...`);
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
    const query = `
      query ($startTime: DateTime, $endTime: DateTime, $limit: Int!) {
        EVM(dataset: combined, network: matic) {
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
          EVM(dataset: combined, network: matic) {
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
        };
      }
      return {
        status: 'degraded',
        message: 'Bitquery V2 API connected but no Polymarket trades found',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Bitquery V2 API connection failed: ${error.message}`,
      };
    }
  }
}

const bitqueryClient = new BitqueryClient();
export default bitqueryClient;
