import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    TestEnvironment,
    expect,
    describe,
    it,
    before
} from "./setup";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { Registry } from "../target/types/registry";
import { EnergyToken } from "../target/types/energy_token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
    createAssociatedTokenAccount,
    getAssociatedTokenAddress,
    createMint,
    mintTo,
    createTransferInstruction
} from "@solana/spl-token";
import BN from "bn.js";

// Constants
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

describe("Advanced P2P Trading: Mint-from-Meter & Dynamic Pricing", () => {
    let env: TestEnvironment;
    let tradingProgram: Program<Trading>;
    let governanceProgram: Program<Governance>;
    let registryProgram: Program<Registry>;
    let energyTokenProgram: Program<EnergyToken>;
    let marketAuthority: Keypair;

    // Users
    let seller: Keypair;
    let buyer: Keypair;
    let escrowAuthority: Keypair;

    // PDAs
    let marketAddress: PublicKey;
    let pricingConfig: PublicKey;
    let registryConfig: PublicKey;
    let sellerUserAccount: PublicKey;
    let meterAccount: PublicKey;
    let tokenInfo: PublicKey; // Energy Token Global State
    let energyMint: PublicKey; // The mint created by Energy Token Program

    // Token Accounts
    let sellerEnergyAccount: PublicKey;
    let sellerCurrencyAccount: PublicKey;
    let buyerEnergyAccount: PublicKey;
    let buyerCurrencyAccount: PublicKey;

    // Escrow
    let sellerEnergyEscrow: PublicKey;
    let buyerCurrencyEscrow: PublicKey;
    let feeCollector: PublicKey;
    let wheelingCollector: PublicKey;
    let currencyMint: PublicKey; // We'll need a mock currency mint

    // Dynamic Data
    const METER_ID = "SMART-METER-X99";
    const BASE_PRICE = new BN(4000000); // 4.00 USDC
    const MIN_PRICE = new BN(2000000);  // 2.00 USDC
    const MAX_PRICE = new BN(8000000); // 8.00 USDC

    before(async () => {
        env = await TestEnvironment.create();
        tradingProgram = env.tradingProgram;
        governanceProgram = env.governanceProgram;
        registryProgram = env.registryProgram;
        energyTokenProgram = env.energyTokenProgram;
        marketAuthority = env.authority;

        seller = Keypair.generate();
        buyer = Keypair.generate();
        escrowAuthority = Keypair.generate();

        await requestAirdrop(env.connection, seller.publicKey);
        await requestAirdrop(env.connection, buyer.publicKey);
        await requestAirdrop(env.connection, escrowAuthority.publicKey);

        // --- PDA Derivations ---

        [marketAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("market")],
            tradingProgram.programId
        );

        [pricingConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("pricing_config"), marketAddress.toBuffer()],
            tradingProgram.programId
        );

        [registryConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry")],
            registryProgram.programId
        );

        [tokenInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("token_info_2022")],
            energyTokenProgram.programId
        );

        // Mint is derived from token_info in the new version? 
        // Checking InitializeToken instruction in energy_token... 
        // seeds = [b"mint_2022"], mint::authority = token_info
        [energyMint] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_2022")],
            energyTokenProgram.programId
        );

        [sellerUserAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("user"), seller.publicKey.toBuffer()],
            registryProgram.programId
        );

        [meterAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter"), seller.publicKey.toBuffer(), Buffer.from(METER_ID)],
            registryProgram.programId
        );

        // --- Initialization Steps (Idempotent-ish) ---

        // 1. Initialize Registry
        try {
            await registryProgram.methods.initialize()
                .accounts({
                    registry: registryConfig,
                    authority: marketAuthority.publicKey,
                    systemProgram: SystemProgram.programId
                })
                .signers([marketAuthority])
                .rpc();
            // Set Oracle (using MarketAuth for simplicity)
            await registryProgram.methods.setOracleAuthority(marketAuthority.publicKey)
                .accounts({
                    registry: registryConfig,
                    authority: marketAuthority.publicKey
                })
                .signers([marketAuthority])
                .rpc();
        } catch (e) { /* Assume initialized */ }

        // 2. Initialize Energy Token
        try {
            await energyTokenProgram.methods.initializeToken(registryProgram.programId)
                .accounts({
                    // @ts-ignore
                    tokenInfo: tokenInfo,
                    // @ts-ignore
                    mint: energyMint,
                    authority: marketAuthority.publicKey,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY
                })
                .signers([marketAuthority])
                .rpc();
            console.log("      Energy Token Initialized");
        } catch (e) { /* Assume initialized */ }

        // 3. Initialize Market & Pricing
        try {
            await tradingProgram.methods.initializeMarket()
                .accounts({
                    market: marketAddress,
                    authority: marketAuthority.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([marketAuthority])
                .rpc();
        } catch (e) { /* Assume initialized */ }

        try {
            await tradingProgram.methods.initializePricingConfig(
                BASE_PRICE,
                MIN_PRICE,
                MAX_PRICE,
                700 // +7 UTC (Bangkok)
            ).accounts({
                pricingConfig: pricingConfig,
                market: marketAddress,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId
            }).signers([marketAuthority]).rpc();
            console.log("      Pricing Config Initialized");
        } catch (e) { /* Assume initialized */ }

        // 4. Create Mock Currency Mint (USDC)
        // We can't easily create a real SPL mint with Anchor client directly within the same flow cleanly 
        // without importing spl-token library calls, which we have.
        // But for simplicity use a placeholder or create one.
        // Let's create a standard SPL mint.
        const mintAuth = Keypair.generate();
        await requestAirdrop(env.connection, mintAuth.publicKey);

        // We'll use a library helper if available, or raw transaction
        // Actually p2p_energy_trading.ts used createMint from @solana/spl-token
        // const { createMint, mintTo } = require("@solana/spl-token");
        currencyMint = await createMint(env.connection, mintAuth, mintAuth.publicKey, null, 6);

        // Setup User Token Accounts
        // Seller needs Energy Account (to receive mint) & Currency Account (to receive $)
        sellerEnergyAccount = await createAssociatedTokenAccount(env.connection, seller, energyMint, seller.publicKey);
        sellerCurrencyAccount = await createAssociatedTokenAccount(env.connection, seller, currencyMint, seller.publicKey);
        // Buyer needs Currency Account (to pay $) & Energy Account (to receive energy)
        buyerCurrencyAccount = await createAssociatedTokenAccount(env.connection, buyer, currencyMint, buyer.publicKey);
        buyerEnergyAccount = await createAssociatedTokenAccount(env.connection, buyer, energyMint, buyer.publicKey);

        // Mint some currency to buyer
        await mintTo(env.connection, mintAuth, currencyMint, buyerCurrencyAccount, mintAuth, 1000000000); // 1000 USDC

        // Escrows
        // Note: In real app, escrows are PDAs or ATAs owned by the program/escrow authority.
        // Here we use ATAs owned by escrowAuthority for simplicity, matching the previous test.
        sellerEnergyEscrow = await createAssociatedTokenAccount(env.connection, escrowAuthority, energyMint, escrowAuthority.publicKey);
        buyerCurrencyEscrow = await createAssociatedTokenAccount(env.connection, escrowAuthority, currencyMint, escrowAuthority.publicKey);

        // Collectors
        feeCollector = await createAssociatedTokenAccount(env.connection, marketAuthority, currencyMint, marketAuthority.publicKey);

        const wheelingAuth = Keypair.generate();
        await requestAirdrop(env.connection, wheelingAuth.publicKey);
        wheelingCollector = await createAssociatedTokenAccount(env.connection, marketAuthority, currencyMint, wheelingAuth.publicKey);

    });

    it("Step 1: Register User & Meter", async () => {
        // Register Seller
        await registryProgram.methods.registerUser(
            { prosumer: {} }, // UserType
            13.7563, // Lat
            100.5018 // Long
        ).accounts({
            // @ts-ignore
            userAccount: sellerUserAccount,
            // @ts-ignore
            registry: registryConfig,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId
        }).signers([seller]).rpc();

        // Register Meter
        await registryProgram.methods.registerMeter(
            METER_ID,
            { solar: {} }
        ).accounts({
            // @ts-ignore
            meterAccount: meterAccount,
            userAccount: sellerUserAccount,
            // @ts-ignore
            registry: registryConfig,
            owner: seller.publicKey,
            systemProgram: SystemProgram.programId
        }).signers([seller]).rpc();

        const meter = await registryProgram.account.meterAccount.fetch(meterAccount);
        expect(meter.owner.toBase58()).to.equal(seller.publicKey.toBase58());
    });

    it("Step 2: Update Meter Reading & Mint Tokens (Automated)", async () => {
        const GENERATION = new BN(500000); // 500 kWh (assuming 3 decimals or so, wait.. EnergyToken is 9 decimals?)
        // EnergyToken is 9 decimals. 1 Token = 1 Wh usually? Or 1 kWh?
        // Let's assume 1 unit = 1 Wh. 500,000 unit = 500 kWh.

        // Update Reading via Oracle (MarketAuthority)
        await registryProgram.methods.updateMeterReading(
            GENERATION,
            new BN(0),
            new BN(Math.floor(Date.now() / 1000))
        ).accounts({
            registry: registryConfig,
            meterAccount: meterAccount,
            oracleAuthority: marketAuthority.publicKey
        }).signers([marketAuthority]).rpc();

        // Settle & Mint
        // This triggers the CPI from Registry -> EnergyToken
        await registryProgram.methods.settleAndMintTokens()
            .accounts({
                meterAccount: meterAccount,
                meterOwner: seller.publicKey,
                tokenInfo: tokenInfo,
                mint: energyMint,
                userTokenAccount: sellerEnergyAccount,
                authority: marketAuthority.publicKey, // This might be tricky. Who authorizes the mint in CPI?
                // The Registry program signer? No, Registry calls MintDirect.
                // energy_token:mint_tokens_direct checks `ctx.accounts.authority.key() == token_info.authority`
                // token_info.authority is MarketAuthority.
                // So Registry needs to sign? Or we pass MarketAuthority as signer to Registry call?
                // Registry `settle_and_mint_tokens` has `authority` account but it is NOT a signer in the struct:
                /* 
                    pub authority: AccountInfo<'info>, // passed to CPI
                    pub meter_owner: Signer<'info>,
                */
                // Wait, if `authority` is not a signer in `SettleAndMintTokens`, it can't sign the CPI.
                // In `mint_tokens_direct(ctx, ...)`: `pub authority: Signer<'info>` is required!
                // So `SettleAndMintTokens` struct in Registry must have `authority` as Signer if it passes it along?
                // OR `disk` check: Registry `lib.rs`:
                /*
                    pub authority: AccountInfo<'info>,
                    ...
                    let cpi_accounts = ... { ..., authority: ctx.accounts.authority.to_account_info() }
                */
                // If the target expects a Signer, the source must allow it to be a signer. 
                // But `settle_and_mint_tokens` does NOT declare `authority` as Signer.
                // This implies `mint_tokens_direct` might NOT enforce signer if called via PDA? 
                // NO, `mint_tokens_direct` struct: `pub authority: Signer<'info>`.
                // This looks like a potential bug in `registry` program if it intends to proxy the authority signature.
                // UNLESS `token_info.authority` is the Registry Program itself?
                // In Setup: `token_info.authority = ctx.accounts.authority.key()` (MarketAuth).
                // So MarketAuth must sign.
                // But `registry` instruction doesn't require MarketAuth signature.

                // HYPOTHESIS: This step might FAIL if the Registry program `settle_and_mint_tokens` implementation 
                // doesn't support passing the signature.
                // Let's try passing MarketAuthority as a signer to the transaction even if not strictly required by Anchor IDL?
                // Use `signers([seller, marketAuthority])`. 
                // But Anchor IDL for `settleAndMintTokens` says `meterOwner` is Signer. `authority` is Unchecked/AccountInfo.
                // If we pass a signer account to a non-signer slot, it remains a signer in the array.
                // So `authority.is_signer` should be true.

                // Let's try.
                energyTokenProgram: energyTokenProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID
            })
            // We need MarketAuthority to sign the underlying Mint, so we must add it here.
            .signers([seller, marketAuthority])
            .rpc();

        // Check Balance
        const balance = await env.connection.getTokenAccountBalance(sellerEnergyAccount);
        expect(balance.value.amount).to.equal(GENERATION.toString());
    });

    it("Step 3: Dynamic Pricing Update", async () => {
        // Simulate High Demand to push price up
        // Base: 4.00
        // Supply: 1000
        // Demand: 1500 (Ratio 1.5)
        // Sensitivity: 5% (500 bps)
        // Adjustment: (1.5 - 1.0) * 0.05 * Base = 0.5 * 0.05 * 4 = 0.1
        // New Price ~ 4.10

        await tradingProgram.methods.updateMarketData(
            new BN(1000), // Supply
            new BN(1500), // Demand
            100 // Congestion Normal
        ).accounts({
            pricingConfig: pricingConfig,
            authority: marketAuthority.publicKey
        }).signers([marketAuthority]).rpc();

        // Check Event or fetch Snapshot? 
        // We simulate a Mid-Peak timestamp (e.g., 14:00 Local) to avoid Off-Peak (0.7x) reduction
        // masking the supply/demand increase.
        // 14:00 Local (+7 UTC) = 07:00 UTC.
        // We use start of today UTC + 7 hours.
        const currentMs = Date.now();
        const startOfDay = currentMs - (currentMs % 86400000);
        const midPeakTime = Math.floor((startOfDay + (7 * 3600 * 1000)) / 1000);

        const [snapshotAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("price_snapshot"), marketAddress.toBuffer(), new BN(midPeakTime).toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );

        await tradingProgram.methods.createPriceSnapshot(new BN(midPeakTime))
            .accounts({
                pricingConfig: pricingConfig,
                snapshot: snapshotAddress,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId
            })
            .signers([marketAuthority])
            .rpc();

        const snapshot = await tradingProgram.account.priceSnapshot.fetch(snapshotAddress);
        console.log("      Dynamic Price:", snapshot.price.toString());

        // Expect price > Base Price (4000000)
        expect(snapshot.price.gt(BASE_PRICE)).to.be.true();

        // Save for next step
        global.dynamicPrice = snapshot.price;
    });

    it("Step 4: Trading at Dynamic Price", async () => {
        const tradeAmount = new BN(100); // 100 units
        // @ts-ignore
        const tradePrice = global.dynamicPrice || BASE_PRICE;

        // 1. Seller transfers Energy to Escrow (Manual transfer for P2P, normally initiated by Order Creation if approved)
        // For this test we assume order creation logic doesn't auto-pull unless we wrap it. 
        // Standard flow: User approves Delegate, then Program PULLS.
        // OR User transfers to Escrow.
        // In `create_sell_order`, it doesn't transfer tokens. 
        // `match_orders` -> `execute_atomic_settlement` transfers from Escrow -> User.
        // So tokens must be in Escrow BEFORE settlement.
        // Seller -> SellerEscrow

        // const { createTransferInstruction } = require("@solana/spl-token");
        const tx = new anchor.web3.Transaction().add(
            createTransferInstruction(
                sellerEnergyAccount,
                sellerEnergyEscrow,
                seller.publicKey,
                100
            )
        );
        await env.connection.sendTransaction(tx, [seller]);

        // Buyer deposits Currency to Escrow
        const tx2 = new anchor.web3.Transaction().add(
            createTransferInstruction(
                buyerCurrencyAccount,
                buyerCurrencyEscrow,
                buyer.publicKey,
                100 * tradePrice.toNumber() // Safe enough for small numbers
            )
        );
        await env.connection.sendTransaction(tx2, [buyer]);


        // 2. Create Orders
        const sellOrderId = new BN(Date.now());
        const [sellOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );

        await tradingProgram.methods.createSellOrder(
            sellOrderId,
            tradeAmount,
            tradePrice
        ).accounts({
            market: marketAddress,
            order: sellOrder,
            ercCertificate: null, // Optional
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId
        }).signers([seller]).rpc();

        // Create Buy Order
        const buyOrderId = new BN(Date.now() + 1);
        const [buyOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );

        await tradingProgram.methods.createBuyOrder(
            buyOrderId,
            tradeAmount,
            tradePrice // Max price matches
        ).accounts({
            market: marketAddress,
            order: buyOrder,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId
        }).signers([buyer]).rpc();


        // 3. Match & Settle in Batches or Atomic
        // We'll use Match then Atomic Settlement
        const [tradeRecord] = PublicKey.findProgramAddressSync(
            [Buffer.from("trade"), sellOrder.toBuffer(), buyOrder.toBuffer()],
            tradingProgram.programId // Actually `trade` PDA format might differ, checking `MatchOrders`
            // `pub trade_record: Account<'info, TradeRecord>` -> init seeds?
        );
        // Wait, `MatchOrders` struct in `lib.rs`:
        /*
            pub trade_record: Account<'info, TradeRecord>, // NOT init?
            // If it's not init, it must exist? Or is it ZeroCopy?
            // Let's check `MatchOrders` context in `lib.rs` (I can't see full context in view).
            // Usually it's `init`. 
            // I'll assume standard anchor init logic if seeds are present.
            // If checking `lib.rs` again...
        */

        // Since I can't confirm the TradeRecord seeds from the snippet, 
        // and `execute_atomic_settlement` DOES NOT take `trade_record`, 
        // I might skipping `match_orders` if `atomic_settlement` doesn't depend on it?
        // `match_orders` logic: Updates matched amount, sets status.
        // `execute_atomic` logic: Checks status.
        // So we MUST call `match_orders` OR `execute_atomic` directly if it handles matching?
        // `execute_atomic_settlement` -> "Execute a truly atomic settlement ... This performs both currency and energy transfers"
        // It updates `filled_amount` too!
        // `buy_order.filled_amount += amount;`
        // So `execute_atomic_settlement` IS the match+settle function combined?
        // NO, `match_orders` seems to be for "Matching Engine" (Order Book update)
        // and `atomic_settlement` is for "Settlement".
        // BUT `atomic_settlement` logic in `lib.rs` line 550 ALSO updates `filled_amount`.
        // This effectively double-counts if we run both?
        // Block comment on `MatchOrders`: "Match a buy order with a sell order ... updates status ... Create trade record".
        // Block comment on `ExecuteAtomicSettlement`: "Execute a truly atomic settlement ... both currency and energy transfers... Update State".
        // It seems they are ALTERNATIVE paths or sequential for different use cases?
        // If I run `match_orders`, status becomes `Completed` (if full). 
        // `execute_atomic_settlement` requires status `Active` or `PartiallyFilled`.
        // So if I run `match_orders` first, I CANNOT run `atomic_settlement` on the same amount.
        // `match_orders` creates a record but DOES NOT transfer tokens (Logic line 289: update stats, emit event).
        // `atomic_settlement` DOES transfer tokens.

        // CONCLUSION: `execute_atomic_settlement` is the one we want for the "Atomic P2P" flow.

        await tradingProgram.methods.executeAtomicSettlement(
            tradeAmount,
            tradePrice,
            new BN(0) // wheeling
        ).accounts({
            market: marketAddress,
            buyOrder: buyOrder,
            sellOrder: sellOrder,
            buyerCurrencyEscrow: buyerCurrencyEscrow,
            sellerEnergyEscrow: sellerEnergyEscrow,
            sellerCurrencyAccount: sellerCurrencyAccount,
            buyerEnergyAccount: buyerEnergyAccount,
            feeCollector: feeCollector,
            wheelingCollector: wheelingCollector,
            energyMint: energyMint,
            currencyMint: currencyMint,
            escrowAuthority: escrowAuthority.publicKey,
            marketAuthority: marketAuthority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            secondaryTokenProgram: TOKEN_PROGRAM_ID
        }).signers([escrowAuthority, marketAuthority]).rpc();

        // 4. Verify Balances
        const buyerEnergy = await env.connection.getTokenAccountBalance(buyerEnergyAccount);
        expect(buyerEnergy.value.amount).to.equal(tradeAmount.toString());

        console.log("      Trade Complete at Price:", tradePrice.toString());
    });
});

async function requestAirdrop(connection: anchor.web3.Connection, address: PublicKey) {
    const sig = await connection.requestAirdrop(address, 5 * anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
}
