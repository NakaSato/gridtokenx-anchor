// Initialize the fungible REC mint (governance program).
//
// REC is a Token-2022 SPL mint: 1 token = 1 MWh, 6 decimals (base unit = 1 Wh, so
// 1 kWh = 1_000 base units). PDA = [b"rec_mint"]; mint authority = the governance
// [b"poa_config"] PDA. `issue_erc` mints REC to producers; `retire_rec` burns them.
//
// Run AFTER init-governance.ts (the poa_config PDA must already exist):
//   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=<dev-wallet> npx tsx scripts/init-rec-mint.ts
import * as anchor from '@anchor-lang/core';
import { Program } from '@anchor-lang/core';
import { Governance } from '../target/types/governance';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const governance = anchor.workspace.Governance as Program<Governance>;
  const authority = provider.wallet.publicKey;

  const [poaPda] = PublicKey.findProgramAddressSync([Buffer.from('poa_config')], governance.programId);
  const [recMint] = PublicKey.findProgramAddressSync([Buffer.from('rec_mint')], governance.programId);

  console.log('REC mint PDA:', recMint.toBase58());
  try {
    const sig = await governance.methods
      .initRecMint()
      .accounts({
        governanceConfig: poaPda,
        recMint,
        authority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log('  ✅ REC mint initialized (6 decimals, authority = poa_config PDA):', sig);
  } catch (e: any) {
    if (/already in use|0x0/.test(e.message ?? '')) {
      console.log('  ℹ️ REC mint already initialized');
    } else {
      throw e;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
