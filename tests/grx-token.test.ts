import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EnergyToken } from "../target/types/energy_token";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

describe("GRX Token Tests", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.EnergyToken as Program<EnergyToken>;
  
  // Test accounts
  const authority = provider.wallet as anchor.Wallet;
  let mintKeypair: Keypair;
  let metadataAddress: PublicKey;
  let userTokenAccount: PublicKey;
  
  // Token metadata
  const tokenName = "GridTokenX";
  const tokenSymbol = "GRX";
  const tokenUri = "https://arweave.net/grx-metadata.json";
  
  // Metaplex Token Metadata Program ID
  const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

  before(async () => {
    console.log("\n🚀 Setting up GRX Token Test Environment...");
    console.log("Authority:", authority.publicKey.toBase58());
  });

  describe("Token Creation", () => {
    it("Creates GRX token mint with metadata", async () => {
      // Generate new mint keypair
      mintKeypair = Keypair.generate();
      
      // Derive metadata PDA
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          mintKeypair.publicKey.toBuffer(),
        ],
        METADATA_PROGRAM_ID
      );
      metadataAddress = metadataPDA;
      
      console.log("\n📝 Creating GRX Token:");
      console.log("  Mint:", mintKeypair.publicKey.toBase58());
      console.log("  Metadata:", metadataAddress.toBase58());
      console.log("  Name:", tokenName);
      console.log("  Symbol:", tokenSymbol);
      
      try {
        const tx = await program.methods
          .createTokenMint(tokenName, tokenSymbol, tokenUri)
          .accounts({
            mint: mintKeypair.publicKey,
            metadata: metadataAddress,
            payer: authority.publicKey,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID, // Use Token 2022 for enhanced features
            metadataProgram: METADATA_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([mintKeypair])
          .rpc();
        
        console.log("✅ Token created! Transaction:", tx);
        
        // Verify mint was created
        const mintInfo = await provider.connection.getAccountInfo(mintKeypair.publicKey);
        expect(mintInfo).to.not.be.null;
        console.log("✅ Mint account verified");
        
        // Verify metadata was created
        const metadataInfo = await provider.connection.getAccountInfo(metadataAddress);
        expect(metadataInfo).to.not.be.null;
        console.log("✅ Metadata account verified");
      } catch (error) {
        console.error("❌ Error creating token:", error);
        throw error;
      }
    });
  });

  describe("Token Minting", () => {
    it("Mints GRX tokens to a wallet", async () => {
      // Derive user's associated token account
      userTokenAccount = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        authority.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      
      const mintAmount = 1_000_000_000; // 1 token (with 9 decimals)
      
      console.log("\n💰 Minting GRX Tokens:");
      console.log("  To:", authority.publicKey.toBase58());
      console.log("  Amount:", mintAmount / 1e9, "GRX");
      console.log("  Token Account:", userTokenAccount.toBase58());
      
      try {
        const tx = await program.methods
          .mintToWallet(new anchor.BN(mintAmount))
          .accounts({
            mint: mintKeypair.publicKey,
            destination: userTokenAccount,
            destinationOwner: authority.publicKey,
            authority: authority.publicKey,
            payer: authority.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        console.log("✅ Tokens minted! Transaction:", tx);
        
        // Verify token account balance
        const tokenAccountInfo = await provider.connection.getTokenAccountBalance(
          userTokenAccount
        );
        
        expect(tokenAccountInfo.value.amount).to.equal(mintAmount.toString());
        console.log("✅ Token balance verified:", 
          parseFloat(tokenAccountInfo.value.uiAmountString || "0"), "GRX");
      } catch (error) {
        console.error("❌ Error minting tokens:", error);
        throw error;
      }
    });
    
    it("Mints additional GRX tokens to the same wallet", async () => {
      const additionalAmount = 500_000_000; // 0.5 token
      
      console.log("\n💰 Minting Additional GRX Tokens:");
      console.log("  Amount:", additionalAmount / 1e9, "GRX");
      
      try {
        // Get balance before
        const balanceBefore = await provider.connection.getTokenAccountBalance(
          userTokenAccount
        );
        
        const tx = await program.methods
          .mintToWallet(new anchor.BN(additionalAmount))
          .accounts({
            mint: mintKeypair.publicKey,
            destination: userTokenAccount,
            destinationOwner: authority.publicKey,
            authority: authority.publicKey,
            payer: authority.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        console.log("✅ Additional tokens minted! Transaction:", tx);
        
        // Verify new balance
        const balanceAfter = await provider.connection.getTokenAccountBalance(
          userTokenAccount
        );
        
        const expectedBalance = 
          BigInt(balanceBefore.value.amount) + BigInt(additionalAmount);
        expect(balanceAfter.value.amount).to.equal(expectedBalance.toString());
        
        console.log("✅ New balance verified:", 
          parseFloat(balanceAfter.value.uiAmountString || "0"), "GRX");
      } catch (error) {
        console.error("❌ Error minting additional tokens:", error);
        throw error;
      }
    });
    
    it("Mints GRX tokens to a different wallet", async () => {
      const newWallet = Keypair.generate();
      const newTokenAccount = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        newWallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      
      const mintAmount = 2_000_000_000; // 2 tokens
      
      console.log("\n💰 Minting GRX to New Wallet:");
      console.log("  To:", newWallet.publicKey.toBase58());
      console.log("  Amount:", mintAmount / 1e9, "GRX");
      
      try {
        const tx = await program.methods
          .mintToWallet(new anchor.BN(mintAmount))
          .accounts({
            mint: mintKeypair.publicKey,
            destination: newTokenAccount,
            destinationOwner: newWallet.publicKey,
            authority: authority.publicKey,
            payer: authority.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        console.log("✅ Tokens minted to new wallet! Transaction:", tx);
        
        // Verify token account balance
        const tokenAccountInfo = await provider.connection.getTokenAccountBalance(
          newTokenAccount
        );
        
        expect(tokenAccountInfo.value.amount).to.equal(mintAmount.toString());
        console.log("✅ New wallet balance verified:", 
          parseFloat(tokenAccountInfo.value.uiAmountString || "0"), "GRX");
      } catch (error) {
        console.error("❌ Error minting to new wallet:", error);
        throw error;
      }
    });
  });

  describe("Token Information", () => {
    it("Retrieves GRX token mint information", async () => {
      console.log("\n📊 Token Mint Information:");
      
      const mintInfo = await provider.connection.getParsedAccountInfo(
        mintKeypair.publicKey
      );
      
      if (mintInfo.value && "parsed" in mintInfo.value.data) {
        const parsed = mintInfo.value.data.parsed.info;
        console.log("  Decimals:", parsed.decimals);
        console.log("  Supply:", parsed.supply / 1e9, "GRX");
        console.log("  Mint Authority:", parsed.mintAuthority);
        
        expect(parsed.decimals).to.equal(9);
      }
    });
    
    it("Retrieves GRX token metadata", async () => {
      console.log("\n📊 Token Metadata Information:");
      
      const metadataInfo = await provider.connection.getAccountInfo(
        metadataAddress
      );
      
      expect(metadataInfo).to.not.be.null;
      console.log("  Metadata Address:", metadataAddress.toBase58());
      console.log("  Data Length:", metadataInfo?.data.length, "bytes");
      console.log("✅ Metadata account exists and contains data");
    });
  });

  after(() => {
    console.log("\n✨ GRX Token Test Summary:");
    console.log("  Token Name:", tokenName);
    console.log("  Token Symbol:", tokenSymbol);
    console.log("  Mint Address:", mintKeypair?.publicKey.toBase58());
    console.log("  Metadata Address:", metadataAddress?.toBase58());
    console.log("  Program ID:", program.programId.toBase58());
    console.log("\n🎉 All GRX token tests completed successfully!\n");
  });
});
