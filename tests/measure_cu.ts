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
} from "@solana/spl-token";
import { assert } from "chai";
import type { Trading } from "../target/types/trading";
import * as zk from "./utils/zk-proofs";

// Re-use the program ID from utils or define it if missing
const ZK_TOKEN_PROOF_PROGRAM_ID = new PublicKey("ZkTokenProof1111111111111111111111111111111");

describe("Compute Unit Benchmark", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const authority = provider.wallet as anchor.Wallet;

    const seller = Keypair.generate();
    const buyer = Keypair.generate();
    const escrowAuthority = Keypair.generate();

    let energyMint: PublicKey;
    let currencyMint: PublicKey;

    let sellerEnergyEscrow: PublicKey;
    let buyerEnergyAccount: PublicKey;
    let buyerCurrencyConfidential: PublicKey;
    let sellerCurrencyConfidential: PublicKey;

    let marketAddress: PublicKey;
    let buyOrderPda: PublicKey;
    let sellOrderPda: PublicKey;

    // Helper to measure CU
    async function measureCU(signature: string, label: string) {
        // Wait for confirmation explicitly just in case
        await provider.connection.confirmTransaction(signature, "confirmed");

        let tx = null;
        for (let i = 0; i < 5; i++) {
            tx = await provider.connection.getTransaction(signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0
            });
            if (tx) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (tx && tx.meta) {
            console.log(`[BENCHMARK] ${label}: ${tx.meta.computeUnitsConsumed} CU`);
        } else {
            console.log(`[BENCHMARK] ${label}: FAILED TO RETRIEVE TX (${signature})`);
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

        // Airdrop to authority if balance is low
        const authBalance = await provider.connection.getBalance(authority.publicKey);
        if (authBalance < LAMPORTS_PER_SOL) {
            console.log("Airdropping to authority...");
            const airdropSig = await provider.connection.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: airdropSig, ...latest });
        }

        // Airdrops for other keypairs
        console.log("Airdropping to test accounts...");
        for (const kp of [seller, buyer, escrowAuthority]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        console.log("Creating mints...");
        // 1. Create Mints
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);
        currencyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 6, undefined, undefined, TOKEN_PROGRAM_ID);

        console.log("Setting up ATAs...");
        // 2. Setup ATAs
        sellerEnergyEscrow = await createATA(escrowAuthority.publicKey, energyMint, TOKEN_2022_PROGRAM_ID, escrowAuthority);
        buyerEnergyAccount = await createATA(buyer.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);

        // 3. Setup Confidential PDAs
        [buyerCurrencyConfidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), buyer.publicKey.toBuffer(), currencyMint.toBuffer()],
            program.programId
        );
        [sellerCurrencyConfidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), seller.publicKey.toBuffer(), currencyMint.toBuffer()],
            program.programId
        );

        // 4. Setup Market
        [marketAddress] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);
        try {
            await program.methods.initializeMarket().accounts({
                market: marketAddress,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e) { }

        // 5. Fund Seller Energy Escrow
        await mintTo(provider.connection, authority.payer, energyMint, sellerEnergyEscrow, authority.payer, 1000, [], undefined, TOKEN_2022_PROGRAM_ID);
    });

    it("Benchmarks Confidential Operations", async () => {
        console.log("\n--- STARTING BENCHMARK ---\n");

        // 1. Initialize Confidential Account
        const initSig = await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: buyerCurrencyConfidential,
            mint: currencyMint,
            owner: buyer.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([buyer]).rpc();
        await measureCU(initSig, "Initialize Confidential Balance");

        // Initialize Seller
        await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: sellerCurrencyConfidential,
            mint: currencyMint,
            owner: seller.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([seller]).rpc();


        // 2. Create Orders
        const sellOrderId = new BN(101);
        [sellOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        const sellSig = await program.methods.createSellOrder(sellOrderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: sellOrderPda,
            ercCertificate: null,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([seller]).rpc();
        await measureCU(sellSig, "Create Sell Order");

        const buyOrderId = new BN(202);
        [buyOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        const buySig = await program.methods.createBuyOrder(buyOrderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: buyOrderPda,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([buyer]).rpc();
        await measureCU(buySig, "Create Buy Order");

        // 3. Execute Confidential Settlement
        const amount = new BN(100);
        const price = new BN(50);

        // Generate ZK Proofs - Trimmed for benchmark because ZK is skipped in localnet
        const senderBlinding = zk.generateValidBlinding();
        const amountBlinding = zk.generateValidBlinding();
        const fullProof = zk.createTransferProof(
            BigInt(amount.toNumber()),
            BigInt(1000), // senderBalance (initial)
            senderBlinding,
            amountBlinding
        );

        // Trim the proof to a small size to ensure TX fits. 
        // Since we built with 'localnet' feature, verification is skipped.
        const trimmedProof = fullProof.proof.slice(0, 100);
        const transferProof = {
            amountCommitment: fullProof.amountCommitment,
            proof: trimmedProof
        };

        // Mock ciphertext
        const amountCiphertext = { data: Array.from(Buffer.alloc(64, 0)) };

        const settleSig = await program.methods.executeConfidentialSettlement(
            amount,
            price,
            amountCiphertext,
            {
                amountCommitment: transferProof.amountCommitment,
                proof: transferProof.proof,
            }
        ).accounts({
            market: marketAddress,
            buyOrder: buyOrderPda,
            sellOrder: sellOrderPda,
            buyerConfidentialBalance: buyerCurrencyConfidential,
            sellerConfidentialBalance: sellerCurrencyConfidential,
            sellerEnergyEscrow: sellerEnergyEscrow,
            buyerEnergyAccount: buyerEnergyAccount,
            energyMint: energyMint,
            mint: currencyMint,
            escrowAuthority: escrowAuthority.publicKey,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId
        } as any).signers([escrowAuthority]).rpc();

        await measureCU(settleSig, "Execute Confidential Settlement");

        console.log("\n--- BENCHMARK COMPLETE ---\n");
    });
});
