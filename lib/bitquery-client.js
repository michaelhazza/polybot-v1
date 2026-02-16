/**
 * Bitquery GraphQL Client
 *
 * Handles authentication, rate limiting, and error handling for Bitquery API calls.
 * Provides methods for querying Polymarket data from the blockchain.
 *
 * Documentation: https://docs.bitquery.io/
 */

import { GraphQLClient } from 'graphql-request';
import dotenv from 'dotenv';

dotenv.config();

class BitqueryClient {
  constructor() {
    this.streamingEndpoint = process.env.BITQUERY_STREAMING_ENDPOINT || 'https://streaming.bitquery.io/graphql';
    this.standardEndpoint = process.env.BITQUERY_STANDARD_ENDPOINT || 'https://graphql.bitquery.io/';
    this.oauthToken = process.env.BITQUERY_OAUTH_TOKEN;

    if (!this.oauthToken) {
      console.warn('[BitqueryClient] Warning: BITQUERY_OAUTH_TOKEN not set. Bitquery queries will fail.');
    }

    // Initialize GraphQL clients
    this.streamingClient = new GraphQLClient(this.streamingEndpoint, {
      headers: {
        'Authorization': this.oauthToken,
        'Content-Type': 'application/json',
      },
    });

    this.standardClient = new GraphQLClient(this.standardEndpoint, {
      headers: {
        'Authorization': this.oauthToken,
        'Content-Type': 'application/json',
      },
    });

    // Rate limiting configuration
    this.requestCount = 0;
    this.requestLimit = 50; // Conservative limit per minute
    this.requestWindow = 60000; // 1 minute in milliseconds
    this.lastResetTime = Date.now();

    // Retry configuration
    this.maxRetries = 4;
    this.baseDelay = 2000; // 2 seconds base delay
  }

  /**
   * Check rate limit and wait if necessary
   */
  async checkRateLimit() {
    const now = Date.now();

    // Reset counter if window has passed
    if (now - this.lastResetTime >= this.requestWindow) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }

    // Wait if we've hit the limit
    if (this.requestCount >= this.requestLimit) {
      const waitTime = this.requestWindow - (now - this.lastResetTime);
      console.log(`[BitqueryClient] Rate limit reached. Waiting ${waitTime}ms...`);
      await this.sleep(waitTime);
      this.requestCount = 0;
      this.lastResetTime = Date.now();
    }

