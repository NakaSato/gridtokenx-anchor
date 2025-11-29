import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { expect } from "chai";

// import { EnergyToken } from "../target/types/index.js";

// --- Test Utils ---
class TestUtils {
    static async createAssociatedTokenAccount(
        payer: anchor.web3.PublicKey,
        mint: anchor.web3.PublicKey,
        owner: anchor.web3.PublicKey,
        connection: anchor.web3.Connection,
        signer: anchor.web3.Keypair
    ): Promise<anchor.web3.PublicKey> {
        const associatedTokenAddress = await getAssociatedTokenAddress(
            mint,
            owner,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const accountInfo = await connection.getAccountInfo(associatedTokenAddress);
        if (accountInfo) {
            return associatedTokenAddress;
        }

        const instruction = createAssociatedTokenAccountInstruction(
            payer,
            associatedTokenAddress,
            owner,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const tx = new anchor.web3.Transaction().add(instruction);
        await anchor.web3.sendAndConfirmTransaction(connection, tx, [signer]);

        return associatedTokenAddress;
    }

    static async getTokenBalance(
        connection: anchor.web3.Connection,
        tokenAccount: anchor.web3.PublicKey
    ): Promise<number> {
        const accountInfo = await connection.getAccountInfo(tokenAccount);
        if (!accountInfo) return 0;
        const data = accountInfo.data;
        const amount = data.readBigUInt64LE(64);
        return Number(amount);
    }

    static findTokenInfoPda(programId: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
        return anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("token_info")],
            programId
        );
    }

    static findMintPda(programId: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
        return anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("mint")],
            programId
        );
    }
}

// --- Test Environment ---
class TestEnvironment {
    public provider: anchor.AnchorProvider;
    public connection: anchor.web3.Connection;
    public wallet: anchor.Wallet;
    public energyTokenProgram: Program<any>;
    public authority: anchor.web3.Keypair;
    public testUser: anchor.web3.Keypair;

    constructor() {
        this.provider = anchor.AnchorProvider.env();
        anchor.setProvider(this.provider);
        this.connection = this.provider.connection;
        this.wallet = this.provider.wallet as anchor.Wallet;
        this.energyTokenProgram = anchor.workspace.EnergyToken as Program<any>;
        this.authority = anchor.web3.Keypair.generate();
        this.testUser = anchor.web3.Keypair.generate();
    }

    static async create(): Promise<TestEnvironment> {
        const env = new TestEnvironment();
        await env.airdropSol(env.authority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
        await env.airdropSol(env.testUser.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
        return env;
    }

    public async airdropSol(publicKey: anchor.web3.PublicKey, amount: number): Promise<void> {
        const signature = await this.connection.requestAirdrop(publicKey, amount);
        await this.connection.confirmTransaction(signature);
    }
}

// --- Tests ---
const TEST_AMOUNTS = {
    ONE_TOKEN: 1_000_000_000,
    TRANSFER_AMOUNT: 500_000_000,
};

describe("Mint Transaction Flow Tests (Self-Contained)", () => {
    let env: TestEnvironment;
    let tokenInfoPda: anchor.web3.PublicKey;
    let mintPda: anchor.web3.PublicKey;
    let senderTokenAccount: anchor.web3.PublicKey;
    let recipientTokenAccount: anchor.web3.PublicKey;
    let recipientUser: anchor.web3.Keypair;

    before(async () => {
        env = await TestEnvironment.create();
        recipientUser = anchor.web3.Keypair.generate();
        await env.airdropSol(recipientUser.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

        [tokenInfoPda] = TestUtils.findTokenInfoPda(env.energyTokenProgram.programId);
        [mintPda] = TestUtils.findMintPda(env.energyTokenProgram.programId);
    });

    it("should initialize token program and mint", async () => {
        try {
            await env.energyTokenProgram.methods
                .initialize()
                .accounts({
                    authority: env.authority.publicKey,
                })
                .signers([env.authority])
                .rpc();
        } catch (e) {
            // Ignore
        }

        try {
            await env.energyTokenProgram.methods
                .initializeToken()
                .accounts({
                    // @ts-ignore
                    tokenInfo: tokenInfoPda,
                    mint: mintPda,
                    authority: env.authority.publicKey,
                })
                .signers([env.authority])
                .rpc();
        } catch (e) {
            // Ignore
        }
    });

    it("should create sender and recipient token accounts", async () => {
        senderTokenAccount = await TestUtils.createAssociatedTokenAccount(
            env.authority.publicKey,
            mintPda,
            env.testUser.publicKey,
            env.connection,
            env.authority
        );

        recipientTokenAccount = await TestUtils.createAssociatedTokenAccount(
            env.authority.publicKey,
            mintPda,
            recipientUser.publicKey,
            env.connection,
            env.authority
        );
    });

    it("should mint tokens to sender", async () => {
        const mintAmount = TEST_AMOUNTS.ONE_TOKEN;

        const tx = await env.energyTokenProgram.methods
            .mintToWallet(new BN(mintAmount))
            .accounts({
                mint: mintPda,
                // @ts-ignore
                tokenInfo: tokenInfoPda,
                // @ts-ignore
                destination: senderTokenAccount,
                destinationOwner: env.testUser.publicKey,
                authority: env.authority.publicKey,
                payer: env.wallet.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([env.authority])
            .rpc();

        // Verify balance
        const balance = await TestUtils.getTokenBalance(env.connection, senderTokenAccount);
        if (balance !== mintAmount) throw new Error(`Expected balance ${mintAmount}, got ${balance}`);
    });

    it("should transfer tokens from sender to recipient", async () => {
        const transferAmount = TEST_AMOUNTS.TRANSFER_AMOUNT;
        const initialSenderBalance = await TestUtils.getTokenBalance(env.connection, senderTokenAccount);
        const initialRecipientBalance = await TestUtils.getTokenBalance(env.connection, recipientTokenAccount);

        const tx = await env.energyTokenProgram.methods
            .transferTokens(new BN(transferAmount))
            .accounts({
                fromTokenAccount: senderTokenAccount,
                toTokenAccount: recipientTokenAccount,
                fromAuthority: env.testUser.publicKey,

            })
            .signers([env.testUser])
            .rpc();

        // Verify balances
        const finalSenderBalance = await TestUtils.getTokenBalance(env.connection, senderTokenAccount);
        const finalRecipientBalance = await TestUtils.getTokenBalance(env.connection, recipientTokenAccount);

        if (finalSenderBalance !== initialSenderBalance - transferAmount) throw new Error(`Sender balance mismatch`);
        if (finalRecipientBalance !== initialRecipientBalance + transferAmount) throw new Error(`Recipient balance mismatch`);
    });

    it("should burn tokens from recipient", async () => {
        const burnAmount = TEST_AMOUNTS.TRANSFER_AMOUNT;
        const initialRecipientBalance = await TestUtils.getTokenBalance(env.connection, recipientTokenAccount);

        const tx = await env.energyTokenProgram.methods
            .burnTokens(new BN(burnAmount))
            .accounts({
                tokenInfo: tokenInfoPda,
                mint: mintPda,
                tokenAccount: recipientTokenAccount,
                authority: recipientUser.publicKey,

            })
            .signers([recipientUser])
            .rpc();

        // Verify balance
        const finalRecipientBalance = await TestUtils.getTokenBalance(env.connection, recipientTokenAccount);
        if (finalRecipientBalance !== initialRecipientBalance - burnAmount) throw new Error(`Burn failed`);
    });
});
