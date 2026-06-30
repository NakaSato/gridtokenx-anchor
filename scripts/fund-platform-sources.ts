// Pre-fund the platform (EzudwoHv) source ATAs that fund_escrow_custodial transfers
// FROM, and create the settlement collector ATAs. Run as EzudwoHv (GRX mint authority
// + energy mint_to_wallet authority).
//   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=<repo>/dev-wallet.json \
//     npx tsx scripts/fund-platform-sources.ts
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { EnergyToken } from "../target/types/energy_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount, mintTo,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

const FEE = new PublicKey("BT9ESAZoNGnvPswpeHNLgt582GTQrAUv21ZLkk4H6Bad");
const PLATFORM = new PublicKey("EzudwoHvNPAc4dpPi5ndU8MEZVHVzq3Pj3Thm9ooKmiJ");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const energyToken = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;
  const conn = provider.connection;

  const currencyMint = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("currency-mint.json", "utf8")))
  ).publicKey;
  const [energyMintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyToken.programId);
  const [energyTokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyToken.programId);

  // 1) Platform GRX source ATA (classic SPL) + mint plenty (authority = EzudwoHv).
  const grxSrc = await getOrCreateAssociatedTokenAccount(conn, payer, currencyMint, authority, false, "confirmed", undefined, TOKEN_PROGRAM_ID);
  await mintTo(conn, payer, currencyMint, grxSrc.address, payer, 1_000_000_000_000n, [], undefined, TOKEN_PROGRAM_ID);
  console.log("✅ platform GRX source:", grxSrc.address.toBase58());

  // 2) Platform GRID source ATA (Token-2022) + mint via energy-token mint_to_wallet.
  const gridSrc = await getOrCreateAssociatedTokenAccount(conn, payer, energyMintPda, authority, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
  await energyToken.methods
    .mintToWallet(new BN(1_000_000_000_000))
    .accounts({
      mint: energyMintPda, tokenInfo: energyTokenInfoPda, destination: gridSrc.address,
      destinationOwner: authority, authority, payer: authority,
      tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .rpc();
  console.log("✅ platform GRID source:", gridSrc.address.toBase58());

  // 3) Collector ATAs (currency, classic SPL) — must exist for settlement transfers.
  for (const [name, owner] of [["fee", FEE], ["wheeling", PLATFORM], ["loss", PLATFORM]] as [string, PublicKey][]) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, payer, currencyMint, owner, false, "confirmed", undefined, TOKEN_PROGRAM_ID);
    console.log(`✅ ${name} collector ATA:`, ata.address.toBase58());
  }
  console.log("\n✨ Platform sources + collectors ready.");
}
main().catch((e) => {
  console.error("❌ name:", e?.name, "msg:", JSON.stringify(e?.message));
  console.error("raw:", e);
  if (e?.logs) console.error("LOGS:\n" + e.logs.join("\n"));
  if (e?.transactionLogs) console.error("TXLOGS:\n" + e.transactionLogs.join("\n"));
  process.exit(1);
});
