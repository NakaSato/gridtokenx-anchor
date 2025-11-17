#!/usr/bin/env ts-node

/**
 * GridTokenX Transaction Inspector
 * Decode base64 data from transaction logs
 */

import { Connection, PublicKey } from "@solana/web3.js";

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

class GridTokenXInspector {
  private connection: Connection;

  constructor(rpcUrl: string = "http://127.0.0.1:8899") {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  // Decode base64 string
  decode(encoded: string): string {
    return Buffer.from(encoded, 'base64').toString('utf-8');
  }

  // Parse program-specific data
  parseData(decoded: string, program?: string) {
    const parts = decoded.split(':');

    // Auto-detect program type
    if (!program) {
      if (parts[0].startsWith('REC-')) program = 'governance';
      else if (parts[0].startsWith('METER-')) program = 'registry';
      else if (parts[0] === 'SELL' || parts[0] === 'BUY') program = 'trading';
      else if (parts.length === 3 && !isNaN(parseInt(parts[2]))) program = 'energy-token';
    }

    switch (program) {
      case 'energy-token':
        return {
          program: 'Energy Token',
          data: {
            owner: parts[0],
            amount: `${parts[1]} GRID`,
            timestamp: new Date(parseInt(parts[2]) * 1000).toISOString()
          }
        };
      
      case 'governance':
        return {
          program: 'Governance (REC)',
          data: {
            certificateId: parts[0],
            energyAmount: `${parts[1]} kWh`,
            renewableSource: parts[2]
          }
        };
      
      case 'registry':
        return {
          program: 'Registry',
          data: {
            meterId: parts[0],
            owner: parts[1],
            tokensToMint: `${parts[2]} GRID`,
            totalSettled: `${parts[3]} kWh`
          }
        };
      
      case 'oracle':
        return {
          program: 'Oracle',
          data: {
            meterId: parts[0],
            energyProduced: `${parts[1]} kWh`,
            energyConsumed: `${parts[2]} kWh`,
            netEnergy: `${parseInt(parts[1]) - parseInt(parts[2])} kWh`,
            timestamp: new Date(parseInt(parts[3]) * 1000).toISOString()
          }
        };
      
      case 'trading':
        return {
          program: 'Trading',
          data: {
            orderType: parts[0],
            amount: `${parts[1]} GRID`,
            pricePerToken: `${parseInt(parts[2]) / 1e9} SOL`,
            totalValue: `${(parseInt(parts[1]) * parseInt(parts[2])) / 1e9} SOL`
          }
        };
      
      default:
        return {
          program: 'Unknown',
          data: { raw: decoded }
        };
    }
  }

  // Inspect transaction
  async inspectTransaction(signature: string) {
    console.log(`\n${colors.cyan}🔍 INSPECTING TRANSACTION${colors.reset}`);
    console.log("=".repeat(70));
    console.log(`${colors.blue}Signature:${colors.reset} ${signature}`);
    console.log("=".repeat(70));

    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        console.log(`${colors.yellow}❌ Transaction not found${colors.reset}`);
        return;
      }

      // Transaction details
      console.log(`\n${colors.green}📊 DETAILS:${colors.reset}`);
      console.log(`  Slot: ${tx.slot}`);
      console.log(`  Block Time: ${new Date(tx.blockTime! * 1000).toISOString()}`);
      console.log(`  Fee: ${tx.meta?.fee} lamports`);
      console.log(`  Status: ${tx.meta?.err ? '❌ Failed' : '✅ Success'}`);

      // Program logs
      if (tx.meta?.logMessages) {
        console.log(`\n${colors.green}📝 LOGS:${colors.reset}`);
        console.log("-".repeat(70));
        
        let base64Count = 0;
        for (const log of tx.meta.logMessages) {
          console.log(log);
          
          // Extract and decode base64
          const match = log.match(/\(base64\):\s*([A-Za-z0-9+/=]+)/);
          if (match) {
            base64Count++;
            const encoded = match[1];
            const decoded = this.decode(encoded);
            const parsed = this.parseData(decoded);
            
            console.log(`${colors.magenta}  🔓 DECODED:${colors.reset} ${decoded}`);
            console.log(`${colors.cyan}  📦 PARSED (${parsed.program}):${colors.reset}`);
            console.log(JSON.stringify(parsed.data, null, 4).split('\n').map(l => `     ${l}`).join('\n'));
          }
        }
        
        if (base64Count === 0) {
          console.log(`${colors.yellow}💡 No base64 encoded data found${colors.reset}`);
        } else {
          console.log(`\n${colors.green}✅ Found ${base64Count} base64 encoded data${colors.reset}`);
        }
      }

      // Explorer links
      console.log(`\n${colors.green}🌐 VIEW IN EXPLORER:${colors.reset}`);
      console.log(`  Solana Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
      console.log(`  Solscan: https://solscan.io/tx/${signature}?cluster=devnet`);

    } catch (error) {
      console.error(`${colors.yellow}❌ Error:${colors.reset}`, error);
    }

    console.log("\n" + "=".repeat(70) + "\n");
  }

