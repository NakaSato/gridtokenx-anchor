import { createHash } from "crypto";
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
import * as zk from "./utils/zk-proofs";

const ZK_TOKEN_PROOF_PROGRAM_ID = new PublicKey("ZkTokenProof1111111111111111111111111111111");

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

    // Helpers for mocks
    function sha256(data: Buffer[]): Buffer {
        const hash = createHash("sha256");
        data.forEach(d => hash.update(d));
        return hash.digest();
    }

    // Mock ciphertexts: WrappedElGamalCiphertext { inner: [u8; 64] }
    const mockCiphertext = {
        data: Buffer.alloc(64, 0)
    };

    // Placeholder for real proofs generated via WASM
    let rangeProof: zk.RangeProofResult;
    let transferProof: zk.TransferProofResult;

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
        assert.equal(balanceA.pendingCredits.toNumber(), 0);
    });

    it("Shields energy tokens (Public -> Confidential)", async () => {
        const amount = new BN(500);
        const blinding = zk.generateValidBlinding();
        rangeProof = zk.createRangeProof(BigInt(amount.toNumber()), blinding);

        await program.methods.shieldEnergy(amount, { data: [...mockCiphertext.data] }, rangeProof).accounts({
            confidentialBalance: userA_Confidential,
            mint: energyMint,
            userTokenAccount: userA_Token,
            owner: userA.publicKey,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
            tokenProgram: TOKEN_2022_PROGRAM_ID
        } as any).signers([userA]).rpc();

        const tokenBalance = await provider.connection.getTokenAccountBalance(userA_Token);
        assert.equal(tokenBalance.value.amount, "500");

        const confidentialBalance = await program.account.confidentialBalance.fetch(userA_Confidential);
        assert.ok(confidentialBalance.lastUpdateSlot.gtn(0));
    });

    it("Executes a private transfer", async () => {
        const amount = new BN(200);
        const senderBlinding = zk.generateValidBlinding();
        const amountBlinding = zk.generateValidBlinding();

        transferProof = zk.createTransferProof(
            BigInt(amount.toNumber()),
            BigInt(500), // senderBalance (from shield)
            senderBlinding,
            amountBlinding
        );

        await program.methods.privateTransfer(amount, { data: [...mockCiphertext.data] }, {
            amountCommitment: transferProof.amountCommitment,
            proof: transferProof.proof
        }).accounts({
            senderBalance: userA_Confidential,
            receiverBalance: userB_Confidential,
            receiverOwner: userB.publicKey,
            mint: energyMint,
            owner: userA.publicKey,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID
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

        const senderBlinding = zk.generateValidBlinding();
        const amountBlinding = zk.generateValidBlinding();

        transferProof = zk.createTransferProof(
            BigInt(amount.toNumber()),
            BigInt(200), // userB's balance from previous transfer
            senderBlinding,
            amountBlinding
        );

        await program.methods.unshieldEnergy(amount, { data: [...mockCiphertext.data] }, {
            amountCommitment: transferProof.amountCommitment,
            proof: transferProof.proof
        }).accounts({
            confidentialBalance: userB_Confidential,
            mint: energyMint,
            userTokenAccount: userB_Token,
            mintAuthority: mintAuth,
            owner: userB.publicKey,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
            tokenProgram: TOKEN_2022_PROGRAM_ID
        } as any).signers([userB]).rpc();

        const tokenBalance = await provider.connection.getTokenAccountBalance(userB_Token);
        // User B had 0, now should have 100
        assert.equal(tokenBalance.value.amount, "100");
    });

    it("Executes batch confidential settlement (3 settlements)", async () => {
        // Prepare 3 settlement items with real proofs
        const settlements = [];
        const amounts = [100, 50, 150];
        let currentSenderBalance = 300; // userA's remaining balance after transfer (500 - 200)

        for (const amt of amounts) {
            const senderBlinding = zk.generateValidBlinding();
            const amountBlinding = zk.generateValidBlinding();

            const proofData = zk.createTransferProof(
                BigInt(amt),
                BigInt(currentSenderBalance),
                senderBlinding,
                amountBlinding
            );

            settlements.push({
                amount: new BN(amt),
                encryptedAmount: { data: [...mockCiphertext.data] },
                proof: {
                    amountCommitment: proofData.amountCommitment,
                    proof: proofData.proof
                }
            });
            currentSenderBalance -= amt;
        }

        await program.methods.batchConfidentialSettlement(settlements).accounts({
            senderConfidentialBalance: userA_Confidential,
            receiverConfidentialBalance: userB_Confidential,
            receiverOwner: userB.publicKey,
            mint: energyMint,
            authority: userA.publicKey,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
            systemProgram: SystemProgram.programId
        } as any).signers([userA]).rpc();

        const balanceA = await program.account.confidentialBalance.fetch(userA_Confidential);
        const balanceB = await program.account.confidentialBalance.fetch(userB_Confidential);

        // Verify update slots
        assert.ok(balanceA.lastUpdateSlot.gtn(0));
        assert.ok(balanceB.lastUpdateSlot.gtn(0));
    });

    // ============================================
    // Negative Test Cases - Security Verification
    // These tests only work when ZK proof verification is enabled (not in localnet/test-skip-zk mode).
    // With test-skip-zk, all proofs pass regardless of validity.
    // ============================================

    const skipZk = process.env.TEST_SKIP_ZK === "1" || process.env.ANCHOR_FEATURES?.includes("test-skip-zk") || process.env.ANCHOR_FEATURES?.includes("localnet");

    describe("Security: Proof Rejection Tests" + (skipZk ? " [SKIPPED: test-skip-zk active]" : ""), function () {
        before(function () {
            if (skipZk) this.skip();
        });
        it("Rejects transfer with tampered proof data", async () => {
            const amount = new BN(50);

            // Create a real valid proof first, then tamper with it
            const sBlinding = zk.generateValidBlinding();
            const aBlinding = zk.generateValidBlinding();
            const validTransferProof = zk.createTransferProof(BigInt(50), BigInt(300), sBlinding, aBlinding);

            // Create a tampered proof by modifying bytes
            const tamperedProof = {
                amountCommitment: validTransferProof.amountCommitment,
                proof: Buffer.from(validTransferProof.proof)
            };
            // Tamper with the proof bytes
            tamperedProof.proof[0] = (tamperedProof.proof[0] + 1) % 256;
            tamperedProof.proof[tamperedProof.proof.length - 1] = (tamperedProof.proof[tamperedProof.proof.length - 1] + 1) % 256;

            try {
                await program.methods.privateTransfer(amount, { data: [...mockCiphertext.data] }, {
                    amountCommitment: tamperedProof.amountCommitment,
                    proof: tamperedProof.proof
                }).accounts({
                    senderBalance: userA_Confidential,
                    receiverBalance: userB_Confidential,
                    receiverOwner: userB.publicKey,
                    mint: energyMint,
                    owner: userA.publicKey,
                    zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID
                } as any).signers([userA]).rpc();

                assert.fail("Should have rejected tampered proof");
            } catch (err: any) {
                // Expected: transaction should fail
                assert.ok(err.message.includes("failed") || err.logs?.some((l: string) => l.includes("failed")));
            }
        });

        it("Rejects transfer with mismatched amount", async () => {
            // Use a proof generated for 200 tokens but claim only 50
            const wrongAmount = new BN(50);

            // Create a real valid proof for 200 first
            const sBlinding = zk.generateValidBlinding();
            const aBlinding = zk.generateValidBlinding();
            const validTransferProof200 = zk.createTransferProof(BigInt(200), BigInt(300), sBlinding, aBlinding);

            try {
                await program.methods.privateTransfer(wrongAmount, { data: [...mockCiphertext.data] }, {
                    amountCommitment: validTransferProof200.amountCommitment,
                    proof: validTransferProof200.proof
                }).accounts({
                    senderBalance: userA_Confidential,
                    receiverBalance: userB_Confidential,
                    receiverOwner: userB.publicKey,
                    mint: energyMint,
                    owner: userA.publicKey,
                    zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID
                } as any).signers([userA]).rpc();

                assert.fail("Should have rejected mismatched amount");
            } catch (err: any) {
                // Expected: transaction should fail due to amount/proof mismatch
                assert.ok(err.message.includes("failed") || err.logs?.some((l: string) => l.includes("failed")));
            }
        });

        it("Rejects transfer with zeroed commitment", async () => {
            const amount = new BN(100);
            const zeroedCommitment = { data: new Array(32).fill(0) };

            // Generate a valid proof we can "steal" the commitment/proof from
            const sBlinding = zk.generateValidBlinding();
            const aBlinding = zk.generateValidBlinding();
            const validTransferProof100 = zk.createTransferProof(BigInt(100), BigInt(300), sBlinding, aBlinding);

            try {
                await program.methods.privateTransfer(amount, { data: [...mockCiphertext.data] }, {
                    amountCommitment: zeroedCommitment,
                    proof: validTransferProof100.proof
                }).accounts({
                    senderBalance: userA_Confidential,
                    receiverBalance: userB_Confidential,
                    receiverOwner: userB.publicKey,
                    mint: energyMint,
                    owner: userA.publicKey,
                    zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID
                } as any).signers([userA]).rpc();

                assert.fail("Should have rejected zeroed commitment");
            } catch (err: any) {
                assert.ok(err.message.includes("failed") || err.logs?.some((l: string) => l.includes("failed")));
            }
        });

        it("Rejects transfer with empty proof bytes", async () => {
            const amount = new BN(100);

            // Generate a valid proof to get the commitment
            const sBlinding = zk.generateValidBlinding();
            const aBlinding = zk.generateValidBlinding();
            const validTransferProof100 = zk.createTransferProof(BigInt(100), BigInt(300), sBlinding, aBlinding);

            const emptyProof = Buffer.alloc(validTransferProof100.proof.length, 0);

            try {
                await program.methods.privateTransfer(amount, { data: [...mockCiphertext.data] }, {
                    amountCommitment: validTransferProof100.amountCommitment,
                    proof: emptyProof
                }).accounts({
                    senderBalance: userA_Confidential,
                    receiverBalance: userB_Confidential,
                    receiverOwner: userB.publicKey,
                    mint: energyMint,
                    owner: userA.publicKey,
                    zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID
                } as any).signers([userA]).rpc();

                assert.fail("Should have rejected empty proof");
            } catch (err: any) {
                assert.ok(err.message.includes("failed") || err.logs?.some((l: string) => l.includes("failed")));
            }
        });
    });
});
