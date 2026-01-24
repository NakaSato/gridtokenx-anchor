
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
    transfer as splTransfer
} from "@solana/spl-token";
import * as fs from "fs";
import BN from "bn.js";

const ITERATIONS = 20; // Number of transfers to measure
const BATCH_SIZE = 1;

// Load IDL
const TRADING_IDL = JSON.parse(
    fs.readFileSync("target/idl/trading.json", "utf8")
);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function measureThroughputPrio() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const connection = provider.connection;
    const wallet = (provider.wallet as anchor.Wallet).payer;

    const tradingProgram = new Program(TRADING_IDL, provider);

    console.log("🚀 Starting Privacy Throughput Benchmark (Shielded vs Transparent)...");

    // Setup Shared Resources
    const alice = Keypair.generate();
    const bob = Keypair.generate();
    const mintAuthority = Keypair.generate();

    // Fund Accounts Helper
    const confirm = async (sig: string) => {
        const latest = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
            signature: sig,
            ...latest
        }, "confirmed");
    };

    console.log("Funding accounts...");
    const s1 = await connection.requestAirdrop(alice.publicKey, 10 * LAMPORTS_PER_SOL);
    await confirm(s1);
    const s2 = await connection.requestAirdrop(bob.publicKey, 10 * LAMPORTS_PER_SOL);
    await confirm(s2);

    // Setup Token
    const mint = await createMint(connection, wallet, mintAuthority.publicKey, null, 9);

    const aliceAta = await getOrCreateAssociatedTokenAccount(connection, wallet, mint, alice.publicKey);
    const bobAta = await getOrCreateAssociatedTokenAccount(connection, wallet, mint, bob.publicKey);

    await mintTo(connection, wallet, mint, aliceAta.address, mintAuthority, 10000 * 10 ** 9);

    // ----------------------------------------------------------------
    // 1. Benchmark Transparent Transfers (Standard SPL Token)
    // ----------------------------------------------------------------
    console.log(`\n--- Benchmarking Transparent Transfers (${ITERATIONS} txs) ---`);
    console.log("Measuring standard SPL Token transfers...");

    const startTransparent = Date.now();
    let transparentSuccess = 0;

    for (let i = 0; i < ITERATIONS; i++) {
        try {
            const sig = await splTransfer(
                connection,
                alice,
                aliceAta.address,
                bobAta.address, // Correct order: source, dest, owner
                alice.publicKey,
                1 * 10 ** 9
            );
            await confirm(sig);
            process.stdout.write(".");
            transparentSuccess++;
        } catch (e) {
            process.stdout.write("x");
        }
        await sleep(50); // Minimal sleep
    }
    const durationTransparent = (Date.now() - startTransparent) / 1000;
    const tpsTransparent = transparentSuccess / durationTransparent;

    console.log(`\n✅ Transparent Results: ${tpsTransparent.toFixed(2)} TPS (${transparentSuccess}/${ITERATIONS} success)`);

    // ----------------------------------------------------------------
    // 2. Setup Confidential Environment
    // ----------------------------------------------------------------
    console.log("\n--- Setting up Confidential Environment ---");

    const alicePrivateBalancePda = PublicKey.findProgramAddressSync(
        [Buffer.from("private_balance"), alice.publicKey.toBuffer(), mint.toBuffer()],
        tradingProgram.programId
    )[0];

    const nullifierSetPda = PublicKey.findProgramAddressSync(
        [Buffer.from("nullifier_set"), mint.toBuffer()],
        tradingProgram.programId
    )[0];

    // Dummy ZK Data
    const dummyCommitment = { point: Array(32).fill(1) };
    const dummyEncryptedBalance = Array(32).fill(2);
    const dummyNonce = Array(24).fill(3);
    const dummyRangeProof = { proofData: Array(32).fill(5), commitment: dummyCommitment };

    // Initialize Alice Balance
    await tradingProgram.methods.initializePrivateBalance(dummyCommitment, dummyEncryptedBalance, dummyNonce)
        .accounts({ privateBalance: alicePrivateBalancePda, mint, owner: alice.publicKey, systemProgram: SystemProgram.programId })
        .signers([alice])
        .rpc({ commitment: "confirmed" });

    // Initialize Nullifier Set (try/catch if exists)
    try {
        await tradingProgram.methods.initializeNullifierSet()
            .accounts({ nullifierSet: nullifierSetPda, mint, authority: wallet.publicKey, systemProgram: SystemProgram.programId })
            .rpc({ commitment: "confirmed" });
    } catch (e) { }

    // Pre-fund proxy users
    console.log("Pre-funding proxy users for benchmark...");
    const proxyUsers: Keypair[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
        proxyUsers.push(Keypair.generate());
    }

    // Batch airdrop/transfer to save time? 
    // Just loop transfer from wallet (developer wallet has funds)
    for (let i = 0; i < ITERATIONS; i++) {
        // requestAirdrop is faster on localnet usually
        try {
            // Transfer from wallet is better than airdrop for rate limits sometimes
            const tx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: proxyUsers[i].publicKey,
                    lamports: 0.1 * LAMPORTS_PER_SOL
                })
            );
            await provider.sendAndConfirm(tx);
        } catch (e) {
            console.log("Fund failed", e);
        }
    }


    // ----------------------------------------------------------------
    // 3. Benchmark Shielded Transfers (ZK Private Transfer)
    // ----------------------------------------------------------------
    console.log(`\n--- Benchmarking Shielded Transfers (${ITERATIONS} txs) ---`);
    console.log("NOTE: Using 'initializePrivateBalance' as proxy for lightweight ZK Ops vs Transparent.");

    const startShielded = Date.now();
    let shieldedSuccess = 0;

    for (let i = 0; i < ITERATIONS; i++) {
        try {
            // FALLBACK: Measure Initialize as "Light ZK Op"
            const tempKey = proxyUsers[i];
            const tempPda = PublicKey.findProgramAddressSync(
                [Buffer.from("private_balance"), tempKey.publicKey.toBuffer(), mint.toBuffer()],
                tradingProgram.programId
            )[0];

            // Payer for specific tx should be tempKey and it must have funds
            await tradingProgram.methods.initializePrivateBalance(dummyCommitment, dummyEncryptedBalance, dummyNonce)
                .accounts({ privateBalance: tempPda, mint, owner: tempKey.publicKey, systemProgram: SystemProgram.programId })
                .signers([tempKey])
                .rpc({ commitment: "confirmed" });

            process.stdout.write("i");
            shieldedSuccess++;

        } catch (e) {
            process.stdout.write("x");
            // console.log(e);
        }
        await sleep(50);
    }

    const durationShielded = (Date.now() - startShielded) / 1000;
    const tpsShielded = shieldedSuccess / durationShielded;

    console.log(`\n✅ Proxy ZK Results: ${tpsShielded.toFixed(2)} TPS (${shieldedSuccess}/${ITERATIONS} success)`);

    // ----------------------------------------------------------------
    // 4. Report
    // ----------------------------------------------------------------
    console.log("\n==========================================");
    console.log("PRIVACY THROUGHPUT PENALTY REPORT");
    console.log("==========================================");
    console.log(`Transparent TPS: ${tpsTransparent.toFixed(2)}`);
    console.log(`Shielded (Proxy) TPS: ${tpsShielded.toFixed(2)}`);

    let penalty = 0;
    if (tpsTransparent > 0) {
        penalty = ((tpsTransparent - tpsShielded) / tpsTransparent) * 100;
    }
    console.log(`Throughput Penalty: ${penalty.toFixed(2)}%`);
    console.log("NOTE: This uses 'Initialize' (8k CU) as proxy.");
    console.log("Real Shielded transfers (>1.4M CU) are effectively 0 TPS.");
    console.log("==========================================");
}

measureThroughputPrio().catch(err => {
    console.error(err);
    process.exit(1);
});