  // Decode standalone base64 string
  decodeBase64(encoded: string, program?: string) {
    console.log(`\n${colors.cyan}🔓 DECODING BASE64${colors.reset}`);
    console.log("=".repeat(70));
    console.log(`${colors.blue}Input:${colors.reset} ${encoded}`);
    console.log("=".repeat(70));

    try {
      const decoded = this.decode(encoded);
      const parsed = this.parseData(decoded, program);

      console.log(`\n${colors.green}✅ DECODED:${colors.reset} ${decoded}`);
      console.log(`\n${colors.green}📦 PARSED (${parsed.program}):${colors.reset}`);
      console.log(JSON.stringify(parsed.data, null, 2));

    } catch (error) {
      console.error(`${colors.yellow}❌ Error:${colors.reset}`, error);
    }

    console.log("\n" + "=".repeat(70) + "\n");
  }

  // Monitor program logs in real-time
  async monitorProgram(programId: string) {
    const pubkey = new PublicKey(programId);
    
    console.log(`\n${colors.cyan}👀 MONITORING PROGRAM${colors.reset}`);
    console.log("=".repeat(70));
    console.log(`${colors.blue}Program ID:${colors.reset} ${programId}`);
    console.log(`${colors.yellow}Press Ctrl+C to stop${colors.reset}`);
    console.log("=".repeat(70));

    this.connection.onLogs(
      pubkey,
      (logs) => {
        console.log(`\n${colors.green}🔔 NEW TRANSACTION:${colors.reset} ${logs.signature}`);
        console.log(`${colors.blue}Time:${colors.reset} ${new Date().toISOString()}`);
        console.log("-".repeat(70));
        
        for (const log of logs.logs) {
          console.log(log);
          
          const match = log.match(/\(base64\):\s*([A-Za-z0-9+/=]+)/);
          if (match) {
            const decoded = this.decode(match[1]);
            const parsed = this.parseData(decoded);
            console.log(`${colors.magenta}  🔓 DECODED:${colors.reset} ${decoded}`);
            console.log(`${colors.cyan}  📦 ${parsed.program}:${colors.reset} ${JSON.stringify(parsed.data)}`);
          }
        }
        
        console.log("-".repeat(70));
      },
      "confirmed"
    );
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const inspector = new GridTokenXInspector();

  if (args.length === 0) {
    console.log(`
${colors.cyan}GridTokenX Transaction Inspector${colors.reset}
${colors.yellow}==================================${colors.reset}

Usage:
  ${colors.green}Inspect transaction:${colors.reset}
    ts-node inspect.ts tx <SIGNATURE>
  
  ${colors.green}Decode base64:${colors.reset}
    ts-node inspect.ts decode <BASE64_STRING> [program-type]
  
  ${colors.green}Monitor program:${colors.reset}
    ts-node inspect.ts monitor <PROGRAM_ID>

Program Types:
  - energy-token
  - governance
  - registry
  - oracle
  - trading

Examples:
  ts-node inspect.ts tx 5j7s8K9L...abc123
  ts-node inspect.ts decode UkVDLTAwMTo4MDA6c29sYXI= governance
  ts-node inspect.ts monitor 6LgvcJJ9fQ4P3h2JybqoRXq5mNqMkTPyMbuYrqpSb7yj
    `);
    return;
  }

  const command = args[0];

  switch (command) {
    case 'tx':
    case 'transaction':
      if (args[1]) {
        await inspector.inspectTransaction(args[1]);
      } else {
        console.log(`${colors.yellow}❌ Please provide a transaction signature${colors.reset}`);
      }
      break;

    case 'decode':
      if (args[1]) {
        inspector.decodeBase64(args[1], args[2]);
      } else {
        console.log(`${colors.yellow}❌ Please provide a base64 string${colors.reset}`);
      }
      break;

    case 'monitor':
      if (args[1]) {
        await inspector.monitorProgram(args[1]);
      } else {
        console.log(`${colors.yellow}❌ Please provide a program ID${colors.reset}`);
      }
      break;

    default:
      console.log(`${colors.yellow}❌ Unknown command: ${command}${colors.reset}`);
      console.log(`Run without arguments to see usage`);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { GridTokenXInspector };
