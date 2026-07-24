// governance issue_erc net-basis precheck (litesvm, no validator). Pins the
// governance-side fail-fast bound that mirrors registry mark_erc_claimed:
//
//   unclaimed = total_generation - total_consumption            (NET basis)
//                                - claimed_erc_generation
//                                - settled_net_generation
//   require!(energy_amount <= unclaimed, InsufficientUnclaimedGeneration)
//
// (issue_erc.rs:113-119 + 152-155). This precheck fires BEFORE the registry
// `mark_erc_claimed` CPI (issue_erc.rs:166), so — exactly like the
// registry_hardening cases 6/7 pattern — we do NOT load registry.so: a reject
// stops at the precheck, and a pass sails past it and only then fails on the
// unreachable registry CPI (asserted with expectNotError).
//
// The registry-side authoritative bound is covered by registry_hardening_litesvm
// cases 4/5; this suite closes the remaining gap: that governance rejects on the
// SAME net basis (not gross generation) before ever reaching the CPI.
//
// governance_config + rec_mint are fabricated at their PDAs; meter_account and the
// registry singleton are fabricated byte-for-byte at the registry zero-copy /
// singleton layouts (state.rs) so no on-chain setup is needed.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Governance } from "../target/types/governance";
import { Registry } from "../target/types/registry";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const governanceIdl = require("../target/idl/governance.json");
const registryIdl = require("../target/idl/registry.json");

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const NOW = 1_000_000;
const INSUFFICIENT_UNCLAIMED = 6017; // GovernanceError::InsufficientUnclaimedGeneration

// registry account discriminators (sha256("account:<Name>")[..8]) — registry.json
const REGISTRY_DISC = Buffer.from([47, 174, 110, 246, 184, 182, 252, 218]);
const METER_DISC = Buffer.from([87, 111, 139, 87, 181, 20, 104, 255]);

