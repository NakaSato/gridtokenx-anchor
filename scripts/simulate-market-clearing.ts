import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";

// Helpers
function findOrderPda(userPubkey: PublicKey, orderId: BN, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), userPubkey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

function findTradeRecordPda(buyOrder: PublicKey, sellOrder: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trade"), buyOrder.toBuffer(), sellOrder.toBuffer()],
    programId
  );
}

// Order Book State
interface Order {
  id: BN;
  pda: PublicKey;
  user: Keypair;
  amount: number;
  price: number;
  isBuy: boolean;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const tradingProgram = anchor.workspace.Trading as Program<Trading>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  
  // Load users
  const users = [
    Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-prosumer.json", "utf8")))),
    Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-consumer.json", "utf8")))),
    Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-industrial.json", "utf8"))))
  ];

  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
  const zoneId = 0;
  const [zoneMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, "le", 4)],
    tradingProgram.programId
  );
  const [governanceConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceProgram.programId);

  console.log("📈 Starting Batch Market Clearing Simulator...");
  console.log("Generating randomized order book...");

  const buyOrders: Order[] = [];
  const sellOrders: Order[] = [];

  // Generate 5 random buy orders and 5 random sell orders
  for (let i = 0; i < 5; i++) {
    const buyUser = users[Math.floor(Math.random() * users.length)];
    const sellUser = users[Math.floor(Math.random() * users.length)];

    const bPrice = 40 + Math.floor(Math.random() * 20); // 40-60
    const sPrice = 30 + Math.floor(Math.random() * 20); // 30-50
    const bAmt = 10 + Math.floor(Math.random() * 90);
    const sAmt = 10 + Math.floor(Math.random() * 90);

    const bId = new BN(10000 + i);
    const sId = new BN(20000 + i);

    buyOrders.push({ id: bId, pda: findOrderPda(buyUser.publicKey, bId, tradingProgram.programId)[0], user: buyUser, amount: bAmt, price: bPrice, isBuy: true });
    sellOrders.push({ id: sId, pda: findOrderPda(sellUser.publicKey, sId, tradingProgram.programId)[0], user: sellUser, amount: sAmt, price: sPrice, isBuy: false });
  }

  // 1. Submit all orders
  console.log("\n📦 Submitting Orders to Blockchain...");
  for (const b of buyOrders) {
    await tradingProgram.methods.createBuyOrder(b.id, new BN(b.amount), new BN(b.price))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: b.pda,
        authority: b.user.publicKey,
        governanceConfig: governanceConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([b.user])
      .rpc();
    console.log(`   🛒 Buy Order [${b.price} GRX] Vol: ${b.amount} | PDA: ${b.pda.toBase58().substring(0, 8)}...`);
  }

  for (const s of sellOrders) {
    await tradingProgram.methods.createSellOrder(s.id, new BN(s.amount), new BN(s.price))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: s.pda,
        authority: s.user.publicKey,
        governanceConfig: governanceConfigPda,
        ercCertificate: null,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([s.user])
      .rpc();
    console.log(`   🏷️ Sell Order [${s.price} GRX] Vol: ${s.amount} | PDA: ${s.pda.toBase58().substring(0, 8)}...`);
  }

  // 2. Off-chain matching engine (Price-Time Priority)
  console.log("\n⚙️  Running Off-chain Intersection Engine...");
  
  // Sort Buy orders descending (highest bid first)
  buyOrders.sort((a, b) => b.price - a.price);
  // Sort Sell orders ascending (lowest ask first)
  sellOrders.sort((a, b) => a.price - b.price);

  let matchCount = 0;
  let totalMatchedVol = 0;

  for (const buy of buyOrders) {
    for (const sell of sellOrders) {
      if (buy.amount <= 0) break; // Buy filled
      if (sell.amount <= 0) continue; // Sell already filled

      // Check if price overlaps
      if (buy.price >= sell.price) {
        const matchVol = Math.min(buy.amount, sell.amount);
        const clearingPrice = Math.floor((buy.price + sell.price) / 2); // Split the spread
        
        console.log(`   ⚡ Match Found! Clearing Price: ${clearingPrice} GRX | Vol: ${matchVol}`);

        const [tradeRecordPda] = findTradeRecordPda(buy.pda, sell.pda, tradingProgram.programId);

        try {
          await tradingProgram.methods.matchOrders(new BN(matchVol))
            .accounts({
              market: marketPda,
              zoneMarket: zoneMarketPda,
              buyOrder: buy.pda,
              sellOrder: sell.pda,
              tradeRecord: tradeRecordPda,
              authority: provider.wallet.publicKey, // Crank pays gas
              governanceConfig: governanceConfigPda,
              systemProgram: SystemProgram.programId,
            } as any)
            .rpc();
          
          matchCount++;
          totalMatchedVol += matchVol;
          buy.amount -= matchVol;
          sell.amount -= matchVol;
        } catch (e: any) {
          console.error(`   ❌ Match tx failed: ${e.message}`);
        }
      }
    }
  }

  console.log(`\n✅ Batch Clearing Complete!`);
  console.log(`   Trades Executed: ${matchCount}`);
  console.log(`   Total Volume Cleared: ${totalMatchedVol} kWh`);
}

// Start simulation
main().catch(err => {
  console.error(err);
  process.exit(1);
});
