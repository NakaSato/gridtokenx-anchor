// Export all program types
export { EnergyToken } from './energy_token';
export { Governance } from './governance';
export { Oracle } from './oracle';
export { Registry } from './registry';
export { Trading } from './trading';

// Re-export the original IDL files for programmatic use
import energyTokenIdl from '../../target/idl/energy_token.json';
import governanceIdl from '../../target/idl/governance.json';
import oracleIdl from '../../target/idl/oracle.json';
import registryIdl from '../../target/idl/registry.json';
import tradingIdl from '../../target/idl/trading.json';

export const IDLS = {
  energyToken: energyTokenIdl,
  governance: governanceIdl,
  oracle: oracleIdl,
  registry: registryIdl,
  trading: tradingIdl,
} as const;

// Program addresses
export const PROGRAM_ADDRESSES = {
  energyToken: '94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur',
  governance: '4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe',
  oracle: 'DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE',
  registry: '2XPQmFYMdXjP7ffoBB3mXeCdboSFg5Yeb6QmTSGbW8a7',
  trading: 'GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk',
} as const;

export type ProgramName = keyof typeof PROGRAM_ADDRESSES;
