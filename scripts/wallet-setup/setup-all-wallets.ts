#!/usr/bin/env ts-node

/**
 * GridTokenX Comprehensive Wallet Setup Script
 *
 * This script creates all role-based wallets needed for comprehensive testing
 * of the GridTokenX platform. It mirrors the functionality of the bash version
 * but provides better error handling and integration with the TypeScript ecosystem.
 *
 * Usage:
 *   ts-node scripts/wallet-setup/setup-all-wallets.ts [options]
 *
 * Options:
 *   --reset                 Delete existing wallets and create new ones
 *   --airdrop-only          Only perform airdrops to existing wallets
 *   --skip-airdrop          Skip SOL airdrops to wallets
 *   --keypair-dir <path>    Directory to store keypairs (default: ./keypairs)
 *   --validator-url <url>   Validator RPC URL (default: localhost)
 *   --help                  Show this help
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// Color codes for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

// Default values
const DEFAULT_KEYPAIR_DIR = './keypairs';
const DEFAULT_VALIDATOR_URL = 'localhost';

// Parse command line arguments
const args = process.argv.slice(2);
let reset = false;
let airdropOnly = false;
let skipAirdrop = false;
let keypairDir = DEFAULT_KEYPAIR_DIR;
let validatorUrl = DEFAULT_VALIDATOR_URL;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--reset':
      reset = true;
      break;
    case '--airdrop-only':
      airdropOnly = true;
      break;
    case '--skip-airdrop':
      skipAirdrop = true;
      break;
    case '--keypair-dir':
      keypairDir = args[++i];
      break;
    case '--validator-url':
      validatorUrl = args[++i];
      break;
    case '--help':
      console.log('GridTokenX Wallet Setup Script');
      console.log('');
      console.log('Usage: ts-node scripts/wallet-setup/setup-all-wallets.ts [options]');
      console.log('');
      console.log('Options:');
      console.log('  --reset                 Delete existing wallets and create new ones');
      console.log('  --airdrop-only          Only perform airdrops to existing wallets');
      console.log('  --skip-airdrop          Skip SOL airdrops to wallets');
      console.log(`  --keypair-dir <path>    Directory to store keypairs (default: ${DEFAULT_KEYPAIR_DIR})`);
      console.log(`  --validator-url <url>   Validator RPC URL (default: ${DEFAULT_VALIDATOR_URL})`);
      console.log('  --help                  Show this help');
      process.exit(0);
    default:
      console.error(`${colors.red}[ERROR]${colors.reset} Unknown option: ${args[i]}`);
      process.exit(1);
  }
}

// Helper functions
function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logInfo(message: string) {
  log(`[INFO] ${message}`, colors.blue);
}

function logSuccess(message: string) {
  log(`[SUCCESS] ${message}`, colors.green);
}

function logWarning(message: string) {
  log(`[WARNING] ${message}`, colors.yellow);
}

function logError(message: string) {
  log(`[ERROR] ${message}`, colors.red);
}

function executeCommand(command: string, errorMessage?: string): string {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch (error) {
    logError(errorMessage || `Failed to execute command: ${command}`);
    throw error;
  }
}

function getSolanaConfigPath(): string {
  try {
    const solanaConfig = executeCommand('solana config get');
    const match = solanaConfig.match(/Keypair Path: (.+)/);
    return match ? match[1] : join(homedir(), '.config', 'solana', 'id.json');
  } catch (error) {
    return join(homedir(), '.config', 'solana', 'id.json');
  }
}

// Define all wallets with their airdrop amounts
const walletAmounts: Record<string, number> = {
  'dev-wallet': 1000,
  'wallet-1': 500,
  'wallet-2': 200,
  'producer-1': 300,
  'producer-2': 300,
  'producer-3': 300,
  'consumer-1': 250,
  'consumer-2': 250,
  'oracle-authority': 500,
  'governance-authority': 500,
  'treasury-wallet': 1000,
  'test-wallet-3': 150,
  'test-wallet-4': 150,
  'test-wallet-5': 150,
};

// Function to create a single wallet
function createWallet(walletName: string): string {
  const walletPath = join(keypairDir, walletName);

  if (existsSync(walletPath)) {
    if (reset) {
      logInfo(`Removing existing wallet: ${walletName}`);
      rmSync(walletPath);
    } else {
      logWarning(`Wallet ${walletName} already exists. Use --reset to recreate.`);
      return executeCommand(`solana-keygen pubkey ${walletPath}`);
    }
  }

  logInfo(`Creating wallet: ${walletName}`);
  executeCommand(`solana-keygen new --no-bip39-passphrase --silent --force --outfile ${walletPath}`);

  const pubkey = executeCommand(`solana-keygen pubkey ${walletPath}`);
  logSuccess(`Created wallet ${walletName} with public key: ${pubkey}`);
  return pubkey;
}

// Function to airdrop SOL to a wallet
function airdropSol(walletName: string, amount: number): void {
  const walletPath = join(keypairDir, walletName);

  if (!existsSync(walletPath)) {
    logError(`Wallet ${walletName} not found at ${walletPath}`);
    throw new Error(`Wallet ${walletName} not found`);
  }

  const pubkey = executeCommand(`solana-keygen pubkey ${walletPath}`);
  logInfo(`Airdropping ${amount} SOL to ${walletName} (${pubkey})`);

  try {
    executeCommand(`solana airdrop ${amount} --keypair ${walletPath}`);
    const balance = executeCommand(`solana balance ${pubkey} | awk '{print $1}'`);
    logSuccess(`Airdropped ${amount} SOL to ${walletName}. New balance: ${balance} SOL`);
  } catch (error) {
    logError(`Failed to airdrop SOL to ${walletName}`);
    throw error;
  }
}

// Main function
async function main(): Promise<void> {
  try {
    // Configure Solana CLI to use the specified validator
    logInfo(`Configuring Solana CLI to use validator: ${validatorUrl}`);
    executeCommand(`solana config set --url ${validatorUrl}`);

    // Check if validator is running
    try {
      executeCommand('solana cluster-version');
    } catch (error) {
      logError(`Cannot connect to validator at ${validatorUrl}. Please ensure the validator is running.`);
      process.exit(1);
    }

    // Create keypair directory if it doesn't exist
    if (!existsSync(keypairDir)) {
      mkdirSync(keypairDir, { recursive: true });
      logInfo(`Created keypair directory: ${keypairDir}`);
    }

    if (airdropOnly) {
      logInfo('Performing airdrops only to existing wallets...');

      for (const walletName in walletAmounts) {
        if (existsSync(join(keypairDir, walletName))) {
          airdropSol(walletName, walletAmounts[walletName]);
        } else {
          logWarning(`Skipping airdrop for ${walletName} - wallet does not exist`);
        }
      }

      logSuccess('Airdrops completed for all existing wallets');
      process.exit(0);
    }

    // Create all wallets
    logInfo('Creating all role-based wallets...');

    const walletPubkeys: Record<string, string> = {};

    for (const walletName in walletAmounts) {
      walletPubkeys[walletName] = createWallet(walletName);
    }

    // Perform airdrops if not skipped
    if (!skipAirdrop) {
      logInfo('Performing SOL airdrops to all wallets...');

      for (const walletName in walletAmounts) {
        airdropSol(walletName, walletAmounts[walletName]);
      }
    } else {
      logWarning('Skipping SOL airdrops as requested');
    }

    // Display wallet information summary
    logInfo('Wallet Setup Summary');
    logInfo('=======================');

    for (const walletName in walletPubkeys) {
      const walletPath = join(keypairDir, walletName);
      if (existsSync(walletPath)) {
        const pubkey = executeCommand(`solana-keygen pubkey ${walletPath}`);
        const balance = executeCommand(`solana balance ${pubkey} | awk '{print $1}'`);
        log(`${walletName}: ${pubkey} (Balance: ${balance} SOL)`, colors.blue);
      }
    }

    logSuccess('All wallets have been set up successfully!');
    logInfo(`Keypair files are stored in: ${keypairDir}`);
    logInfo('You can now run tests with these wallets using the commands in the README.');
  } catch (error) {
    logError(`Wallet setup failed: ${error}`);
    process.exit(1);
  }
}

// Run the main function
main();
