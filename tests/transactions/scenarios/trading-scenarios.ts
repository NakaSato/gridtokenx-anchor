/**
 * Trading Program Transaction Test Scenarios
 * 
 * Tests market operations, order creation, matching, and execution
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo
} from "@solana/spl-token";
import KeypairManager from "../keypair-manager.js";
import { TransactionReporter, StateValidator } from "../utils/index.js";
import { BN } from "bn.js";

export class TradingScenarios {
  private program: anchor.Program;
  private keypairManager: KeypairManager;
  private reporter: TransactionReporter;
  private validator: StateValidator;

  // State for sharing between steps/scenarios
  private marketPda: PublicKey | null = null;
  private currencyMint: PublicKey | null = null;
  private energyMint: PublicKey | null = null;

  constructor(
    program: anchor.Program,
    keypairManager: KeypairManager,
    reporter: TransactionReporter,
    validator: StateValidator
  ) {
    this.program = program;
    this.keypairManager = keypairManager;
    this.reporter = reporter;
    this.validator = validator;
  }

  async runAllScenarios(): Promise<void> {
    await this.testMarketInitialization();
    await this.testUpdateMarketParams();
    await this.testCreateOrders();
    await this.testMatchOrders();
    await this.testAtomicSettlement();
  }

  /**
   * Scenario 1: Market Initialization
   */
  async testMarketInitialization(): Promise<void> {
    this.reporter.startScenario("Market Initialization", "Trading");
    const authority = this.keypairManager.getDevWallet();
    const startTime = Date.now();

    try {
      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        this.program.programId
      );
      this.marketPda = marketPda;

      try {
        await (this.program.account as any).market.fetch(marketPda);
        this.reporter.recordTransaction({
          program: "Trading",
          operation: "initializeMarket",
          keypair: "dev-wallet",
          success: true,
          duration: Date.now() - startTime,
          timestamp: startTime,
          error: "Already initialized (expected)",
        });
      } catch (e: any) {
        const signature = await this.program.methods
          .initializeMarket()
          .accounts({
            market: marketPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();

        this.reporter.recordTransaction({
          program: "Trading",
          operation: "initializeMarket",
          keypair: "dev-wallet",
          signature,
          success: true,
          duration: Date.now() - startTime,
          timestamp: startTime,
        });
      }
    } catch (error: any) {
      this.reporter.recordTransaction({
        program: "Trading",
        operation: "initializeMarket",
        keypair: "dev-wallet",
        success: false,
        duration: Date.now() - startTime,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }
    this.reporter.endScenario();
  }

  /**
   * Scenario 2: Update Market Params
   */
  async testUpdateMarketParams(): Promise<void> {
    this.reporter.startScenario("Update Market Params", "Trading");
    const authority = this.keypairManager.getDevWallet();
    const startTime = Date.now();

    try {
      if (!this.marketPda) throw new Error("Market PDA missing");

      const signature = await this.program.methods
        .updateMarketParams(25, true)
        .accounts({
          market: this.marketPda,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      this.reporter.recordTransaction({
        program: "Trading",
        operation: "updateMarketParams",
        keypair: "dev-wallet",
        signature,
        success: true,
        duration: Date.now() - startTime,
        timestamp: startTime,
      });
    } catch (error: any) {
      this.reporter.recordTransaction({
        program: "Trading",
        operation: "updateMarketParams",
        keypair: "dev-wallet",
        success: false,
        duration: Date.now() - startTime,
        timestamp: startTime,
        error: error.message?.slice(0, 100),
      });
    }
    this.reporter.endScenario();
  }

  /**
   * Scenario 3: Create Buy/Sell Orders (Isolated)
   */
  async testCreateOrders(): Promise<void> {
    this.reporter.startScenario("Create Orders", "Trading");
    const seller = this.keypairManager.getProducers()[0];
    const buyer = this.keypairManager.getConsumers()[0];

    // Fund if needed
    const connection = this.program.provider.connection;
    await this.fundWallet(connection, seller.keypair.publicKey);
    await this.fundWallet(connection, buyer.keypair.publicKey);

    // 1. Create Sell Order
    const startTimeSell = Date.now();
    try {
      const marketAccount = await (this.program.account as any).market.fetch(this.marketPda);
      const activeOrders = new BN(marketAccount.activeOrders).toArrayLike(Buffer, 'le', 4);

      const [orderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order"), seller.keypair.publicKey.toBuffer(), activeOrders],
        this.program.programId
      );

      const signature = await this.program.methods
        .createSellOrder(new BN(1000), new BN(50))
        .accounts({
          market: this.marketPda!,
          order: orderPda,
          authority: seller.keypair.publicKey,
          ercCertificate: null,
          systemProgram: SystemProgram.programId
        })
        .signers([seller.keypair])
        .rpc();

      this.reporter.recordTransaction({
        program: "Trading",
        operation: "createSellOrder",
        keypair: "producer-0",
        signature,
        success: true,
        duration: Date.now() - startTimeSell,
        timestamp: startTimeSell,
      });
    } catch (e: any) {
      this.reporter.recordTransaction({
        program: "Trading",
        operation: "createSellOrder",
        keypair: "producer-0",
        success: false,
        duration: Date.now() - startTimeSell,
        timestamp: startTimeSell,
        error: e.message
      });
    }

    // 2. Create Buy Order
    const startTimeBuy = Date.now();
    try {
      const marketAccount = await (this.program.account as any).market.fetch(this.marketPda);
      const activeOrders = new BN(marketAccount.activeOrders).toArrayLike(Buffer, 'le', 4);

      const [orderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order"), buyer.keypair.publicKey.toBuffer(), activeOrders],
        this.program.programId
      );

      const signature = await this.program.methods
        .createBuyOrder(new BN(500), new BN(60))
        .accounts({
          market: this.marketPda!,
          order: orderPda,
          authority: buyer.keypair.publicKey,
          systemProgram: SystemProgram.programId
        })
        .signers([buyer.keypair])
        .rpc();

      this.reporter.recordTransaction({
        program: "Trading",
        operation: "createBuyOrder",
        keypair: "consumer-0",
        signature,
        success: true,
        duration: Date.now() - startTimeBuy,
        timestamp: startTimeBuy,
      });

    } catch (e: any) {
      this.reporter.recordTransaction({
        program: "Trading",
        operation: "createBuyOrder",
        keypair: "consumer-0",
        success: false,
        duration: Date.now() - startTimeBuy,
        timestamp: startTimeBuy,
        error: e.message
      });
    }
    this.reporter.endScenario();
  }

  /**
   * Helper: Create a pair of matching orders for a specific scenario
   */
  async createOrderPair(sellAmount: number, buyAmount: number, price: number): Promise<{ sellOrder: PublicKey, buyOrder: PublicKey }> {
    // Use fresh keypairs to isolate from previous tests, or distinct ones from manager
    // We'll use producers[1] and consumers[1] for match/settle tests to avoid seed collisions 
    // with testCreateOrders (producer[0]).
    const seller = this.keypairManager.getProducers()[1];
    const buyer = this.keypairManager.getConsumers()[1];

    // Fund if needed
    const connection = this.program.provider.connection;
    await this.fundWallet(connection, seller.keypair.publicKey);
    await this.fundWallet(connection, buyer.keypair.publicKey);

    // Create Sell
    let marketAccount = await (this.program.account as any).market.fetch(this.marketPda);
    let activeOrders = new BN(marketAccount.activeOrders).toArrayLike(Buffer, 'le', 4);
    const [sellOrder] = PublicKey.findProgramAddressSync(
      [Buffer.from("order"), seller.keypair.publicKey.toBuffer(), activeOrders],
      this.program.programId
    );
    await this.program.methods
      .createSellOrder(new BN(sellAmount), new BN(price))
      .accounts({
        market: this.marketPda!,
        order: sellOrder,
        authority: seller.keypair.publicKey,
        ercCertificate: null,
        systemProgram: SystemProgram.programId
      })
      .signers([seller.keypair])
      .rpc();

    // Create Buy
    marketAccount = await (this.program.account as any).market.fetch(this.marketPda);
    activeOrders = new BN(marketAccount.activeOrders).toArrayLike(Buffer, 'le', 4);
    const [buyOrder] = PublicKey.findProgramAddressSync(
      [Buffer.from("order"), buyer.keypair.publicKey.toBuffer(), activeOrders],
      this.program.programId
    );
    await this.program.methods
      .createBuyOrder(new BN(buyAmount), new BN(price))
      .accounts({
        market: this.marketPda!,
        order: buyOrder,
        authority: buyer.keypair.publicKey,
        systemProgram: SystemProgram.programId
      })
      .signers([buyer.keypair])
      .rpc();

    return { sellOrder, buyOrder };
  }

  /**
   * Scenario 4: Match Orders
   * Creates its own orders, matches them. No settlement.
   */
  async testMatchOrders(): Promise<void> {
    this.reporter.startScenario("Match Orders", "Trading");
    const authority = this.keypairManager.getDevWallet();
    const startTime = Date.now();

    try {
      // Create fresh orders
      const { sellOrder, buyOrder } = await this.createOrderPair(1000, 500, 50);

      const [tradeRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("trade"), buyOrder.toBuffer(), sellOrder.toBuffer()],
        this.program.programId
      );

      const signature = await this.program.methods
        .matchOrders(new BN(500)) // Match 500
        .accounts({
          market: this.marketPda!,
          buyOrder: buyOrder,
          sellOrder: sellOrder,
          tradeRecord: tradeRecordPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId
        })
        .signers([authority])
        .rpc();

      this.reporter.recordTransaction({
        program: "Trading",
        operation: "matchOrders",
        keypair: "dev-wallet",
        signature,
        success: true,
        duration: Date.now() - startTime,
        timestamp: startTime,
      });
    } catch (e: any) {
      this.reporter.recordTransaction({
        program: "Trading",
        operation: "matchOrders",
        keypair: "dev-wallet",
        success: false,
        duration: Date.now() - startTime,
        timestamp: startTime,
        error: e.message
      });
    }
    this.reporter.endScenario();
  }

  /**
   * Scenario 5: Atomic Settlement
   * Creates its own orders, settles them directly. 
   * Note: We assume executeAtomicSettlement handles the partial fill logic internally or replaces matching.
   * If it requires prior matching, then this test is invalid, but based on code analysis, it updates filled_amount itself.
   */
  async testAtomicSettlement(): Promise<void> {
    this.reporter.startScenario("Atomic Settlement", "Trading");
    const authority = this.keypairManager.getDevWallet();
    const startTime = Date.now();

    try {
      // Create fresh orders
      const { sellOrder, buyOrder } = await this.createOrderPair(1000, 500, 50);

      // A. Setup Token Environment
      const connection = this.program.provider.connection;
      const devWallet = this.keypairManager.getDevWallet();

      // 1. Create Mints
      if (!this.currencyMint) {
        this.currencyMint = await createMint(connection, devWallet, devWallet.publicKey, null, 6);
        this.energyMint = await createMint(connection, devWallet, devWallet.publicKey, null, 6);
      }

      // 2. Setup Escrow Accounts
      const buyerCurrencyEscrow = await getOrCreateAssociatedTokenAccount(
        connection, devWallet, this.currencyMint, devWallet.publicKey
      );
      await mintTo(connection, devWallet, this.currencyMint, buyerCurrencyEscrow.address, devWallet.publicKey, 100_000_000);

      const sellerEnergyEscrow = await getOrCreateAssociatedTokenAccount(
        connection, devWallet, this.energyMint, devWallet.publicKey
      );
      await mintTo(connection, devWallet, this.energyMint, sellerEnergyEscrow.address, devWallet.publicKey, 1000_000_000);

      // 3. Setup Destination Accounts
      const sellOrderAcct = await (this.program.account as any).order.fetch(sellOrder);
      const buyOrderAcct = await (this.program.account as any).order.fetch(buyOrder);

      const sellerCurrencyDest = await getOrCreateAssociatedTokenAccount(
        connection, devWallet, this.currencyMint, sellOrderAcct.seller
      );

      const buyerEnergyDest = await getOrCreateAssociatedTokenAccount(
        connection, devWallet, this.energyMint, buyOrderAcct.buyer
      );

      const feeCollector = await getOrCreateAssociatedTokenAccount(
        connection, devWallet, this.currencyMint, devWallet.publicKey
      );
      const wheelingCollector = await getOrCreateAssociatedTokenAccount(
        connection, devWallet, this.currencyMint, devWallet.publicKey
      );

      // B. Execute Settlement
      const signature = await this.program.methods
        .executeAtomicSettlement(
          new BN(500), // Amount
          new BN(50),  // Price
          new BN(0)    // Wheeling charge
        )
        .accounts({
          market: this.marketPda!,
          buyOrder: buyOrder,
          sellOrder: sellOrder,
          buyerCurrencyEscrow: buyerCurrencyEscrow.address,
          sellerEnergyEscrow: sellerEnergyEscrow.address,
          sellerCurrencyAccount: sellerCurrencyDest.address,
          buyerEnergyAccount: buyerEnergyDest.address,
          feeCollector: feeCollector.address,
          wheelingCollector: wheelingCollector.address,
          energyMint: this.energyMint,
          currencyMint: this.currencyMint,
          escrowAuthority: devWallet.publicKey,
          marketAuthority: devWallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          secondaryTokenProgram: TOKEN_PROGRAM_ID
        })
        .signers([devWallet])
        .rpc();

      this.reporter.recordTransaction({
        program: "Trading",
        operation: "executeAtomicSettlement",
        keypair: "dev-wallet",
        signature,
        success: true,
        duration: Date.now() - startTime,
        timestamp: startTime,
      });

    } catch (e: any) {
      this.reporter.recordTransaction({
        program: "Trading",
        operation: "executeAtomicSettlement",
        keypair: "dev-wallet",
        success: false,
        duration: Date.now() - startTime,
        timestamp: startTime,
        error: e.message
      });
    }
    this.reporter.endScenario();
  }

  // Helper
  private async fundWallet(connection: anchor.web3.Connection, pubkey: PublicKey) {
    const bal = await connection.getBalance(pubkey);
    if (bal < 1_000_000_000) {
      const sig = await connection.requestAirdrop(pubkey, 1_000_000_000);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...latest });
    }
  }
}

export default TradingScenarios;
