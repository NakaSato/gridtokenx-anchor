import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { EnergyToken } from "../target/types/energy_token";
import { Governance } from "../target/types/governance";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  Transaction,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  mintTo
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

async function ensureAta(
    connection: anchor.web3.Connection,
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey,
    programId: PublicKey = TOKEN_PROGRAM_ID
): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
    try {
        await getAccount(connection, ata, "confirmed", programId);
        console.log(`   Account exists: ${ata.toBase58()}`);
    } catch (e: any) {
        console.log(`   Creating account: ${ata.toBase58()} for mint ${mint.toBase58()} using program ${programId.toBase58()}`);
        const tx = new Transaction().add(
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                ata,
                owner,
                mint,
                programId
            )
        );
        const sig = await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer]);
        console.log(`   ✅ Account created: ${sig}`);
    }
    return ata;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const tradingProgram = anchor.workspace.Trading as Program<Trading>;
  const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  
  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;

  console.log("🏁 Starting On-Chain Settlement E2E Test...");

  // 1. Load/Derive IDs
  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
  const zoneId = 0;
  const [zoneMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, 'le', 4)],
    tradingProgram.programId
  );
  const [poaConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceProgram.programId);
  const [energyMintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyTokenProgram.programId);
  const [energyTokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyTokenProgram.programId);

  const currencyMintRaw = JSON.parse(fs.readFileSync("currency-mint.json", "utf8"));
  const currencyMintKeypair = Keypair.fromSecretKey(Uint8Array.from(currencyMintRaw));
  const currencyMint = currencyMintKeypair.publicKey;

  console.log(`   Market: ${marketPda.toBase58()}`);
  console.log(`   Energy Mint: ${energyMintPda.toBase58()}`);
  console.log(`   Currency Mint: ${currencyMint.toBase58()}`);

  // 2. Load Wallets
  const prosumerKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-prosumer.json", "utf8"))));
  const consumerKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-consumer.json", "utf8"))));
  
  // Fund prosumer and consumer for transaction fees and rent
  console.log(`\n💸 Funding prosumer and consumer...`);
  const fundUsersTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority,
      toPubkey: prosumerKey.publicKey,
      lamports: 0.5 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({
      fromPubkey: authority,
      toPubkey: consumerKey.publicKey,
      lamports: 0.5 * LAMPORTS_PER_SOL,
    })
  );
  await anchor.web3.sendAndConfirmTransaction(provider.connection, fundUsersTx, [payer]);
  
  // 3. Setup Escrow Authority & Accounts
  const escrowAuth = Keypair.generate();
  console.log(`\n🛡️ Escrow Authority: ${escrowAuth.publicKey.toBase58()}`);

  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority,
      toPubkey: escrowAuth.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    })
  );
  await anchor.web3.sendAndConfirmTransaction(provider.connection, fundTx, [payer]);

  console.log(`\n📦 Setting up escrow accounts...`);
  const buyerCurrencyEscrow = await ensureAta(provider.connection, payer, currencyMint, escrowAuth.publicKey, TOKEN_PROGRAM_ID);
  const sellerEnergyEscrow = await ensureAta(provider.connection, payer, energyMintPda, escrowAuth.publicKey, TOKEN_PROGRAM_ID);

  // 4. Setup Receiver Accounts
  console.log(`\n🏦 Setting up receiver and collector accounts...`);
  const sellerCurrencyAccount = await ensureAta(provider.connection, payer, currencyMint, prosumerKey.publicKey, TOKEN_PROGRAM_ID);
  const buyerEnergyAccount = await ensureAta(provider.connection, payer, energyMintPda, consumerKey.publicKey, TOKEN_PROGRAM_ID);

  const feeCollector = await ensureAta(provider.connection, payer, currencyMint, authority, TOKEN_PROGRAM_ID);
  const wheelingCollector = await ensureAta(provider.connection, payer, currencyMint, Keypair.generate().publicKey, TOKEN_PROGRAM_ID);
  const lossCollector = await ensureAta(provider.connection, payer, currencyMint, Keypair.generate().publicKey, TOKEN_PROGRAM_ID);

  // 5. Mint tokens to Escrows
  console.log(`\n💰 Funding Escrows...`);
  
  await mintTo(
    provider.connection,
    payer,
    currencyMint,
    buyerCurrencyEscrow,
    payer,
    1_000_000
  );

  await energyTokenProgram.methods
    .mintToWallet(new BN(100))
    .accounts({
        mint: energyMintPda,
        tokenInfo: energyTokenInfoPda,
        destination: sellerEnergyEscrow,
        destinationOwner: escrowAuth.publicKey,
        authority: authority,
        payer: authority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  
  console.log(`   ✅ Escrows funded`);

  // 6. Create Orders
  const sellOrderId = new BN(Date.now());
  const [sellOrderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), prosumerKey.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, 'le', 8)],
    tradingProgram.programId
  );

  console.log(`\n📦 Creating Sell Order...`);
  await tradingProgram.methods
    .createSellOrder(sellOrderId, new BN(100), new BN(50))
    .accounts({
      market: marketPda,
      zoneMarket: zoneMarketPda,
      order: sellOrderPda,
      authority: prosumerKey.publicKey,
      governanceConfig: poaConfigPda,
      ercCertificate: null,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([prosumerKey])
    .rpc();

  const buyOrderId = new BN(Date.now() + 1);
  const [buyOrderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), consumerKey.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, 'le', 8)],
    tradingProgram.programId
  );

  console.log(`🛒 Creating Buy Order...`);
  await tradingProgram.methods
    .createBuyOrder(buyOrderId, new BN(100), new BN(60))
    .accounts({
      market: marketPda,
      zoneMarket: zoneMarketPda,
      order: buyOrderPda,
      authority: consumerKey.publicKey,
      governanceConfig: poaConfigPda,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([consumerKey])
    .rpc();

  // 7. Execute Atomic Settlement
  console.log(`\n⚡ Executing Atomic Settlement...`);
  try {
    const tx = await tradingProgram.methods
      .executeAtomicSettlement(
        new BN(100), // amount
        new BN(55),  // price
        new BN(1),   // wheeling
        new BN(1)    // loss
      )
      .accounts({
        market: marketPda,
        buyOrder: buyOrderPda,
        sellOrder: sellOrderPda,
        buyerCurrencyEscrow: buyerCurrencyEscrow,
        sellerEnergyEscrow: sellerEnergyEscrow,
        sellerCurrencyAccount: sellerCurrencyAccount,
        buyerEnergyAccount: buyerEnergyAccount,
        feeCollector: feeCollector,
        wheelingCollector: wheelingCollector,
        lossCollector: lossCollector,
        energyMint: energyMintPda,
        currencyMint: currencyMint,
        escrowAuthority: escrowAuth.publicKey,
        marketAuthority: authority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        secondaryTokenProgram: TOKEN_PROGRAM_ID,
        governanceConfig: poaConfigPda,
      } as any)
      .signers([escrowAuth])
      .rpc();

    console.log(`   ✅ Settlement successful! Tx: ${tx}`);
    
    // Verify balances
    const sellerBalance = await provider.connection.getTokenAccountBalance(sellerCurrencyAccount);
    const buyerBalance = await provider.connection.getTokenAccountBalance(buyerEnergyAccount);
    console.log(`\n📊 Final Balances:`);
    console.log(`   Seller Currency: ${sellerBalance.value.uiAmount}`);
    console.log(`   Buyer Energy: ${buyerBalance.value.uiAmount}`);

  } catch (e: any) {
    console.error(`   ❌ Settlement failed:`, e.message);
    if (e.logs) console.log(e.logs.join('\n'));
  }

  console.log("\n✨ On-chain settlement test completed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
