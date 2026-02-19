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
} from "@solana/spl-token";
import type { Trading } from "../target/types/trading";
import type { Governance } from "../target/types/governance";
import { initializeGovernance } from "./utils/governance";

describe("CDA Performance Benchmarks", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const governanceProgram = anchor.workspace.Governance as Program<Governance>;
    const authority = provider.wallet as anchor.Wallet;

    const seller = Keypair.generate();
    const buyer = Keypair.generate();
    const escrowAuthority = Keypair.generate();

    let energyMint: PublicKey;
    let currencyMint: PublicKey;

    let sellerEnergyEscrow: PublicKey;
    let buyerEnergyAccount: PublicKey;
    let sellerCurrencyAccount: PublicKey;
    let buyerCurrencyAccount: PublicKey;
    let buyerCurrencyEscrow: PublicKey;
    let feeCollector: PublicKey;

    let marketAddress: PublicKey;
    let governanceConfig: PublicKey;
    let sellOrderPda: PublicKey;
    let buyOrderPda: PublicKey;
    let tradeRecordPda: PublicKey;

    const INITIAL_ENERGY = 10000;
    const INITIAL_CURRENCY = 10000000;

    // Helper to measure CU
    async function measureCU(signature: string, label: string) {
        await provider.connection.confirmTransaction(signature, "confirmed");
        let tx = null;
        for (let i = 0; i < 5; i++) {
            tx = await provider.connection.getTransaction(signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0
            });
            if (tx) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (tx && tx.meta) {
            console.log(`[BENCHMARK] ${label}: ${tx.meta.computeUnitsConsumed} CU`);
            return tx.meta.computeUnitsConsumed;
        } else {
            console.log(`[BENCHMARK] ${label}: FAILED TO RETRIEVE TX`);
            return null;
        }
    }

    async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey, payer: Keypair = authority.payer as any) {
        const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
        const ix = createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint, programId);
        const tx = new anchor.web3.Transaction().add(ix);
        await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [payer]);
        return ata;
    }

    before(async () => {
        console.log("Setting up benchmark environment...");

        // Airdrops
        for (const kp of [seller, buyer, escrowAuthority]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        // Mints
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);
        currencyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 6, undefined, undefined, TOKEN_PROGRAM_ID);

        // ATAs
        sellerEnergyEscrow = await createATA(escrowAuthority.publicKey, energyMint, TOKEN_2022_PROGRAM_ID, escrowAuthority);
        buyerEnergyAccount = await createATA(buyer.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);
        sellerCurrencyAccount = await createATA(seller.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        buyerCurrencyAccount = await createATA(buyer.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        buyerCurrencyEscrow = await createATA(escrowAuthority.publicKey, currencyMint, TOKEN_PROGRAM_ID, escrowAuthority);
        feeCollector = await createATA(authority.publicKey, currencyMint, TOKEN_PROGRAM_ID);

        // Fund accounts
        await mintTo(provider.connection, authority.payer, energyMint, sellerEnergyEscrow, authority.payer, INITIAL_ENERGY, [], undefined, TOKEN_2022_PROGRAM_ID);
        await mintTo(provider.connection, authority.payer, currencyMint, buyerCurrencyEscrow, authority.payer, INITIAL_CURRENCY, [], undefined, TOKEN_PROGRAM_ID);

        // Initialize Governance
        governanceConfig = await initializeGovernance(provider, governanceProgram);

        // PDAs
        [marketAddress] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);

        // Ensure market is initialized
        try {
            await program.methods.initializeMarket().accounts({
                market: marketAddress,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e) { }
    });

    it("Measure Baseline CU for Core Instructions", async () => {
        console.log("\n--- BASELINE CU MEASUREMENTS ---\n");

        // 1. Create Sell Order
        const sellOrderId = new BN(Date.now());
        [sellOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        const sellSig = await program.methods.createSellOrder(sellOrderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: sellOrderPda,
            ercCertificate: null,
            governanceConfig: governanceConfig,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([seller]).rpc();
        await measureCU(sellSig, "Create Sell Order");

        // 2. Create Buy Order
        const buyOrderId = new BN(Date.now() + 1);
        [buyOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        const buySig = await program.methods.createBuyOrder(buyOrderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: buyOrderPda,
            governanceConfig: governanceConfig,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([buyer]).rpc();
        await measureCU(buySig, "Create Buy Order");

        // 3. Execute Atomic Settlement
        [tradeRecordPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("trade"), buyOrderPda.toBuffer(), sellOrderPda.toBuffer()],
            program.programId
        );

        const settleSig = await program.methods.executeAtomicSettlement(
            new BN(100),
            new BN(50),
            new BN(0), // wheeling
            new BN(0)  // loss
        ).accounts({
            market: marketAddress,
            buyOrder: buyOrderPda,
            sellOrder: sellOrderPda,
            buyerCurrencyEscrow: buyerCurrencyEscrow,
            sellerEnergyEscrow: sellerEnergyEscrow,
            sellerCurrencyAccount: sellerCurrencyAccount,
            buyerEnergyAccount: buyerEnergyAccount,
            feeCollector: feeCollector,
            wheelingCollector: feeCollector,
            lossCollector: feeCollector,
            energyMint: energyMint,
            currencyMint: currencyMint,
            escrowAuthority: escrowAuthority.publicKey,
            marketAuthority: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
            governanceConfig: governanceConfig,
        } as any).signers([escrowAuthority]).rpc();

        await measureCU(settleSig, "Execute Atomic Settlement");

        console.log("\n--- BASELINE COMPLETE ---\n");
    });

    it("Concurrency Stress Test (Burst Simulation)", async () => {
        console.log("\n--- STARTING CONCURRENCY STRESS TEST ---\n");

        const BURST_SIZE = 10;
        const start = Date.now();

        const promises = [];
        for (let i = 0; i < BURST_SIZE; i++) {
            const orderId = new BN(start + i);
            const [orderPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("order"), seller.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
                program.programId
            );

            promises.push(
                program.methods.createSellOrder(orderId, new BN(10), new BN(50)).accounts({
                    market: marketAddress,
                    order: orderPda,
                    ercCertificate: null,
                    governanceConfig: governanceConfig,
                    authority: seller.publicKey,
                    systemProgram: SystemProgram.programId
                } as any).signers([seller]).rpc()
            );
        }

        console.log(`Sending ${BURST_SIZE} concurrent Sell Orders...`);
        const results = await Promise.allSettled(promises);
        const end = Date.now();

        const successful = results.filter(r => r.status === "fulfilled").length;
        const failed = results.filter(r => r.status === "rejected").length;
        const duration = (end - start) / 1000;

        console.log(`\n--- STRESS TEST RESULTS ---`);
        console.log(`Total Requests: ${BURST_SIZE}`);
        console.log(`Successful:     ${successful}`);
        console.log(`Failed:         ${failed}`);
        console.log(`Duration:       ${duration.toFixed(2)}s`);
        console.log(`TPS (Requests): ${(BURST_SIZE / duration).toFixed(2)}`);

        if (failed > 0) {
            const errors = results.filter(r => r.status === "rejected").map(r => (r as any).reason.message || (r as any).reason);
            console.log(`First Error Example: ${errors[0]}`);
        }

        console.log(`\n--- CONCURRENCY STRESS TEST COMPLETE ---\n`);
    });
});
