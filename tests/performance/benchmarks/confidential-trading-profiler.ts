
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    PublicKey,
    Keypair,
    SystemProgram,
    LAMPORTS_PER_SOL,
    Transaction,
    ComputeBudgetProgram
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import * as fs from "fs";
import { expect } from "chai";
import BN from "bn.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Load IDL
const TRADING_IDL = JSON.parse(
    fs.readFileSync("target/idl/trading.json", "utf8")
);

async function profileConfidentialTrading() {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgram = new Program(TRADING_IDL, provider);
    const wallet = (provider.wallet as anchor.Wallet).payer;

    console.log("🚀 Starting Confidential Trading CU Profiling...");
    console.log("Program ID:", tradingProgram.programId.toBase58());
    console.log("Cluster:", provider.connection.rpcEndpoint);

    // 1. Setup Users and Mint
    const alice = Keypair.generate();
    const bob = Keypair.generate();
    const mintAuthority = Keypair.generate();

    console.log("Airdropping SOL to Alice and Bob...");

    // Helper to confirm robustly
    const confirm = async (sig: string) => {
        const latest = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({
            signature: sig,
            ...latest
        });
    };

    const sig1 = await provider.connection.requestAirdrop(alice.publicKey, 10 * LAMPORTS_PER_SOL);
    await confirm(sig1);

    const sig2 = await provider.connection.requestAirdrop(bob.publicKey, 10 * LAMPORTS_PER_SOL);
    await confirm(sig2);

    console.log("Creating Energy Token Mint...");
    const mint = await createMint(
        provider.connection,
        wallet,
        mintAuthority.publicKey,
        null,
        9
    );

    const aliceTokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        wallet,
        mint,
        alice.publicKey
    );

    console.log("Minting 1000 Energy Tokens to Alice...");
    await mintTo(
        provider.connection,
        wallet,
        mint,
        aliceTokenAccount.address,
        mintAuthority,
        1000 * 10 ** 9
    );

    await sleep(1000);

    // 2. Initialize Private Balances
    console.log("\n--- PHASE 1: Initialize Private Balances ---");

    const alicePrivateBalancePda = PublicKey.findProgramAddressSync(
        [Buffer.from("private_balance"), alice.publicKey.toBuffer(), mint.toBuffer()],
        tradingProgram.programId
    )[0];

    const bobPrivateBalancePda = PublicKey.findProgramAddressSync(
        [Buffer.from("private_balance"), bob.publicKey.toBuffer(), mint.toBuffer()],
        tradingProgram.programId
    )[0];

    // Dummy commitment and encryption data
    const dummyCommitment = { point: Array(32).fill(1) };
    const dummyEncryptedBalance = Array(32).fill(2);
    const dummyNonce = Array(24).fill(3);

    try {
        const tx1 = await tradingProgram.methods
            .initializePrivateBalance(
                dummyCommitment,
                dummyEncryptedBalance,
                dummyNonce
            )
            .accounts({
                privateBalance: alicePrivateBalancePda,
                mint: mint,
                owner: alice.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([alice])
            .rpc({ commitment: "confirmed" });

        const initCu = await getCuUsage(provider.connection, tx1);
        console.log(`✅ Alice Private Balance Initialized. CU: ${initCu}`);

        await tradingProgram.methods
            .initializePrivateBalance(
                dummyCommitment,
                dummyEncryptedBalance,
                dummyNonce
            )
            .accounts({
                privateBalance: bobPrivateBalancePda,
                mint: mint,
                owner: bob.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([bob])
            .rpc({ commitment: "confirmed" });

        await sleep(500);

        // 3. Shield Tokens (Alice: Public -> Private)
        console.log("\n--- PHASE 2: Shield Tokens (Locking Public Supply) ---");

        const shieldAmount = new BN(500 * 10 ** 9);
        const dummyBlinding = Array(32).fill(4);
        const dummyRangeProof = {
            proofData: Array(32).fill(5),
            commitment: dummyCommitment
        };

        const tx2 = await tradingProgram.methods
            .shieldTokens(
                shieldAmount,
                dummyCommitment,
                dummyBlinding,
                dummyRangeProof
            )
            .accounts({
                privateBalance: alicePrivateBalancePda,
                mint: mint,
                userTokenAccount: aliceTokenAccount.address,
                owner: alice.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .preInstructions([
                ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
            ])
            .signers([alice])
            .rpc({ commitment: "confirmed" });

        const shieldCu = await getCuUsage(provider.connection, tx2);
        console.log(`✅ Tokens Shielded (500 units). CU: ${shieldCu}`);

        await sleep(500);

        // 4. Private Transfer (Alice -> Bob)
        console.log("\n--- PHASE 3: Private Transfer (Hidden Sender/Recipient/Amount) ---");

        // Initialize Nullifier Set first if needed
        const nullifierSetPda = PublicKey.findProgramAddressSync(
            [Buffer.from("nullifier_set"), mint.toBuffer()],
            tradingProgram.programId
        )[0];

        try {
            await tradingProgram.methods
                .initializeNullifierSet()
                .accounts({
                    nullifierSet: nullifierSetPda,
                    mint: mint,
                    authority: wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc({ commitment: "confirmed" });
        } catch (e) {
            // Check if error is "already initialized"
            // console.log("Nullifier set might already be initialized");
        }

        const transferRecord = Keypair.generate();
        const dummyTransferProof = {
            amountCommitment: dummyCommitment,
            amountRangeProof: dummyRangeProof,
            remainingRangeProof: dummyRangeProof,
            balanceProof: {
                challenge: Array(32).fill(6),
                response: Array(32).fill(7)
            }
        };
        const dummyNullifier = Array(32).fill(8);

        const tx3 = await tradingProgram.methods
            .privateTransfer(
                dummyCommitment, // sender new commitment
                dummyCommitment, // recipient new commitment
                dummyTransferProof,
                dummyNullifier
            )
            .accounts({
                senderBalance: alicePrivateBalancePda,
                recipientBalance: bobPrivateBalancePda,
                nullifierSet: nullifierSetPda,
                transferRecord: transferRecord.publicKey,
                sender: alice.publicKey,
                owner: alice.publicKey, // redundant check in this IDL?
                systemProgram: SystemProgram.programId,
            })
            .preInstructions([
                ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
            ])
            .signers([alice, transferRecord])
            .rpc({ commitment: "confirmed" });

        const transferCu = await getCuUsage(provider.connection, tx3);
        console.log(`✅ Private Transfer Executed. CU: ${transferCu}`);

        await sleep(500);

        // 5. Unshield Tokens (Bob: Private -> Public)
        console.log("\n--- PHASE 4: Unshield Tokens (Revealing to Public) ---");

        const unshieldAmount = new BN(200 * 10 ** 9);
        const bobTokenAccount = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet,
            mint,
            bob.publicKey
        );

        const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority"), mint.toBuffer()],
            tradingProgram.programId
        );

        const dummyNullifier2 = Array(32).fill(9);

        const tx4 = await tradingProgram.methods
            .unshieldTokens(
                unshieldAmount,
                dummyCommitment,
                dummyTransferProof,
                dummyNullifier2
            )
            .accounts({
                privateBalance: bobPrivateBalancePda,
                nullifierSet: nullifierSetPda,
                mint: mint,
                userTokenAccount: bobTokenAccount.address,
                mintAuthority: mintAuthorityPda,
                owner: bob.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .preInstructions([
                ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
            ])
            .signers([bob])
            .rpc({ commitment: "confirmed" });

        const unshieldCu = await getCuUsage(provider.connection, tx4);
        console.log(`✅ Tokens Unshielded (200 units). CU: ${unshieldCu}`);

        // Summary Report
        console.log("\n==========================================");
        console.log("CONFIDENTIAL TRADING PERFORMANCE REPORT");
        console.log("==========================================");
        console.log(`Initialization:   ${initCu.toLocaleString()} CU`);
        console.log(`Shielding:        ${shieldCu.toLocaleString()} CU`);
        console.log(`Private Transfer: ${transferCu.toLocaleString()} CU`);
        console.log(`Unshielding:      ${unshieldCu.toLocaleString()} CU`);
        console.log("------------------------------------------");

        const totalCu = initCu + shieldCu + transferCu + unshieldCu;
        console.log(`Total Flow CU:    ${totalCu.toLocaleString()} CU`);
        console.log("==========================================");

    } catch (e) {
        console.error("❌ Benchmarking failed:", e);
        if (e.logs) {
            console.error("Logs:", e.logs);
        }
        process.exit(1);
    }
}

async function getCuUsage(connection: anchor.web3.Connection, signature: string): Promise<number> {
    const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
    });
    return tx?.meta?.computeUnitsConsumed || 0;
}

profileConfidentialTrading().catch(err => {
    console.error(err);
    process.exit(1);
});
