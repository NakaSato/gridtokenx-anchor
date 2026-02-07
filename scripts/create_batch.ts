import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgram = anchor.workspace.Trading;
    const authority = provider.wallet;

    const BATCH_ID = new BN(Date.now());
    const AUCTION_DURATION = 3600; // 1 hour for testing

    const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        tradingProgram.programId
    );

    const [batchPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("auction"), marketPda.toBuffer(), BATCH_ID.toArrayLike(Buffer, "le", 8)],
        tradingProgram.programId
    );

    console.log(`🚀 Creating auction batch: ${BATCH_ID.toString()}`);
    console.log(`Batch PDA: ${batchPda.toBase58()}`);

    await tradingProgram.methods.initializeAuction(BATCH_ID, new BN(AUCTION_DURATION)).accounts({
        batch: batchPda,
        market: marketPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
    }).rpc();

    console.log(`✅ Batch created successfuly!`);
    console.log(`BATCH_ID=${BATCH_ID.toString()}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
