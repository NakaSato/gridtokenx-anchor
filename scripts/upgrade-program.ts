/**
 * GridTokenX Program Upgrade Script
 * 
 * This script manages program upgrades for GridTokenX Anchor programs.
 * It supports:
 * - Upgrading a single program
 * - Viewing program upgrade authority
 * - Transferring upgrade authority
 * - Rolling back to previous version (via buffer)
 * 
 * Usage:
 *   npx tsx scripts/upgrade-program.ts upgrade <program-name>
 *   npx tsx scripts/upgrade-program.ts info <program-name>
 *   npx tsx scripts/upgrade-program.ts transfer-authority <program-name> <new-authority>
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

// Program IDs from Anchor.toml
const PROGRAM_IDS: Record<string, string> = {
  'energy_token': 'G8dC1NwdDiMhfrnPwkf9dMaR2AgrnFXcjWcepyGSHTfA',
  'governance': '3d1BQT3EiwbspkD8HYKAnyLvKjs5kZwSbRBWwS5NHof9',
  'oracle': '4Agkm8isGD6xDegsfoFzWN5Xp5WLVoqJyPDQLRsjh85u',
  'registry': 'EgpmmYPFDAX8QfawUEFissBXi3yG6AapoxNfB6KdGtBQ',
  'trading': 'CrfC5coUm2ty6DphLBFhAmr8m1AMutf8KTW2JYS38Z5J',
  'blockbench': '9qVk6eD69nzSTjjcHpxDjjXePMdGUVeazeQZYuSmhs1d',
  'tpc_benchmark': 'CKLCEJhsxMu1NNEu9oVuyDqpkXcR9dMr769XSuh2WAjC',
};

interface UpgradeConfig {
  programName: string;
  cluster: 'localnet' | 'devnet' | 'mainnet-beta';
  dryRun: boolean;
  skipBuild: boolean;
  bufferAuthority?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command) {
    printUsage();
    process.exit(1);
  }
  
  switch (command) {
    case 'upgrade':
      await upgradeProgram(args[1], args.includes('--dry-run'), args.includes('--skip-build'));
      break;
    case 'info':
      await showProgramInfo(args[1]);
      break;
    case 'transfer-authority':
      await transferAuthority(args[1], args[2]);
      break;
    case 'list':
      listPrograms();
      break;
    case 'verify':
      await verifyUpgrade(args[1]);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  console.log(`
GridTokenX Program Upgrade Script

Usage:
  npx tsx scripts/upgrade-program.ts <command> [options]

Commands:
  upgrade <program-name>              Upgrade a program to the latest build
  info <program-name>                 Show program info (authority, data length, etc.)
  transfer-authority <program> <key>  Transfer upgrade authority to a new keypair
  list                                List all program names and IDs
  verify <program-name>               Verify the deployed program matches local build

Options:
  --dry-run          Simulate upgrade without executing
  --skip-build       Skip building the program (use existing .so file)

Examples:
  npx tsx scripts/upgrade-program.ts upgrade trading
  npx tsx scripts/upgrade-program.ts info governance
  npx tsx scripts/upgrade-program.ts transfer-authority oracle keypairs/new-authority.json
  `);
}

function listPrograms() {
  console.log('\n📋 GridTokenX Programs:\n');
  for (const [name, id] of Object.entries(PROGRAM_IDS)) {
    console.log(`  ${name.padEnd(20)} → ${id}`);
  }
  console.log('');
}

async function getConnection(): Promise<Connection> {
  // Read cluster from Anchor.toml
  const anchorToml = fs.readFileSync('Anchor.toml', 'utf-8');
  const clusterMatch = anchorToml.match(/cluster\s*=\s*"([^"]+)"/);
  const cluster = clusterMatch?.[1] || 'localnet';
  
  const endpoints: Record<string, string> = {
    'localnet': 'http://127.0.0.1:8899',
    'devnet': 'https://api.devnet.solana.com',
    'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  };
  
  return new Connection(endpoints[cluster] || endpoints['localnet'], 'confirmed');
}

async function loadWallet(): Promise<Keypair> {
  const walletPath = 'keypairs/dev-wallet.json';
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

async function upgradeProgram(programName: string, dryRun: boolean = false, skipBuild: boolean = false) {
  if (!programName || !PROGRAM_IDS[programName]) {
    console.error(`❌ Unknown program: ${programName}`);
    console.log('Available programs:', Object.keys(PROGRAM_IDS).join(', '));
    process.exit(1);
  }
  
  const programId = PROGRAM_IDS[programName];
  const soPath = `target/deploy/${programName.replace(/-/g, '_')}.so`;
  
  console.log(`\n🔄 Upgrading program: ${programName}`);
  console.log(`   Program ID: ${programId}`);
  console.log(`   Binary: ${soPath}`);
  console.log(`   Dry Run: ${dryRun}`);
  
  // Step 1: Build the program (if not skipped)
  if (!skipBuild) {
    console.log('\n📦 Building program...');
    try {
      execSync(`anchor build -p ${programName}`, { stdio: 'inherit' });
    } catch (error) {
      console.error('❌ Build failed');
      process.exit(1);
    }
  }
  
  // Step 2: Verify the .so file exists
  if (!fs.existsSync(soPath)) {
    console.error(`❌ Program binary not found: ${soPath}`);
    process.exit(1);
  }
  
  const soStats = fs.statSync(soPath);
  console.log(`   Binary size: ${(soStats.size / 1024).toFixed(2)} KB`);
  
  if (dryRun) {
    console.log('\n✅ Dry run complete. No changes made.');
    return;
  }
  
  // Step 3: Deploy the upgrade
  console.log('\n🚀 Deploying upgrade...');
  try {
    execSync(`anchor upgrade target/deploy/${programName.replace(/-/g, '_')}.so --program-id ${programId}`, { stdio: 'inherit' });
    console.log('\n✅ Upgrade successful!');
  } catch (error) {
    console.error('❌ Upgrade failed');
    process.exit(1);
  }
  
  // Step 4: Verify the upgrade
  console.log('\n🔍 Verifying upgrade...');
  await showProgramInfo(programName);
}

async function showProgramInfo(programName: string) {
  if (!programName || !PROGRAM_IDS[programName]) {
    console.error(`❌ Unknown program: ${programName}`);
    console.log('Available programs:', Object.keys(PROGRAM_IDS).join(', '));
    process.exit(1);
  }
  
  const programId = PROGRAM_IDS[programName];
  const connection = await getConnection();
  
  console.log(`\n📊 Program Info: ${programName}`);
  console.log('─'.repeat(50));
  
  try {
    const programPubkey = new PublicKey(programId);
    const accountInfo = await connection.getAccountInfo(programPubkey);
    
    if (!accountInfo) {
      console.log('   Status: Not deployed');
      return;
    }
    
    console.log(`   Program ID: ${programId}`);
    console.log(`   Owner: ${accountInfo.owner.toBase58()}`);
    console.log(`   Executable: ${accountInfo.executable}`);
    console.log(`   Data Length: ${accountInfo.data.length} bytes`);
    console.log(`   Lamports: ${accountInfo.lamports / LAMPORTS_PER_SOL} SOL`);
    
    // Try to get program data account for upgradeable programs
    if (accountInfo.owner.toBase58() === 'BPFLoaderUpgradeab1e11111111111111111111111') {
      console.log(`   Loader: BPF Loader Upgradeable`);
      
      // Parse program data address from account data
      // First 4 bytes = variant, next 32 bytes = program data address
      if (accountInfo.data.length >= 36) {
        const programDataAddress = new PublicKey(accountInfo.data.slice(4, 36));
        console.log(`   Program Data: ${programDataAddress.toBase58()}`);
        
        const programDataInfo = await connection.getAccountInfo(programDataAddress);
        if (programDataInfo) {
          // First 45 bytes contain metadata, including upgrade authority at bytes 13-45
          const upgradeAuthorityBytes = programDataInfo.data.slice(13, 45);
          const upgradeAuthority = new PublicKey(upgradeAuthorityBytes);
          console.log(`   Upgrade Authority: ${upgradeAuthority.toBase58()}`);
        }
      }
    } else {
      console.log(`   Loader: ${accountInfo.owner.toBase58()}`);
      console.log(`   Note: Non-upgradeable program`);
    }
    
  } catch (error) {
    console.error(`❌ Error fetching program info: ${error}`);
  }
  
  console.log('─'.repeat(50));
}

async function transferAuthority(programName: string, newAuthorityPath: string) {
  if (!programName || !PROGRAM_IDS[programName]) {
    console.error(`❌ Unknown program: ${programName}`);
    process.exit(1);
  }
  
  if (!newAuthorityPath || !fs.existsSync(newAuthorityPath)) {
    console.error(`❌ New authority keypair not found: ${newAuthorityPath}`);
    process.exit(1);
  }
  
  const programId = PROGRAM_IDS[programName];
  const newAuthorityKey = JSON.parse(fs.readFileSync(newAuthorityPath, 'utf-8'));
  const newAuthority = Keypair.fromSecretKey(new Uint8Array(newAuthorityKey));
  
  console.log(`\n🔐 Transferring upgrade authority for: ${programName}`);
  console.log(`   Program ID: ${programId}`);
  console.log(`   New Authority: ${newAuthority.publicKey.toBase58()}`);
  
  console.log('\n⚠️  WARNING: This action cannot be undone!');
  console.log('   Make sure you have access to the new authority keypair.\n');
  
  try {
    execSync(
      `solana program set-upgrade-authority ${programId} --new-upgrade-authority ${newAuthority.publicKey.toBase58()}`,
      { stdio: 'inherit' }
    );
    console.log('\n✅ Authority transfer successful!');
  } catch (error) {
    console.error('❌ Authority transfer failed');
    process.exit(1);
  }
}

async function verifyUpgrade(programName: string) {
  if (!programName || !PROGRAM_IDS[programName]) {
    console.error(`❌ Unknown program: ${programName}`);
    process.exit(1);
  }
  
  const soPath = `target/deploy/${programName.replace(/-/g, '_')}.so`;
  
  if (!fs.existsSync(soPath)) {
    console.error(`❌ Local binary not found. Run 'anchor build -p ${programName}' first.`);
    process.exit(1);
  }
  
  console.log(`\n🔍 Verifying: ${programName}`);
  
  try {
    execSync(`anchor verify ${PROGRAM_IDS[programName]}`, { stdio: 'inherit' });
    console.log('\n✅ Verification successful! On-chain program matches local build.');
  } catch (error) {
    console.error('\n❌ Verification failed. Programs do not match.');
    process.exit(1);
  }
}

main().catch(console.error);
