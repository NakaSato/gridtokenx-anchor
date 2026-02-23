import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry;
  const programId = registryProgram.programId;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Registry Program Users');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Program ID: ${programId.toBase58()}`);
  console.log(`RPC: ${provider.connection.rpcEndpoint}`);
  console.log('');

  // Get all program accounts
  const accounts = await provider.connection.getProgramAccounts(programId, {
    commitment: 'confirmed',
  });

  console.log(`Total accounts found: ${accounts.length}`);
  console.log('');

  const registryPda = PublicKey.findProgramAddressSync(
    [Buffer.from('registry')],
    programId
  )[0];

  let userCount = 0;
  let meterCount = 0;

  for (const acc of accounts) {
    const pubkey = acc.pubkey.toBase58();
    const data = acc.account.data;

    // Check discriminator (first 8 bytes) - observed from on-chain
    const userDisc = Buffer.from([0xd3, 0x21, 0x88, 0x10, 0xba, 0x6e, 0xf2, 0x7f]); // From 3c25241e5GW49Lcthj445iyXh8UjVfAx4Ziy3u9aow3V
    const meterDisc = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // Placeholder

    const accountDisc = data.slice(0, 8);

    if (acc.pubkey.equals(registryPda)) {
      console.log(`📋 REGISTRY (Global State)`);
      console.log(`   Address: ${pubkey}`);
      try {
        const registry = await registryProgram.account.registry.fetch(acc.pubkey);
        console.log(`   Authority: ${registry.authority.toBase58()}`);
        console.log(`   User Count: ${registry.userCount}`);
        console.log(`   Meter Count: ${registry.meterCount}`);
        console.log(`   Active Meters: ${registry.activeMeterCount}`);
      } catch (e: any) {
        console.log(`   (Using zero_copy - raw data)`);
      }
      console.log('');
    } else if (accountDisc.equals(userDisc)) {
      userCount++;
      console.log(`👤 USER #${userCount}`);
      console.log(`   Address: ${pubkey}`);
      try {
        const user = await registryProgram.account.userAccount.fetch(acc.pubkey);
        console.log(`   Authority: ${user.authority.toBase58()}`);
        console.log(`   Type: ${Object.keys(user.userType)[0]}`);
        console.log(`   Status: ${Object.keys(user.status)[0]}`);
        console.log(`   Location: ${user.latE7 / 1e7}, ${user.longE7 / 1e7}`);
        console.log(`   Meters: ${user.meterCount}`);
        console.log(`   Registered: ${new Date(user.registeredAt.toNumber() * 1000).toISOString()}`);
      } catch (e: any) {
        console.log(`   (Error fetching: ${e.message})`);
      }
      console.log('');
    } else if (accountDisc.equals(meterDisc)) {
      meterCount++;
      console.log(`⚡ METER #${meterCount}`);
      console.log(`   Address: ${pubkey}`);
      try {
        const meter = await registryProgram.account.meterAccount.fetch(acc.pubkey);
        console.log(`   ID: ${Buffer.from(meter.meterId).toString().replace(/\0/g, '')}`);
        console.log(`   Owner: ${meter.owner.toBase58()}`);
        console.log(`   Type: ${Object.keys(meter.meterType)[0]}`);
        console.log(`   Status: ${Object.keys(meter.status)[0]}`);
        console.log(`   Generation: ${meter.totalGeneration}`);
        console.log(`   Consumption: ${meter.totalConsumption}`);
      } catch (e: any) {
        console.log(`   (Error fetching: ${e.message})`);
      }
      console.log('');
    } else {
      console.log(`❓ UNKNOWN Account: ${pubkey}`);
      console.log(`   Discriminator: ${accountDisc.toString('hex')}`);
      console.log('');
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Summary: ${userCount} users, ${meterCount} meters, 1 registry`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
