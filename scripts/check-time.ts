import * as anchor from '@coral-xyz/anchor';

async function main() {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  
  const slot = await connection.getSlot();
  const timestamp = await connection.getBlockTime(slot);
  
  console.log('Current Slot:', slot);
  console.log('Current Validator Time (Unix):', timestamp);
  console.log('Current Host Time (Unix):', Math.floor(Date.now() / 1000));
  console.log('Difference (Host - Validator):', Math.floor(Date.now() / 1000) - (timestamp || 0));
}

main().catch(console.error);
