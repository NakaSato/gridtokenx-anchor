import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Governance } from "../target/types/governance";
import { Trading } from "../target/types/trading";
import { Registry } from "../target/types/registry";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  Transaction,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

// Idempotent setup helper: these init calls re-run across test sessions against a
// persistent validator ledger, so an "account already in use" failure is expected
// and benign. Any OTHER error (bad accounts, constraint violation, program panic)
// is a real setup failure and must surface — never blanket-swallow.
async function ensureInitialized(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes("already in use")) return; // already initialized — fine
    throw new Error(`setup '${label}' failed: ${msg}`);
  }
}

describe("governance-dao-integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  const tradingProgram = anchor.workspace.Trading as Program<Trading>;
  const registryProgram = anchor.workspace.Registry as Program<Registry>;
  
  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;

  let governanceConfigPda: PublicKey;
  const zoneId = 301;
  let zoneConfigPda: PublicKey;
  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;
  
  const shardId = 0;

  before(async () => {
    [governanceConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceProgram.programId);
    [zoneConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_config"), new BN(zoneId).toArrayLike(Buffer, 'le', 4)], governanceProgram.programId);
    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(0).toArrayLike(Buffer, 'le', 4)],
        tradingProgram.programId
    );

    // Ensure PoA is initialized
    await ensureInitialized("initializeGovernance", () =>
        governanceProgram.methods.initializeGovernance().accounts({
            governanceConfig: governanceConfigPda,
            authority: authority,
            systemProgram: SystemProgram.programId,
        } as any).rpc());

    // Ensure ZoneConfig is initialized
    await ensureInitialized("initializeZoneConfig", () =>
        governanceProgram.methods.initializeZoneConfig(zoneId, new BN(1000), new BN(50)).accounts({
            zoneConfig: zoneConfigPda,
            governanceConfig: governanceConfigPda,
            authority: authority,
            systemProgram: SystemProgram.programId,
        } as any).rpc());

    // Ensure Trading market + zone market (zone 0) exist so create_sell_order
    // deserializes its accounts and reaches the maintenance-mode gate.
    await ensureInitialized("initializeMarket", () =>
        tradingProgram.methods.initializeMarket(1).accounts({
            market: marketPda,
            authority: authority,
            systemProgram: SystemProgram.programId,
        } as any).rpc());
    await ensureInitialized("initializeZoneMarket", () =>
        tradingProgram.methods.initializeZoneMarket(0, 1, new BN(1_000_000)).accounts({
            market: marketPda,
            zoneMarket: zoneMarketPda,
            authority: authority,
            systemProgram: SystemProgram.programId,
        } as any).rpc());
  });

  async function registerUserWithMeter(user: Keypair, meterId: string): Promise<{ meterPda: PublicKey }> {
    const [userPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), user.publicKey.toBuffer()], registryProgram.programId);
    const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryProgram.programId);
    // Shard bound in-program to the user's first key byte — derive + ensure inited.
    const userShardId = user.publicKey.toBytes()[0] % 16;
    const [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([userShardId])], registryProgram.programId);
    await ensureInitialized("initializeShard", () =>
        registryProgram.methods.initializeShard(userShardId).accounts({ shard: shardPda, authority, systemProgram: SystemProgram.programId } as any).rpc());
    const [meterPda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), user.publicKey.toBuffer(), Buffer.from(meterId)], registryProgram.programId);

    // Fund user
    await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({ fromPubkey: authority, toPubkey: user.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL })));

    // Register User (ignore airdrop for this test by providing dummy accounts)
    await registryProgram.methods.registerUser({ prosumer: {} }, 0, 0, new BN(0), userShardId).accounts({
        userAccount: userPda,
        registryShard: shardPda,
        registry: registryPda,
        authority: user.publicKey,
        payer: authority,
        energyTokenProgram: registryProgram.programId, // Just not default
        mint: registryPda,
        userTokenAccount: registryPda,
        tokenInfo: registryPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
    } as any).rpc();

    // Register Meter — owner is non-signing (custodial-bridge model); payer (wallet) signs.
    // Zone-bind the meter to the DAO test's proposal zone so create_proposal/cast_vote pass
    // the new meter.zone_id == target_zone check.
    await registryProgram.methods.registerMeter(meterId, { solar: {} }, userShardId, zoneId).accounts({
        meterAccount: meterPda,
        userAccount: userPda,
        registryShard: shardPda,
        registry: registryPda,
        owner: user.publicKey,
        payer: authority,
        systemProgram: SystemProgram.programId,
    } as any).rpc();

    return { meterPda };
  }

  it("DAO Lifecycle: Create Proposal -> Vote -> Execute", async () => {
    const proposer = Keypair.generate();
    const { meterPda: proposerMeter } = await registerUserWithMeter(proposer, "METER-PROP");
    
    const proposalId = new BN(Date.now());
    const [proposalPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("proposal"), new BN(zoneId).toArrayLike(Buffer, 'le', 4), proposalId.toArrayLike(Buffer, 'le', 8)],
        governanceProgram.programId
    );

    // 1. Create Proposal (Update Wheeling Charge to 75)
    console.log("   Creating proposal...");
    await governanceProgram.methods
        .createProposal(zoneId, proposalId, { wheelingCharge: {} }, new BN(75), new BN(3)) // short voting period; execute polls for on-chain expiry below
        .accounts({
            proposal: proposalPda,
            proposer: proposer.publicKey,
            meterAccount: proposerMeter,
            systemProgram: SystemProgram.programId,
        } as any)
        .signers([proposer])
        .rpc();

    // 2. Cast Vote
    console.log("   Casting vote...");
    const [votePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vote"), proposalPda.toBuffer(), proposer.publicKey.toBuffer()],
        governanceProgram.programId
    );

    await governanceProgram.methods
        .castVote(true)
        .accounts({
            proposal: proposalPda,
            voteRecord: votePda,
            voter: proposer.publicKey,
            meterAccount: proposerMeter,
            systemProgram: SystemProgram.programId,
        } as any)
        .signers([proposer])
        .rpc();

    // 3. + 4. Execute once the voting period has expired. The validator clock is
    // slot-derived (drifts from wall time), so poll executeProposal and retry while
    // it reports ProposalNotExpired rather than relying on a fixed setTimeout.
    console.log("   Waiting for voting period to end, then executing...");
    const execDeadline = Date.now() + 30000;
    while (true) {
        try {
            await governanceProgram.methods
                .executeProposal()
                .accounts({
                    governanceConfig: governanceConfigPda,
                    zoneConfig: zoneConfigPda,
                    proposal: proposalPda,
                    executor: authority,
                } as any)
                .rpc();
            break;
        } catch (e: any) {
            if (e.message?.includes("ProposalNotExpired") && Date.now() < execDeadline) {
                await new Promise(resolve => setTimeout(resolve, 700));
                continue;
            }
            throw e;
        }
    }

    // 5. Verify outcome
    const zoneConfig = await governanceProgram.account.zoneConfig.fetch(zoneConfigPda);
    expect(zoneConfig.wheelingCharge.toNumber()).to.equal(75);
    
    const proposal = await governanceProgram.account.proposal.fetch(proposalPda);
    expect(proposal.status).to.have.property("executed");
  });

  it("Two-Step Authority Handover", async () => {
    const newAuthority = Keypair.generate();

    // 1. Propose Change
    console.log("   Proposing authority change...");
    await governanceProgram.methods
        .proposeAuthorityChange(newAuthority.publicKey)
        .accounts({
            governanceConfig: governanceConfigPda,
            authority: authority,
        } as any)
        .rpc();

    let config = await governanceProgram.account.governanceConfig.fetch(governanceConfigPda);
    expect(config.pendingAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

    // 2. Approve Change (must be signed by new authority)
    console.log("   Approving authority change...");
    // Need to fund new authority
    await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({ fromPubkey: authority, toPubkey: newAuthority.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL })));

    await governanceProgram.methods
        .approveAuthorityChange()
        .accounts({
            governanceConfig: governanceConfigPda,
            newAuthority: newAuthority.publicKey,
        } as any)
        .signers([newAuthority])
        .rpc();

    config = await governanceProgram.account.governanceConfig.fetch(governanceConfigPda);
    expect(config.authority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

    // Clean up: Revert to original authority for other tests
    await governanceProgram.methods
        .proposeAuthorityChange(authority)
        .accounts({
            governanceConfig: governanceConfigPda,
            authority: newAuthority.publicKey,
        } as any)
        .signers([newAuthority])
        .rpc();
    
    await governanceProgram.methods
        .approveAuthorityChange()
        .accounts({
            governanceConfig: governanceConfigPda,
            newAuthority: authority,
        } as any)
        .rpc();
  });

  it("Maintenance Mode Enforcement", async () => {
    // 1. Enable Maintenance Mode
    console.log("   Enabling maintenance mode...");
    await governanceProgram.methods
        .setMaintenanceMode(true)
        .accounts({
            governanceConfig: governanceConfigPda,
            authority: authority,
        } as any)
        .rpc();

    // 2. Try to create a sell order in Trading program (should fail)
    console.log("   Verifying Trading program is locked...");
    const seller = Keypair.generate();
    await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({ fromPubkey: authority, toPubkey: seller.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL })));
    
    const orderId = new BN(Date.now());
    const [orderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order"), seller.publicKey.toBuffer(), orderId.toArrayLike(Buffer, 'le', 8)],
        tradingProgram.programId
    );

    try {
        await tradingProgram.methods
            .createSellOrder(orderId, new BN(100), new BN(50))
            .accounts({
                market: marketPda,
                zoneMarket: zoneMarketPda,
                order: orderPda,
                authority: seller.publicKey,
                governanceConfig: governanceConfigPda,
                ercCertificate: null,
                systemProgram: SystemProgram.programId,
            } as any)
            .signers([seller])
            .rpc();
        expect.fail("Should have failed due to maintenance mode");
    } catch (e: any) {
        expect(e.message).to.contain("MaintenanceMode");
    }

    // 3. Disable Maintenance Mode
    console.log("   Disabling maintenance mode...");
    await governanceProgram.methods
        .setMaintenanceMode(false)
        .accounts({
            governanceConfig: governanceConfigPda,
            authority: authority,
        } as any)
        .rpc();
    
    // 4. Try again (should succeed)
    console.log("   Verifying Trading program is unlocked...");
    await tradingProgram.methods
        .createSellOrder(orderId, new BN(100), new BN(50))
        .accounts({
            market: marketPda,
            zoneMarket: zoneMarketPda,
            order: orderPda,
            authority: seller.publicKey,
            governanceConfig: governanceConfigPda,
            ercCertificate: null,
            systemProgram: SystemProgram.programId,
        } as any)
        .signers([seller])
        .rpc();
  });
});
