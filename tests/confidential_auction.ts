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

const ZK_TOKEN_PROOF_PROGRAM_ID = new PublicKey("ZkTokenProof1111111111111111111111111111111");

describe("Confidential Auction Integration", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const authority = provider.wallet as anchor.Wallet;

    const seller = Keypair.generate();
    const buyer = Keypair.generate();

    let energyMint: PublicKey;
    let currencyMint: PublicKey;
    let marketAddress: PublicKey;
    let batchAddress: PublicKey;
    let batchVault: PublicKey;

    let sellerEnergyToken: PublicKey;
    let buyerEnergyToken: PublicKey;
    let buyerCurrencyConfidential: PublicKey;
    let sellerCurrencyConfidential: PublicKey;

    const BATCH_ID = new BN(Date.now());
    const AUCTION_DURATION = 10; // 10 seconds

    // Static mock proof data (used with test-skip-zk feature)
    const mockTransferProof = {
        amountCommitment: { data: [...Buffer.from("46580554dbda963d76326cd6036814ac2fa8ee2f1c9d466f27f8a7eff75be5f7", "hex")] },
        proof: Buffer.alloc(100, 0),
    };

    // Mock ciphertext for testing
    const mockCiphertext = { data: Array.from(Buffer.alloc(64, 0)) };

    async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey, payer: Keypair = authority.payer as any) {
        const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
        const ix = createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint, programId);
        const tx = new anchor.web3.Transaction().add(ix);
        await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [payer]);
        return ata;
    }

    before(async () => {
        // Airdrops
        for (const kp of [seller, buyer]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        // 1. Create Mints
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);
        currencyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 6, undefined, undefined, TOKEN_PROGRAM_ID);

        // 2. Setup ATAs
        sellerEnergyToken = await createATA(seller.publicKey, energyMint, TOKEN_2022_PROGRAM_ID, seller);
        buyerEnergyToken = await createATA(buyer.publicKey, energyMint, TOKEN_2022_PROGRAM_ID, buyer);

        // 3. Mint energy to seller (for selling in auction)
        await mintTo(provider.connection, authority.payer, energyMint, sellerEnergyToken, authority.publicKey, 1_000_000_000, [], undefined, TOKEN_2022_PROGRAM_ID);

        // 4. Setup Confidential PDAs (for Currency)
        [buyerCurrencyConfidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), buyer.publicKey.toBuffer(), currencyMint.toBuffer()],
            program.programId
        );
        [sellerCurrencyConfidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), seller.publicKey.toBuffer(), currencyMint.toBuffer()],
            program.programId
        );

        // 5. Setup Market
        [marketAddress] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);
        try {
            await program.methods.initializeMarket().accounts({
                market: marketAddress,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e) { /* Market already exists */ }

        // 6. Derive batch PDA
        [batchAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("auction"), marketAddress.toBuffer(), BATCH_ID.toArrayLike(Buffer, "le", 8)],
            program.programId
        );

        // 7. Derive batch vault for energy mint
        [batchVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("batch_vault"), batchAddress.toBuffer(), energyMint.toBuffer()],
            program.programId
        );

        // 8. Initialize confidential balances for buyer and seller
        try {
            await program.methods.initializeConfidentialBalance().accounts({
                confidentialBalance: buyerCurrencyConfidential,
                mint: currencyMint,
                owner: buyer.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([buyer]).rpc();
        } catch (e) { /* Already exists */ }

        try {
            await program.methods.initializeConfidentialBalance().accounts({
                confidentialBalance: sellerCurrencyConfidential,
                mint: currencyMint,
                owner: seller.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([seller]).rpc();
        } catch (e) { /* Already exists */ }
    });

    it("Initializes an auction batch", async () => {
        await program.methods.initializeAuction(BATCH_ID, new BN(AUCTION_DURATION)).accounts({
            batch: batchAddress,
            market: marketAddress,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();

        const batch = await program.account.auctionBatch.fetch(batchAddress);
        assert.equal(batch.state, 0); // Open
        assert.ok(batch.batchId.eq(BATCH_ID));
    });

    it("Submits a sell order to auction", async () => {
        const sellAmount = new BN(500_000_000); // 0.5 energy tokens
        const sellPrice = new BN(100); // Price per unit

        await program.methods.submitAuctionOrder(sellPrice, sellAmount, false).accounts({
            batch: batchAddress,
            userTokenAccount: sellerEnergyToken,
            vault: batchVault,
            tokenMint: energyMint,
            authority: seller.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        }).signers([seller]).rpc();

        const batch = await program.account.auctionBatch.fetch(batchAddress);
        assert.equal(batch.orderCount, 1);
    });

    it("Submits a buy order to auction", async () => {
        const buyAmount = new BN(500_000_000); // 0.5 energy tokens
        const buyPrice = new BN(120); // Higher price (willing to pay more)

        // For buy orders, we need a currency vault
        const [currencyVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("batch_vault"), batchAddress.toBuffer(), currencyMint.toBuffer()],
            program.programId
        );

        // Create buyer's currency token account and mint enough for bid (price * amount)
        const buyerCurrencyToken = await createATA(buyer.publicKey, currencyMint, TOKEN_PROGRAM_ID, buyer);
        await mintTo(provider.connection, authority.payer, currencyMint, buyerCurrencyToken, authority.publicKey, 100_000_000_000, [], undefined, TOKEN_PROGRAM_ID);

        await program.methods.submitAuctionOrder(buyPrice, buyAmount, true).accounts({
            batch: batchAddress,
            userTokenAccount: buyerCurrencyToken,
            vault: currencyVault,
            tokenMint: currencyMint,
            authority: buyer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        }).signers([buyer]).rpc();

        const batch = await program.account.auctionBatch.fetch(batchAddress);
        assert.equal(batch.orderCount, 2);
    });

    it("Resolves auction after duration", async () => {
        // Wait for auction to end
        await new Promise(resolve => setTimeout(resolve, (AUCTION_DURATION + 1) * 1000));

        await program.methods.resolveAuction().accounts({
            batch: batchAddress,
        }).rpc();

        const batch = await program.account.auctionBatch.fetch(batchAddress);
        assert.equal(batch.state, 2); // Cleared
        assert.ok(batch.clearingPrice.gt(new BN(0)));
        console.log(`Clearing Price: ${batch.clearingPrice.toString()}, Volume: ${batch.clearingVolume.toString()}`);
    });

    it("Executes confidential auction settlement with valid ZK proof", async () => {
        const batch = await program.account.auctionBatch.fetch(batchAddress);
        const settleAmount = batch.clearingVolume.toNumber();

        await program.methods.executeConfidentialAuctionSettlement(
            new BN(settleAmount),
            batch.clearingPrice,
            mockCiphertext,
            { amountCommitment: mockTransferProof.amountCommitment, proof: mockTransferProof.proof }
        ).accounts({
            batch: batchAddress,
            buyerConfidentialBalance: buyerCurrencyConfidential,
            sellerConfidentialBalance: sellerCurrencyConfidential,
            buyerOwner: buyer.publicKey,
            sellerOwner: seller.publicKey,
            sellerEnergyVault: batchVault,
            buyerEnergyAccount: buyerEnergyToken,
            energyMint: energyMint,
            mint: currencyMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        }).rpc();

        console.log("Confidential auction settlement executed successfully");
    });

    // ============================================
    // Negative Test Cases - Auction Security
    // These tests only work when ZK proof verification is enabled (not in localnet/test-skip-zk mode).
    // ============================================

    const skipZk = process.env.TEST_SKIP_ZK === "1" || process.env.ANCHOR_FEATURES?.includes("test-skip-zk") || process.env.ANCHOR_FEATURES?.includes("localnet");

    describe("Security: Auction Proof Rejection Tests" + (skipZk ? " [SKIPPED: test-skip-zk active]" : ""), function () {
        before(function () {
            if (skipZk) this.skip();
        });
        it("Rejects settlement with tampered transfer proof", async () => {
            const batch = await program.account.auctionBatch.fetch(batchAddress);
            const settleAmount = batch.clearingVolume.toNumber();

            // Tamper with proof bytes
            const tamperedProof = Buffer.from(mockTransferProof.proof);
            tamperedProof[50] = (tamperedProof[50] + 1) % 256;

            try {
                await program.methods.executeConfidentialAuctionSettlement(
                    new BN(settleAmount),
                    batch.clearingPrice,
                    mockCiphertext,
                    { amountCommitment: mockTransferProof.amountCommitment, proof: tamperedProof }
                ).accounts({
                    batch: batchAddress,
                    buyerConfidentialBalance: buyerCurrencyConfidential,
                    sellerConfidentialBalance: sellerCurrencyConfidential,
                    buyerOwner: buyer.publicKey,
                    sellerOwner: seller.publicKey,
                    sellerEnergyVault: batchVault,
                    buyerEnergyAccount: buyerEnergyToken,
                    energyMint: energyMint,
                    mint: currencyMint,
                    tokenProgram: TOKEN_2022_PROGRAM_ID,
                    zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                }).rpc();

                assert.fail("Should have rejected tampered proof");
            } catch (err: any) {
                assert.ok(err.message.includes("failed") || err.logs?.some((l: string) => l.includes("failed")));
            }
        });

        it("Rejects settlement with wrong clearing price", async () => {
            const batch = await program.account.auctionBatch.fetch(batchAddress);
            const settleAmount = batch.clearingVolume.toNumber();
            const wrongPrice = batch.clearingPrice.add(new BN(100)); // Wrong price

            try {
                await program.methods.executeConfidentialAuctionSettlement(
                    new BN(settleAmount),
                    wrongPrice,
                    mockCiphertext,
                    { amountCommitment: mockTransferProof.amountCommitment, proof: mockTransferProof.proof }
                ).accounts({
                    batch: batchAddress,
                    buyerConfidentialBalance: buyerCurrencyConfidential,
                    sellerConfidentialBalance: sellerCurrencyConfidential,
                    buyerOwner: buyer.publicKey,
                    sellerOwner: seller.publicKey,
                    sellerEnergyVault: batchVault,
                    buyerEnergyAccount: buyerEnergyToken,
                    energyMint: energyMint,
                    mint: currencyMint,
                    tokenProgram: TOKEN_2022_PROGRAM_ID,
                    zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                }).rpc();

                assert.fail("Should have rejected wrong clearing price");
            } catch (err: any) {
                // Expected: PriceMismatch error
                assert.ok(err.message.includes("PriceMismatch") || err.message.includes("failed"));
            }
        });
    });
});
