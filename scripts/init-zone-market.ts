import * as anchor from '@coral-xyz/anchor';
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

    const zoneId = 999;
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
    try {
        const tx = await tradingProgram.methods
            .initializeZoneMarket(zoneId)
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
            throw e;
        }
    }
}

main().catch(console.error);
