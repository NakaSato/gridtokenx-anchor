import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    TestEnvironment,
    expect,
    describe,
    it,
    before
} from "./setup";
import { Trading } from "../target/types/trading";
import { EnergyToken } from "../target/types/energy_token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

// Real ZK Proof generation state
let zkModule: any;

async function loadZk() {
    if (zkModule) return;
    try {
        // @ts-ignore
        zkModule = await import("../../gridtokenx-wasm/pkg/gridtokenx_wasm.js");
    } catch (e) {
        console.warn("WASM ZK module not found in pkg/. Ensure 'wasm-pack build' was run in gridtokenx-wasm.");
        // Mock fallback for CI/Local environment without WASM build
        zkModule = {
            create_commitment: async (v: bigint, b: Buffer) => ({ point: [...Buffer.alloc(32).fill(Number(v))] }),
            create_range_proof: async (v: bigint, b: Buffer) => ({
                proof_data: [...Buffer.alloc(32).fill(1)],
                commitment: { point: [...Buffer.alloc(32).fill(Number(v))] }
            }),
            create_transfer_proof: async (a: bigint, b: bigint, sb: Buffer, ab: Buffer) => ({
                amount_commitment: { point: [...Buffer.alloc(32).fill(Number(a))] },
                amount_range_proof: { proof_data: [...Buffer.alloc(32).fill(1)], commitment: { point: [...Buffer.alloc(32).fill(Number(a))] } },
                remaining_range_proof: { proof_data: [...Buffer.alloc(32).fill(1)], commitment: { point: [...Buffer.alloc(32).fill(Number(b - a))] } },
                balance_proof: { challenge: [...Buffer.alloc(32).fill(2)], response: [...Buffer.alloc(32).fill(3)] }
            })
        };
    }
}

const NULLIFIER_SET_SEED = "nullifier_set";
const PRIVATE_BALANCE_SEED = "private_balance";

