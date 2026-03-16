import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgram = anchor.workspace.Trading as anchor.Program;
    const governanceProgram = anchor.workspace.Governance as anchor.Program;
    const authority = provider.wallet;

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  GridTokenX Sharding Initialization');
    console.log('═══════════════════════════════════════════════════════════════');

    // 1. Initialize Market
    const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from('market')], tradingProgram.programId);
    console.log(`Market PDA: ${marketPda.toBase58()}`);
    
    try {
        const tx = await tradingProgram.methods.initializeMarket(10).accounts({
            market: marketPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();
        console.log(`✅ Market initialized. TX: ${tx}`);
    } catch(e: any) {
        if (e.message.includes('already in use')) {
            console.log('ℹ️ Market already initialized.');
        } else {
            console.warn('⚠️ Market Error:', e.message);
        }
    }

    // 2. Initialize Zone Market (Zone 999)
    const zoneId = 999;
    const [zoneMarketPda] = PublicKey.findProgramAddressSync([
        Buffer.from('zone_market'), 
        marketPda.toBuffer(), 
        (() => { let b = Buffer.alloc(4); b.writeUInt32LE(zoneId); return b; })()
    ], tradingProgram.programId);
    
    console.log(`Zone Market PDA: ${zoneMarketPda.toBase58()}`);
    try {
        const tx = await tradingProgram.methods.initializeZoneMarket(zoneId, 10).accounts({
            market: marketPda,
            zoneMarket: zoneMarketPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();
        console.log(`✅ Zone Market ${zoneId} initialized. TX: ${tx}`);
    } catch(e: any) {
        if (e.message.includes('already in use')) {
            console.log('ℹ️ Zone Market already initialized.');
        } else {
            console.warn('⚠️ Zone Market Error:', e.message);
        }
    }

    // 3. Initialize Shards (10 shards)
    console.log("Initializing 10 Shards...");
    for (let i = 0; i < 10; i++) {
        const [shardPda] = PublicKey.findProgramAddressSync([
            Buffer.from('zone_shard'), 
            zoneMarketPda.toBuffer(), 
            Buffer.from([i])
        ], tradingProgram.programId);
        
        try {
            const tx = await tradingProgram.methods.initializeZoneMarketShard(i).accounts({
                zoneMarket: zoneMarketPda,
                zoneShard: shardPda,
                payer: authority.publicKey,
                systemProgram: SystemProgram.programId,
            }).rpc();
            console.log(`  ✓ Shard ${i} ready. PDA: ${shardPda.toBase58()}`);
        } catch(e: any) {
            if (e.message.includes('already in use')) {
                // skip
            } else {
                console.warn(`  ⚠️ Shard ${i} Error:`, e.message);
            }
        }
    }

    // 4. Initialize Governance PoA Config
    const [poaConfigPda] = PublicKey.findProgramAddressSync([Buffer.from('poa_config')], governanceProgram.programId);
    console.log("Initializing PoA Config...");
    try {
        const tx = await governanceProgram.methods.initializePoa().accounts({
            poaConfig: poaConfigPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();
        console.log(`✅ PoA Config initialized. TX: ${tx}`);
    } catch(e: any) {
        if (e.message.includes('already in use')) {
            console.log('ℹ️ PoA Config already initialized.');
        } else {
             console.warn('⚠️ PoA Config Error:', e.message);
        }
    }

    console.log("\n🚀 All set! Ready for rust benchmark driver.");
}

main().catch(console.error);
