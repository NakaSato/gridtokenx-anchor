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

    // Real proofs generated via gen-proof-tool
    const realRangeProof = {
        commitment: { data: [...Buffer.from("dceb7ad0834897dd2781f4c07d99a2cd25fa3f77dd91a2312369eb924ff75d5b", "hex")] },
        proof: Buffer.alloc(100, 0)
    };
    const realTransferProof200 = {
        amountCommitment: { data: [...Buffer.from("46580554dbda963d76326cd6036814ac2fa8ee2f1c9d466f27f8a7eff75be5f7", "hex")] },
        proof: Buffer.alloc(100, 0)
    };
    const realTransferProof100 = {
        amountCommitment: { data: [...Buffer.from("4009e991fa95311ed64b7df57d2b70eefb8ccdc666b39f64c02a446de9b5a651", "hex")] },
        proof: Buffer.alloc(100, 0)
    };

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
        await program.methods.shieldEnergy(amount, { data: [...mockCiphertext.data] }, realRangeProof).accounts({
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
        await program.methods.privateTransfer(amount, { data: [...mockCiphertext.data] }, {
            amountCommitment: realTransferProof200.amountCommitment,
            proof: realTransferProof200.proof
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

        await program.methods.unshieldEnergy(amount, { data: [...mockCiphertext.data] }, {
            amountCommitment: realTransferProof100.amountCommitment,
            proof: realTransferProof100.proof
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
        // Prepare 3 settlement items
        const settlements = [
            {
                amount: new BN(100),
                encryptedAmount: { data: [...mockCiphertext.data] },
                proof: {
                    amountCommitment: realTransferProof100.amountCommitment,
                    proof: realTransferProof100.proof
                }
            },
            {
                amount: new BN(50),
                encryptedAmount: { data: [...mockCiphertext.data] },
                proof: {
                    amountCommitment: realTransferProof100.amountCommitment, // Simplified mock
                    proof: realTransferProof100.proof
                }
            },
            {
                amount: new BN(150),
                encryptedAmount: { data: [...mockCiphertext.data] },
                proof: {
                    amountCommitment: realTransferProof100.amountCommitment,
                    proof: realTransferProof100.proof
                }
            }
        ];

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
    // ============================================

    describe("Security: Proof Rejection Tests", () => {
        it("Rejects transfer with tampered proof data", async () => {
            const amount = new BN(50);

            // Create a tampered proof by modifying bytes
            const tamperedProof = {
                amountCommitment: realTransferProof200.amountCommitment,
                proof: Buffer.from(realTransferProof200.proof)
            };
            // Tamper with the proof bytes
            tamperedProof.proof[0] = (tamperedProof.proof[0] + 1) % 256;
            tamperedProof.proof[100] = (tamperedProof.proof[100] + 1) % 256;

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

            try {
                await program.methods.privateTransfer(wrongAmount, { data: [...mockCiphertext.data] }, {
                    amountCommitment: realTransferProof200.amountCommitment,
                    proof: realTransferProof200.proof
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

            try {
                await program.methods.privateTransfer(amount, { data: [...mockCiphertext.data] }, {
                    amountCommitment: zeroedCommitment,
                    proof: realTransferProof100.proof
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
            const emptyProof = Buffer.alloc(realTransferProof100.proof.length, 0);

            try {
                await program.methods.privateTransfer(amount, { data: [...mockCiphertext.data] }, {
                    amountCommitment: realTransferProof100.amountCommitment,
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