    this.requestCount++;
  }

  /**
   * Sleep utility for delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a GraphQL query with retry logic and rate limiting
   *
   * @param {string} query - GraphQL query string
   * @param {object} variables - Query variables
   * @param {boolean} useStreaming - Whether to use streaming endpoint
   * @param {number} retryCount - Current retry attempt
   * @returns {Promise<object>} Query response data
   */
  async executeQuery(query, variables = {}, useStreaming = false, retryCount = 0) {
    await this.checkRateLimit();

    const client = useStreaming ? this.streamingClient : this.standardClient;
    const endpoint = useStreaming ? 'streaming' : 'standard';

    try {
      const data = await client.request(query, variables);
      return data;
    } catch (error) {
      // Handle rate limit errors
      if (error.response?.status === 429 && retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount);
        console.log(`[BitqueryClient] Rate limit error. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${this.maxRetries})`);
        await this.sleep(delay);
        return this.executeQuery(query, variables, useStreaming, retryCount + 1);
      }

      // Handle network errors
      if ((error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') && retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount);
        console.log(`[BitqueryClient] Network error (${error.code}). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${this.maxRetries})`);
        await this.sleep(delay);
        return this.executeQuery(query, variables, useStreaming, retryCount + 1);
      }

      // Handle GraphQL errors
      if (error.response?.errors) {
        console.error('[BitqueryClient] GraphQL errors:', JSON.stringify(error.response.errors, null, 2));
        throw new Error(`Bitquery GraphQL error: ${error.response.errors[0]?.message || 'Unknown error'}`);
      }

      // Rethrow other errors
      console.error(`[BitqueryClient] ${endpoint} query failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get account points balance
   *
   * @returns {Promise<number>} Current points balance
   */
  async getPointsBalance() {
    const query = `
      query {
        user {
          points
        }
      }
    `;

    try {
      const data = await this.executeQuery(query, {}, false);
      return data?.user?.points || 0;
    } catch (error) {
      console.error('[BitqueryClient] Failed to fetch points balance:', error.message);
      return null;
    }
  }

  /**
   * Query OrderFilled events for a specific condition
   *
   * @param {string} conditionId - Polymarket condition ID (market ID)
   * @param {string} startTime - ISO 8601 timestamp
   * @param {string} endTime - ISO 8601 timestamp
   * @param {number} limit - Maximum number of events to fetch
   * @returns {Promise<Array>} Array of OrderFilled events
   */
  async queryOrderFilledEvents(conditionId, startTime, endTime, limit = 1000) {
    const query = `
      query ($conditionId: String!, $startTime: DateTime, $endTime: DateTime, $limit: Int!) {
        EVM(network: matic) {
          Events(
            where: {
              Block: {Time: {since: $startTime, till: $endTime}},
              Log: {Signature: {Name: {eq: "OrderFilled"}}},
              LogHeader: {Address: {in: ["0xC5d563A36AE78145C45a50134d48A1215220f80a"]}},
              Arguments: {includes: [{Name: {eq: "conditionId"}, Value: {Address: {is: $conditionId}}}}
            }
            orderBy: {ascending: Block_Time}
            limit: {count: $limit}
          ) {
            Block {
              Time
              Timestamp
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

    const variables = {
      conditionId,
      startTime,
      endTime,
      limit,
    };

    try {
      const data = await this.executeQuery(query, variables, false);
      return data?.EVM?.Events || [];
    } catch (error) {
      console.error('[BitqueryClient] Failed to fetch OrderFilled events:', error.message);
      throw error;
    }
  }

  /**
   * Query ConditionPreparation events to discover markets
   *
   * @param {string} startTime - ISO 8601 timestamp
   * @param {string} endTime - ISO 8601 timestamp
   * @param {number} limit - Maximum number of events to fetch
   * @returns {Promise<Array>} Array of ConditionPreparation events
   */
  async queryConditionPreparationEvents(startTime, endTime, limit = 100) {
    const query = `
      query ($startTime: DateTime, $endTime: DateTime, $limit: Int!) {
        EVM(network: matic) {
          Events(
            where: {
              Block: {Time: {since: $startTime, till: $endTime}},
              Log: {Signature: {Name: {eq: "ConditionPreparation"}}},
              LogHeader: {Address: {is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045"}}
            }
            orderBy: {ascending: Block_Time}
            limit: {count: $limit}
          ) {
            Block {
              Time
              Timestamp
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

    const variables = {
      startTime,
      endTime,
      limit,
    };

    try {
      const data = await this.executeQuery(query, variables, false);
      return data?.EVM?.Events || [];
    } catch (error) {
      console.error('[BitqueryClient] Failed to fetch ConditionPreparation events:', error.message);
      throw error;
    }
  }

  /**
   * Query QuestionInitialized events for market metadata
   *
   * @param {string} startTime - ISO 8601 timestamp
   * @param {string} endTime - ISO 8601 timestamp
   * @param {number} limit - Maximum number of events to fetch
   * @returns {Promise<Array>} Array of QuestionInitialized events
   */
  async queryQuestionInitializedEvents(startTime, endTime, limit = 100) {
    const query = `
      query ($startTime: DateTime, $endTime: DateTime, $limit: Int!) {
        EVM(network: matic) {
          Events(
            where: {
              Block: {Time: {since: $startTime, till: $endTime}},
              Log: {Signature: {Name: {eq: "QuestionInitialized"}}},
              LogHeader: {Address: {is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045"}}
            }
            orderBy: {ascending: Block_Time}
            limit: {count: $limit}
          ) {
            Block {
              Time
              Timestamp
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
                ... on EVM_ABI_String_Value_Arg {
                  string
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

    const variables = {
      startTime,
      endTime,
      limit,
    };

    try {
      const data = await this.executeQuery(query, variables, false);
      return data?.EVM?.Events || [];
    } catch (error) {
      console.error('[BitqueryClient] Failed to fetch QuestionInitialized events:', error.message);
      throw error;
    }
  }

  /**
   * Health check - verify API credentials and connectivity
   *
   * @returns {Promise<object>} Health check result
   */
  async healthCheck() {
    try {
      const points = await this.getPointsBalance();

      if (points !== null) {
        return {
          status: 'healthy',
          points,
          message: `Bitquery API connected. Points balance: ${points}`,
        };
      } else {
        return {
          status: 'degraded',
          points: null,
          message: 'Bitquery API connected but could not fetch points balance',
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        points: null,
        message: `Bitquery API connection failed: ${error.message}`,
      };
    }
  }
}

// Export singleton instance
const bitqueryClient = new BitqueryClient();
export default bitqueryClient;
