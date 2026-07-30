import * as anchor from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';

// Read-only: dump the treasury params + the trading market's settlement mint config,
// so the THBC wiring (which mint trades actually settle in) can be verified without
// guessing. No writes.
async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const treasuryProgram = anchor.workspace.Treasury;
    const tradingProgram = anchor.workspace.Trading;

    const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('treasury')], treasuryProgram.programId);
    const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from('market')], tradingProgram.programId);

    const t = await treasuryProgram.account.treasury.fetch(treasuryPda);
    console.log('=== TREASURY', treasuryPda.toBase58());
    console.log('  authority          :', t.authority.toBase58());
    console.log('  attestor           :', t.attestor.toBase58());
    console.log('  thbc_mint          :', t.thbcMint.toBase58());
    console.log('  settlement_recorder:', t.settlementRecorder.toBase58());
    console.log('  thbc_supply        :', t.thbcSupply.toString());
    console.log('  attested_reserve   :', t.attestedReserve.toString());
    console.log('  reserve_encumbered :', (t.reserveEncumbered ?? 0).toString());
    console.log('  attestation_ts     :', t.attestationTs.toString());
    console.log('  attestation_ttl    :', t.attestationTtl.toString());
    console.log('  total_settled_thbc :', t.totalSettledThbc.toString());
    console.log('  paused             :', t.paused);

    const m = await tradingProgram.account.market.fetch(marketPda);
    console.log('\n=== MARKET', marketPda.toBase58());
    console.log('  has_settlement_thbc_mint:', m.hasSettlementThbcMint);
    console.log('  settlement_thbc_mint    :', new PublicKey(m.settlementThbcMint).toBase58());
    console.log('  min_price_per_kwh       :', m.minPricePerKwh.toString());
    console.log('  max_price_per_kwh       :', m.maxPricePerKwh.toString());
}

main().catch((e) => { console.error(e); process.exit(1); });
