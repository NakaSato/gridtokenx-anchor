import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { EnergyToken } from "../target/types/energy_token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
    const payer = (provider.wallet as any).payer;

    const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyTokenProgram.programId);
    const [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyTokenProgram.programId);

    // Use test-api-gateway or test-wallet-prosumer as recipient if available
    let destinationOwner = payer.publicKey;
    try {
        const prosumerKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-prosumer.json", "utf8"))));
        destinationOwner = prosumerKey.publicKey;
    } catch (e) {
        console.log("No test-wallet-prosumer.json found, minting to payer.");
    }

    const amount = new BN(100_000_000_000); // 100 GRX

    console.log(`Minting ${amount.toNumber() / 1e9} GRX to ${destinationOwner.toBase58()}...`);

    const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        mintPda,
        destinationOwner,
        false,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
    );

    const tx = await energyTokenProgram.methods
        .mintToWallet(amount)
        .accounts({
            mint: mintPda,
            tokenInfo: tokenInfoPda,
            destination: ata.address,
            destinationOwner: destinationOwner,
            authority: payer.publicKey,
            payer: payer.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

    console.log(`✅ Minted tokens successfully! Tx Signature: ${tx}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
