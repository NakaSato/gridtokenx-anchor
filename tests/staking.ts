import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
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

    // 2. Fetch existing vault to re-use grxMint, or create new Mint
    try {
      const vaultAcc = await getAccount(
        provider.connection,
        vaultPda,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      grxMint = vaultAcc.mint;
    } catch (e) {
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
    }

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

    // Register User — shard bound in-program to the user's first key byte.
    [userPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), userKeypair.publicKey.toBuffer()],
      program.programId
    );
    const userShardId = userKeypair.publicKey.toBytes()[0] % 16;
    const [userShardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_shard"), Buffer.from([userShardId])],
      program.programId
    );
    try {
      await program.methods
        .initializeShard(userShardId)
        .accounts({ shard: userShardPda, authority, systemProgram: SystemProgram.programId } as any)
        .rpc();
    } catch (e) {}

    await program.methods
      .registerUser(
        { prosumer: {} },
        0,
        0,
        new BN(0),
        userShardId
      )
      .accounts({
        userAccount: userPda,
        registryShard: userShardPda,
        registry: registryPda,
        authority: userKeypair.publicKey,
        energyTokenProgram: SystemProgram.programId,
        mint: authority, // placeholder
        tokenInfo: authority, // placeholder
        userTokenAccount: authority, // placeholder
        tokenProgram: TOKEN_2022_PROGRAM_ID, // placeholder
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("Successfully initializes vault", async () => {
    try {
      const existingVault = await getAccount(provider.connection, vaultPda, undefined, TOKEN_2022_PROGRAM_ID);
      expect(existingVault.mint.toBase58()).to.equal(grxMint.toBase58());
      return;
    } catch (e) {
      // Doesn't exist, proceed to initialize
    }

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
      } as any)
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
    expect(new BN(vaultAcc.amount.toString()).gte(amount)).to.be.true;
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

  // ── Review-fix coverage: unstake cooldown (F3) + slash guards (F1/F2) + withdraw_slashed (F4) ──
  //
  // NOTE: This suite runs against a live validator (AnchorProvider.env()), which
  // offers no clock control, so the unstake *happy path* and the below-MIN
  // *demotion* path (both gated by the 24h UNSTAKE_COOLDOWN_SECS) cannot be
  // exercised here. They need a Bankrun/litesvm port that can warp the clock —
  // tracked separately. The cooldown *lock*, slash guards, sticky-slash, and
  // withdraw bounds are all time-independent and covered below.

  it("Fails to unstake during cooldown (F3 lock)", async () => {
    // User staked in the prior tests → still within UNSTAKE_COOLDOWN_SECS.
    try {
      await program.methods
        .unstakeGrx(new BN(1_000_000_000)) // 1 GRX
        .accounts({
          userAccount: userPda,
          grxVault: vaultPda,
          registry: registryPda,
          userGrxAta: userAta,
          grxMint: grxMint,
          authority: userKeypair.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        } as any)
        .signers([userKeypair])
        .rpc();
      expect.fail("Should have failed with UnstakingLocked");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnstakingLocked");
    }
  });

  it("Fails to slash a non-validator (F2 guard)", async () => {
    // Register a second plain user (validator_status = None).
    const plainUser = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(plainUser.publicKey, 1_000_000_000);
    await provider.connection.confirmTransaction(sig);
    const [plainPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), plainUser.publicKey.toBuffer()],
      program.programId
    );
    const plainShardId = plainUser.publicKey.toBytes()[0] % 16;
    const [plainShardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_shard"), Buffer.from([plainShardId])],
      program.programId
    );
    try {
      await program.methods
        .initializeShard(plainShardId)
        .accounts({ shard: plainShardPda, authority, systemProgram: SystemProgram.programId } as any)
        .rpc();
    } catch (e) {}
    await program.methods
      .registerUser({ prosumer: {} }, 0, 0, new BN(0), plainShardId)
      .accounts({
        userAccount: plainPda,
        registryShard: plainShardPda,
        registry: registryPda,
        authority: plainUser.publicKey,
        energyTokenProgram: SystemProgram.programId,
        mint: authority,
        tokenInfo: authority,
        userTokenAccount: authority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    try {
      await program.methods
        .slashValidator(new BN(1_000_000_000))
        .accounts({
          target: plainUser.publicKey,
          userAccount: plainPda,
          registry: registryPda,
          authority: authority,
        } as any)
        .rpc();
      expect.fail("Should have failed with NotAValidator");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("NotAValidator");
    }
  });

  it("Successfully slashes an active validator (pool grows)", async () => {
    const before = await program.account.registry.fetch(registryPda);
    const userBefore = await program.account.userAccount.fetch(userPda);
    const slashAmount = new BN(1_000_000_000_000); // 1,000 GRX

    await program.methods
      .slashValidator(slashAmount)
      .accounts({
        target: userKeypair.publicKey,
        userAccount: userPda,
        registry: registryPda,
        authority: authority,
      } as any)
      .rpc();

    const userAfter = await program.account.userAccount.fetch(userPda);
    expect(Object.keys(userAfter.validatorStatus)[0]).to.equal("slashed");
    expect(userAfter.stakedGrx.toString()).to.equal(
      userBefore.stakedGrx.sub(slashAmount).toString()
    );
    const after = await program.account.registry.fetch(registryPda);
    expect(after.slashedPool.sub(before.slashedPool).toString()).to.equal(
      slashAmount.toString()
    );
  });

  it("Fails to double-slash an already-slashed validator (F2 guard)", async () => {
    try {
      await program.methods
        .slashValidator(new BN(1_000_000_000))
        .accounts({
          target: userKeypair.publicKey,
          userAccount: userPda,
          registry: registryPda,
          authority: authority,
        } as any)
        .rpc();
      expect.fail("Should have failed with NotAValidator");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("NotAValidator");
    }
  });

  it("Slashed validator cannot re-register (F1 sticky slash)", async () => {
    // Top up well above MIN, then try to re-register — must still be rejected.
    const topUp = new BN(2_000_000_000_000); // 2,000 GRX
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      grxMint,
      userAta,
      authority,
      topUp.toNumber(),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await program.methods
      .stakeGrx(topUp)
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

    try {
      await program.methods
        .registerValidator()
        .accounts({ userAccount: userPda, authority: userKeypair.publicKey })
        .signers([userKeypair])
        .rpc();
      expect.fail("Should have failed with ValidatorAlreadySlashed");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("ValidatorAlreadySlashed");
    }
  });

  it("withdraw_slashed: rejects non-authority and over-pool, sweeps valid amount (F4)", async () => {
    const reg = await program.account.registry.fetch(registryPda);
    const pool = reg.slashedPool;
    expect(pool.gtn(0)).to.be.true; // forfeited by the earlier slash

    // Admin treasury destination ATA.
    const treasury = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      grxMint,
      authority,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // (a) non-authority signer → UnauthorizedAuthority
    try {
      await program.methods
        .withdrawSlashed(new BN(1))
        .accounts({
          registry: registryPda,
          grxVault: vaultPda,
          destination: treasury.address,
          grxMint: grxMint,
          authority: userKeypair.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        } as any)
        .signers([userKeypair])
        .rpc();
      expect.fail("Should have failed with UnauthorizedAuthority");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnauthorizedAuthority");
    }

    // (b) amount > slashed_pool → InsufficientStakingBalance
    try {
      await program.methods
        .withdrawSlashed(pool.add(new BN(1)))
        .accounts({
          registry: registryPda,
          grxVault: vaultPda,
          destination: treasury.address,
          grxMint: grxMint,
          authority: authority,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        } as any)
        .rpc();
      expect.fail("Should have failed with InsufficientStakingBalance");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InsufficientStakingBalance");
    }

    // (c) valid sweep of the whole pool → treasury balance up, pool → 0
    const treBefore = await getAccount(provider.connection, treasury.address, undefined, TOKEN_2022_PROGRAM_ID);
    await program.methods
      .withdrawSlashed(pool)
      .accounts({
        registry: registryPda,
        grxVault: vaultPda,
        destination: treasury.address,
        grxMint: grxMint,
        authority: authority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc();

    const treAfter = await getAccount(provider.connection, treasury.address, undefined, TOKEN_2022_PROGRAM_ID);
    expect((treAfter.amount - treBefore.amount).toString()).to.equal(pool.toString());
    const regAfter = await program.account.registry.fetch(registryPda);
    expect(regAfter.slashedPool.toString()).to.equal("0");
  });
});
