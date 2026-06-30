// Verify the redeployed custodial instructions execute on-chain:
//   record_order_custodial  — platform records an order PDA for a non-signing user
//   fund_escrow_custodial   — platform funds that user's escrow from a platform ATA
// Run: ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
//      ANCHOR_WALLET=<repo>/dev-wallet.json npx tsx scripts/verify-custodial.ts
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const trading = anchor.workspace.Trading as Program<Trading>;
  const governance = anchor.workspace.Governance as Program<Governance>;
  const authority = provider.wallet.publicKey; // platform = funder (EzudwoHv)
  const payer = (provider.wallet as any).payer as Keypair;

  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], trading.programId);
  const zoneId = 0;
  const [zoneMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, "le", 4)],
    trading.programId
  );
  const [govCfgPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governance.programId);
  const currencyMint = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("currency-mint.json", "utf8")))
  ).publicKey;

  // A non-signing end user (custodial — user key never signs).
  const user = Keypair.generate().publicKey;
  const orderId = new BN(Date.now());
  const [orderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), user.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
    trading.programId
  );

  console.log("user(non-signer):", user.toBase58());
  console.log("orderPda:", orderPda.toBase58());

  // 1) record_order_custodial — platform signs, user is non-signing authority arg.
  await trading.methods
    .recordOrderCustodial(orderId, user, true, new BN(100), new BN(55))
    .accounts({
      market: marketPda,
      zoneMarket: zoneMarketPda,
      order: orderPda,
      funder: authority,
      systemProgram: anchor.web3.SystemProgram.programId,
      governanceConfig: govCfgPda,
    } as any)
    .rpc();
  const ord = await (trading.account as any).order.fetch(orderPda);
  console.log("✅ record_order_custodial — buyer:", ord.buyer.toBase58(), "amount:", ord.amount.toString());

  // 2) fund_escrow_custodial — platform mints GRX to its own ATA, then funds user escrow.
  const funderAta = await getOrCreateAssociatedTokenAccount(
    provider.connection, payer, currencyMint, authority, false, "confirmed", undefined, TOKEN_PROGRAM_ID
  );
  await mintTo(provider.connection, payer, currencyMint, funderAta.address, payer, 1_000_000, [], undefined, TOKEN_PROGRAM_ID);

  const [escrowPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), user.toBuffer(), currencyMint.toBuffer()],
    trading.programId
  );
  const [marketAuthority] = PublicKey.findProgramAddressSync([Buffer.from("market_authority")], trading.programId);

  const fundSig = await trading.methods
    .fundEscrowCustodial(user, new BN(500_000))
    .accounts({
      funder: authority,
      mint: currencyMint,
      funderSource: funderAta.address,
      userEscrow: escrowPda,
      marketAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .rpc();
  console.log("fund tx:", fundSig, "escrowPda:", escrowPda.toBase58());
  const info = await provider.connection.getAccountInfo(escrowPda, "confirmed");
  if (!info) throw new Error("escrow account info NULL after fund rpc");
  const esc = await getAccount(provider.connection, escrowPda, "confirmed", TOKEN_PROGRAM_ID);
  console.log("✅ fund_escrow_custodial — escrow:", escrowPda.toBase58(), "balance:", esc.amount.toString());

  console.log("\n✨ Custodial instructions verified on-chain.");
}
main().catch((e) => {
  console.error("❌ name:", e?.name, "msg:", e?.message);
  console.error("raw:", e);
  if (e?.logs) console.error("LOGS:\n" + e.logs.join("\n"));
  process.exit(1);
});
