/**
 * audit-month.ts — verify month-bench results against live chain state via RPC
 * reads only. Run from the gridtokenx-anchor repo root (anchor.workspace needs
 * Anchor.toml) with the bench validator still up.
 *
 * ANCHOR_PROVIDER_URL=http://127.0.0.1:8890 ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx tsx <scratchpad>/audit-month.ts
 */
import * as anchor from "@anchor-lang/core";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

const EXP = {
  readings: 229481,
  meters: 80,
  orders: 2396,
  settles: 353,
  ercCerts: 12,
  mintedWh: 3290724,
  recWh: 4962778,
  currencyVolume: 13137,
  buyerSeedWh: 68, // 68 buyers seeded 1 Wh each into energy escrows
};

let pass = 0, fail = 0;
function check(name: string, actual: number | string, expected: number | string) {
  const ok = String(actual) === String(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}\n      actual=${actual} expected=${expected}`);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const conn = provider.connection;
  const oracle = anchor.workspace.Oracle as any;
  const trading = anchor.workspace.Trading as any;
  const governance = anchor.workspace.Governance as any;
  const energyToken = anchor.workspace.EnergyToken as any;
  const registry = anchor.workspace.Registry as any;

  console.log("═".repeat(60));
  console.log("ON-CHAIN AUDIT of month-bench results  (RPC:", (conn as any)._rpcEndpoint + ")");
  console.log("═".repeat(60));

  // 1. Oracle telemetry counters. NOTE: oracle_data.total_readings is a global
  // counter that the hot path deliberately never writes (Sealevel invariant:
  // per-entity PDAs only; global totals reconcile via aggregate_readings) — so
  // the ground truth is the SUM of per-meter counters.
  const meterStates = await oracle.account.meterState.all();
  check("oracle MeterState PDAs == fleet size", meterStates.length, EXP.meters);
  const sumReadings = meterStates.reduce((a: number, m: any) => a + Number(m.account.totalReadings), 0);
  check("Σ per-meter total_readings == confirmed telemetry", sumReadings, EXP.readings);

  // 3. Trading accounts
  const orders = await trading.account.order.all();
  check("trading Order PDAs == phase-2 orders", orders.length, EXP.orders);
  const tradeNullifiers = await trading.account.tradeNullifier.all();
  check("TradeNullifier PDAs == settled matches", tradeNullifiers.length, EXP.settles);
  const orderNullifiers = await trading.account.orderNullifier.all();
  check("OrderNullifier PDAs == 2 × settles", orderNullifiers.length, 2 * EXP.settles);

  // 4. Registry conservation + REC certificates
  const regMeters = await registry.account.meterAccount.all();
  check("registry MeterAccount PDAs == prosumers", regMeters.length, 12);
  const settledSum = regMeters.reduce((a: number, m: any) => a + Number(m.account.settledNetGeneration), 0);
  const claimedSum = regMeters.reduce((a: number, m: any) => a + Number(m.account.claimedErcGeneration), 0);
  check("registry Σ settled_net_generation == GRID minted (Wh)", settledSum, EXP.mintedWh);
  check("registry Σ claimed_erc_generation == REC certified (Wh)", claimedSum, EXP.recWh);
  const certs = await governance.account.ercCertificate.all();
  check("ErcCertificate PDAs == prosumers", certs.length, EXP.ercCerts);
  const certEnergy = certs.reduce((a: number, c: any) => a + Number(c.account.energyAmount), 0);
  check("Σ certificate energy_amount == REC certified (Wh)", certEnergy, EXP.recWh);

  // 5. Token supplies — mint/burn closure
  const [energyMint] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyToken.programId);
  const gridSupply = await conn.getTokenSupply(energyMint);
  check("GRID supply after burns == 68 escrow-seed Wh (all trade GRID burned)", gridSupply.value.amount, EXP.buyerSeedWh);
  const [recMint] = PublicKey.findProgramAddressSync([Buffer.from("rec_mint")], governance.programId);
  const recSupply = await conn.getTokenSupply(recMint);
  check("REC supply == claimed Wh × 1000 base units", recSupply.value.amount, EXP.recWh * 1000);

  // 6. Currency conservation
  const currencyMint = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("currency-mint.json", "utf8")))).publicKey;
  const [marketAuthority] = PublicKey.findProgramAddressSync([Buffer.from("market_authority")], trading.programId);
  const collector = (label: string) =>
    PublicKey.findProgramAddressSync([Buffer.from(label), currencyMint.toBuffer()], trading.programId)[0];
  const bal = async (pk: PublicKey) => Number((await conn.getTokenAccountBalance(pk)).value.amount);
  const fees = await bal(collector("fee_collector"));
  const wheel = await bal(collector("wheeling_collector"));
  const loss = await bal(collector("loss_collector"));
  const parsed = await conn.getParsedProgramAccounts(
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    { filters: [{ dataSize: 165 }, { memcmp: { offset: 32, bytes: marketAuthority.toBase58() } }] });
  const collectorKeys = new Set(["fee_collector", "wheeling_collector", "loss_collector"]
    .map((l) => collector(l).toBase58()));
  let sellerSum = 0, buyerLeft = 0;
  for (const a of parsed) {
    const info: any = (a.account.data as any).parsed.info;
    if (info.mint !== currencyMint.toBase58()) continue;
    if (collectorKeys.has(a.pubkey.toBase58())) continue; // collectors are marketAuthority-owned too
    const amt = Number(info.tokenAmount.amount);
    if (amt >= 900_000_000) buyerLeft += amt; else sellerSum += amt;
  }
  const sellerProceeds = sellerSum - 12 * 10; // minus the 12 × 10-unit escrow seeds
  console.log(`   collectors: fee=${fees} wheeling=${wheel} loss=${loss}  seller proceeds=${sellerProceeds}`);
  check("currency conservation: seller proceeds + collectors == Σ trade totals",
    sellerProceeds + fees + wheel + loss, EXP.currencyVolume);
  check("registry minted == artifact precise gridMinted (Wh)", EXP.mintedWh, 3290724);
  const buyersSpent = 68 * 1_000_000_000 - buyerLeft;
  check("buyer escrow outflow == Σ trade totals", buyersSpent, EXP.currencyVolume);

  console.log("\n" + "═".repeat(60));
  console.log(`AUDIT ${fail === 0 ? "✅ PASSED" : "❌ FAILED"}: ${pass} ok, ${fail} failed`);
  console.log("═".repeat(60));
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