describe("governance issue_erc — net-basis unclaimed precheck", () => {
  let svm: LiteSVM;
  let governance: Program<Governance>;
  let governanceId: PublicKey;
  let registryId: PublicKey;
  let cfgPda: PublicKey, recMintPda: PublicKey, registryPda: PublicKey;

  const payer = Keypair.generate();      // fee payer + governance authority + registry authority
  const meterOwner = Keypair.generate(); // meter.owner — must sign to authorize issuance

  function send(ix: TransactionInstruction, signers: Keypair[]) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(ix);
    tx.sign(payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey)));
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  }
  function expectCustomError(res: any, code: number) {
    expect(res instanceof FailedTransactionMetadata, "expected tx failure").to.eq(true);
    const logs = res.meta().logs().join("\n");
    expect(logs, logs).to.contain(`custom program error: 0x${code.toString(16)}`);
  }
  // A pass of the precheck still fails later (registry CPI is not loaded) — assert it
  // is NOT the precheck error, proving the net bound admitted the claim.
  function expectNotError(res: any, code: number) {
    if (!(res instanceof FailedTransactionMetadata)) return; // outright success is also fine
    const logs = res.meta().logs().join("\n");
    expect(logs, logs).to.not.contain(`custom program error: 0x${code.toString(16)}`);
  }

  const ata = (mint: PublicKey, owner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_2022.toBuffer(), mint.toBuffer()], ATA_PROG)[0];

  const certPda = (id: string) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("erc_certificate"), Buffer.from(id)], governanceId)[0];

  // GovernanceConfig at [b"governance_config"]: operational, ERC validation on,
  // no min/oracle gate, generous max so only the net precheck can bite.
  async function installConfig() {
    const c = {
      authority: payer.publicKey, authorityName: Array(64).fill(0), nameLen: 0,
      contactInfo: Array(128).fill(0), contactLen: 0, version: 1, maintenanceMode: false,
      ercValidationEnabled: true, minEnergyAmount: new BN(0), maxErcAmount: new BN("1000000000000000000"),
      ercValidityPeriod: new BN(31_536_000), requireOracleValidation: false, oracleAuthority: PublicKey.default,
      minOracleConfidence: 0, allowCertificateTransfers: true, minQuorumVotes: new BN(0),
      totalErcsIssued: new BN(0), totalErcsValidated: new BN(0), totalErcsRevoked: new BN(0),
      totalEnergyCertified: new BN(0), createdAt: new BN(0), lastUpdated: new BN(0),
      lastErcIssuedAt: new BN(0), pendingAuthority: PublicKey.default,
      pendingAuthorityProposedAt: new BN(0), pendingAuthorityExpiresAt: new BN(0), reserved: Array(5).fill(0),
    };
    const data = await governance.coder.accounts.encode("governanceConfig", c as any);
    svm.setAccount(cfgPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: governanceId, executable: false, rentEpoch: 0,
    } as any);
  }

  // Base 82-byte SPL mint owned by Token-2022, decimals 6, mint_authority = cfg PDA.
  function installRecMint() {
    const data = Buffer.alloc(82);
    data.writeUInt32LE(1, 0);             // COption::Some(mint_authority)
    cfgPda.toBuffer().copy(data, 4);
    data.writeUInt8(6, 44);               // decimals
    data.writeUInt8(1, 45);               // is_initialized
    svm.setAccount(recMintPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(82n)),
      data, owner: TOKEN_2022, executable: false, rentEpoch: 0,
    } as any);
  }

  // Registry singleton [b"registry"]: only the authority field (data[8..40]) is read
  // by issue_erc's `registry` constraint — must equal the governance authority.
  function installRegistry() {
    const data = Buffer.alloc(136);
    REGISTRY_DISC.copy(data, 0);
    payer.publicKey.toBuffer().copy(data, 8); // authority
    svm.setAccount(registryPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(136n)),
      data, owner: registryId, executable: false, rentEpoch: 0,
    } as any);
  }

  // MeterAccount owned by registry (state.rs:80): disc | meter_id[32] | owner[32] |
  // ...(64) | total_gen@96 | total_cons@104 | settled@112 | claimed@120.
  function installMeter(totalGen: bigint, totalCons: bigint, settled: bigint, claimed: bigint): PublicKey {
    const key = Keypair.generate().publicKey;
    const data = Buffer.alloc(128);
    METER_DISC.copy(data, 0);
    meterOwner.publicKey.toBuffer().copy(data, 40); // owner — must match the signer
    data.writeBigUInt64LE(totalGen, 96);
    data.writeBigUInt64LE(totalCons, 104);
    data.writeBigUInt64LE(settled, 112);
    data.writeBigUInt64LE(claimed, 120);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(128n)),
      data, owner: registryId, executable: false, rentEpoch: 0,
    } as any);
    return key;
  }

  const issueIx = (id: string, meter: PublicKey, energy: number) =>
    governance.methods
      .issueErc(id, new BN(energy), "solar", "")
      .accounts({
        governanceConfig: cfgPda, ercCertificate: certPda(id), meterAccount: meter,
        owner: meterOwner.publicKey, registry: registryPda, registryProgram: registryId,
        recMint: recMintPda, recTokenAccount: ata(recMintPda, meterOwner.publicKey),
        tokenProgram: TOKEN_2022, associatedTokenProgram: ATA_PROG,
        authority: payer.publicKey, systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    const registry = new Program(registryIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governanceId = governance.programId;
    registryId = registry.programId; // no addProgramFromFile: the CPI is unreachable in these cases
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    [cfgPda] = PublicKey.findProgramAddressSync([Buffer.from("governance_config")], governanceId);
    [recMintPda] = PublicKey.findProgramAddressSync([Buffer.from("rec_mint")], governanceId);
    [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryId);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    await installConfig();
    installRecMint();
    installRegistry();
  });

  it("1. energy_amount within net-unclaimed → precheck passes (not InsufficientUnclaimedGeneration)", async () => {
    // net = 10_000 - 4_000 = 6_000; unclaimed = 6_000 - 2_000(settled) - 1_000(claimed) = 3_000
    const meter = installMeter(10_000n, 4_000n, 2_000n, 1_000n);
    expectNotError(send(await issueIx("cert-ok", meter, 3_000), [meterOwner]), INSUFFICIENT_UNCLAIMED);
  });

  it("2. energy_amount over net-unclaimed → InsufficientUnclaimedGeneration", async () => {
    const meter = installMeter(10_000n, 4_000n, 2_000n, 1_000n); // unclaimed = 3_000
    expectCustomError(send(await issueIx("cert-over", meter, 4_000), [meterOwner]), INSUFFICIENT_UNCLAIMED);
  });

  it("3. NET basis, not gross: high generation but near-equal consumption → rejected", async () => {
    // gross generation = 100_000 would admit 5_000, but net = 100_000 - 99_000 = 1_000.
    const meter = installMeter(100_000n, 99_000n, 0n, 0n); // unclaimed = 1_000
    expectCustomError(send(await issueIx("cert-net", meter, 5_000), [meterOwner]), INSUFFICIENT_UNCLAIMED);
  });

  it("4. consumption/prior-claims/settled all subtract (fully-claimed meter → any issuance rejected)", async () => {
    // net = 8_000 - 3_000 = 5_000; settled 2_000 + claimed 3_000 = 5_000 → unclaimed = 0.
    const meter = installMeter(8_000n, 3_000n, 2_000n, 3_000n);
    expectCustomError(send(await issueIx("cert-zero", meter, 1), [meterOwner]), INSUFFICIENT_UNCLAIMED);
  });
});
