/**
 * Bitquery V2 GraphQL Query Templates
 *
 * Centralized repository for all Bitquery GraphQL queries used in the application.
 * These queries access Polymarket data on Polygon (Matic) blockchain via V2 Streaming API.
 *
 * V2 Schema Notes:
 * - dataset parameter required (combined, realtime, archive)
 * - DateTime type for time variables
 * - Name filter uses { is: } instead of { eq: }
 *
 * Contract Addresses:
 * - CTF Exchange (OrderFilled events): 0xC5d563A36AE78145C45a50134d48A1215220f80a
 * - Conditional Tokens (ConditionPreparation): 0x4d97dcd97ec945f40cf65f87097ace5ea0476045
 */

export const ORDER_FILLED_QUERY = `
  query OrderFilledEvents(
    $conditionId: String!
    $startTime: DateTime
    $endTime: DateTime
    $limit: Int!
  ) {
    EVM(dataset: combined, network: matic) {
      Events(
        where: {
          Block: { Time: { since: $startTime, till: $endTime } }
          Log: { Signature: { Name: { is: "OrderFilled" } } }
          LogHeader: {
            Address: { is: "0xC5d563A36AE78145C45a50134d48A1215220f80a" }
          }
          Arguments: {
            includes: [
              { Name: { is: "conditionId" }, Value: { Address: { is: $conditionId } } }
            ]
          }
        }
        orderBy: { ascending: Block_Time }
        limit: { count: $limit }
      ) {
        Block {
          Time
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

export const CONDITION_PREPARATION_QUERY = `
  query ConditionPreparationEvents(
    $startTime: DateTime
    $endTime: DateTime
    $limit: Int!
  ) {
    EVM(dataset: combined, network: matic) {
      Events(
        where: {
          Block: { Time: { since: $startTime, till: $endTime } }
          Log: { Signature: { Name: { is: "ConditionPreparation" } } }
          LogHeader: {
            Address: { is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" }
          }
        }
        orderBy: { ascending: Block_Time }
        limit: { count: $limit }
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

export const QUESTION_INITIALIZED_QUERY = `
  query QuestionInitializedEvents(
    $startTime: DateTime
    $endTime: DateTime
    $limit: Int!
  ) {
    EVM(dataset: combined, network: matic) {
      Events(
        where: {
          Block: { Time: { since: $startTime, till: $endTime } }
          Log: { Signature: { Name: { is: "QuestionInitialized" } } }
          LogHeader: {
            Address: { is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" }
          }
        }
        orderBy: { ascending: Block_Time }
        limit: { count: $limit }
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
            ... on EVM_ABI_String_Value_Arg {
              string
            }
          }
        }
      }
    }
  }
`;

export const POSITION_SPLIT_QUERY = `
  query PositionSplitEvents(
    $conditionId: String!
    $startTime: DateTime
    $endTime: DateTime
    $limit: Int!
  ) {
    EVM(dataset: combined, network: matic) {
      Events(
        where: {
          Block: { Time: { since: $startTime, till: $endTime } }
          Log: { Signature: { Name: { is: "PositionSplit" } } }
          LogHeader: {
            Address: { is: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" }
          }
          Arguments: {
            includes: [
              { Name: { is: "conditionId" }, Value: { Address: { is: $conditionId } } }
            ]
          }
        }
        orderBy: { ascending: Block_Time }
        limit: { count: $limit }
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

export const ORDER_FILLED_SUBSCRIPTION = `
  subscription OrderFilledStream(
    $conditionId: String!
  ) {
    EVM(network: matic, trigger_on: head) {
      Events(
        where: {
          Log: { Signature: { Name: { is: "OrderFilled" } } }
          LogHeader: {
            Address: { is: "0xC5d563A36AE78145C45a50134d48A1215220f80a" }
          }
          Arguments: {
            includes: [
              { Name: { is: "conditionId" }, Value: { Address: { is: $conditionId } } }
            ]
          }
        }
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

export const QUERY_DEFAULTS = {
  DEFAULT_LIMIT: 1000,
  MAX_LIMIT: 10000,
  CONTRACTS: {
    CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
    CONDITIONAL_TOKENS: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  },
  NETWORK: 'matic',
  DATASET: 'combined',
};

export function buildTimeRange(startDate, endDate) {
  return {
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
  };
}

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
  ORDER_FILLED_SUBSCRIPTION,
  QUERY_DEFAULTS,
  buildTimeRange,
  parseOrderFilledArgs,
};
