import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgram = anchor.workspace.Trading;
    const authority = provider.wallet;

    const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('market')],
        tradingProgram.programId
    );

    const zoneId = 1;
    const [zoneMarketPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('zone_market'),
            marketPda.toBuffer(),
            (() => {
                const buf = Buffer.alloc(4);
                buf.writeUInt32LE(zoneId);
                return buf;
            })(),
        ],
        tradingProgram.programId
    );

    console.log(`Initializing Zone Market for zone ${zoneId}...`);
    console.log(`Market PDA: ${marketPda.toBase58()}`);
    console.log(`Zone Market PDA: ${zoneMarketPda.toBase58()}`);
    
    try {
        const tx = await tradingProgram.methods
            .initializeZoneMarket(zoneId, 1, new anchor.BN(1000000))
            .accounts({
                market: marketPda,
                zoneMarket: zoneMarketPda,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log('✅ Zone Market initialized:', tx);
    } catch (e: any) {
        if (e.message.includes('already in use')) {
            console.log('ℹ️  Zone Market already initialized.');
        } else {
            console.error('❌ Error initializing zone market:', e);
            throw e;
        }
    }
}

main().catch(console.error);
