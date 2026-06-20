// Client helper for the §2b batch settlement audit commitment.
//
// Derives the treasury `SettlementRecord` PDA that
// `trading::batch_settle_offchain_match` creates (via CPI) and that
// `treasury::record_settlement_batch` writes. The batch caller MUST pass this
// account whenever treasury recording fires for a THBG market, otherwise the
// settlement is rejected (`TreasurySettlementRequired`).
//
// Seeds (must match treasury on-chain exactly):
//   [ b"settlement", zone_id as u32 LE (4 bytes), batch_id as u64 LE (8 bytes) ]
// owned by the TREASURY program. This encoding is the one exercised by the
// passing litesvm test `tests/settlement_commitment_litesvm.ts`, whose on-chain
// `init` matched it — so it is verified against the program, not guessed.
//
// CLI:  npx tsx scripts/settlement-pda.ts <zoneId> <batchId>
//   e.g. npx tsx scripts/settlement-pda.ts 301 42

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// Treasury program id — source of truth Anchor.toml [programs.localnet].
export const TREASURY_PROGRAM = new PublicKey(
  "FfxSQYKUmx9NGdCC9TDPmZSYjWYE1h4ruu3JatzHN5Tn"
);

/** u32 little-endian, 4 bytes. */
function zoneSeed(zoneId: number): Buffer {
  if (!Number.isInteger(zoneId) || zoneId < 0 || zoneId > 0xffff_ffff) {
    throw new Error(`zoneId out of u32 range: ${zoneId}`);
  }
  const b = Buffer.alloc(4);
  b.writeUInt32LE(zoneId, 0);
  return b;
}

/** u64 little-endian, 8 bytes. Accepts number | bigint | BN | string. */
function batchSeed(batchId: number | bigint | BN | string): Buffer {
  const bn = BN.isBN(batchId) ? batchId : new BN(batchId.toString());
  if (bn.isNeg() || bn.bitLength() > 64) {
    throw new Error(`batchId out of u64 range: ${batchId}`);
  }
  return bn.toArrayLike(Buffer, "le", 8);
}

/**
 * Derive the per-(zone, batch) SettlementRecord PDA under the treasury program.
 * Returns [address, bump].
 */
export function settlementRecordPda(
  zoneId: number,
  batchId: number | bigint | BN | string,
  treasuryProgram: PublicKey = TREASURY_PROGRAM
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("settlement"), zoneSeed(zoneId), batchSeed(batchId)],
    treasuryProgram
  );
}

// --- CLI ---------------------------------------------------------------------
// Run directly: print the derived PDA for the given (zoneId, batchId).
// Compare against `tests/settlement_commitment_litesvm.ts` (zone 301, batch 42)
// to confirm the encoding matches the program.
if (import.meta.url === `file://${process.argv[1]}`) {
  const zone = Number(process.argv[2] ?? 301);
  const batch = process.argv[3] ?? "42";
  const [addr, bump] = settlementRecordPda(zone, batch);
  console.log(`zone=${zone} batch=${batch}`);
  console.log(`settlement_record=${addr.toBase58()}`);
  console.log(`bump=${bump}`);
}
