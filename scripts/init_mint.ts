import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import fs from 'fs';

async function main() {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.EnergyToken;

    console.log("Program ID:", program.programId.toString());

    const [mintPda, mintBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint")],
        program.programId
    );

    const [tokenInfoPda, tokenInfoBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_info")],
        program.programId
    );

    console.log("Mint PDA:", mintPda.toString());
    console.log("Token Info PDA:", tokenInfoPda.toString());

    try {
        const tx = await program.methods.initializeToken()
            .accounts({
                authority: provider.wallet.publicKey,
                mint: mintPda,
                tokenInfo: tokenInfoPda,
                tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        console.log("Mint initialized! Tx:", tx);
    } catch (e) {
        console.error("Error initializing mint:", e);
    }
}

main().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
