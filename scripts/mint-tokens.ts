import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";

const provider = anchor.AnchorProvider.local("http://localhost:8899");
anchor.setProvider(provider);

const wallet = provider.wallet;

async function main() {
  console.log("🚀 Minting GridTokenX Energy Tokens\n");

  const idl = JSON.parse(fs.readFileSync("target/idl/energy_token.json", "utf-8"));
  const programId = new PublicKey("GzEcWzkb73zcgvgoNRxEiuuT7CEAbzbHcAgjNV25pbLV");
  const program = new anchor.Program(idl as anchor.Idl, programId, provider);

  const MINT = new PublicKey("2XLTgMue7MHSjZ7A25zmV9xF6ZeBz2LouZt6Y92AtN2H");

  // Find token info PDA (seeds: [b"token_info_2022"])
  const [tokenInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_info_2022")],
    programId
  );
  console.log("Token Info PDA:", tokenInfo.toBase58());

  // Recipients to fund
  const recipients = [
    {
      name: "Dev Wallet",
      path: path.join(process.cwd(), "../dev-wallet.json"),
      amount: new anchor.BN(1000000000000), // 1 million tokens (9 decimals)
    },
    {
      name: "Gateway Wallet",
      path: path.join(process.cwd(), "../gridtokenx-apigateway/dev-wallet.json"),
      amount: new anchor.BN(1000000000000),
    },
  ];

  for (const recipient of recipients) {
    console.log(`\n💰 Funding ${recipient.name}...`);

    if (!fs.existsSync(recipient.path)) {
      console.log(`  ⚠️  Wallet not found: ${recipient.path}`);
      continue;
    }

    const keypairData = JSON.parse(fs.readFileSync(recipient.path, "utf-8"));
    const recipientPubkey = new PublicKey(keypairData.slice(32, 64));

    console.log(`  Address: ${recipientPubkey.toBase58()}`);

    // Get associated token account address
    const recipientTokenAccount = getAssociatedTokenAddressSync(
      MINT,
      recipientPubkey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    console.log(`  Token Account: ${recipientTokenAccount.toBase58()}`);

    // Check if token account exists
    const accountInfo = await provider.connection.getAccountInfo(recipientTokenAccount);

    if (!accountInfo) {
      console.log(`  Creating token account...`);
      const createATAIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        recipientTokenAccount,
        recipientPubkey,
        MINT,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const tx = new anchor.web3.Transaction().add(createATAIx);
      await provider.sendAndConfirm(tx);
      console.log(`  ✅ Token account created`);
    } else {
      console.log(`  Token account exists`);
    }

    // Mint tokens using the program
    console.log(`  Minting ${recipient.amount.toNumber() / 1e9} GRID tokens...`);

    try {
      await program.methods
        .mintTokens(recipient.amount)
        .accounts({
          tokenInfo: tokenInfo,
          mint: MINT,
          destination: recipientTokenAccount,
          authority: wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`  ✅ Tokens minted successfully!`);
    } catch (err: any) {
      console.error(`  ❌ Failed to mint: ${err.message}`);
      if (err.message?.includes("Unauthorized")) {
        console.log(`     The wallet may not have mint authority`);
      }
    }
  }

  console.log("\n📋 Token Minting Complete!");
  console.log(`  Token Mint: ${MINT.toBase58()}`);
  console.log(`  Token Info: ${tokenInfo.toBase58()}`);
}

main()
  .then(() => {
    console.log("\n✨ Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
