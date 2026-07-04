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

/**
 * Fabricate a minimal `GovernanceConfig` at the canonical `poa_config` PDA via setAccount,
 * so energy-token's `add_rec_validator`/`remove_rec_validator` (ERC-is-REC-issuer gate)
 * and trading's `require_governance_operational` maintenance check pass without deploying
 * or driving the governance program. Both readers only check owner + PDA + a few fixed
 * byte offsets, so a hand-rolled buffer is sufficient. Not maintenance-mode by default
 * (byte 235 left 0 = operational); pass `maintenanceMode: true` to flip it for a guard test.
 *
 * GovernanceConfig borsh layout (see CLAUDE.md / settle_offchain.rs comments):
 *   [0..8] disc | [8..40] authority | [40..104] authority_name | [104] name_len
 *   | [105..233] contact_info | [233] contact_len | [234] version | [235] maintenance_mode
 */
export function fabricateGovernanceConfig(
  svm: LiteSVM,
  authority: PublicKey,
  opts: { maintenanceMode?: boolean } = {},
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], GOVERNANCE_PROGRAM_ID);
  const data = Buffer.alloc(236);
  authority.toBuffer().copy(data, 8); // authority at [8..40]
  data[235] = opts.maintenanceMode ? 1 : 0;
  svm.setAccount(pda, {
    lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    data,
    owner: GOVERNANCE_PROGRAM_ID,
    executable: false,
    rentEpoch: 0,
  } as any);
  return pda;
}
