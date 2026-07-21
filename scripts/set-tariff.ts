/**
 * set-tariff.ts — replace the on-chain tariff schedule (close + re-init).
 *
 * The trading program has no rate-update instruction; rates change by closing
 * the tariff_config PDA and re-initializing it with new values (both gated on
 * the market authority, which is the deployer on localnet).
 *
 * Env: WHEELING_MICROS (u64, micros per kWh, e.g. 1150000 = 1.15 THB/kWh)
 *      LOSS_BPS        (u16, e.g. 5)
 *      ANCHOR_PROVIDER_URL / ANCHOR_WALLET
 *
 * Run: npx tsx scripts/set-tariff.ts
 */
import * as anchor from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

const WHEELING_MICROS = process.env.WHEELING_MICROS;
const LOSS_BPS = process.env.LOSS_BPS;
if (!WHEELING_MICROS || !LOSS_BPS) throw new Error("WHEELING_MICROS and LOSS_BPS required");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const trading = anchor.workspace.Trading as anchor.Program;
  const authority = provider.wallet.publicKey;

  const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], trading.programId);
  const [tariffConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("tariff_config")], trading.programId);

  try {
    await trading.methods.closeTariffConfig().accounts({
      tariffConfig: tariffConfigPda, market: marketPda, authority,
    } as any).rpc();
    console.log("tariff_config closed");
  } catch (e: any) {
    console.log("close skipped:", (e.message || e).toString().slice(0, 80));
  }
  await trading.methods
    .initializeTariffConfig(authority, authority, new BN(WHEELING_MICROS), parseInt(LOSS_BPS, 10))
    .accounts({
      tariffConfig: tariffConfigPda, market: marketPda, authority,
      systemProgram: SystemProgram.programId,
    } as any).rpc();
  console.log(`tariff set: wheeling=${WHEELING_MICROS} micros/kWh, loss=${LOSS_BPS} bps`);
}

main().catch((e) => { console.error(e); process.exit(1); });
