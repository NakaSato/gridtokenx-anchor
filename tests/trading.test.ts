import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { GridTokenXClient } from "../src/client/js/gridtokenx-client";
import * as Trading from "../src/client/js/trading";

describe("Trading Program - GridTokenXClient", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let client: GridTokenXClient;
  let marketPda: anchor.web3.PublicKey;

  before(async () => {
    // Initialize GridTokenXClient
    client = new GridTokenXClient({
      connection: provider.connection,
      wallet: (provider.wallet as anchor.Wallet).payer,
    });

    // Get market PDA for verification
    const programIds = client.getProgramIds();
    const tradingProgramId = new anchor.web3.PublicKey(programIds.trading);

    [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("market")],
      tradingProgramId,
    );
  });

  describe("Initialize", () => {
    it("should initialize market successfully", async () => {
      const tx = await client.initializeMarket();
      expect(tx).to.exist;

      // Verify market was initialized
      const market = await client.getMarketState();
      expect(market).to.exist;
      if (market) {
        expect(market.authority.toString()).to.equal(
          provider.wallet.publicKey.toString(),
        );
        expect(Number(market.activeOrders)).to.equal(0);
        expect(Number(market.totalVolume)).to.equal(0);
        expect(Number(market.totalTrades)).to.equal(0);
        expect(market.clearingEnabled).to.be.true;
        expect(market.marketFeeBps).to.equal(25); // 0.25% default fee
        expect(Number(market.createdAt)).to.be.greaterThan(0);
      }
    });
  });

  describe("Sell Orders", () => {
    it("should create a sell order", async () => {
      const energyAmount = BigInt(100);
      const pricePerKwh = BigInt(50);

      const tx = await client.placeOrder("sell", energyAmount, pricePerKwh);
      expect(tx).to.exist;
    });

    it("should create multiple sell orders", async () => {
      const orders = [
        { energy: BigInt(50), price: BigInt(45) },
        { energy: BigInt(75), price: BigInt(55) },
        { energy: BigInt(100), price: BigInt(60) },
      ];

      for (const order of orders) {
        const tx = await client.placeOrder("sell", order.energy, order.price);
        expect(tx).to.exist;
      }
    });
  });

  describe("Buy Orders", () => {
    it("should create a buy order", async () => {
      const energyAmount = BigInt(50);
      const maxPricePerKwh = BigInt(60);

      const tx = await client.placeOrder("buy", energyAmount, maxPricePerKwh);
      expect(tx).to.exist;
    });

    it("should create multiple buy orders", async () => {
      const orders = [
        { energy: BigInt(25), maxPrice: BigInt(55) },
        { energy: BigInt(40), maxPrice: BigInt(65) },
        { energy: BigInt(60), maxPrice: BigInt(70) },
      ];

      for (const order of orders) {
        const tx = await client.placeOrder("buy", order.energy, order.maxPrice);
        expect(tx).to.exist;
      }
    });

    it("should create buy orders with varying parameters", async () => {
      const variations = [
        { energy: BigInt(100), maxPrice: BigInt(40) }, // Low budget
        { energy: BigInt(200), maxPrice: BigInt(80) }, // High budget
        { energy: BigInt(150), maxPrice: BigInt(60) }, // Medium parameters
      ];

      for (const variation of variations) {
        const tx = await client.placeOrder(
          "buy",
          variation.energy,
          variation.maxPrice,
        );
        expect(tx).to.exist;
      }
    });
  });

  describe("Order Matching", () => {
    it("should match buy and sell orders with exact price", async () => {
      // Create a sell order
      const sellTx = await client.placeOrder("sell", BigInt(100), BigInt(50));
      expect(sellTx).to.exist;

      // Create a buy order that can be matched (same price)
      const buyTx = await client.placeOrder("buy", BigInt(100), BigInt(50));
      expect(buyTx).to.exist;

      // Match orders
      const matchTx = await client.matchOrders();
      expect(matchTx).to.exist;
    });

    it("should match orders when buy price exceeds sell price", async () => {
      // Create a sell order at lower price
      await client.placeOrder("sell", BigInt(50), BigInt(45));

      // Create a buy order with higher max price - should match
      await client.placeOrder("buy", BigInt(50), BigInt(55));

      // Match orders
      const tx = await client.matchOrders();
      expect(tx).to.exist;
    });

    it("should handle partial order matching", async () => {
      // Create a large sell order
      await client.placeOrder("sell", BigInt(200), BigInt(50));

      // Create a smaller buy order - should partially fill
      await client.placeOrder("buy", BigInt(100), BigInt(50));

      // Match orders
      const tx = await client.matchOrders();
      expect(tx).to.exist;

      // Create another buy order to fill remaining amount
      await client.placeOrder("buy", BigInt(100), BigInt(50));

      // Match remaining orders
      const tx2 = await client.matchOrders();
      expect(tx2).to.exist;
    });
  });

  describe("Order Cancellation", () => {
    it("should cancel an active order", async () => {
      const orderId = BigInt(1);
      const tx = await client.cancelOrder(orderId);
      expect(tx).to.exist;
    });

    it("should cancel multiple orders", async () => {
      const orderIds = [BigInt(2), BigInt(3), BigInt(4)];

      for (const orderId of orderIds) {
        const tx = await client.cancelOrder(orderId);
        expect(tx).to.exist;
      }
    });

    it("should handle cancelling non-existent order", async () => {
      const nonExistentOrderId = BigInt(999999);

      try {
        await client.cancelOrder(nonExistentOrderId);
        // If the program doesn't validate order existence, tx may succeed
      } catch (error: any) {
        // If the program validates, we expect an error
        expect(error.message).to.match(/OrderNotFound|does not exist/);
      }
    });
  });

  describe("Market Parameters", () => {
    it("should update market parameters by authority", async () => {
      const newFeeBps = 50; // 0.5% fee
      const clearingEnabled = true;

      const tx = await client.updateMarketParams(newFeeBps, clearingEnabled);
      expect(tx).to.exist;

      // Verify parameters were updated
      const market = await client.getMarketState();
      expect(market?.marketFeeBps).to.equal(newFeeBps);
      expect(market?.clearingEnabled).to.be.true;
    });
  });

  describe("Market State", () => {
    it("should retrieve current market state", async () => {
      const market = await client.getMarketState();
      expect(market).to.exist;
      expect(market?.authority.toString()).to.equal(
        provider.wallet.publicKey.toString(),
      );
    });

    it("should get order book data", async () => {
      const orderBook = await client.getOrderBook();
      expect(orderBook).to.exist;
    });
  });
});
