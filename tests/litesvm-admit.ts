import { LiteSVM } from "litesvm";
import { PublicKey } from "@solana/web3.js";

/// Governance program ID — owner of the PoA aggregator allow-list. Must match
/// Anchor.toml [programs.localnet].governance and registry::GOVERNANCE_PROGRAM_ID.
export const GOVERNANCE_PROGRAM_ID = new PublicKey(
  "FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS",
);

/**
 * Fabricate an *active* governance `AggregatorEntry` PDA for `aggregator` via setAccount,
 * so registry's `register_validator` PoA gate passes without deploying or driving the
 * governance program. The registry gate only reads owner + PDA seeds + bytes, so a
 * hand-rolled buffer (zeroed discriminator) is sufficient.
 *
 * AggregatorEntry borsh layout:
 *   [0..8] discriminator | [8..40] aggregator | [40..48] admitted_at
 *   [48..56] updated_at | [56] active | [57] bump
 */
export function admitAggregator(svm: LiteSVM, aggregator: PublicKey): PublicKey {
  const [entry] = PublicKey.findProgramAddressSync(
    [Buffer.from("aggregator"), aggregator.toBuffer()],
    GOVERNANCE_PROGRAM_ID,
  );
  const data = Buffer.alloc(58);
  aggregator.toBuffer().copy(data, 8); // aggregator at [8..40]
  data[56] = 1; // active = true
  svm.setAccount(entry, {
    lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    data,
    owner: GOVERNANCE_PROGRAM_ID,
    executable: false,
    rentEpoch: 0,
  } as any);
  return entry;
}
