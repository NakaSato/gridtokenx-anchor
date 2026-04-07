import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Registry } from "../target/types/registry";
import { expect } from "chai";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  Transaction, 
  sendAndConfirmTransaction 
} from "@solana/web3.js";
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo, 
  TOKEN_2022_PROGRAM_ID,
  getAccount
} from "@solana/spl-token";
import BN from "bn.js";

describe("registry_staking", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Registry as Program<Registry>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const authority = provider.wallet.publicKey;

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    program.programId
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("grx_vault")],
    program.programId
  );

  let grxMint: PublicKey;
  let userKeypair: Keypair;
  let userAta: PublicKey;
  let userPda: PublicKey;

  const shardId = 0;
  const [shardPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry_shard"), Buffer.from([shardId])],
    program.programId
  );

  before(async () => {
    // 1. Initialize Registry and Shard if needed
    try {
      const regAcc = await program.account.registry.fetch(registryPda);
    } catch (e) {
      await program.methods
        .initialize()
        .accounts({
          registry: registryPda,
          authority: authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    try {
      await program.account.registryShard.fetch(shardPda);
    } catch (e) {
      await program.methods
        .initializeShard(shardId)
        .accounts({
          shard: shardPda,
          authority: authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // 2. Create GRX Mint (Token-2022)
    grxMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      authority,
      null,
      9,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // 3. Setup User
    userKeypair = Keypair.generate();
    // Airdrop SOL to user
    const signature = await provider.connection.requestAirdrop(userKeypair.publicKey, 1_000_000_000);
    await provider.connection.confirmTransaction(signature);

    // Create User ATA and mint tokens
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      grxMint,
      userKeypair.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    userAta = ata.address;

    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      grxMint,
      userAta,
      authority,
      1000_000_000_000, // 1000 GRX
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Register User
    [userPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), userKeypair.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerUser(
        { prosumer: {} },
        0,
        0,
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
        tokenProgram: SystemProgram.programId, // placeholder
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([userKeypair])
      .rpc();
  });

  it("Successfully initializes vault", async () => {
    await program.methods
      .initializeVault()
      .accounts({
        registry: registryPda,
        grxVault: vaultPda,
        grxMint: grxMint,
        authority: authority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    
    const vaultAcc = await getAccount(
      provider.connection,
      vaultPda,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(vaultAcc.mint.toBase58()).to.equal(grxMint.toBase58());
  });

  it("Successfully stakes GRX", async () => {
    const amount = new BN(100_000_000_000); // 100 GRX
    await program.methods
      .stakeGrx(amount)
      .accounts({
        registry: registryPda,
        userAccount: userPda,
        grxVault: vaultPda,
        userGrxAta: userAta,
        grxMint: grxMint,
        authority: userKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([userKeypair])
      .rpc();
    
    const userAcc = await program.account.userAccount.fetch(userPda);
    expect(userAcc.stakedGrx.toString()).to.equal(amount.toString());
    
    const vaultAcc = await getAccount(
      provider.connection,
      vaultPda,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(vaultAcc.amount.toString()).to.equal(amount.toString());
  });

  it("Fails to register as validator with insufficient stake", async () => {
    try {
      await program.methods
        .registerValidator()
        .accounts({
          userAccount: userPda,
          authority: userKeypair.publicKey,
        })
        .signers([userKeypair])
        .rpc();
      expect.fail("Should have failed with MinStakeNotMet");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("MinStakeNotMet");
    }
  });

  it("Successfully registers as validator with sufficient stake", async () => {
    // Stake more to reach 10,000 GRX
    // Current stake is 100 GRX. Need 9,900 more.
    const needed = new BN(9_900_000_000_000); 
    
    // Mint more GRX to user
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      grxMint,
      userAta,
      authority,
      needed.toNumber(),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .stakeGrx(needed)
      .accounts({
        registry: registryPda,
        userAccount: userPda,
        grxVault: vaultPda,
        userGrxAta: userAta,
        grxMint: grxMint,
        authority: userKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([userKeypair])
      .rpc();

    await program.methods
      .registerValidator()
      .accounts({
        userAccount: userPda,
        authority: userKeypair.publicKey,
      })
      .signers([userKeypair])
      .rpc();
    
    const userAcc = await program.account.userAccount.fetch(userPda);
    expect(Object.keys(userAcc.validatorStatus)[0]).to.equal("active");
  });
});
