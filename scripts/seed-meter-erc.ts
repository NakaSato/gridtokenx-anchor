// Seed a registry Meter + a governance ErcCertificate for one registered user,
// so the explorer's Meter(128) and ErcCertificate decoders have real data.
// Run AFTER register-test-users.ts (needs an Active user + its keypair).
//   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=<dev-wallet> npx tsx scripts/seed-meter-erc.ts
import * as anchor from '@anchor-lang/core';
import { Program } from '@anchor-lang/core';
import { Registry } from '../target/types/registry';
import { Governance } from '../target/types/governance';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const registry = anchor.workspace.Registry as Program<Registry>;
  const governance = anchor.workspace.Governance as Program<Governance>;
  const authority = provider.wallet.publicKey; // dev wallet = registry + governance authority

  // Owner must be a registered Active user AND must sign issue_erc.
  const owner = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('test-wallet-prosumer.json', 'utf8'))),
  );
  const shardId = owner.publicKey.toBytes()[0] % 16;
  const meterId = `MTR_${owner.publicKey.toBase58().slice(0, 6)}`;
  const zoneId = 0;

  const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from('registry')], registry.programId);
  const [userPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user'), owner.publicKey.toBuffer()],
    registry.programId,
  );
  const [shardPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry_shard'), Buffer.from([shardId])],
    registry.programId,
  );
  const [meterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('meter'), owner.publicKey.toBuffer(), Buffer.from(meterId)],
    registry.programId,
  );

  console.log('Registering meter', meterId, 'for', owner.publicKey.toBase58());
  try {
    await registry.methods
      .registerMeter(meterId, { solar: {} } as any, shardId, zoneId)
      .accounts({
        meterAccount: meterPda,
        userAccount: userPda,
        registryShard: shardPda,
        registry: registryPda,
        owner: owner.publicKey,
        payer: authority,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log('  ✅ meter registered:', meterPda.toBase58());
  } catch (e: any) {
    console.log('  ⚠️ register_meter:', e.message);
  }

  // Record generation on the meter so it has unclaimed kWh for the ERC.
  // oracle_authority (the registry-configured oracle) must sign — that's the dev wallet.
  console.log('Recording meter generation...');
  try {
    await registry.methods
      .updateMeterReading(new BN(10000), new BN(0), new BN(Math.floor(Date.now() / 1000)))
      .accounts({
        registry: registryPda,
        meterAccount: meterPda,
        oracleAuthority: authority,
      } as any)
      .rpc();
    console.log('  ✅ generation recorded (10000 kWh)');
  } catch (e: any) {
    console.log('  ⚠️ update_meter_reading:', e.message);
  }

  // Issue an ERC for that meter (owner signs, dev wallet is governance authority).
  const certId = `ERC_${owner.publicKey.toBase58().slice(0, 6)}`;
  const [poaPda] = PublicKey.findProgramAddressSync([Buffer.from('poa_config')], governance.programId);
  const [ercPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('erc_certificate'), Buffer.from(certId)],
    governance.programId,
  );
  // Fungible REC mint (1 token = 1 MWh, 6 decimals) + producer ATA (owner = meter owner).
  const [recMint] = PublicKey.findProgramAddressSync([Buffer.from('rec_mint')], governance.programId);
  const recAta = getAssociatedTokenAddressSync(recMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);

  // Ensure the REC mint exists (idempotent).
  try {
    await governance.methods
      .initRecMint()
      .accounts({
        governanceConfig: poaPda,
        recMint,
        authority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log('  ✅ REC mint initialized');
  } catch (e: any) {
    if (!/already in use|0x0/.test(e.message ?? '')) console.log('  ⚠️ init_rec_mint:', e.message);
  }

  console.log('Issuing ERC', certId);
  try {
    await governance.methods
      .issueErc(certId, new BN(500), 'Solar', 'oracle-validated')
      .accounts({
        governanceConfig: poaPda,
        ercCertificate: ercPda,
        meterAccount: meterPda,
        owner: owner.publicKey,
        registry: registryPda,
        registryProgram: registry.programId,
        recMint,
        recTokenAccount: recAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        authority,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([owner])
      .rpc();
    console.log('  ✅ ERC issued:', ercPda.toBase58());
  } catch (e: any) {
    console.log('  ⚠️ issue_erc:', e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
