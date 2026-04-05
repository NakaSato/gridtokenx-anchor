import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';

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
            new BN(zoneId).toArrayLike(Buffer, 'le', 4)
        ],
        tradingProgram.programId
    );

    console.log('Authority:', authority.publicKey.toBase58());
    console.log('Market PDA:', marketPda.toBase58());
    console.log('Zone 1 PDA:', zoneMarketPda.toBase58());

    try {
        const tx = await tradingProgram.methods
            .initializeZoneMarket(zoneId, 1)
            .accounts({
                market: marketPda,
                zoneMarket: zoneMarketPda,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log('✅ Zone 1 Market initialized:', tx);
    } catch (e: any) {
        console.error('❌ Error:', e.message);
        if (e.logs) {
            console.log('Logs:', e.logs);
        }
    }
}

main().catch(console.error);
