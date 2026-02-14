import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL,
    Connection
} from "@solana/web3.js";
import {
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { assert } from "chai";
import type { Registry } from "../target/types/registry";
import type { EnergyToken } from "../target/types/energy_token";

/**
 * Test Suite: Airdrop Verification for New Accounts
 * 
 * This test suite verifies that:
 * 1. New accounts can be registered
 * 2. Initial tokens are distributed to new accounts (airdrop)
 * 3. Token balances are correctly initialized
 * 4. Multiple accounts receive proper airdrop amounts
 */
describe("Airdrop Verification for New Accounts", () => {
    // Get provider from environment or use default
    const getProvider = () => {
        try {
            return anchor.AnchorProvider.env();
        } catch (e) {
            // Fallback: use a local connection
            const connection = new Connection("http://localhost:8899", "processed");
            const wallet = anchor.Wallet.local();
            return new anchor.AnchorProvider(connection, wallet, { commitment: "processed" });
        }
    };

    const provider = getProvider();
    anchor.setProvider(provider);

    const registryProgram = anchor.workspace.Registry as Program<Registry>;
    const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
    const authority = provider.wallet as anchor.Wallet;

    // Test data
    const INITIAL_AIRDROP_AMOUNT = 1000; // Initial tokens for new account
    const NEW_ACCOUNTS_TO_TEST = 3;
    
    let tokenInfo: PublicKey;
    let mint: PublicKey;
    let registryConfig: PublicKey;
    let newAccounts: Array<{
        keypair: Keypair;
        userAccount: PublicKey;
        tokenAccount: PublicKey;
        expectedBalance: BN;
    }> = [];

    before(async () => {
        // Derive PDAs
        [tokenInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("token_info_2022")],
            energyTokenProgram.programId
        );
        [mint] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_2022")],
            energyTokenProgram.programId
        );
        [registryConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry")],
            registryProgram.programId
        );

        // Initialize energy token program
        try {
            await energyTokenProgram.methods.initializeToken(registryProgram.programId).accounts({
                tokenInfo: tokenInfo,
                mint: mint,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY
            }).rpc();
            console.log("✓ Energy token program initialized");
        } catch (e: any) {
            if (!e.message.includes("already in use")) {
                throw e;
            }
            console.log("✓ Energy token program already initialized");
        }

        // Initialize registry
        try {
            await registryProgram.methods.initialize().accounts({
                registry: registryConfig,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
            console.log("✓ Registry program initialized");
        } catch (e: any) {
            if (!e.message.includes("already in use")) {
                throw e;
            }
            console.log("✓ Registry program already initialized");
        }

        // Create test accounts
        for (let i = 0; i < NEW_ACCOUNTS_TO_TEST; i++) {
            const keypair = Keypair.generate();
            
            // Airdrop SOL for transaction fees
            const sig = await provider.connection.requestAirdrop(
                keypair.publicKey,
                2 * LAMPORTS_PER_SOL
            );
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
            
            // Derive user account PDA
            const [userAccount] = PublicKey.findProgramAddressSync(
                [Buffer.from("user"), keypair.publicKey.toBuffer()],
                registryProgram.programId
            );
            
            // Derive token account for the new user
            const tokenAccount = getAssociatedTokenAddressSync(
                mint,
                keypair.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID
            );
            
            newAccounts.push({
                keypair,
                userAccount,
                tokenAccount,
                expectedBalance: new BN(INITIAL_AIRDROP_AMOUNT)
            });
        }

        console.log(`✓ Created ${NEW_ACCOUNTS_TO_TEST} test accounts with SOL funding`);
    });

    it("should register new users and create user accounts", async () => {
        for (let i = 0; i < newAccounts.length; i++) {
            const { keypair, userAccount } = newAccounts[i];
            
            await registryProgram.methods.registerUser(
                { prosumer: {} },
                15.0 + i * 0.1, // latitude
                100.0 + i * 0.1  // longitude
            ).accounts({
                userAccount: userAccount,
                registry: registryConfig,
                authority: keypair.publicKey,
                systemProgram: SystemProgram.programId
            }).signers([keypair]).rpc();

            // Verify user account was created
            const account = await registryProgram.account.userAccount.fetch(userAccount);
            assert.ok(account.authority.equals(keypair.publicKey), `User ${i} authority mismatch`);
            console.log(`✓ User ${i} registered successfully`);
        }
    });

    it("should create token accounts for new users", async () => {
        for (let i = 0; i < newAccounts.length; i++) {
            const { keypair, tokenAccount } = newAccounts[i];
            
            // Create associated token account instruction
            const ix = createAssociatedTokenAccountInstruction(
                authority.publicKey,
                tokenAccount,
                keypair.publicKey,
                mint,
                TOKEN_2022_PROGRAM_ID
            );
            
            await anchor.web3.sendAndConfirmTransaction(
                provider.connection,
                new anchor.web3.Transaction().add(ix),
                [authority.payer]
            );
            
            console.log(`✓ Token account created for user ${i}`);
        }
    });

    it("should airdrop initial tokens to new users", async () => {
        for (let i = 0; i < newAccounts.length; i++) {
            const { tokenAccount, expectedBalance } = newAccounts[i];
            
            // Mint initial tokens to the new user account
            await energyTokenProgram.methods.mintToWallet(expectedBalance).accounts({
                mint: mint,
                tokenInfo: tokenInfo,
                destination: tokenAccount,
                destinationOwner: newAccounts[i].keypair.publicKey,
                authority: authority.publicKey,
                payer: authority.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId
            }).rpc();
            
            console.log(`✓ Airdrop of ${INITIAL_AIRDROP_AMOUNT} tokens sent to user ${i}`);
        }
    });

    it("should verify token balances after airdrop", async () => {
        for (let i = 0; i < newAccounts.length; i++) {
            const { tokenAccount, expectedBalance } = newAccounts[i];
            
            // Check token balance
            const balance = await provider.connection.getTokenAccountBalance(tokenAccount);
            const actualBalance = new BN(balance.value.amount);
            
            assert.equal(
                actualBalance.toString(),
                expectedBalance.toString(),
                `Token balance mismatch for user ${i}`
            );
            
            console.log(`✓ User ${i} token balance verified: ${balance.value.amount} tokens`);
        }
    });

    it("should verify all new users have received airdrop", async () => {
        const results = [];
        
        for (let i = 0; i < newAccounts.length; i++) {
            const { keypair, userAccount, tokenAccount, expectedBalance } = newAccounts[i];
            
            // Get user registry info
            const userReg = await registryProgram.account.userAccount.fetch(userAccount);
            
            // Get token balance
            const tokenBalance = await provider.connection.getTokenAccountBalance(tokenAccount);
            const hasTokens = new BN(tokenBalance.value.amount).gt(new BN(0));
            
            results.push({
                user: i,
                registered: userReg.authority.equals(keypair.publicKey),
                hasTokenAccount: true,
                hasTokens: hasTokens,
                balance: tokenBalance.value.amount,
                expectedBalance: expectedBalance.toString(),
                balanceCorrect: tokenBalance.value.amount === expectedBalance.toString()
            });
        }
        
        // Display results
        console.log("\n📊 Airdrop Verification Summary:");
        console.log("================================");
        results.forEach(result => {
            const status = result.balanceCorrect ? "✓ PASS" : "✗ FAIL";
            console.log(`User ${result.user}: ${status}`);
            console.log(`  Registered: ${result.registered ? "Yes" : "No"}`);
            console.log(`  Token Account: ${result.hasTokenAccount ? "Created" : "Missing"}`);
            console.log(`  Has Tokens: ${result.hasTokens ? "Yes" : "No"}`);
            console.log(`  Balance: ${result.balance} / ${result.expectedBalance}`);
        });
        
        // Assert all passed
        const allPassed = results.every(r => r.balanceCorrect && r.registered && r.hasTokens);
        assert.ok(allPassed, "Not all airdrop verifications passed");
    });

    it("should handle multiple airdrops (batch verification)", async () => {
        // Test scenario: airdrop to same account multiple times
        const testUser = newAccounts[0];
        const additionalAirdrop = new BN(500);
        
        // Initial balance
        let balance = await provider.connection.getTokenAccountBalance(testUser.tokenAccount);
        const initialAmount = new BN(balance.value.amount);
        
        // Send additional airdrop
        await energyTokenProgram.methods.mintToWallet(additionalAirdrop).accounts({
            mint: mint,
            tokenInfo: tokenInfo,
            destination: testUser.tokenAccount,
            destinationOwner: testUser.keypair.publicKey,
            authority: authority.publicKey,
            payer: authority.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId
        }).rpc();
        
        // Verify balance increased
        balance = await provider.connection.getTokenAccountBalance(testUser.tokenAccount);
        const finalAmount = new BN(balance.value.amount);
        const expected = initialAmount.add(additionalAirdrop);
        
        assert.equal(
            finalAmount.toString(),
            expected.toString(),
            "Multiple airdrop balance verification failed"
        );
        
        console.log(`✓ Multiple airdrop test passed: ${initialAmount.toString()} + ${additionalAirdrop.toString()} = ${finalAmount.toString()}`);
    });
});
