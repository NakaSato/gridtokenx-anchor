// Emit the canonical mint addresses + program PDAs as KEY=VALUE lines so the
// orchestrator (scripts/cmd/init.sh, start.sh) can propagate them into the
// service .env files. Without this the propagation step grep'd an empty string
// and every service fell back to a hard-coded phantom mint.
//
// Run from the gridtokenx-anchor dir against a live validator:
//   npx tsx scripts/get_pdas.ts
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

// Program IDs — source of truth is Anchor.toml [programs.localnet] (keypair-derived, stable).
const ENERGY_TOKEN_PROGRAM = new PublicKey("6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX");
const REGISTRY_PROGRAM = new PublicKey("FcSd5x4X1nzJMKLZC4tMZXnQ1ipLrGsEfeoH8N4mvJX7");
const TRADING_PROGRAM = new PublicKey("CnWDEUhTvSixeLSyViWgAnnu9YouBAYVGcrrFm1s9WcX");

const pda = (seed: string, program: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed)], program)[0].toBase58();

// GRID energy token is a Token-2022 mint owned by the energy-token program at PDA [b"mint_2022"].
const energyMint = pda("mint_2022", ENERGY_TOKEN_PROGRAM);

// GRX currency mint is a plain keypair persisted by bootstrap.ts as currency-mint.json.
let currencyMint = "";
try {
    const kp = JSON.parse(fs.readFileSync("currency-mint.json", "utf8"));
    // Last 32 bytes of the 64-byte secret key are the public key.
    currencyMint = new PublicKey(Uint8Array.from(kp).slice(32)).toBase58();
} catch {
    // currency-mint.json absent — leave blank; caller keeps its existing value.
}

console.log(`ENERGY_TOKEN_MINT=${energyMint}`);
console.log(`CURRENCY_TOKEN_MINT=${currencyMint}`);
console.log(`REGISTRY_PDA=${pda("registry", REGISTRY_PROGRAM)}`);
console.log(`MARKET_PDA=${pda("market", TRADING_PROGRAM)}`);
