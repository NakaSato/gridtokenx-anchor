import pkg from "@anchor-lang/core";
const { BN, Program, AnchorProvider } = pkg;
import * as anchor from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
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
  const program = new Program(idl as anchor.Idl, provider);
  const programId = program.programId;

  // Derive Mint PDA
  const [MINT] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_2022")],
    programId
  );
  console.log("Energy Token Mint:", MINT.toBase58());

  // Find token info PDA (seeds: [b"token_info_2022"])
  const [tokenInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_info_2022")],
    programId
  );
  console.log("Token Info PDA:", tokenInfo.toBase58());

  // Recipients to fund
  const recipients = [];

  // Check if command line arguments are provided
  if (process.argv.length >= 3) {
    const address = process.argv[2];
    const amountStr = process.argv[3] || "1000";
    const amount = new BN(parseFloat(amountStr) * 1e9);
    recipients.push({
      name: "CLI Requested Wallet",
      address: address,
      amount: amount,
    });
  } else {
    recipients.push(
      {
        name: "Dev Wallet (API)",
        path: path.join(process.cwd(), "../gridtokenx-api/dev-wallet.json"),
        amount: new BN(1000000000000),
      },
      {
        name: "Buyer Test User",
        address: "7rdNNcszvgNcYqQezZicnFHZ9kxyPcSpFCnRNB52meHK",
        amount: new BN(1000000000000),
      },
      {
        name: "Seller Test User",
        address: "7JsfJPuJvhkY376RAzQExbdFbZMgdGc2cWLic25SE1tq",
        amount: new BN(1000000000000),
      }
    );
  }

  for (const recipient of recipients) {
    console.log(`\n💰 Funding ${recipient.name}...`);

    let recipientPubkey: PublicKey;
    const r = recipient as any;
    if (r.address) {
      recipientPubkey = new PublicKey(r.address);
    } else {
      if (!fs.existsSync(r.path)) {
        console.log(`  ⚠️  Wallet not found: ${recipient.path}`);
        continue;
      }
      const keypairData = JSON.parse(fs.readFileSync(recipient.path!, "utf-8"));
      recipientPubkey = new PublicKey(keypairData.slice(32, 64));
    }

    console.log(`  Address: ${recipientPubkey.toBase58()}`);

    // Get associated token account address
    const recipientTokenAccount = getAssociatedTokenAddressSync(
      MINT,
      recipientPubkey,
      false,
      TOKEN_PROGRAM_ID,
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
        TOKEN_PROGRAM_ID,
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
        .mintToWallet(recipient.amount)
        .accounts({
          tokenInfo: tokenInfo,
          mint: MINT,
          destination: recipientTokenAccount,
          destinationOwner: recipientPubkey,
          authority: wallet.publicKey,
          payer: wallet.publicKey, // Explicit payer for 1.0.0
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
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
