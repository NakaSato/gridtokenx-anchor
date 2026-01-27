import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
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

    const [mintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint")],
        programId
    );

    console.log("🚀 Triggering GridTokensMinted events...");

    for (let i = 0; i < 5; i++) {
        const recipient = Keypair.generate().publicKey;
        const amount = new BN(Math.floor(Math.random() * 1000 + 1) * 1e9);

        const destination = anchor.utils.token.associatedAddress({
            mint: mintPda,
            owner: recipient,
        });

        try {
            const tx = await program.methods
                .mintToWallet(amount)
                .accounts({
                    mint: mintPda,
                    destination,
                    destinationOwner: recipient,
                    authority: authority.publicKey,
                    payer: provider.wallet.publicKey,
                    tokenProgram: TOKEN_2022_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            console.log(`✅ Minted ${amount.div(new BN(1e9)).toString()} kWh to ${recipient.toBase58().slice(0, 8)}... (Tx: ${tx.slice(0, 8)}...)`);
        } catch (e: any) {
            console.error(`❌ Error minting: ${e.message}`);
        }

        // Smooth delivery
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log("🎉 Event triggering complete!");
}

main().catch(console.error);
