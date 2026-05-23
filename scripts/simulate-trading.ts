import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Registry } from "../target/types/registry";
import { Governance } from "../target/types/governance";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const tradingProgram = anchor.workspace.Trading as Program<Trading>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  
  const authority = provider.wallet.publicKey;

  console.log("📈 Starting Trading Simulation...");

  // Load test wallets
  const prosumerKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-prosumer.json", "utf8"))));
  const consumerKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-consumer.json", "utf8"))));
  const industrialKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-industrial.json", "utf8"))));

  // Derivations
  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
  const zoneId = 0;
  const [zoneMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, 'le', 4)],
    tradingProgram.programId
  );
  const [poaConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceProgram.programId);

  console.log(`Using Market: ${marketPda.toBase58()}`);
  console.log(`Using Zone Market (0): ${zoneMarketPda.toBase58()}`);

  // 1. Create Sell Order (Prosumer)
  const sellOrderId = new BN(1001); // Use fixed IDs for simplicity
  const [sellOrderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), prosumerKey.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, 'le', 8)],
    tradingProgram.programId
  );

  console.log(`\n📦 Creating Sell Order for Prosumer...`);
  try {
    await tradingProgram.methods
      .createSellOrder(sellOrderId, new BN(100), new BN(50))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: sellOrderPda,
        authority: prosumerKey.publicKey,
        governanceConfig: poaConfigPda,
        ercCertificate: null,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([prosumerKey])
      .rpc();
    console.log(`   ✅ Sell Order created: ${sellOrderPda.toBase58()}`);
  } catch (e: any) {
    console.error(`   ❌ Failed to create sell order:`, e.message);
  }

  // 2. Create Buy Order (Consumer)
  const buyOrderId = new BN(2001);
  const [buyOrderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), consumerKey.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, 'le', 8)],
    tradingProgram.programId
  );

  console.log(`\n🛒 Creating Buy Order for Consumer...`);
  try {
    await tradingProgram.methods
      .createBuyOrder(buyOrderId, new BN(40), new BN(60))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: buyOrderPda,
        authority: consumerKey.publicKey,
        governanceConfig: poaConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([consumerKey])
      .rpc();
    console.log(`   ✅ Buy Order created: ${buyOrderPda.toBase58()}`);
  } catch (e: any) {
    console.error(`   ❌ Failed to create buy order:`, e.message);
  }

  // 3. Match Orders
  console.log(`\n⚡ Matching Orders (Partial Match)...`);
  const [tradeRecordPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trade"), buyOrderPda.toBuffer(), sellOrderPda.toBuffer()],
    tradingProgram.programId
  );

  try {
    await tradingProgram.methods
      .matchOrders(new BN(40))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        buyOrder: buyOrderPda,
        sellOrder: sellOrderPda,
        tradeRecord: tradeRecordPda,
        authority: authority,
        governanceConfig: poaConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log(`   ✅ Orders matched! Trade Record: ${tradeRecordPda.toBase58()}`);
  } catch (e: any) {
    console.error(`   ❌ Failed to match orders:`, e.message);
  }

  // 4. Create Buy Order (Industrial)
  const indBuyOrderId = new BN(3001);
  const [indBuyOrderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), industrialKey.publicKey.toBuffer(), indBuyOrderId.toArrayLike(Buffer, 'le', 8)],
    tradingProgram.programId
  );

  console.log(`\n🏭 Creating Buy Order for Industrial...`);
  try {
    await tradingProgram.methods
      .createBuyOrder(indBuyOrderId, new BN(60), new BN(55))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: indBuyOrderPda,
        authority: industrialKey.publicKey,
        governanceConfig: poaConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([industrialKey])
      .rpc();
    console.log(`   ✅ Industrial Buy Order created: ${indBuyOrderPda.toBase58()}`);
  } catch (e: any) {
    console.error(`   ❌ Failed to create industrial buy order:`, e.message);
  }

  // 5. Match remaining Prosumer sell order with Industrial
  console.log(`\n⚡ Matching Remaining Sell Order with Industrial...`);
  const [tradeRecord2Pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trade"), indBuyOrderPda.toBuffer(), sellOrderPda.toBuffer()],
    tradingProgram.programId
  );

  try {
    await tradingProgram.methods
      .matchOrders(new BN(60))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        buyOrder: indBuyOrderPda,
        sellOrder: sellOrderPda,
        tradeRecord: tradeRecord2Pda,
        authority: authority,
        governanceConfig: poaConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log(`   ✅ Orders matched! Trade Record: ${tradeRecord2Pda.toBase58()}`);
  } catch (e: any) {
    console.error(`   ❌ Failed to match orders:`, e.message);
  }

  console.log("\n✨ Trading simulation completed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
