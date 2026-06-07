// Mint GRID (energy-token, Token-2022) to one or more wallet owners.
//
// The energy-token mint authority is a program PDA (`token_info_2022`), so GRID
// can only be minted through the program's `mint_to_wallet` instruction — the
// caller must sign as the configured admin `authority` (the dev/platform wallet).
//
// Usage:
//   ANCHOR_PROVIDER_URL=http://localhost:8899 \
//   ANCHOR_WALLET=../dev-wallet.json \
//   npx tsx scripts/mint-to-owners.ts <amountGRID> <owner1> [owner2 ...]
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { EnergyToken } from "../target/types/energy_token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import BN from "bn.js";

async function main() {
    const [, , amountArg, ...owners] = process.argv;
    if (!amountArg || owners.length === 0) {
        console.error("usage: mint-to-owners.ts <amountGRID> <owner1> [owner2 ...]");
        process.exit(2);
    }
    const amount = new BN(Math.round(Number(amountArg) * 1e9)); // 9 decimals

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
    const payer = (provider.wallet as any).payer;

    const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyTokenProgram.programId);
    const [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyTokenProgram.programId);

    console.log(`mint=${mintPda.toBase58()} authority=${payer.publicKey.toBase58()}`);

    for (const ownerStr of owners) {
        const owner = new PublicKey(ownerStr);
        const ata = await getOrCreateAssociatedTokenAccount(
            provider.connection, payer, mintPda, owner, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
        );
        const tx = await energyTokenProgram.methods
            .mintToWallet(amount)
            .accounts({
                mint: mintPda,
                tokenInfo: tokenInfoPda,
                destination: ata.address,
                destinationOwner: owner,
                authority: payer.publicKey,
                payer: payer.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            } as any)
            .rpc();
        console.log(`✅ minted ${amountArg} GRID to ${owner.toBase58()}  ata=${ata.address.toBase58()}  tx=${tx}`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
