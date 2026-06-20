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

  // ── §1 slash distribution: partial demotion + capped compensation + CU ───────
  //
  // The full-slash test above leaves the shared validator terminally Slashed, so
  // these spin up FRESH validators. MIN_VALIDATOR_STAKE = 10,000 GRX (9 dec).
  const MIN = new BN("10000000000000");
  const GRX = (n: number) => new BN(n).mul(new BN("1000000000")); // n GRX → base units
  let slashDest: PublicKey; // the configured fund sink (authority ATA)

  async function freshAta(owner: PublicKey): Promise<PublicKey> {
    const a = await getOrCreateAssociatedTokenAccount(
      provider.connection, (provider.wallet as any).payer, grxMint, owner,
      false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
    );
    return a.address;
  }

  // Register + stake + activate a brand-new validator with `stake` GRX bonded.
  async function setupValidator(stake: BN): Promise<{ kp: Keypair; userPda: PublicKey }> {
    const kp = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(kp.publicKey, 1_000_000_000)
    );
    const ata = await freshAta(kp.publicKey);
    await mintTo(provider.connection, (provider.wallet as any).payer, grxMint, ata, authority,
      BigInt(stake.toString()), [], undefined, TOKEN_2022_PROGRAM_ID);

    const [uPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), kp.publicKey.toBuffer()], program.programId);
    const ushard = kp.publicKey.toBytes()[0] % 16;
    const [ushardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_shard"), Buffer.from([ushard])], program.programId);
    try {
      await program.methods.initializeShard(ushard)
        .accounts({ shard: ushardPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
    } catch {}
    await program.methods.registerUser({ prosumer: {} }, 0, 0, new BN(0), ushard)
      .accounts({
        userAccount: uPda, registryShard: ushardPda, registry: registryPda, authority: kp.publicKey,
        energyTokenProgram: SystemProgram.programId, mint: authority, tokenInfo: authority,
        userTokenAccount: authority, tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).rpc(); // registerUser: authority is a plain account, not a Signer (matches the main before())
    await program.methods.stakeGrx(stake)
      .accounts({ registry: registryPda, userAccount: uPda, grxVault: vaultPda, userGrxAta: ata, grxMint, authority: kp.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([kp]).rpc();
    await program.methods.registerValidator()
      .accounts({ userAccount: uPda, authority: kp.publicKey }).signers([kp]).rpc();
    return { kp, userPda: uPda };
  }

  async function slash(v: { kp: Keypair; userPda: PublicKey }, bps: number, provenLoss: BN, victim: PublicKey): Promise<string> {
    return await program.methods.slashValidator(bps, provenLoss)
      .accounts({
        targetAuthority: v.kp.publicKey, targetUserAccount: v.userPda, grxVault: vaultPda,
        registry: registryPda, slashDestination: slashDest, victimTokenAccount: victim, grxMint,
        authority, tokenProgram: TOKEN_2022_PROGRAM_ID,
      }).rpc();
  }

  before(async () => {
    // Ensure the fund sink is configured (the full-slash test also sets it, but
    // these run independently of ordering).
    slashDest = await freshAta(authority);
    await program.methods.setSlashDestination(slashDest).accounts({ registry: registryPda, authority }).rpc();
  });

  const bal = async (a: PublicKey) =>
    new BN((await getAccount(provider.connection, a, undefined, TOKEN_2022_PROGRAM_ID)).amount.toString());
  const statusOf = async (pda: PublicKey) =>
    Object.keys((await program.account.userAccount.fetch(pda)).validatorStatus)[0];

  it("partial slash demotes to Suspended when remaining < MIN_VALIDATOR_STAKE", async () => {
    const v = await setupValidator(MIN); // bond == MIN
    const victim = await freshAta(Keypair.generate().publicKey);
    // 10% slash, no proven loss → slash_amount = MIN/10 to fund; remaining = 90% < MIN.
    await slash(v, 1000, new BN(0), victim);
    const acc = await program.account.userAccount.fetch(v.userPda);
    expect(Object.keys(acc.validatorStatus)[0]).to.equal("suspended");
    expect(acc.stakedGrx.toString()).to.equal(MIN.muln(9).divn(10).toString());
  });

  it("compensation capped at proven_loss; remainder funded; invariant holds", async () => {
    const v = await setupValidator(MIN.muln(2)); // 20,000 GRX bond
    const victimOwner = Keypair.generate().publicKey;
    const victim = await freshAta(victimOwner);
    const [victimBefore, destBefore, vaultBefore] = [await bal(victim), await bal(slashDest), await bal(vaultPda)];
    // 50% slash = 10,000 GRX; proven_loss 4,000 < slash → comp 4,000 to victim, fund 6,000.
    await slash(v, 5000, GRX(4000), victim);
    const acc = await program.account.userAccount.fetch(v.userPda);
    const [victimAfter, destAfter, vaultAfter] = [await bal(victim), await bal(slashDest), await bal(vaultPda)];
    expect(victimAfter.sub(victimBefore).toString()).to.equal(GRX(4000).toString());
    expect(destAfter.sub(destBefore).toString()).to.equal(GRX(6000).toString());
    // remaining 10,000 == MIN → stays Active (not < MIN).
    expect(Object.keys(acc.validatorStatus)[0]).to.equal("active");
    expect(acc.stakedGrx.toString()).to.equal(MIN.toString());
    // Invariant: comp + fund == slash_amount == vault drain.
    expect(victimAfter.sub(victimBefore).add(destAfter.sub(destBefore)).toString())
      .to.equal(vaultBefore.sub(vaultAfter).toString());
    expect(vaultBefore.sub(vaultAfter).toString()).to.equal(GRX(10000).toString());
  });

  it("compensation never exceeds slash_amount when proven_loss is larger", async () => {
    const v = await setupValidator(MIN.muln(2)); // 20,000 GRX
    const victim = await freshAta(Keypair.generate().publicKey);
    const [victimBefore, destBefore] = [await bal(victim), await bal(slashDest)];
    // 10% slash = 2,000 GRX; proven_loss 5,000 > slash → comp capped at 2,000, fund 0.
    await slash(v, 1000, GRX(5000), victim);
    const acc = await program.account.userAccount.fetch(v.userPda);
    expect((await bal(victim)).sub(victimBefore).toString()).to.equal(GRX(2000).toString());
    expect((await bal(slashDest)).sub(destBefore).toString()).to.equal("0"); // nothing left to fund
    expect(Object.keys(acc.validatorStatus)[0]).to.equal("active"); // remaining 18,000 ≥ MIN
  });

  it("slash_validator CU under budget", async () => {
    const v = await setupValidator(MIN.muln(2));
    const victim = await freshAta(Keypair.generate().publicKey);
    // Two-transfer path (comp + fund) to measure the heavier branch.
    const sig = await slash(v, 1000, GRX(1000), victim);
    let cu = 0;
    for (let i = 0; i < 8 && cu === 0; i++) {
      const tx = await provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      cu = tx?.meta?.computeUnitsConsumed ?? 0;
      if (cu === 0) await new Promise((r) => setTimeout(r, 400));
    }
    console.log(`  [BENCH_SLASH_CU] slash_validator (comp+fund) cu=${cu}`);
    expect(cu).to.be.greaterThan(0).and.lessThan(200_000); // well inside the 200k default budget
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
