/**
 * Example usage of GridTokenX generated clients
 * 
 * This file demonstrates how to use the generated TypeScript client
 * to interact with GridTokenX programs.
 */

import { Connection, Keypair } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { createGridTokenXClient } from './client';

// Example: Create and use the GridTokenX client
async function exampleUsage() {
  // Create connection to Solana cluster
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Create a wallet (in production, this would come from user's wallet)
  const keypair = Keypair.generate();
  const wallet = new Wallet(keypair);
  
  // Create the unified GridTokenX client
  const client = createGridTokenXClient(connection, wallet);
  
  // Access individual programs
  const energyTokenProgram = client.energyToken;
  const governanceProgram = client.governance;
  const oracleProgram = client.oracle;
  const registryProgram = client.registry;
  const tradingProgram = client.trading;
  
  // Example: Initialize the energy token program
  try {
    const tx = await energyTokenProgram.methods
      .initialize()
      .accounts({
        authority: wallet.publicKey,
      })
      .rpc();
    
    console.log('Energy token initialized:', tx);
  } catch (error) {
    console.error('Error initializing energy token:', error);
  }
  
  // Example: Create a token mint
  try {
    const tx = await energyTokenProgram.methods
      .createTokenMint(
        'Grid Renewable Energy Token',
        'GRX',
        'https://example.com/metadata.json'
      )
      .accounts({
        mint: Keypair.generate().publicKey, // In practice, this should be a proper keypair
        metadata: Keypair.generate().publicKey, // In practice, this should be a proper keypair
        payer: wallet.publicKey,
        authority: wallet.publicKey,
      })
      .rpc();
    
    console.log('Token mint created:', tx);
  } catch (error) {
    console.error('Error creating token mint:', error);
  }
  
  // Get all programs at once
  const allPrograms = client.getAllPrograms();
  console.log('Available programs:', Object.keys(allPrograms));
}

// Export for use in other files
export { exampleUsage };

// Run example if this file is executed directly
if (require.main === module) {
  exampleUsage().catch(console.error);
}
