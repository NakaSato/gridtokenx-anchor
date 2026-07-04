// Mint + burn demonstration for GRID (energy token, Token-2022):
//   register_user -> register_meter -> submit_meter_reading -> update_meter_reading
//   -> settle_and_mint_tokens (mint) -> burn_tokens (burn)
// Trading/CDA leg is proven separately via the live IAM+Trading services (90_golden_path).
//   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=<repo>/dev-wallet.json \
//     npx tsx scripts/mint-and-burn-demo.ts
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { Oracle } from "../target/types/oracle";
import { EnergyToken } from "../target/types/energy_token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount, getAccount } from "@solana/spl-token";
import BN from "bn.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registry = anchor.workspace.Registry as Program<Registry>;
  const oracle = anchor.workspace.Oracle as Program<Oracle>;
  const energyToken = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const authority = provider.wallet.publicKey; // dev-wallet: registry oracle_authority + REC validator
  const payer = (provider.wallet as any).payer;

  const prosumer = Keypair.generate();
  console.log("prosumer:", prosumer.publicKey.toBase58());

  // Fund prosumer for its one signature (settle_and_mint_tokens doesn't pay rent, but
  // needs a lamport balance for the tx if it ever becomes fee payer downstream).
  await provider.sendAndConfirm(
    new anchor.web3.Transaction().add(
      SystemProgram.transfer({ fromPubkey: authority, toPubkey: prosumer.publicKey, lamports: 0.05 * anchor.web3.LAMPORTS_PER_SOL })
    )
  );

  const shardId = shardFor(prosumer.publicKey);
  const meterId = `MTR_DEMO_${prosumer.publicKey.toBase58().slice(0, 6)}`;
  const zoneId = 0;

  const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registry.programId);
  const [userPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), prosumer.publicKey.toBuffer()], registry.programId);
  const [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([shardId])], registry.programId);
  const [meterPda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), prosumer.publicKey.toBuffer(), Buffer.from(meterId)], registry.programId);
  const [oracleDataPda] = PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], oracle.programId);
  const [oracleMeterStatePda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), Buffer.from(meterId)], oracle.programId);
  const [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyToken.programId);
  const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyToken.programId);

  console.log("\n1. register_user");
  // `authority` is an UncheckedAccount in the IDL (admin can sign on the user's behalf),
  // so anchor-ts won't mark it isSigner from .accounts() alone — patch the ix manually
  // so the prosumer's own signature is attached and satisfies is_user_signing on-chain.
  {
    const ix = await registry.methods
      .registerUser({ prosumer: {} } as any, 13756300, 100501800, new BN(0), shardId)
      .accounts({
        userAccount: userPda,
        registryShard: shardPda,
        registry: registryPda,
        authority: prosumer.publicKey,
        payer: authority,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
    for (const k of ix.keys) if (k.pubkey.equals(prosumer.publicKey)) k.isSigner = true;
    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx, [prosumer]);
  }
  console.log("   user PDA:", userPda.toBase58());

  console.log("\n2. register_meter");
  await registry.methods
    .registerMeter(meterId, { solar: {} } as any, shardId, zoneId)
    .accounts({
      meterAccount: meterPda,
      userAccount: userPda,
      registryShard: shardPda,
      registry: registryPda,
      owner: prosumer.publicKey,
      payer: authority,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  console.log("   meter PDA:", meterPda.toBase58());

  console.log("\n3. submit_meter_reading (oracle) — 500 kWh generated");
  const ts = Math.floor(Date.now() / 1000);
  await oracle.methods
    .submitMeterReading(meterId, new BN(500), new BN(0), new BN(ts), zoneId)
    .accounts({
      oracleData: oracleDataPda,
      meterState: oracleMeterStatePda,
      authority,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  console.log("   oracle reading submitted");

  console.log("\n4. update_meter_reading (registry)");
  await registry.methods
    .updateMeterReading(new BN(500), new BN(0), new BN(ts))
    .accounts({
      registry: registryPda,
      meterAccount: meterPda,
      oracleMeterState: oracleMeterStatePda,
      oracleAuthority: authority,
    } as any)
    .rpc();
  console.log("   registry meter reading updated");

  console.log("\n5. settle_and_mint_tokens — MINT leg");
  const userAta = await getOrCreateAssociatedTokenAccount(provider.connection, payer, mintPda, prosumer.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID);
  const before = await getAccount(provider.connection, userAta.address, undefined, TOKEN_2022_PROGRAM_ID);
  console.log("   GRID balance before mint:", before.amount.toString());

  // energy_token::MintTokensDirect requires rec_validator as an actual Signer (the
  // registry->energy_token CPI doesn't relax that), but registry's own SettleAndMintTokens
  // context declares it as an UncheckedAccount — anchor-ts won't mark it isSigner from
  // .accounts() alone, so patch the ix manually (same trick as the prosumer signer above).
  // dev-wallet/EzudwoHv is registered as a REC validator by bootstrap.ts.
  {
    const ix = await registry.methods
      .settleAndMintTokens()
      .accounts({
        meterAccount: meterPda,
        meterOwner: prosumer.publicKey,
        tokenInfo: tokenInfoPda,
        mint: mintPda,
        userTokenAccount: userAta.address,
        registry: registryPda,
        energyTokenProgram: energyToken.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        recValidator: authority,
      } as any)
      .instruction();
    for (const k of ix.keys) if (k.pubkey.equals(authority)) k.isSigner = true;
    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx, [prosumer]);
  }

  const afterMint = await getAccount(provider.connection, userAta.address, undefined, TOKEN_2022_PROGRAM_ID);
  console.log("   ✅ GRID balance after mint: ", afterMint.amount.toString());

  console.log("\n6. burn_tokens — BURN leg (burn half of minted balance)");
  const burnAmount = afterMint.amount / 2n;
  await energyToken.methods
    .burnTokens(new BN(burnAmount.toString()))
    .accounts({
      mint: mintPda,
      tokenAccount: userAta.address,
      authority: prosumer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any)
    .signers([prosumer])
    .rpc();

  const afterBurn = await getAccount(provider.connection, userAta.address, undefined, TOKEN_2022_PROGRAM_ID);
  console.log("   ✅ GRID balance after burning", burnAmount.toString(), ":", afterBurn.amount.toString());

  console.log("\n✨ mint + burn demo complete.");
  console.log(`   before=${before.amount} minted_to=${afterMint.amount} burned=${burnAmount} after_burn=${afterBurn.amount}`);
  if (afterMint.amount <= before.amount) throw new Error("mint did not increase balance");
  if (afterBurn.amount !== afterMint.amount - burnAmount) throw new Error("burn balance mismatch");
  console.log("   ✅ balance deltas verified");
}

function shardFor(pk: PublicKey): number {
  return pk.toBytes()[0] % 16;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
