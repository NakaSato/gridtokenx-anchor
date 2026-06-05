import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { EnergyToken } from "../target/types/energy_token";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";

/**
 * Reconcile the stored `token_info.total_supply` with the canonical `mint.supply`.
 *
 * mint_to/burn skip the stored total on purpose (avoids write-lock contention on
 * token_info during high-frequency minting — Sealevel parallelism), so it drifts.
 * `sync_total_supply` is the admin reconciler; run this periodically to refresh it.
 */
async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const authority = provider.wallet.publicKey;

  const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyTokenProgram.programId);
  const [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyTokenProgram.programId);

  const before = await energyTokenProgram.account.tokenInfo.fetch(tokenInfoPda);
  const mint = await getMint(provider.connection, mintPda, "confirmed", TOKEN_PROGRAM_ID);
  console.log(`Stored total_supply: ${before.totalSupply.toString()}`);
  console.log(`Canonical mint.supply: ${mint.supply.toString()}`);

  const tx = await energyTokenProgram.methods
    .syncTotalSupply()
    .accounts({
      tokenInfo: tokenInfoPda,
      mint: mintPda,
      authority,
    } as any)
    .rpc();

  const after = await energyTokenProgram.account.tokenInfo.fetch(tokenInfoPda);
  console.log(`✅ Synced. total_supply = ${after.totalSupply.toString()} (tx ${tx})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
