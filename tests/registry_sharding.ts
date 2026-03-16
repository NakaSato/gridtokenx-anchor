import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Registry } from "../target/types/registry";
import { expect } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";

describe("registry_sharding", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Registry as Program<Registry>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const authority = provider.wallet.publicKey;

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
          authority: authority,
          systemProgram: anchor.web3.SystemProgram.programId,
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
            authority: authority,
            systemProgram: anchor.web3.SystemProgram.programId,
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

        await program.methods
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
                energyTokenProgram: PublicKey.default,
                mint: authority, // placeholder
                tokenInfo: authority, // placeholder
                userTokenAccount: authority, // placeholder
                tokenProgram: anchor.web3.SystemProgram.programId, // placeholder
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([userKeypair])
            .preInstructions([
                anchor.web3.SystemProgram.transfer({
                    fromPubkey: authority,
                    toPubkey: userKeypair.publicKey,
                    lamports: 10_000_000,
                }),
            ])
            .rpc();
            
        const shardAccount = await program.account.registryShard.fetch(shardPda);
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
            authority: authority,
        })
        .remainingAccounts(shardPdas.map(pda => ({
            pubkey: pda,
            isWritable: false,
            isSigner: false,
        })))
        .rpc();

    const registryAccount = await program.account.registry.fetch(registryPda);
    console.log(`Aggregated User Count: ${registryAccount.userCount.toNumber()}`);
    expect(registryAccount.userCount.toNumber()).to.be.at.least(4);
  });
});
