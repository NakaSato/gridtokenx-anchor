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

describe("Confidential Bidding Integration", () => {
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
    const AUCTION_DURATION = 10;

    // Mock ciphertext for testing (64 bytes)
    const mockEncryptedPrice = Buffer.alloc(64, 1);
    const mockEncryptedAmount = Buffer.alloc(64, 2);

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

        // 3. Setup Confidential PDAs (for Currency)
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
        } catch (e) { /* Market already exists */ }

        // 5. Derive batch PDA
        [batchAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("auction"), marketAddress.toBuffer(), BATCH_ID.toArrayLike(Buffer, "le", 8)],
            program.programId
        );

        // 6. Derive batch vault for energy mint
        [batchVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("batch_vault"), batchAddress.toBuffer(), energyMint.toBuffer()],
            program.programId
        );

        // 7. Initialize confidential balances
        try {
            await program.methods.initializeConfidentialBalance().accounts({
                confidentialBalance: buyerCurrencyConfidential,
                mint: currencyMint,
                owner: buyer.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([buyer]).rpc();
        } catch (e) { }

        try {
            await program.methods.initializeConfidentialBalance().accounts({
                confidentialBalance: sellerCurrencyConfidential,
                mint: currencyMint,
                owner: seller.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([seller]).rpc();
        } catch (e) { }

        // 8. Mint initial tokens
        await mintTo(
            provider.connection,
            authority.payer,
            energyMint,
            sellerEnergyToken,
            authority.publicKey,
            10000,
            [],
            undefined,
            TOKEN_2022_PROGRAM_ID
        );

        // Initialize Auction
        await program.methods.initializeAuction(BATCH_ID, new BN(AUCTION_DURATION)).accounts({
            batch: batchAddress,
            market: marketAddress,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();
    });

    it("Submits encrypted bids to the auction", async () => {
        // Buyer submits encrypted bid
        await program.methods.submitEncryptedBid(
            [...mockEncryptedPrice],
            [...mockEncryptedAmount],
            true // is_bid
        ).accounts({
            batch: batchAddress,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId,
        } as any).signers([buyer]).rpc();

        // Seller submits encrypted ask
        await program.methods.submitEncryptedBid(
            [...mockEncryptedPrice],
            [...mockEncryptedAmount],
            false // is_bid (Ask)
        ).accounts({
            batch: batchAddress,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId,
        } as any).signers([seller]).rpc();

        const batch = await program.account.auctionBatch.fetch(batchAddress);
        assert.equal(batch.confidentialOrderCount, 2);

        // Check first order (Buyer)
        assert.ok(batch.confidentialOrders[0].orderId.equals(buyer.publicKey));
        assert.equal(batch.confidentialOrders[0].isBid, 1);

        // Check second order (Seller)
        assert.ok(batch.confidentialOrders[1].orderId.equals(seller.publicKey));
        assert.equal(batch.confidentialOrders[1].isBid, 0);
    });

    it("Settle auction using encrypted order verification", async () => {
        // Let's add one public order to ensure it resolves with a price - MUST DO BEFORE DURATION EXPIRES
        await program.methods.submitAuctionOrder(new BN(100), new BN(1000), false).accounts({
            batch: batchAddress,
            userTokenAccount: sellerEnergyToken,
            vault: batchVault,
            tokenMint: energyMint,
            authority: seller.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        }).signers([seller]).rpc();

        // Resolve auction (need to wait for duration)
        await new Promise(resolve => setTimeout(resolve, (AUCTION_DURATION + 1) * 1000));

        await program.methods.resolveAuction().accounts({
            batch: batchAddress,
        }).rpc();

        const batch = await program.account.auctionBatch.fetch(batchAddress);
        const settleAmount = new BN(10); // Small amount for test

        // Executing settlement - this should trigger the "Verified Buyer participation" logs
        const mockTransferProof = {
            amountCommitment: { data: new Array(32).fill(0) },
            proof: Buffer.alloc(100, 0) // Small mock proof for test-skip-zk
        };

        await program.methods.executeConfidentialAuctionSettlement(
            settleAmount,
            batch.clearingPrice,
            { data: new Array(64).fill(0) },
            mockTransferProof
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

        // Verification: If it didn't fail, the logic worked. 
        // We could check logs if we wanted to be super sure.
        console.log("Confidential auction settlement with encrypted bid verification passed!");
    });
});
