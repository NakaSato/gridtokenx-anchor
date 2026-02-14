import { PublicKey, Connection } from '@solana/web3.js';

async function main() {
  const conn = new Connection('http://localhost:8899', 'confirmed');
  const ENERGY_TOKEN_PROGRAM = new PublicKey('5yksg9BHH5RFWpSsLHgRKaX8YAGLwBCu4FQKtpY9bS7U');
  const [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from('token_info_2022')], ENERGY_TOKEN_PROGRAM);
  const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from('mint_2022')], ENERGY_TOKEN_PROGRAM);
  
  const acct = await conn.getAccountInfo(tokenInfoPda);
  if (!acct) { console.log('ERROR: token_info not found'); return; }
  
  const authority = new PublicKey(acct.data.slice(8, 40));
  console.log('token_info.authority:', authority.toBase58());
  console.log('Expected dev-wallet: 5FdkFZDC9x1u9mgtvqXSYCnXNgj4oEtTpaTRK4CSFCWW');
  console.log('Match:', authority.toBase58() === '5FdkFZDC9x1u9mgtvqXSYCnXNgj4oEtTpaTRK4CSFCWW');
  console.log('Mint PDA:', mintPda.toBase58());
}
main().catch(console.error);
