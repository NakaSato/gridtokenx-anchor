import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import fs from "fs";
import BN from "bn.js";
import energyTokenIdl from "../dashboard/src/idl/energy_token.json" assert { type: "json" };

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const programId = new PublicKey(energyTokenIdl.address);
    // @ts-ignore
    const program = new Program(energyTokenIdl, provider);

    const walletPath = "./scripts/poa-cluster/genesis/faucet-keypair.json";
    const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
    const authority = Keypair.fromSecretKey(new Uint8Array(walletData));

    // The mint PDA used in the cluster (as confirmed by solana account)
    const mintPda = new PublicKey("8Tv7USkjpr8LZSXQCspVsJ4swN6ZWSkyMwpPPnYrb4R4");

    console.log(`🚀 Triggering Live Events on Mint: ${mintPda.toBase58()}...`);

    // Use the faucet as the recipient
    const recipient = authority.publicKey;
    const destination = getAssociatedTokenAddressSync(
        mintPda,
        recipient,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    for (let i = 0; i < 5; i++) {
        const amount = new BN(Math.floor(Math.random() * 1000 + 1)).mul(new BN(1e9));

        try {
            const tx = await program.methods
                .mintToWallet(amount)
                .accounts({
                    mint: mintPda,
                    destination,
                    destinationOwner: recipient,
                    authority: authority.publicKey,
                    payer: provider.wallet.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            console.log(`✅ [${i + 1}/5] Minted ${amount.div(new BN(1e9)).toString()} kWh. (Tx: ${tx.slice(0, 8)}...)`);
        } catch (e: any) {
            if (e.message.includes("AccountNotInitialized")) {
                console.log("   ⚡ Initializing Faucet ATA first (manual construction)...");
                // If AToken program fails via RPC, we might still hit issues if the PoA cluster treats it specially
                const ataIx = createAssociatedTokenAccountInstruction(
                    provider.wallet.publicKey,
                    destination,
                    recipient,
                    mintPda,
                    TOKEN_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                );
                const tx = new anchor.web3.Transaction().add(ataIx);
                await provider.sendAndConfirm(tx, [authority]);
                console.log("   ✅ ATA Created");
                i--;
            } else {
                console.error(`❌ Error: ${e.message}`);
            }
        }

        await new Promise(r => setTimeout(r, 2000));
    }

    console.log("🎉 Live Event Stream test complete!");
}

main().catch(console.error);
