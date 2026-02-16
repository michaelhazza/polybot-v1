/**
 * Bitquery GraphQL Query Templates
 *
 * Centralized repository for all Bitquery GraphQL queries used in the application.
 * These queries access Polymarket data on Polygon (Matic) blockchain.
 *
 * Contract Addresses:
 * - CTF Exchange (OrderFilled events): 0xC5d563A36AE78145C45a50134d48A1215220f80a
 * - Conditional Tokens (ConditionPreparation): 0x4d97dcd97ec945f40cf65f87097ace5ea0476045
 * - UMA Oracle (QuestionInitialized): Various addresses
 */

/**
 * Query OrderFilled events for price discovery
 *
 * Returns all trade executions for a specific condition (market).
 * Used to calculate market prices from actual trades.
 */
export const ORDER_FILLED_QUERY = `
  query OrderFilledEvents(
    $conditionId: String!
    $startTime: DateTime
    $endTime: DateTime
    $limit: Int!
  ) {
    EVM(network: matic) {
      Events(
        where: {
          Block: { Time: { since: $startTime, till: $endTime } }
          Log: { Signature: { Name: { eq: "OrderFilled" } } }
          LogHeader: {
            Address: { in: ["0xC5d563A36AE78145C45a50134d48A1215220f80a"] }
          }
          Arguments: {
            includes: [
              { Name: { eq: "conditionId" }, Value: { Address: { is: $conditionId } } }
            ]
          }
        }
        orderBy: { ascending: Block_Time }
        limit: { count: $limit }
      ) {
        Block {
          Time
          Timestamp
          Number
        }
        Transaction {
          Hash
          From
          To
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

/**
 * Query ConditionPreparation events for market discovery
 *
 * Returns all new market conditions created on Polymarket.
 * Used to discover new markets and their condition IDs.
 */
export const CONDITION_PREPARATION_QUERY = `
  query ConditionPreparationEvents(
    $startTime: DateTime
    $endTime: DateTime
    $limit: Int!
  ) {
    EVM(network: matic) {
      Events(
        where: {
          Block: { Time: { since: $startTime, till: $endTime } }
          Log: { Signature: { Name: { eq: "ConditionPreparation" } } }
          LogHeader: {
            Address: { is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" }
          }
        }
        orderBy: { ascending: Block_Time }
        limit: { count: $limit }
      ) {
        Block {
          Time
          Timestamp
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

/**
 * Query QuestionInitialized events for market metadata
 *
 * Returns market questions and metadata from UMA oracle.
 * Used to filter for Bitcoin-related markets.
 */
export const QUESTION_INITIALIZED_QUERY = `
  query QuestionInitializedEvents(
    $startTime: DateTime
    $endTime: DateTime
    $limit: Int!
  ) {
    EVM(network: matic) {
      Events(
        where: {
          Block: { Time: { since: $startTime, till: $endTime } }
          Log: { Signature: { Name: { eq: "QuestionInitialized" } } }
          LogHeader: {
            Address: { is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" }
          }
        }
        orderBy: { ascending: Block_Time }
        limit: { count: $limit }
      ) {
        Block {
          Time
          Timestamp
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

/**
 * Query PositionSplit events for token creation
 *
 * Returns all position splits (token creations) for a condition.
 * Used to identify UP/DOWN token IDs.
 */
export const POSITION_SPLIT_QUERY = `
  query PositionSplitEvents(
    $conditionId: String!
    $startTime: DateTime
    $endTime: DateTime
    $limit: Int!
  ) {
    EVM(network: matic) {
      Events(
        where: {
          Block: { Time: { since: $startTime, till: $endTime } }
          Log: { Signature: { Name: { eq: "PositionSplit" } } }
          LogHeader: {
            Address: { is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" }
          }
          Arguments: {
            includes: [
              { Name: { eq: "conditionId" }, Value: { Address: { is: $conditionId } } }
            ]
          }
        }
        orderBy: { ascending: Block_Time }
        limit: { count: $limit }
      ) {
        Block {
          Time
          Timestamp
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

/**
 * Query user points balance
 */
export const USER_POINTS_QUERY = `
  query UserPoints {
    user {
      points
      email
    }
  }
`;

/**
 * Streaming subscription for real-time OrderFilled events
 *
 * Use this with Bitquery's streaming endpoint for real-time data.
 * NOTE: Subscriptions consume more points than regular queries.
 */
export const ORDER_FILLED_SUBSCRIPTION = `
  subscription OrderFilledStream(
    $conditionId: String!
  ) {
    EVM(network: matic, trigger_on: head) {
      Events(
        where: {
          Log: { Signature: { Name: { eq: "OrderFilled" } } }
          LogHeader: {
            Address: { in: ["0xC5d563A36AE78145C45a50134d48A1215220f80a"] }
          }
          Arguments: {
            includes: [
              { Name: { eq: "conditionId" }, Value: { Address: { is: $conditionId } } }
            ]
          }
        }
      ) {
        Block {
          Time
          Timestamp
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

/**
 * Query configuration defaults
 */
export const QUERY_DEFAULTS = {
  // Maximum events to fetch per query
  DEFAULT_LIMIT: 1000,

  // Maximum pagination size
  MAX_LIMIT: 10000,

  // Polymarket contract addresses
  CONTRACTS: {
    CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
    CONDITIONAL_TOKENS: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  },

  // Network
  NETWORK: 'matic',
};

/**
 * Helper to build time range variables
 *
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {object} Time range variables for Bitquery
 */
export function buildTimeRange(startDate, endDate) {
  return {
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
  };
}

/**
 * Helper to parse OrderFilled event arguments
 *
 * @param {Array} args - Event arguments from Bitquery
 * @returns {object} Parsed event data
 */
export function parseOrderFilledArgs(args) {
  const parsed = {};

  for (const arg of args) {
    const name = arg.Name;
    const value = arg.Value;

    if (value.integer !== undefined) {
      parsed[name] = value.integer;
    } else if (value.bigInteger !== undefined) {
      parsed[name] = value.bigInteger;
    } else if (value.address !== undefined) {
      parsed[name] = value.address;
    } else if (value.hex !== undefined) {
      parsed[name] = value.hex;
    }
  }

  return parsed;
}

export default {
  ORDER_FILLED_QUERY,
  CONDITION_PREPARATION_QUERY,
  QUESTION_INITIALIZED_QUERY,
  POSITION_SPLIT_QUERY,
  USER_POINTS_QUERY,
  ORDER_FILLED_SUBSCRIPTION,
  QUERY_DEFAULTS,
  buildTimeRange,
  parseOrderFilledArgs,
};
