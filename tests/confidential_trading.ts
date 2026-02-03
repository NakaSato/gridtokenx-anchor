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
    createMint,
    mintTo,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    setAuthority,
    AuthorityType
} from "@solana/spl-token";
import { assert } from "chai";
import type { Trading } from "../target/types/trading";

describe("Confidential Trading", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const authority = provider.wallet as anchor.Wallet;

    const userA = Keypair.generate();
    const userB = Keypair.generate();
    let energyMint: PublicKey;
    let userA_Token: PublicKey;
    let userB_Token: PublicKey;

    let userA_Confidential: PublicKey;
    let userB_Confidential: PublicKey;

    // Mock proofs and ciphertexts (u8; 64)
    const mockCiphertext = { ciphertext: Array(64).fill(0) };
    const mockRangeProof = { proof: Array(64).fill(0) };
    const mockTransferProof = { proof: Array(64).fill(0) };

    async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey) {
        const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
        const ix = createAssociatedTokenAccountInstruction(authority.publicKey, ata, owner, mint, programId);
        await anchor.web3.sendAndConfirmTransaction(provider.connection, new anchor.web3.Transaction().add(ix), [authority.payer]);
        return ata;
    }

    before(async () => {
        // Airdrops
        for (const kp of [userA, userB]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        // Create Energy Mint (Token 2022)
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);

        // ATAs
        userA_Token = await createATA(userA.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);
        userB_Token = await createATA(userB.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);

        // Derive Confidential Balance PDAs
        [userA_Confidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), userA.publicKey.toBuffer(), energyMint.toBuffer()],
            program.programId
        );
        [userB_Confidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), userB.publicKey.toBuffer(), energyMint.toBuffer()],
            program.programId
        );

        // Fund User A with some public energy BEFORE transferring authority
        await mintTo(provider.connection, authority.payer, energyMint, userA_Token, authority.payer, 1000, [], { skipPreflight: true }, TOKEN_2022_PROGRAM_ID);

        // Now Transfer mint authority to the program PDA for unshielding
        const [mintAuth] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority"), energyMint.toBuffer()],
            program.programId
        );
        await setAuthority(provider.connection, authority.payer, energyMint, authority.publicKey, AuthorityType.MintTokens, mintAuth, [], undefined, TOKEN_2022_PROGRAM_ID);
    });

    it("Initializes confidential balance accounts", async () => {
        await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: userA_Confidential,
            mint: energyMint,
            owner: userA.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([userA]).rpc();

        await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: userB_Confidential,
            mint: energyMint,
            owner: userB.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([userB]).rpc();

        const balanceA = await program.account.confidentialBalance.fetch(userA_Confidential);
        assert.ok(balanceA.owner.equals(userA.publicKey));
        assert.equal(balanceA.pendingAmount.toNumber(), 0);
    });

    it("Shields energy tokens (Public -> Confidential)", async () => {
        const amount = new BN(500);
        await program.methods.shieldEnergy(amount, mockCiphertext, mockRangeProof).accounts({
            confidentialBalance: userA_Confidential,
            mint: energyMint,
            userTokenAccount: userA_Token,
            owner: userA.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID
        } as any).signers([userA]).rpc();

        const tokenBalance = await provider.connection.getTokenAccountBalance(userA_Token);
        assert.equal(tokenBalance.value.amount, "500");

        const confidentialBalance = await program.account.confidentialBalance.fetch(userA_Confidential);
        assert.ok(confidentialBalance.lastUpdateSlot.gtn(0));
    });

    it("Executes a private transfer", async () => {
        const amount = new BN(200);
        await program.methods.privateTransfer(amount, mockCiphertext, mockTransferProof).accounts({
            senderBalance: userA_Confidential,
            receiverBalance: userB_Confidential,
            receiverOwner: userB.publicKey,
            mint: energyMint,
            owner: userA.publicKey
        } as any).signers([userA]).rpc();

        const balanceA = await program.account.confidentialBalance.fetch(userA_Confidential);
        const balanceB = await program.account.confidentialBalance.fetch(userB_Confidential);

        // Slot should be updated for both
        assert.ok(balanceA.lastUpdateSlot.gtn(0));
        assert.ok(balanceB.lastUpdateSlot.gtn(0));
    });

    it("Unshields energy tokens (Confidential -> Public)", async () => {
        const amount = new BN(100);
        const [mintAuth] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority"), energyMint.toBuffer()],
            program.programId
        );

        await program.methods.unshieldEnergy(amount, mockCiphertext, mockTransferProof).accounts({
            confidentialBalance: userB_Confidential,
            mint: energyMint,
            userTokenAccount: userB_Token,
            mintAuthority: mintAuth,
            owner: userB.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID
        } as any).signers([userB]).rpc();

        const tokenBalance = await provider.connection.getTokenAccountBalance(userB_Token);
        // User B had 0, now should have 100
        assert.equal(tokenBalance.value.amount, "100");
    });
});
