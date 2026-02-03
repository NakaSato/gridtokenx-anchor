import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { assert } from "chai";
import type { EnergyToken } from "../target/types/energy_token";

describe("Energy Token Program", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.EnergyToken as Program<EnergyToken>;
    const authority = provider.wallet as anchor.Wallet;

    const user = Keypair.generate();
    const registryProgramId = (anchor.workspace.Registry as Program).programId;

    let tokenInfo: PublicKey;
    let mint: PublicKey;
    let userTokenAccount: PublicKey;

    before(async () => {
        [tokenInfo] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], program.programId);
        [mint] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], program.programId);

        // Airdrop
        const sig = await provider.connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
        const latest = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({ signature: sig, ...latest });

        userTokenAccount = getAssociatedTokenAddressSync(mint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
    });

    it("Initializes the token program", async () => {
        try {
            await program.methods.initializeToken(registryProgramId).accounts({
                tokenInfo: tokenInfo,
                mint: mint,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY
            }).rpc();

            const info = await program.account.tokenInfo.fetch(tokenInfo);
            assert.ok(info.authority.equals(authority.publicKey));
            assert.ok(info.mint.equals(mint));
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                console.log("Token program already initialized");
            } else {
                throw e;
            }
        }
    });

    it("Creates user token account", async () => {
        const ix = createAssociatedTokenAccountInstruction(
            authority.publicKey,
            userTokenAccount,
            user.publicKey,
            mint,
            TOKEN_2022_PROGRAM_ID
        );
        await anchor.web3.sendAndConfirmTransaction(provider.connection, new anchor.web3.Transaction().add(ix), [authority.payer]);
    });

    it("Mints to wallet (admin only)", async () => {
        await program.methods.mintToWallet(new BN(1000)).accounts({
            mint: mint,
            tokenInfo: tokenInfo,
            destination: userTokenAccount,
            destinationOwner: user.publicKey,
            authority: authority.publicKey,
            payer: authority.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId
        }).rpc();

        const balance = await provider.connection.getTokenAccountBalance(userTokenAccount);
        assert.equal(balance.value.amount, "1000");
    });

    it("Adds a REC validator", async () => {
        const validator = Keypair.generate().publicKey;
        await program.methods.addRecValidator(validator, "Test Authority").accounts({
            tokenInfo: tokenInfo,
            authority: authority.publicKey
        }).rpc();

        const info = await program.account.tokenInfo.fetch(tokenInfo);
        assert.isAtLeast(info.recValidatorsCount, 1);
        assert.ok(info.recValidators[0].equals(validator));
    });

    it("Transfers tokens", async () => {
        const otherUser = Keypair.generate().publicKey;
        const otherTokenAccount = getAssociatedTokenAddressSync(mint, otherUser, false, TOKEN_2022_PROGRAM_ID);

        // Create other user account
        const ix = createAssociatedTokenAccountInstruction(
            authority.publicKey,
            otherTokenAccount,
            otherUser,
            mint,
            TOKEN_2022_PROGRAM_ID
        );
        await anchor.web3.sendAndConfirmTransaction(provider.connection, new anchor.web3.Transaction().add(ix), [authority.payer]);

        await program.methods.transferTokens(new BN(500)).accounts({
            fromTokenAccount: userTokenAccount,
            toTokenAccount: otherTokenAccount,
            mint: mint,
            fromAuthority: user.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID
        }).signers([user]).rpc();

        const balance = await provider.connection.getTokenAccountBalance(otherTokenAccount);
        assert.equal(balance.value.amount, "500");
    });

    it("Burns tokens", async () => {
        await program.methods.burnTokens(new BN(100)).accounts({
            tokenInfo: tokenInfo,
            mint: mint,
            tokenAccount: userTokenAccount,
            authority: user.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID
        }).signers([user]).rpc();

        const balance = await provider.connection.getTokenAccountBalance(userTokenAccount);
        assert.equal(balance.value.amount, "400"); // 1000 - 500 - 100
    });
});
