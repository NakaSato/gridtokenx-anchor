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

const ZK_TOKEN_PROOF_PROGRAM_ID = new PublicKey("ZkTokenProof1111111111111111111111111111111");

describe("Confidential Settlement Integration", () => {
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

    // Real ZK data generated per test
    let transferProof: zk.TransferProofResult;
    let amountCiphertext: { data: number[] };

    async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey, payer: Keypair = authority.payer as any) {
        const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
        const ix = createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint, programId);
        const tx = new anchor.web3.Transaction().add(ix);
        await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [payer]);
        return ata;
    }

    before(async () => {
        // Airdrops
        for (const kp of [seller, buyer, escrowAuthority]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        // 1. Create Mints
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);
        currencyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 6, undefined, undefined, TOKEN_PROGRAM_ID);

        // 2. Setup ATAs
        sellerEnergyEscrow = await createATA(escrowAuthority.publicKey, energyMint, TOKEN_2022_PROGRAM_ID, escrowAuthority);
        buyerEnergyAccount = await createATA(buyer.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);

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
        } catch (e) { }

        // 5. Fund Seller Energy Escrow
        await mintTo(provider.connection, authority.payer, energyMint, sellerEnergyEscrow, authority.payer, 1000, [], undefined, TOKEN_2022_PROGRAM_ID);
    });

    it("Performs full flow: Confidential Match & Settlement", async () => {
        // A. Initialize Confidential Balances for Currency
        await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: buyerCurrencyConfidential,
            mint: currencyMint,
            owner: buyer.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([buyer]).rpc();

        await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: sellerCurrencyConfidential,
            mint: currencyMint,
            owner: seller.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([seller]).rpc();

        // B. Create Public Orders
        const sellOrderId = new BN(101);
        [sellOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createSellOrder(sellOrderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: sellOrderPda,
            ercCertificate: null,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([seller]).rpc();

        const buyOrderId = new BN(202);
        [buyOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createBuyOrder(buyOrderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: buyOrderPda,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([buyer]).rpc();

        // C. Execute Confidential Settlement
        // This will verify the payment (ZK) and transfer energy (Public)
        const amount = new BN(100);
        const price = new BN(50);

        // Use real ZK proof generation with valid scalars
        const senderBlinding = zk.generateValidBlinding();
        const amountBlinding = zk.generateValidBlinding();

        transferProof = zk.createTransferProof(
            BigInt(amount.toNumber()),
            BigInt(1000), // senderBalance (initial)
            senderBlinding,
            amountBlinding
        );

        // Mock a 64-byte ciphertext for the "amount" (this part is still abstracted in the program)
        amountCiphertext = { data: Array.from(Buffer.alloc(64, 0)) };

        await program.methods.executeConfidentialSettlement(
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

        // D. Verification
        const buyerEnergyBal = await provider.connection.getTokenAccountBalance(buyerEnergyAccount);
        assert.equal(buyerEnergyBal.value.amount, "100");

        const sellerBal = await program.account.confidentialBalance.fetch(sellerCurrencyConfidential);
        // lastUpdateSlot should be > 0 indicating it received a "transfer" update
        assert.ok(sellerBal.lastUpdateSlot.gtn(0));

        const buyOrder = await program.account.order.fetch(buyOrderPda);
        assert.equal(buyOrder.status, 2); // Completed
    });
});
