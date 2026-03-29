import * as anchor from '@coral-xyz/anchor';
import { 
    PublicKey, 
    AddressLookupTableProgram, 
    TransactionMessage, 
    VersionedTransaction,
    SystemProgram
} from '@solana/web3.js';

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgramId = new PublicKey('5yakTtiNHXHonCPqkwh1M22jujqugCJhEkYaHAoaB6pG');
    const govProgramId = new PublicKey('DksRNiZsEZ3zN8n8ZWfukFqi3z74e5865oZ8wFk38p4X');
    const payer = provider.wallet;

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  GridTokenX ALT Setup');
    console.log('═══════════════════════════════════════════════════════════════');

    const slot = await provider.connection.getSlot();

    // 1. Create Lookup Table
    const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
        authority: payer.publicKey,
        payer: payer.publicKey,
        recentSlot: slot - 1, // Subtract 1 for stability in fast localnet
    });

    console.log("Creating Address Lookup Table:", lookupTableAddress.toBase58());

    const createTx = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: (await provider.connection.getLatestBlockhash()).blockhash,
        instructions: [lookupTableInst],
    }).compileToV0Message();

    const tx = new VersionedTransaction(createTx);
    await provider.wallet.signTransaction(tx);
    const txid = await provider.connection.sendTransaction(tx);
    await provider.connection.confirmTransaction(txid);
    
    console.log("✅ Lookup Table Created.");

    // 2. Derive common PDAs to add to ALT
    const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from('market')], tradingProgramId);
    const zoneId = 999;
    const [zoneMarketPda] = PublicKey.findProgramAddressSync([
        Buffer.from('zone_market'), 
        marketPda.toBuffer(), 
        (() => { let b = Buffer.alloc(4); b.writeUInt32LE(zoneId); return b; })()
    ], tradingProgramId);

    const addresses = [
        tradingProgramId,
        govProgramId,
        marketPda,
        zoneMarketPda,
        SystemProgram.programId,
        new PublicKey('DksRNiZsEZ3zN8n8ZWfukFqi3z74e5865oZ8wFk38p4X'), // Gov again
        // Add all 10 shards
    ];

    for (let i = 0; i < 10; i++) {
        const [shardPda] = PublicKey.findProgramAddressSync([
            Buffer.from('zone_shard'), 
            zoneMarketPda.toBuffer(), 
            Buffer.from([i])
        ], tradingProgramId);
        addresses.push(shardPda);
    }

    const [poaConfigPda] = PublicKey.findProgramAddressSync([Buffer.from('poa_config')], govProgramId);
    addresses.push(poaConfigPda);

    console.log(`Adding ${addresses.length} addresses to lookup table...`);

    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable: lookupTableAddress,
        addresses: addresses,
    });

    const extendTxMessage = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: (await provider.connection.getLatestBlockhash()).blockhash,
        instructions: [extendInstruction],
    }).compileToV0Message();

    const extendTx = new VersionedTransaction(extendTxMessage);
    await provider.wallet.signTransaction(extendTx);
    const extendTxid = await provider.connection.sendTransaction(extendTx);
    await provider.connection.confirmTransaction(extendTxid);

    console.log("✅ Addresses added to ALT.");
    console.log("\n🚀 ALT ADDRESS (COPY THIS TO RUST DRIVER):", lookupTableAddress.toBase58());
}

main().catch(console.error);
