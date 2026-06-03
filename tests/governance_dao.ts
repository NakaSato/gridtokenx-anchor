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

describe("governance-dao-integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  const tradingProgram = anchor.workspace.Trading as Program<Trading>;
  const registryProgram = anchor.workspace.Registry as Program<Registry>;
  
  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;

  let poaConfigPda: PublicKey;
  const zoneId = 301;
  let zoneConfigPda: PublicKey;
  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;
  
  const shardId = 0;

  before(async () => {
    [poaConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceProgram.programId);
    [zoneConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_config"), new BN(zoneId).toArrayLike(Buffer, 'le', 4)], governanceProgram.programId);
    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(0).toArrayLike(Buffer, 'le', 4)],
        tradingProgram.programId
    );

    // Ensure PoA is initialized
    try {
        await governanceProgram.methods.initializePoa().accounts({
            poaConfig: poaConfigPda,
            authority: authority,
            systemProgram: SystemProgram.programId,
        } as any).rpc();
    } catch (e) {}

    // Ensure ZoneConfig is initialized
    try {
        await governanceProgram.methods.initializeZoneConfig(zoneId, new BN(1000), new BN(50)).accounts({
            zoneConfig: zoneConfigPda,
            poaConfig: poaConfigPda,
            authority: authority,
            systemProgram: SystemProgram.programId,
        } as any).rpc();
    } catch (e) {}
  });

  async function registerUserWithMeter(user: Keypair, meterId: string): Promise<{ meterPda: PublicKey }> {
    const [userPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), user.publicKey.toBuffer()], registryProgram.programId);
    const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryProgram.programId);
    const [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([shardId])], registryProgram.programId);
    const [meterPda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), user.publicKey.toBuffer(), Buffer.from(meterId)], registryProgram.programId);

    // Fund user
    await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({ fromPubkey: authority, toPubkey: user.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL })));

    // Register User (ignore airdrop for this test by providing dummy accounts)
    await registryProgram.methods.registerUser({ prosumer: {} }, 0, 0, new BN(0), shardId).accounts({
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

    // Register Meter
    await registryProgram.methods.registerMeter(meterId, { solar: {} }, shardId).accounts({
        meterAccount: meterPda,
        userAccount: userPda,
        registryShard: shardPda,
        registry: registryPda,
        owner: user.publicKey,
        systemProgram: SystemProgram.programId,
    } as any).signers([user]).rpc();

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
        .createProposal(zoneId, proposalId, { wheelingCharge: {} }, new BN(75), new BN(1)) // 1 second voting period for test
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

    // 3. Wait for expiry
    console.log("   Waiting for voting period to end...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 4. Execute Proposal
    console.log("   Executing proposal...");
    await governanceProgram.methods
        .executeProposal()
        .accounts({
            poaConfig: poaConfigPda,
            zoneConfig: zoneConfigPda,
            proposal: proposalPda,
            executor: authority,
        } as any)
        .rpc();

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
            poaConfig: poaConfigPda,
            authority: authority,
        } as any)
        .rpc();

    let config = await governanceProgram.account.poAConfig.fetch(poaConfigPda);
    expect(config.pendingAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

    // 2. Approve Change (must be signed by new authority)
    console.log("   Approving authority change...");
    // Need to fund new authority
    await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({ fromPubkey: authority, toPubkey: newAuthority.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL })));

    await governanceProgram.methods
        .approveAuthorityChange()
        .accounts({
            poaConfig: poaConfigPda,
            newAuthority: newAuthority.publicKey,
        } as any)
        .signers([newAuthority])
        .rpc();

    config = await governanceProgram.account.poAConfig.fetch(poaConfigPda);
    expect(config.authority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

    // Clean up: Revert to original authority for other tests
    await governanceProgram.methods
        .proposeAuthorityChange(authority)
        .accounts({
            poaConfig: poaConfigPda,
            authority: newAuthority.publicKey,
        } as any)
        .signers([newAuthority])
        .rpc();
    
    await governanceProgram.methods
        .approveAuthorityChange()
        .accounts({
            poaConfig: poaConfigPda,
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
            poaConfig: poaConfigPda,
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
                governanceConfig: poaConfigPda,
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
            poaConfig: poaConfigPda,
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
            governanceConfig: poaConfigPda,
            ercCertificate: null,
            systemProgram: SystemProgram.programId,
        } as any)
        .signers([seller])
        .rpc();
  });
});
