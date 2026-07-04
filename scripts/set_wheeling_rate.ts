import * as anchor from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const tradingProgram = anchor.workspace.Trading;
  const authority = provider.wallet.publicKey;

  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from('market')], tradingProgram.programId);
  const [tariffConfigPda] = PublicKey.findProgramAddressSync([Buffer.from('tariff_config')], tradingProgram.programId);

  // Old (bps-model) tariff_config is a different account size — close it so init can
  // recreate at the new layout. Raw existence check (not the typed decoder, which
  // throws on the old layout rather than returning null).
  const rawInfo = await provider.connection.getAccountInfo(tariffConfigPda);
  if (rawInfo) {
    console.log('tariff_config exists (', rawInfo.data.length, 'bytes) — closing to reinit at new layout...');
    const closeTx = await tradingProgram.methods
      .closeTariffConfig()
      .accounts({ tariffConfig: tariffConfigPda, market: marketPda, authority })
      .rpc();
    console.log('close tx:', closeTx);
  } else {
    console.log('tariff_config not present, proceeding straight to init');
  }

  // 1.15 THB/kWh flat wheeling rate (6-dec currency units) -- no bps conversion needed,
  // this IS the value now. loss stays bps-of-value (proportional charge is correct there).
  const WHEELING_RATE_PER_KWH = new BN(1_150_000); // 1.15 THB/kWh
  const LOSS_BPS = 5; // 0.05%, matches bootstrap.ts default

  const initTx = await tradingProgram.methods
    .initializeTariffConfig(authority, authority, WHEELING_RATE_PER_KWH, LOSS_BPS)
    .accounts({
      tariffConfig: tariffConfigPda,
      market: marketPda,
      authority: authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log('init tx:', initTx);

  const cfg = await tradingProgram.account.tariffConfig.fetch(tariffConfigPda);
  console.log('wheeling_rate_per_kwh=', cfg.wheelingRatePerKwh.toString(), '(', cfg.wheelingRatePerKwh.toNumber() / 1_000_000, 'THB/kWh )');
  console.log('loss_bps=', cfg.lossBps);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