describe("Confidential Trading (Real ZK Proofs)", () => {
    let env: TestEnvironment;
    let tradingProgram: Program<Trading>;
    let energyTokenProgram: Program<EnergyToken>;
    let marketAuthority: Keypair;

    // Users
    let userA: Keypair;
    let userB: Keypair;

    // Accounts
    let mint: PublicKey;
    let userAPublicAccount: PublicKey;
    let userBPublicAccount: PublicKey;

    // PDAs
    let userAPrivateBalance: PublicKey;
    let userBPrivateBalance: PublicKey;
    let nullifierSet: PublicKey;
    let mintAuthority: PublicKey;

    // Constants
    const INITIAL_PUBLIC = 1000;
    const SHIELD_AMOUNT = 100;
    const TRANSFER_AMOUNT = 50;

    before(async () => {
        await loadZk();
        env = await TestEnvironment.create();
        tradingProgram = env.tradingProgram;
        energyTokenProgram = env.energyTokenProgram;
        marketAuthority = env.authority;

        userA = Keypair.generate();
        userB = Keypair.generate();

        await requestAirdrop(env.connection, userA.publicKey);
        await requestAirdrop(env.connection, userB.publicKey);

        // create Mint
        const { createMint } = await import("@solana/spl-token");
        mint = await createMint(env.connection, marketAuthority, marketAuthority.publicKey, null, 9);

        // Setup Public Accounts
        userAPublicAccount = await createAssociatedTokenAccount(env.connection, userA, mint, userA.publicKey);
        userBPublicAccount = await createAssociatedTokenAccount(env.connection, userB, mint, userB.publicKey);

        // Mint initial tokens
        await mintTo(env.connection, marketAuthority, mint, userAPublicAccount, marketAuthority, INITIAL_PUBLIC);

        // PDAs
        [userAPrivateBalance] = PublicKey.findProgramAddressSync(
            [Buffer.from(PRIVATE_BALANCE_SEED), userA.publicKey.toBuffer(), mint.toBuffer()],
            tradingProgram.programId
        );

        [userBPrivateBalance] = PublicKey.findProgramAddressSync(
            [Buffer.from(PRIVATE_BALANCE_SEED), userB.publicKey.toBuffer(), mint.toBuffer()],
            tradingProgram.programId
        );

        [nullifierSet] = PublicKey.findProgramAddressSync(
            [Buffer.from(NULLIFIER_SET_SEED), mint.toBuffer()],
            tradingProgram.programId
        );

        [mintAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority"), mint.toBuffer()],
            tradingProgram.programId
        );

        // Transfer Mint Authority to PDA
        const { setAuthority, AuthorityType } = await import("@solana/spl-token");
        await setAuthority(
            env.connection,
            marketAuthority,
            mint,
            marketAuthority,
            AuthorityType.MintTokens,
            mintAuthority
        );
    });

    it("Step 1: Initialize Infrastructure", async () => {
        let sig = await tradingProgram.methods.initializeNullifierSet()
            .accounts({
                nullifierSet: nullifierSet,
                mint: mint,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId,
            } as any)
            .signers([marketAuthority])
            .rpc();
        await logCU(env.connection, sig, "initializeNullifierSet");

        const initialCommit = await zkModule.create_commitment(BigInt(0), Buffer.alloc(32).fill(0));

        sig = await tradingProgram.methods.initializePrivateBalance(
            initialCommit,
            [...Buffer.alloc(32).fill(0)],
            [...Buffer.alloc(24).fill(0)]
        ).accounts({
            privateBalance: userAPrivateBalance,
            mint: mint,
            owner: userA.publicKey,
            systemProgram: SystemProgram.programId,
        } as any).signers([userA]).rpc();
        await logCU(env.connection, sig, "initializePrivateBalance (User A)");

        sig = await tradingProgram.methods.initializePrivateBalance(
            initialCommit,
            [...Buffer.alloc(32).fill(0)],
            [...Buffer.alloc(24).fill(0)]
        ).accounts({
            privateBalance: userBPrivateBalance,
            mint: mint,
            owner: userB.publicKey,
            systemProgram: SystemProgram.programId,
        } as any).signers([userB]).rpc();
        await logCU(env.connection, sig, "initializePrivateBalance (User B)");
    });

    it("Step 2: Shield Tokens (using Range Proof)", async () => {
        const amount = new BN(SHIELD_AMOUNT);
        const blindingBytes = Buffer.alloc(32).fill(9);
        const proof = await zkModule.create_range_proof(BigInt(SHIELD_AMOUNT), blindingBytes);

        const sig = await tradingProgram.methods.shieldTokens(
            amount,
            proof.commitment,
            [...blindingBytes],
            {
                proofData: [...proof.proof_data],
                commitment: proof.commitment
            }
        ).accounts({
            privateBalance: userAPrivateBalance,
            mint: mint,
            userTokenAccount: userAPublicAccount,
            owner: userA.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
        } as any).signers([userA]).rpc();
        await logCU(env.connection, sig, "shieldTokens");

        const balance = await env.connection.getTokenAccountBalance(userAPublicAccount);
        expect(balance.value.amount).to.equal((INITIAL_PUBLIC - SHIELD_AMOUNT).toString());
    });

    it("Step 3: Private Transfer (User A -> User B with Transfer Proof)", async () => {
        const amount = TRANSFER_AMOUNT;
        const senderBalance = SHIELD_AMOUNT;
        const amountBlinding = Buffer.alloc(32).fill(11);

        const transferProof = await zkModule.create_transfer_proof(
            BigInt(amount),
            BigInt(senderBalance),
            Buffer.alloc(32).fill(9), // sender_blinding
            amountBlinding
        );

        // Derive new commitments
        const senderNewCommit = await zkModule.create_commitment(BigInt(senderBalance - amount), Buffer.from(Buffer.alloc(32).fill(9).map((b, i) => b ^ amountBlinding[i])));
        const recipientNewCommit = await zkModule.create_commitment(BigInt(amount), amountBlinding);

        const nullifier = Buffer.alloc(32).fill(88);
        const transferRecordKeypair = Keypair.generate();

        const sig = await tradingProgram.methods.privateTransfer(
            senderNewCommit,
            recipientNewCommit,
            {
                amountCommitment: transferProof.amount_commitment,
                amountRangeProof: {
                    proofData: [...transferProof.amount_range_proof.proof_data],
                    commitment: transferProof.amount_range_proof.commitment
                },
                remainingRangeProof: {
                    proofData: [...transferProof.remaining_range_proof.proof_data],
                    commitment: transferProof.remaining_range_proof.commitment
                },
                balanceProof: transferProof.balance_proof
            },
            [...nullifier]
        ).accounts({
            senderBalance: userAPrivateBalance,
            recipientBalance: userBPrivateBalance,
            nullifierSet: nullifierSet,
            transferRecord: transferRecordKeypair.publicKey,
            sender: userA.publicKey,
            owner: userA.publicKey,
            systemProgram: SystemProgram.programId,
        } as any).signers([userA, transferRecordKeypair]).rpc();
        await logCU(env.connection, sig, "privateTransfer");

        const recAccount = await tradingProgram.account.privateBalance.fetch(userBPrivateBalance);
        expect(recAccount.txCounter.toNumber()).to.equal(1);
    });

    it("Step 4: Unshield Tokens (using Transfer Proof)", async () => {
        const amount = new BN(TRANSFER_AMOUNT);
        const nullifier = Buffer.alloc(32).fill(99);

        // Final unshielding requires a transfer proof showing we have the balance
        const proof = await zkModule.create_transfer_proof(
            BigInt(TRANSFER_AMOUNT),
            BigInt(TRANSFER_AMOUNT),
            Buffer.alloc(32).fill(11), // balance blinding from Step 3
            Buffer.alloc(32).fill(0)    // unshield to public (0 blinding for resulting public amount)
        );

        const sig = await tradingProgram.methods.unshieldTokens(
            amount,
            { point: [...Buffer.alloc(32).fill(0)] }, // 0 commitment after unshield
            {
                amountCommitment: proof.amount_commitment,
                amountRangeProof: {
                    proofData: [...proof.amount_range_proof.proof_data],
                    commitment: proof.amount_range_proof.commitment
                },
                remainingRangeProof: {
                    proofData: [...proof.remaining_range_proof.proof_data],
                    commitment: proof.remaining_range_proof.commitment
                },
                balanceProof: proof.balance_proof
            },
            [...nullifier]
        ).accounts({
            privateBalance: userBPrivateBalance,
            nullifierSet: nullifierSet,
            mint: mint,
            userTokenAccount: userBPublicAccount,
            mintAuthority: mintAuthority,
            owner: userB.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
        } as any).signers([userB]).rpc();
        await logCU(env.connection, sig, "unshieldTokens");

        const balance = await env.connection.getTokenAccountBalance(userBPublicAccount);
        expect(balance.value.amount).to.equal(TRANSFER_AMOUNT.toString());
    });
});

async function requestAirdrop(connection: anchor.web3.Connection, address: PublicKey) {
    const sig = await connection.requestAirdrop(address, 5 * anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
}

async function logCU(connection: anchor.web3.Connection, sig: string, label: string) {
    // Wait for commitment to ensure metadata is available
    await connection.confirmTransaction(sig, "confirmed");
    const tx = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
    });
    const cu = tx?.meta?.computeUnitsConsumed;
    console.log(`📊 [CU Benchmark] ${label}: ${cu} CUs`);
    return cu;
}
