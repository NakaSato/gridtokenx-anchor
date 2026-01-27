import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Trading } from "../target/types/trading";
import { assert } from "chai";
import BN from "bn.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";

describe("periodic-auction", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.Trading as Program<Trading>;
  const authority = provider.wallet; // Payer

  // User who will bid and ask
  const user = anchor.web3.Keypair.generate();

  let marketPda: anchor.web3.PublicKey;
  let batchPda: anchor.web3.PublicKey;
  let batchId: BN;
  const AUCTION_DURATION = 2;

  // Token State
  let currencyMint: anchor.web3.PublicKey;
  let energyMint: anchor.web3.PublicKey;
  let userCurrencyAccount: anchor.web3.PublicKey;
  let userEnergyAccount: anchor.web3.PublicKey;

  before(async () => {
    // Derive Market PDA
    [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("market")],
      program.programId
    );

    // Airdrop to user
    const sig = await connection.requestAirdrop(user.publicKey, 5 * anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);

    // Create Mints
    currencyMint = await createMint(connection, user, user.publicKey, null, 6);
    energyMint = await createMint(connection, user, user.publicKey, null, 9);

    // Create ATAs
    const userCurrency = await getOrCreateAssociatedTokenAccount(
      connection,
      user,
      currencyMint,
      user.publicKey
    );
    userCurrencyAccount = userCurrency.address;

    const userEnergy = await getOrCreateAssociatedTokenAccount(
      connection,
      user,
      energyMint,
      user.publicKey
    );
    userEnergyAccount = userEnergy.address;

    // Mint Tokens
    await mintTo(connection, user, currencyMint, userCurrencyAccount, user, 100000);
    await mintTo(connection, user, energyMint, userEnergyAccount, user, 100000);
  });

  it("Is initialized!", async () => {
    // Initialize Market (May already be initialized by other tests)
    try {
      await program.methods
        .initializeMarket()
        .accounts({
          market: marketPda,
          authority: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .rpc();
    } catch (e) {
      // console.log("Market already initialized or error:", e.message);
    }

    // Initialize Auction Batch
    batchId = new BN(Date.now());
    [batchPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("auction"), marketPda.toBuffer(), batchId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .initializeAuction(batchId, new BN(AUCTION_DURATION))
      .accounts({
        batch: batchPda,
        market: marketPda,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    const batchAccount = await program.account.auctionBatch.fetch(batchPda);
    assert.ok(batchAccount.state === 0);
  });

  it("Submits bids and asks", async () => {
    // Submit Bid (Buy Energy): User deposits Currency
    // Price = 50, Amount = 100
    // Logic: Bidder gives Currency

    // Derive Vault for Currency
    const [currencyVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("batch_vault"), batchPda.toBuffer(), currencyMint.toBuffer()],
      program.programId
    );

    await program.methods
      .submitAuctionOrder(new BN(50), new BN(100), true) // is_bid = true
      .accounts({
        batch: batchPda,
        userTokenAccount: userCurrencyAccount,
        vault: currencyVault,
        tokenMint: currencyMint,
        authority: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any) // Cast any to avoid partial match errors if types aren't perfect
      .signers([user])
      .rpc();

    // Submit Ask (Sell Energy): User deposits Energy
    // Price = 40, Amount = 100

    // Derive Vault for Energy
    const [energyVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("batch_vault"), batchPda.toBuffer(), energyMint.toBuffer()],
      program.programId
    );

    await program.methods
      .submitAuctionOrder(new BN(40), new BN(100), false) // is_bid = false
      .accounts({
        batch: batchPda,
        userTokenAccount: userEnergyAccount,
        vault: energyVault,
        tokenMint: energyMint,
        authority: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([user])
      .rpc();

    const batchAccount = await program.account.auctionBatch.fetch(batchPda);
    assert.equal(batchAccount.orders.length, 2);
  });

  it("Resolves the auction", async () => {
    console.log("Waiting for auction to end...");
    await new Promise((resolve) => setTimeout(resolve, AUCTION_DURATION * 1000 + 1000));

    await program.methods
      .resolveAuction()
      .accounts({
        batch: batchPda,
        authority: authority.publicKey,
      })
      .rpc();

    const batchAccount = await program.account.auctionBatch.fetch(batchPda);
    assert.ok(batchAccount.state === 2); // Cleared
    assert.ok(batchAccount.clearingVolume.eq(new BN(100)));
  });

  it("Executes settlement", async () => {
    // 0 = Bid (Buyer), 1 = Ask (Seller)

    // Derive Vaults
    const [buyerCurrencyVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("batch_vault"), batchPda.toBuffer(), currencyMint.toBuffer()],
      program.programId
    );
    const [sellerEnergyVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("batch_vault"), batchPda.toBuffer(), energyMint.toBuffer()],
      program.programId
    );

    await program.methods
      .executeSettlement(
        0, // Bid Index
        1, // Ask Index
        new BN(100) // Amount
      )
      .accounts({
        batch: batchPda,
        buyerCurrencyVault: buyerCurrencyVault,
        sellerEnergyVault: sellerEnergyVault,
        sellerCurrency: userCurrencyAccount, // Seller receives Currency
        buyerEnergy: userEnergyAccount,     // Buyer receives Energy
        currencyMint: currencyMint,
        energyMint: energyMint,
        buyerAuthority: user.publicKey,
        sellerAuthority: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .rpc();

    console.log("Settlement executed successfully.");
  });
});
