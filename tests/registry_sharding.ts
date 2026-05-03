import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import * as os from "os";

// Real program IDs needed by the registry's registerUser instruction
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

describe("registry_sharding", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Registry as Program<Registry>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const wallet = provider.wallet;

  // Load the actual keypair for the provider wallet to ensure we have a valid signer
  const walletPath = os.homedir() + "/.config/solana/id.json";
  let walletKeypair: Keypair;
  try {
      walletKeypair = Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
      );
      console.log(`Loaded wallet: ${walletKeypair.publicKey.toBase58()}`);
      console.log(`Provider wallet: ${wallet.publicKey.toBase58()}`);
  } catch (e) {
      console.warn("Could not load wallet from ~/.config/solana/id.json");
      walletKeypair = (wallet as any).payer || (wallet as any).keypair;
  }

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    program.programId
  );

  it("Initializes registry and shards", async () => {
    try {
      await program.methods
        .initialize()
        .accounts({
          registry: registryPda,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      console.log("Registry already initialized");
    }

    for (let i = 0; i < 4; i++) {
      const [shardPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry_shard"), Buffer.from([i])],
        program.programId
      );

      try {
        await program.methods
          .initializeShard(i)
          .accounts({
            shard: shardPda,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e) {
        console.log(`Shard ${i} already initialized`);
      }
    }
  });

  it("Registers users across different shards", async () => {
    for (let i = 0; i < 4; i++) {
        const userKeypair = Keypair.generate();
        const shardId = i;
        const [shardPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry_shard"), Buffer.from([shardId])],
            program.programId
        );
        const [userPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user"), userKeypair.publicKey.toBuffer()],
            program.programId
        );

        // Pre-fund the user account for fees
        const fundTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: userKeypair.publicKey,
                lamports: 10_000_000,
            })
        );
        await provider.sendAndConfirm(fundTx);

        // Use direct Transaction to avoid Anchor signer issues
        const ix = await program.methods
            .registerUser(
                { prosumer: {} },
                13700000,
                100500000,
                new BN(0),
                shardId
            )
            .accounts({
                userAccount: userPda,
                registryShard: shardPda,
                registry: registryPda,
                authority: userKeypair.publicKey,
                payer: walletKeypair.publicKey, 
                energyTokenProgram: SystemProgram.programId,
                mint: walletKeypair.publicKey,
                userTokenAccount: walletKeypair.publicKey,
                tokenInfo: walletKeypair.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            } as any)
            .instruction();

        const tx = new Transaction().add(ix);
        await sendAndConfirmTransaction(provider.connection, tx, [walletKeypair, userKeypair]);
            
        const shardAccount: any = await program.account.registryShard.fetch(shardPda);
        expect(shardAccount.userCount.toNumber()).to.be.at.least(1);
    }
  });

  it("Aggregates shard counts into the global registry", async () => {
    const shardPdas = [];
    for (let i = 0; i < 4; i++) {
        const [shardPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry_shard"), Buffer.from([i])],
            program.programId
        );
        shardPdas.push(shardPda);
    }

    await program.methods
        .aggregateShards()
        .accounts({
            registry: registryPda,
            authority: wallet.publicKey,
        })
        .remainingAccounts(shardPdas.map(pda => ({
            pubkey: pda,
            isWritable: false,
            isSigner: false,
        })))
        .rpc();

    const registryAccount: any = await program.account.registry.fetch(registryPda);
    console.log(`Aggregated User Count: ${registryAccount.userCount.toNumber()}`);
    expect(registryAccount.userCount.toNumber()).to.be.at.least(4);
  });
});
