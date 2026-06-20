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

  // ── unstake / slash ─────────────────────────────────────────────────────────

  it("Fails to unstake during the cooldown window", async () => {
    // User staked just above in the prior tests, so we're still inside the
    // 24h UNSTAKE_COOLDOWN_SECS — unstake_grx checks the cooldown first.
    try {
      await program.methods
        .unstakeGrx(new BN(100_000_000_000)) // 100 GRX
        .accounts({
          userAccount: userPda,
          grxVault: vaultPda,
          registry: registryPda,
          userGrxAta: userAta,
          grxMint,
          authority: userKeypair.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([userKeypair])
        .rpc();
      expect.fail("Should have failed with UnstakingLocked");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnstakingLocked");
    }
  });

  it("rejects slash from a non-authority", async () => {
    const dest = await getOrCreateAssociatedTokenAccount(
      provider.connection, (provider.wallet as any).payer, grxMint, authority,
      false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
    );
    // Victim account must be distinct from the fund (no duplicate mutable account).
    const victim = await getOrCreateAssociatedTokenAccount(
      provider.connection, (provider.wallet as any).payer, grxMint, userKeypair.publicKey,
      false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
    );
    try {
      await program.methods
        .slashValidator(10_000, new BN(0)) // full slash (bps), no proven loss
        .accounts({
          targetAuthority: userKeypair.publicKey,
          targetUserAccount: userPda,
          grxVault: vaultPda,
          registry: registryPda,
          slashDestination: dest.address,
          victimTokenAccount: victim.address, // unused (proven_loss = 0); distinct from fund
          grxMint,
          authority: userKeypair.publicKey, // wrong authority (registry.authority is the provider wallet)
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([userKeypair])
        .rpc();
      expect.fail("Should have failed with UnauthorizedAuthority");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnauthorizedAuthority");
    }
  });

  it("authority slashes the validator: bond moves to destination, status Slashed", async () => {
    const dest = await getOrCreateAssociatedTokenAccount(
      provider.connection, (provider.wallet as any).payer, grxMint, authority,
      false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
    );
    // Victim account must be distinct from the fund (no duplicate mutable account).
    const victim = await getOrCreateAssociatedTokenAccount(
      provider.connection, (provider.wallet as any).payer, grxMint, userKeypair.publicKey,
      false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
    );
    // Configure the allowed slash sink first — slash_validator refuses any other destination.
    await program.methods
      .setSlashDestination(dest.address)
      .accounts({ registry: registryPda, authority })
      .rpc();

    const stakedBefore = (await program.account.userAccount.fetch(userPda)).stakedGrx;
    const destBefore = await getAccount(provider.connection, dest.address, undefined, TOKEN_2022_PROGRAM_ID);
    const vaultBefore = await getAccount(provider.connection, vaultPda, undefined, TOKEN_2022_PROGRAM_ID);

    // Full slash (10000 bps), proven_loss = 0 → compensation 0, the entire bond
    // goes to the transparent fund (slashDestination); status becomes terminal Slashed.
    await program.methods
      .slashValidator(10_000, new BN(0))
      .accounts({
        targetAuthority: userKeypair.publicKey,
        targetUserAccount: userPda,
        grxVault: vaultPda,
        registry: registryPda,
        slashDestination: dest.address,
        victimTokenAccount: victim.address, // unused (proven_loss = 0); distinct from fund
        grxMint,
        authority, // registry authority = provider wallet (default signer)
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const userAcc = await program.account.userAccount.fetch(userPda);
    expect(Object.keys(userAcc.validatorStatus)[0]).to.equal("slashed");
    // Full forfeiture: remaining stake is zero, entire bond slashed.
    expect(userAcc.stakedGrx.toString()).to.equal("0");

    const destAfter = await getAccount(provider.connection, dest.address, undefined, TOKEN_2022_PROGRAM_ID);
    const vaultAfter = await getAccount(provider.connection, vaultPda, undefined, TOKEN_2022_PROGRAM_ID);
    // proven_loss = 0 → all to fund, none to victim; vault drained by the full bond.
    expect((destAfter.amount - destBefore.amount).toString()).to.equal(stakedBefore.toString());
    expect((vaultBefore.amount - vaultAfter.amount).toString()).to.equal(stakedBefore.toString());
  });

  // Skipped on a live validator: unstake_grx enforces the 24h UNSTAKE_COOLDOWN_SECS
  // and AnchorProvider.env() offers no clock control. The happy path (successful
  // unstake + Active->Suspended demote) is covered by the clock-warped litesvm port
  // in tests/staking_unstake_litesvm.ts (npm run test:staking-litesvm).
  it.skip("unstakes once no longer an Active validator (see litesvm port)", async () => {
    // Status is now Slashed; the only thing blocking unstake here is the cooldown.
    const amount = new BN(1_000_000_000_000); // 1,000 GRX
    const stakedBefore = (await program.account.userAccount.fetch(userPda)).stakedGrx;
    const ataBefore = await getAccount(provider.connection, userAta, undefined, TOKEN_2022_PROGRAM_ID);

    await program.methods
      .unstakeGrx(amount)
      .accounts({
        userAccount: userPda,
        grxVault: vaultPda,
        registry: registryPda,
        userGrxAta: userAta,
        grxMint,
        authority: userKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([userKeypair])
      .rpc();

    const stakedAfter = (await program.account.userAccount.fetch(userPda)).stakedGrx;
    const ataAfter = await getAccount(provider.connection, userAta, undefined, TOKEN_2022_PROGRAM_ID);
    expect(stakedBefore.sub(stakedAfter).toString()).to.equal(amount.toString());
    expect((ataAfter.amount - ataBefore.amount).toString()).to.equal(amount.toString());
  });
});
