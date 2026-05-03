import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgram = anchor.workspace.Trading as anchor.Program;
    const authority = provider.wallet;

    const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from('market')], tradingProgram.programId);
    
    const zones = [0, 1, 2, 3, 4, 5];
    
    for (const zoneId of zones) {
        const [zoneMarketPda] = PublicKey.findProgramAddressSync([
            Buffer.from('zone_market'), 
            marketPda.toBuffer(), 
            (() => { let b = Buffer.alloc(4); b.writeUInt32LE(zoneId); return b; })()
        ], tradingProgram.programId);
        
        console.log(`Checking Zone Market ${zoneId} (PDA: ${zoneMarketPda.toBase58()})...`);
        
        try {
            // Check if already exists
            await tradingProgram.account.zoneMarket.fetch(zoneMarketPda);
            console.log(`  ✓ Zone Market ${zoneId} already exists.`);
        } catch (e) {
            console.log(`  🚀 Initializing Zone Market ${zoneId}...`);
            const tx = await tradingProgram.methods.initializeZoneMarket(zoneId, 10).accounts({
                market: marketPda,
                zoneMarket: zoneMarketPda,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            }).rpc();
            console.log(`  ✅ Zone Market ${zoneId} initialized. TX: ${tx}`);
        }

        // Initialize Shards (10 shards per zone)
        for (let i = 0; i < 10; i++) {
            const [shardPda] = PublicKey.findProgramAddressSync([
                Buffer.from('zone_shard'), 
                zoneMarketPda.toBuffer(), 
                Buffer.from([i])
            ], tradingProgram.programId);
            
            try {
                await tradingProgram.account.zoneMarketShard.fetch(shardPda);
                // console.log(`    ✓ Shard ${i} already exists.`);
            } catch (e) {
                const tx = await tradingProgram.methods.initializeZoneMarketShard(i).accounts({
                    zoneMarket: zoneMarketPda,
                    zoneShard: shardPda,
                    payer: authority.publicKey,
                    systemProgram: SystemProgram.programId,
                }).rpc();
                console.log(`    ✅ Shard ${i} initialized. TX: ${tx}`);
            }
        }
    }

    console.log("\n🚀 All required zones initialized!");
}

main().catch(console.error);
