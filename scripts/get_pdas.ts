// Prints the well-known PDAs + persisted mint addresses as KEY=VALUE lines, for
// scripts/cmd/init.sh and scripts/cmd/start.sh to grep and propagate into .env.
// Seeds mirror bootstrap.ts exactly — keep the two in sync if a seed changes.
import * as anchor from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry;
  const energyTokenProgram = anchor.workspace.EnergyToken;
  const tradingProgram = anchor.workspace.Trading;

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry')],
    registryProgram.programId
  );
  const [mintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_2022')],
    energyTokenProgram.programId
  );
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market')],
    tradingProgram.programId
  );

  let currencyMint = '';
  try {
    const raw = fs.readFileSync('currency-mint.json', 'utf8');
    const kp = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    currencyMint = kp.publicKey.toBase58();
  } catch (e) {
    // currency-mint.json not generated yet (bootstrap hasn't run) — leave blank.
  }

  console.log(`ENERGY_TOKEN_MINT=${mintPda.toBase58()}`);
  console.log(`CURRENCY_TOKEN_MINT=${currencyMint}`);
  console.log(`REGISTRY_PDA=${registryPda.toBase58()}`);
  console.log(`MARKET_PDA=${marketPda.toBase58()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
