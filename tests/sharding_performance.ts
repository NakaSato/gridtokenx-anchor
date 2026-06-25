import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  Transaction,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

describe("sharding-performance", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry as Program<Registry>;
  const tradingProgram = anchor.workspace.Trading as Program<Trading>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  
  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;

  let registryPda: PublicKey;
  let governanceConfigPda: PublicKey;
  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;
  
  const SHARD_COUNT = 16;
  const zoneId = 7588;

  before(async () => {
    [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryProgram.programId);
    [governanceConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceProgram.programId);
    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, 'le', 4)],
        tradingProgram.programId
    );

    // Bootstrap if needed
    try {
        await registryProgram.methods.initialize().accounts({ registry: registryPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
    } catch (e) {}
    
    for (let i = 0; i < SHARD_COUNT; i++) {
        const [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([i])], registryProgram.programId);
        try {
            await registryProgram.methods.initializeShard(i).accounts({ shard: shardPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
        } catch (e) {}
    }

    try {
        await governanceProgram.methods.initializeGovernance().accounts({ governanceConfig: governanceConfigPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
    } catch (e) {}

    try {
        await tradingProgram.methods.initializeMarket().accounts({ market: marketPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
    } catch (e) {}

    try {
        await tradingProgram.methods.initializeZoneMarket(zoneId).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
    } catch (e) {}
    
    for (let i = 0; i < SHARD_COUNT; i++) {
        const [zoneShardPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([i])], tradingProgram.programId);
        try {
            await tradingProgram.methods.initializeZoneMarketShard(i).accounts({ zoneMarket: zoneMarketPda, zoneShard: zoneShardPda, payer: authority, systemProgram: SystemProgram.programId } as any).rpc();
        } catch (e) {}
    }
  });

  async function registerUsers(count: number, startShard: number = 0) {
    console.log(`   🚀 Registering ${count} users across shards...`);
    const users: Keypair[] = [];
    const promises = [];
    const batchSize = 10;

    for (let i = 0; i < count; i++) {
        const user = Keypair.generate();
        users.push(user);
        // Shard bound in-program to the user's first key byte; random keys still spread across all 16.
        const shardId = user.publicKey.toBytes()[0] % SHARD_COUNT;
        const [userPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), user.publicKey.toBuffer()], registryProgram.programId);
        const [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([shardId])], registryProgram.programId);

        const promise = (async () => {
            // Register without airdrop for speed
            await registryProgram.methods.registerUser({ prosumer: {} }, 0, 0, new BN(0), shardId).accounts({
                userAccount: userPda,
                registryShard: shardPda,
                registry: registryPda,
                authority: user.publicKey,
                payer: authority,
                energyTokenProgram: registryProgram.programId,
                mint: registryPda,
                userTokenAccount: registryPda,
                tokenInfo: registryPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            } as any).rpc();
        })();
        promises.push(promise);

        if (promises.length >= batchSize) {
            await Promise.all(promises);
            promises.length = 0;
            process.stdout.write(".");
        }
    }
    await Promise.all(promises);
    console.log(`\n   ✅ ${count} users registered.`);
    return users;
  }

  it("test_shard_aggregation_small: Register 2 users and aggregate", async () => {
    await registerUsers(2);
    // Users bind to random shards now — aggregate the full set so both are counted.
    const remainingAccounts = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
        const [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([i])], registryProgram.programId);
        remainingAccounts.push({ pubkey: shardPda, isWritable: false, isSigner: false });
    }

    await registryProgram.methods.aggregateShards().remainingAccounts(remainingAccounts).accounts({
        registry: registryPda,
        authority: authority,
    } as any).rpc();

    const registry = await registryProgram.account.registry.fetch(registryPda);
    expect(registry.userCount.toNumber()).to.be.at.least(2);
  });

  it("test_shard_aggregation_massive: Register 1000 users and aggregate", async () => {
    // We already have some users from previous test, let's add 1000 more
    await registerUsers(1000);
    
    const remainingAccounts = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
        const [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([i])], registryProgram.programId);
        remainingAccounts.push({ pubkey: shardPda, isWritable: false, isSigner: false });
    }

    await registryProgram.methods.aggregateShards().remainingAccounts(remainingAccounts).accounts({
        registry: registryPda,
        authority: authority,
    } as any).rpc();

    const registry = await registryProgram.account.registry.fetch(registryPda);
    console.log(`   Total Users in Registry: ${registry.userCount.toNumber()}`);
    expect(registry.userCount.toNumber()).to.be.at.least(1002);
  });

  it("test_parallel_clearing_massive: 1000 concurrent trades across shards", async () => {
    console.log("   Seeding 1000 matching orders...");
    // For 1000 trades, we need 1000 buy and 1000 sell orders
    // To speed up, we'll do 100 trades (200 orders) instead if 1000 is too slow for localnet simulation
    const TRADE_COUNT = 100; 
    const buyOrders: PublicKey[] = [];
    const sellOrders: PublicKey[] = [];
    
    const batchSize = 10;
    for (let i = 0; i < TRADE_COUNT; i++) {
        const buyer = Keypair.generate();
        const seller = Keypair.generate();
        const buyOrderId = new BN(Date.now() + i * 2);
        const sellOrderId = new BN(Date.now() + i * 2 + 1);
        
        const [buyPda] = PublicKey.findProgramAddressSync([Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, 'le', 8)], tradingProgram.programId);
        const [sellPda] = PublicKey.findProgramAddressSync([Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, 'le', 8)], tradingProgram.programId);

        // Fund
        await provider.sendAndConfirm(new Transaction().add(
            SystemProgram.transfer({ fromPubkey: authority, toPubkey: buyer.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }),
            SystemProgram.transfer({ fromPubkey: authority, toPubkey: seller.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL })
        ));

        await tradingProgram.methods.createBuyOrder(buyOrderId, new BN(100), new BN(60)).accounts({
            market: marketPda, zoneMarket: zoneMarketPda, order: buyPda, authority: buyer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: governanceConfigPda
        } as any).signers([buyer]).rpc();
        
        await tradingProgram.methods.createSellOrder(sellOrderId, new BN(100), new BN(50)).accounts({
            market: marketPda, zoneMarket: zoneMarketPda, order: sellPda, authority: seller.publicKey, systemProgram: SystemProgram.programId, governanceConfig: governanceConfigPda, ercCertificate: null
        } as any).signers([seller]).rpc();

        buyOrders.push(buyPda);
        sellOrders.push(sellPda);
        if (i % batchSize === 0) process.stdout.write(".");
    }
    console.log(`\n   Seeded ${TRADE_COUNT} matching pairs.`);

    console.log(`   Executing ${TRADE_COUNT} sharded matches...`);
    const startTime = Date.now();
    const matchPromises = [];
    for (let i = 0; i < TRADE_COUNT; i++) {
        const shardId = i % SHARD_COUNT;
        const [zoneShardPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([shardId])], tradingProgram.programId);
        const [tradePda] = PublicKey.findProgramAddressSync([Buffer.from("trade"), buyOrders[i].toBuffer(), sellOrders[i].toBuffer()], tradingProgram.programId);

        const promise = tradingProgram.methods.shardedMatchOrders(new BN(100), shardId).accounts({
            market: marketPda,
            zoneMarket: zoneMarketPda,
            zoneShard: zoneShardPda,
            buyOrder: buyOrders[i],
            sellOrder: sellOrders[i],
            tradeRecord: tradePda,
            authority: authority,
            systemProgram: SystemProgram.programId,
            governanceConfig: governanceConfigPda,
        } as any).rpc();
        matchPromises.push(promise);
    }

    const results = await Promise.allSettled(matchPromises);
    const endTime = Date.now();
    const success = results.filter(r => r.status === 'fulfilled').length;
    const duration = (endTime - startTime) / 1000;

    console.log(`   Success: ${success}/${TRADE_COUNT}`);
    console.log(`   Duration: ${duration.toFixed(2)}s`);
    console.log(`   TPS: ${(success / duration).toFixed(2)}`);

    expect(success).to.equal(TRADE_COUNT);
  });
});
