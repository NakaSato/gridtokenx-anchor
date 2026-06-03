import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgram = anchor.workspace.Trading;
    const authority = provider.wallet;

    console.log('Program ID:', tradingProgram.programId.toBase58());
    console.log('Available instructions:', Object.keys(tradingProgram.methods));

    const zoneId = 1;
    const incentiveMultiplierBps = new anchor.BN(15000); // 1.5x

    const discriminator = anchor.BorshInstructionCoder.forInstruction(
        'initializeZoneConfig',
        { initializeZoneConfig: { zoneId, incentiveMultiplierBps } }
    );
    console.log('Instruction discriminator (hex):', discriminator.slice(0, 8).toString('hex'));

    const [zoneConfigPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('zone_config'),
            (() => {
                const buf = Buffer.alloc(4);
                buf.writeUInt32LE(zoneId);
                return buf;
            })(),
        ],
        tradingProgram.programId
    );

    console.log(`Initializing Zone Config for zone ${zoneId}...`);
    console.log(`Zone Config PDA: ${zoneConfigPda.toBase58()}`);
    
    try {
        const tx = await tradingProgram.methods
            .initializeZoneConfig(zoneId, incentiveMultiplierBps)
            .accounts({
                zoneConfig: zoneConfigPda,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log('✅ Zone Config initialized:', tx);
    } catch (e: any) {
        if (e.message.includes('already in use')) {
            console.log('ℹ️  Zone Config already initialized.');
        } else {
            console.error('❌ Error initializing zone config:', e);
            throw e;
        }
    }
}

main().catch(console.error);
