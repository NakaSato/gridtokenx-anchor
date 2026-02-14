import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo
} from "@solana/spl-token";

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyBridge() {
    console.log("Starting Bridge Verification...");

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<any>;
    const authority = provider.wallet.publicKey;

    // 1. Derive and setup accounts
    console.log("Setting up accounts...");
    const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        program.programId
    );

    // Initialize market if not exists
    try {
        const marketInfo = await provider.connection.getAccountInfo(marketPda);
        if (!marketInfo || !marketInfo.owner.equals(program.programId)) {
            console.log("Initializing Market...");
            await program.methods.initializeMarket().accounts({
                market: marketPda,
                authority: authority,
                systemProgram: SystemProgram.programId,
            }).rpc();
            await sleep(1000);
            console.log("Market Initialized");
        }
    } catch (e) {
        console.log("Market already exists or init failed");
    }

    const [bridgeConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_config"), marketPda.toBuffer()],
        program.programId
    );

    // Create mock GRID mint
    console.log("Creating mock GRID mint...");
    const gridMint = await createMint(
        provider.connection,
        (provider.wallet as any).payer,
        authority,
        null,
        9,
        undefined,
        { commitment: "confirmed" }
    );
    await sleep(2000);

    const [bridgeEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_escrow"), marketPda.toBuffer(), gridMint.toBuffer()],
        program.programId
    );

    console.log("Creating user ATA...");
    const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (provider.wallet as any).payer,
        gridMint,
        authority,
        false,
        "confirmed"
    );
    const userGridAccount = ata.address;
    await sleep(1000);

    console.log("Minting tokens...");
    await mintTo(
        provider.connection,
        (provider.wallet as any).payer,
        gridMint,
        userGridAccount,
        authority,
        1000 * 1_000_000_000,
        undefined,
        { commitment: "confirmed" }
    );
    await sleep(1000);

    // 2. Initializes Bridge Configuration
    console.log("Initializing Bridge Configuration...");
    try {
        const initTx = await program.methods.initializeBridge(
            new BN(10 * 1_000_000_000), // 10 GRID min
            25, // 0.25% fee
            new BN(1000000) // Relayer fee
        ).accounts({
            market: marketPda,
            bridgeConfig: bridgeConfigPda,
            wormholeProgram: new PublicKey("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5"),
            tokenBridgeProgram: new PublicKey("DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe"),
            authority: authority,
            systemProgram: SystemProgram.programId,
        }).rpc();
        await sleep(1000);
        console.log("Bridge Config Initialized:", initTx);
    } catch (e: any) {
        if (e.message.includes("already in use")) {
            console.log("Bridge Config already initialized.");
        } else {
            console.error("Init Bridge Error:", e);
        }
    }

    // 3. Initiates a bridge transfer
    console.log("Initiating bridge transfer...");
    const timestamp = new BN(Math.floor(Date.now() / 1000));
    const [bridgeTransferPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_transfer"), authority.toBuffer(), timestamp.toArrayLike(Buffer, 'le', 8)],
        program.programId
    );

    const destinationAddress = Buffer.alloc(32);
    Buffer.from("742d13f0b2a144c86419820147911a11ed7c1a59", "hex").copy(destinationAddress, 12);

    const amount = new BN(100 * 1_000_000_000);

    const tx = await program.methods.initiateBridgeTransfer(
        2, // Ethereum
        Array.from(destinationAddress),
        amount,
        timestamp
    ).accounts({
        bridgeConfig: bridgeConfigPda,
        market: marketPda,
        bridgeTransfer: bridgeTransferPda,
        tokenMint: gridMint,
        userTokenAccount: userGridAccount,
        bridgeEscrow: bridgeEscrowPda,
        user: authority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: new PublicKey("ATokenGPvbdP94vSpbaatFe7tWxyADGzJ1zL7pLDRBth"),
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }).rpc();

    console.log("Bridge transfer initiated:", tx);

    const transferAccount = await program.account.bridgeTransfer.fetch(bridgeTransferPda);
    console.log("Transfer status:", transferAccount.status);
    console.log("Amount (after fee):", transferAccount.amount.toString());

    if (transferAccount.status === 0) {
        console.log("Verification SUCCESS: Transfer is Pending as expected.");
    } else {
        console.error("Verification FAILED: Unexpected transfer status.");
        process.exit(1);
    }
}

verifyBridge().catch(err => {
    console.error(err);
    process.exit(1);
});
