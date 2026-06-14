import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Treasury } from "../target/types/treasury";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";

const GRX_DECIMALS = 9;
const ONE_GRX = new BN(1_000_000_000); // 1e9 atoms
const RATE = new BN(4_000_000); // 4.000000 THBG (6dp) per whole GRX
const FEE_BPS = 25;
const TTL = new BN(3600);

describe("treasury", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Treasury as Program<Treasury>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const authority = provider.wallet.publicKey;

  const pda = (seed: string) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed)], program.programId)[0];
  const treasuryPda = pda("treasury");
  const thbgMint = pda("thbg_mint");
  const swapVault = pda("swap_vault");
  const stakeVault = pda("stake_vault");
  const rewardVault = pda("reward_vault");

  let grxMint: PublicKey;
  let user: Keypair;
  let userGrxAta: PublicKey;
  let userThbgAta: PublicKey;
  let userStakePos: PublicKey;

  before(async () => {
    user = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(user.publicKey, 5 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    // GRX-like mint for the test (mint authority = local payer).
    grxMint = await createMint(
      provider.connection, payer, authority, null, GRX_DECIMALS, undefined, undefined, TOKEN_2022_PROGRAM_ID,
    );

    userGrxAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, grxMint, user.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
    )).address;

    // Seed the user with 100 GRX.
    await mintTo(
      provider.connection, payer, grxMint, userGrxAta, authority,
      BigInt(ONE_GRX.muln(100).toString()), [], undefined, TOKEN_2022_PROGRAM_ID,
    );

    userThbgAta = getAssociatedTokenAddressSync(thbgMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
    userStakePos = PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), user.publicKey.toBuffer()], program.programId,
    )[0];
  });

  it("initializes the treasury + THBG mint", async () => {
    await program.methods
      .initialize(authority /* attestor */, authority /* recorder */, RATE, FEE_BPS, TTL)
      .accounts({
        treasury: treasuryPda, grxMint, thbgMint, swapVault, stakeVault, rewardVault,
        authority, tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const t = await program.account.treasury.fetch(treasuryPda);
    expect(t.grxPerThbgRate.toString()).to.eq(RATE.toString());
    expect(t.swapFeeBps).to.eq(FEE_BPS);
    expect(t.thbgSupply.toNumber()).to.eq(0);
  });

  it("blocks swap when the attestation is stale (never set)", async () => {
    // Create the user's THBG ATA up front.
    await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, thbgMint, user.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
    );
    let failed = false;
    try {
      await program.methods.swapGrxForThbg(ONE_GRX)
        .accounts({
          treasury: treasuryPda, grxMint, thbgMint, swapVault,
          userGrxAta, userThbgAta, user: user.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user]).rpc();
    } catch (e: any) {
      failed = true;
      expect(e.toString()).to.match(/StaleAttestation/);
    }
    expect(failed).to.eq(true);
  });

  it("attests the reserve", async () => {
    // 1,000 THBG of reserve (6 decimals).
    await program.methods.updateAttestation(new BN(1_000_000_000))
      .accounts({ treasury: treasuryPda, attestor: authority }).rpc();
    const t = await program.account.treasury.fetch(treasuryPda);
    expect(t.attestedReserve.toString()).to.eq("1000000000");
  });

  it("swaps 3 GRX → THBG (rate + 0.25% fee)", async () => {
    await program.methods.swapGrxForThbg(ONE_GRX.muln(3))
      .accounts({
        treasury: treasuryPda, grxMint, thbgMint, swapVault,
        userGrxAta, userThbgAta, user: user.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([user]).rpc();

    // gross = 3 * 4_000_000 = 12_000_000; fee = 30_000; net = 11_970_000.
    const bal = await getAccount(provider.connection, userThbgAta, undefined, TOKEN_2022_PROGRAM_ID);
    expect(bal.amount.toString()).to.eq("11970000");
    const t = await program.account.treasury.fetch(treasuryPda);
    expect(t.thbgSupply.toString()).to.eq("11970000");
  });

  it("rejects a swap that would breach the peg", async () => {
    // Drop attested reserve below outstanding supply, refresh ts, then try to mint more.
    await program.methods.updateAttestation(new BN(11_970_000))
      .accounts({ treasury: treasuryPda, attestor: authority }).rpc();
    let failed = false;
    try {
      await program.methods.swapGrxForThbg(ONE_GRX)
        .accounts({
          treasury: treasuryPda, grxMint, thbgMint, swapVault,
          userGrxAta, userThbgAta, user: user.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user]).rpc();
    } catch (e: any) {
      failed = true;
      expect(e.toString()).to.match(/PegBreach/);
    }
    expect(failed).to.eq(true);
  });

  it("stakes, funds rewards, and claims them", async () => {
    // user stakes 10 GRX
    await program.methods.stakeGrx(ONE_GRX.muln(10))
      .accounts({
        treasury: treasuryPda, position: userStakePos, grxMint, stakeVault,
        userGrxAta, user: user.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .signers([user]).rpc();

    let pos = await program.account.stakePosition.fetch(userStakePos);
    expect(pos.amount.toString()).to.eq(ONE_GRX.muln(10).toString());

    // admin funds 2 GRX of rewards (from authority ATA)
    const adminGrxAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, grxMint, authority, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
    )).address;
    await mintTo(
      provider.connection, payer, grxMint, adminGrxAta, authority,
      BigInt(ONE_GRX.muln(2).toString()), [], undefined, TOKEN_2022_PROGRAM_ID,
    );
    await program.methods.fundRewards(ONE_GRX.muln(2))
      .accounts({
        treasury: treasuryPda, grxMint, rewardVault, funderGrxAta: adminGrxAta,
        funder: authority, tokenProgram: TOKEN_2022_PROGRAM_ID,
      }).rpc();

    // sole staker → claims the full 2 GRX pot
    const before = await getAccount(provider.connection, userGrxAta, undefined, TOKEN_2022_PROGRAM_ID);
    await program.methods.claimRewards()
      .accounts({
        treasury: treasuryPda, position: userStakePos, grxMint, rewardVault,
        userGrxAta, user: user.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([user]).rpc();
    const after = await getAccount(provider.connection, userGrxAta, undefined, TOKEN_2022_PROGRAM_ID);
    expect((after.amount - before.amount).toString()).to.eq(ONE_GRX.muln(2).toString());
  });

  it("redeems THBG back to GRX", async () => {
    // refresh attestation so peg checks pass for nothing-minted redeem path
    await program.methods.updateAttestation(new BN(1_000_000_000))
      .accounts({ treasury: treasuryPda, attestor: authority }).rpc();
    const supplyBefore = (await program.account.treasury.fetch(treasuryPda)).thbgSupply;
    await program.methods.redeemThbgForGrx(new BN(1_970_000))
      .accounts({
        treasury: treasuryPda, grxMint, thbgMint, swapVault,
        userGrxAta, userThbgAta, user: user.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([user]).rpc();
    const supplyAfter = (await program.account.treasury.fetch(treasuryPda)).thbgSupply;
    expect(supplyBefore.sub(supplyAfter).toString()).to.eq("1970000");
  });

  it("rejects slash from a non-authority", async () => {
    let failed = false;
    try {
      await program.methods.slashStake(ONE_GRX.muln(1))
        .accounts({
          treasury: treasuryPda, targetOwner: user.publicKey, position: userStakePos,
          grxMint, stakeVault, rewardVault,
          authority: user.publicKey, // wrong signer
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user]).rpc();
    } catch (e: any) {
      failed = true;
      expect(e.toString()).to.match(/UnauthorizedAuthority|has_one|ConstraintHasOne/);
    }
    expect(failed).to.eq(true);
  });

  it("slashes a staker: principal → reward pool, position reduced", async () => {
    // After the staking test the user holds 10 GRX staked (sole staker).
    const posBefore = await program.account.stakePosition.fetch(userStakePos);
    const tBefore = await program.account.treasury.fetch(treasuryPda);
    const stakeVaultBefore = await getAccount(provider.connection, stakeVault, undefined, TOKEN_2022_PROGRAM_ID);
    const rewardVaultBefore = await getAccount(provider.connection, rewardVault, undefined, TOKEN_2022_PROGRAM_ID);

    const slash = ONE_GRX.muln(4);
    await program.methods.slashStake(slash)
      .accounts({
        treasury: treasuryPda, targetOwner: user.publicKey, position: userStakePos,
        grxMint, stakeVault, rewardVault,
        authority, tokenProgram: TOKEN_2022_PROGRAM_ID,
      }).rpc();

    const posAfter = await program.account.stakePosition.fetch(userStakePos);
    const tAfter = await program.account.treasury.fetch(treasuryPda);
    const stakeVaultAfter = await getAccount(provider.connection, stakeVault, undefined, TOKEN_2022_PROGRAM_ID);
    const rewardVaultAfter = await getAccount(provider.connection, rewardVault, undefined, TOKEN_2022_PROGRAM_ID);

    // Principal reduced by the slashed amount.
    expect(posBefore.amount.sub(posAfter.amount).toString()).to.eq(slash.toString());
    expect(tBefore.totalStaked.sub(tAfter.totalStaked).toString()).to.eq(slash.toString());
    // Slashed GRX moved stake_vault → reward_vault and into the reward pool.
    expect((stakeVaultBefore.amount - stakeVaultAfter.amount).toString()).to.eq(slash.toString());
    expect((rewardVaultAfter.amount - rewardVaultBefore.amount).toString()).to.eq(slash.toString());
    expect(tAfter.rewardPool.sub(tBefore.rewardPool).toString()).to.eq(slash.toString());
  });
});
