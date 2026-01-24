/**
 * Privacy/ZK Transaction Test Scenarios
 * 
 * Tests confidential trading features including shielding, 
 * private transfers, and unshielding with ZK proofs.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, AuthorityType } from "@solana/spl-token";
import KeypairManager from "../keypair-manager.js";
import { TransactionReporter, StateValidator } from "../utils/index.js";
import BN from "bn.js";

// Helper to create 32-byte buffers
const create32ByteBuffer = (val: number = 0) => {
    const buf = Buffer.alloc(32);
    buf.fill(val);
    return [...buf];
};

// Helper for dummy commitment
const createDummyCommitment = () => ({
    point: create32ByteBuffer(1)
});

// Helper for dummy range proof
const createDummyRangeProof = () => ({
    proofData: create32ByteBuffer(2),
    commitment: createDummyCommitment()
});

// Helper for dummy equality proof
const createDummyEqualityProof = () => ({
    challenge: create32ByteBuffer(3),
    response: create32ByteBuffer(4)
});

// Helper for dummy transfer proof
const createDummyTransferProof = () => ({
    amountCommitment: createDummyCommitment(),
    amountRangeProof: createDummyRangeProof(),
    remainingRangeProof: createDummyRangeProof(),
    balanceProof: createDummyEqualityProof()
});

export class PrivacyScenarios {
    private program: anchor.Program;
    private keypairManager: KeypairManager;
    private reporter: TransactionReporter;
    private validator: StateValidator;

    // Test state
    private testMint: PublicKey | null = null;
    private senderTokenAccount: PublicKey | null = null;
    private recipientTokenAccount: PublicKey | null = null;
    private senderPrivateBalancePda: PublicKey | null = null;
    private recipientPrivateBalancePda: PublicKey | null = null;
    private nullifierSetPda: PublicKey | null = null;

    constructor(
        program: anchor.Program,
        keypairManager: KeypairManager,
        reporter: TransactionReporter,
        validator: StateValidator
    ) {
        this.program = program;
        this.keypairManager = keypairManager;
        this.reporter = reporter;
        this.validator = validator;
    }

    async runAllScenarios(): Promise<void> {
        await this.setupEnvironment();
        await this.testInitializeNullifierSet();
        await this.testInitializePrivateBalance();
        await this.testShieldTokens();
        await this.testPrivateTransfer();
        await this.testUnshieldTokens();
    }

    async setupEnvironment(): Promise<void> {
        console.log("    Setting up privacy test environment...");
        const authority = this.keypairManager.getDevWallet();

        // Create a testing mint
        this.testMint = await createMint(
            this.program.provider.connection,
            authority,
            authority.publicKey,
            null,
            6
        );

        // Setup sender token account with funds
        const sender = this.keypairManager.getKeypair("wallet-1");
        const senderTa = await getOrCreateAssociatedTokenAccount(
            this.program.provider.connection,
            authority,
            this.testMint,
            sender.publicKey
        );
        this.senderTokenAccount = senderTa.address;

        // Mint 1000 tokens to sender
        await mintTo(
            this.program.provider.connection,
            authority,
            this.testMint,
            this.senderTokenAccount,
            authority,
            1000_000000
        );

        // Transfer mint authority to PDA for Unshield functionality
        const [mintAuthPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority"), this.testMint.toBuffer()],
            this.program.programId
        );

        await setAuthority(
            this.program.provider.connection,
            authority,
            this.testMint,
            authority,
            AuthorityType.MintTokens,
            mintAuthPda
        );
        console.log(`    Mint authority transferred to PDA: ${mintAuthPda.toString()}`);

        // Setup recipient token account
        const recipient = this.keypairManager.getKeypair("wallet-2");
        const recipientTa = await getOrCreateAssociatedTokenAccount(
            this.program.provider.connection,
            authority,
            this.testMint,
            recipient.publicKey
        );
        this.recipientTokenAccount = recipientTa.address;

        console.log(`    Mint created: ${this.testMint.toString()}`);
    }

    async testInitializeNullifierSet(): Promise<void> {
        this.reporter.startScenario("Initialize Nullifier Set", "Privacy");
        const authority = this.keypairManager.getDevWallet();
        const startTime = Date.now();

        try {
            if (!this.testMint) throw new Error("Mint not initialized");

            const [pda] = PublicKey.findProgramAddressSync(
                [Buffer.from("nullifier_set"), this.testMint.toBuffer()],
                this.program.programId
            );
            this.nullifierSetPda = pda;

            const signature = await this.program.methods
                .initializeNullifierSet()
                .accounts({
                    nullifierSet: pda,
                    mint: this.testMint,
                    authority: authority.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([authority])
                .rpc();

            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "initializeNullifierSet",
                keypair: "dev-wallet",
                signature,
                success: true,
                duration: Date.now() - startTime,
                timestamp: startTime,
            });
        } catch (error: any) {
            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "initializeNullifierSet",
                keypair: "dev-wallet",
                success: false,
                duration: Date.now() - startTime,
                timestamp: startTime,
                error: error.message,
            });
        }
        this.reporter.endScenario();
    }

    async testInitializePrivateBalance(): Promise<void> {
        this.reporter.startScenario("Initialize Private Balance", "Privacy");
        const startTime = Date.now();

        // Test for Sender
        const sender = this.keypairManager.getKeypair("wallet-1");
        try {
            if (!this.testMint) throw new Error("Mint not initialized");

            const [pda] = PublicKey.findProgramAddressSync(
                [Buffer.from("private_balance"), sender.publicKey.toBuffer(), this.testMint.toBuffer()],
                this.program.programId
            );
            this.senderPrivateBalancePda = pda;

            const initialCommitment = createDummyCommitment();
            const encryptedBalance = create32ByteBuffer();
            const encryptionNonce = [...Buffer.alloc(24)];

            const signature = await this.program.methods
                .initializePrivateBalance(
                    initialCommitment,
                    encryptedBalance,
                    encryptionNonce
                )
                .accounts({
                    privateBalance: pda,
                    mint: this.testMint,
                    owner: sender.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([sender])
                .rpc();

            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "initPrivateBalance (Sender)",
                keypair: "wallet-1",
                signature,
                success: true,
                duration: Date.now() - startTime,
                timestamp: startTime,
            });
        } catch (error: any) {
            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "initPrivateBalance (Sender)",
                keypair: "wallet-1",
                success: false,
                duration: Date.now() - startTime,
                timestamp: startTime,
                error: error.message,
            });
        }

        // Test for Recipient
        const recipient = this.keypairManager.getKeypair("wallet-2");
        try {
            if (!this.testMint) throw new Error("Mint not initialized");

            const [pda] = PublicKey.findProgramAddressSync(
                [Buffer.from("private_balance"), recipient.publicKey.toBuffer(), this.testMint.toBuffer()],
                this.program.programId
            );
            this.recipientPrivateBalancePda = pda;

            const initialCommitment = createDummyCommitment();
            const encryptedBalance = create32ByteBuffer();
            const encryptionNonce = [...Buffer.alloc(24)];

            const signature = await this.program.methods
                .initializePrivateBalance(
                    initialCommitment,
                    encryptedBalance,
                    encryptionNonce
                )
                .accounts({
                    privateBalance: pda,
                    mint: this.testMint,
                    owner: recipient.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([recipient])
                .rpc();

            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "initPrivateBalance (Recipient)",
                keypair: "wallet-2",
                signature,
                success: true,
                duration: Date.now() - startTime, // Accumulative, strictly
                timestamp: startTime,
            });

        } catch (error: any) {
            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "initPrivateBalance (Recipient)",
                keypair: "wallet-2",
                success: false,
                duration: Date.now() - startTime,
                timestamp: startTime,
                error: error.message,
            });
        }

        this.reporter.endScenario();
    }

    async testShieldTokens(): Promise<void> {
        this.reporter.startScenario("Shield Tokens", "Privacy");
        const sender = this.keypairManager.getKeypair("wallet-1");
        const startTime = Date.now();

        try {
            if (!this.senderPrivateBalancePda || !this.testMint || !this.senderTokenAccount) {
                throw new Error("Setup incomplete");
            }

            const amount = new BN(100_000000); // 100 tokens
            const newCommitment = createDummyCommitment();
            const blindingFactor = create32ByteBuffer(5);
            const rangeProof = createDummyRangeProof();

            const signature = await this.program.methods
                .shieldTokens(
                    amount,
                    newCommitment,
                    blindingFactor,
                    rangeProof
                )
                .accounts({
                    privateBalance: this.senderPrivateBalancePda,
                    mint: this.testMint,
                    userTokenAccount: this.senderTokenAccount,
                    owner: sender.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([sender])
                .rpc();

            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "shieldTokens",
                keypair: "wallet-1",
                signature,
                success: true,
                duration: Date.now() - startTime,
                timestamp: startTime,
            });
        } catch (error: any) {
            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "shieldTokens",
                keypair: "wallet-1",
                success: false,
                duration: Date.now() - startTime,
                timestamp: startTime,
                error: error.message,
            });
        }
        this.reporter.endScenario();
    }

    async testPrivateTransfer(): Promise<void> {
        this.reporter.startScenario("Private Transfer", "Privacy");
        const sender = this.keypairManager.getKeypair("wallet-1");
        const recipient = this.keypairManager.getKeypair("wallet-2");
        const startTime = Date.now();

        try {
            if (!this.senderPrivateBalancePda || !this.recipientPrivateBalancePda || !this.nullifierSetPda) {
                throw new Error("Setup incomplete");
            }

            const senderNewCommitment = createDummyCommitment();
            const recipientNewCommitment = createDummyCommitment();
            const transferProof = createDummyTransferProof();
            const nullifier = create32ByteBuffer(Math.floor(Math.random() * 255)); // Random nullifier

            // Create transfer record PDA
            const transferRecordKeypair = Keypair.generate();

            const signature = await this.program.methods
                .privateTransfer(
                    senderNewCommitment,
                    recipientNewCommitment,
                    transferProof,
                    nullifier
                )
                .accounts({
                    senderBalance: this.senderPrivateBalancePda,
                    recipientBalance: this.recipientPrivateBalancePda,
                    nullifierSet: this.nullifierSetPda,
                    transferRecord: transferRecordKeypair.publicKey,
                    sender: sender.publicKey,
                    owner: sender.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([sender, transferRecordKeypair])
                .rpc();

            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "privateTransfer",
                keypair: "wallet-1",
                signature,
                success: true,
                duration: Date.now() - startTime,
                timestamp: startTime,
            });

        } catch (error: any) {
            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "privateTransfer",
                keypair: "wallet-1",
                success: false,
                duration: Date.now() - startTime,
                timestamp: startTime,
                error: error.message,
            });
        }
        this.reporter.endScenario();
    }

    async testUnshieldTokens(): Promise<void> {
        this.reporter.startScenario("Unshield Tokens", "Privacy");
        const sender = this.keypairManager.getKeypair("wallet-1");
        const startTime = Date.now();

        try {
            if (!this.senderPrivateBalancePda || !this.testMint || !this.senderTokenAccount || !this.nullifierSetPda) {
                throw new Error("Setup incomplete");
            }

            const amount = new BN(50_000000); // 50 tokens
            const newCommitment = createDummyCommitment();
            const transferProof = createDummyTransferProof();
            const nullifier = create32ByteBuffer(Math.floor(Math.random() * 255)); // New random nullifier

            // Find mint authority PDA
            const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("mint_authority"), this.testMint.toBuffer()],
                this.program.programId
            );

            const signature = await this.program.methods
                .unshieldTokens(
                    amount,
                    newCommitment,
                    transferProof,
                    nullifier
                )
                .accounts({
                    privateBalance: this.senderPrivateBalancePda,
                    nullifierSet: this.nullifierSetPda,
                    mint: this.testMint,
                    userTokenAccount: this.senderTokenAccount,
                    mintAuthority: mintAuthorityPda,
                    owner: sender.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([sender])
                .rpc();

            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "unshieldTokens",
                keypair: "wallet-1",
                signature,
                success: true,
                duration: Date.now() - startTime,
                timestamp: startTime,
            });
        } catch (error: any) {
            this.reporter.recordTransaction({
                program: "Privacy",
                operation: "unshieldTokens",
                keypair: "wallet-1",
                success: false,
                duration: Date.now() - startTime,
                timestamp: startTime,
                error: error.message,
            });
        }
        this.reporter.endScenario();
    }
}
