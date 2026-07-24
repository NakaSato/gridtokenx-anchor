= 8. Consensus & Validator Topology

== 8.1 What Solana consensus provides

On any Solana cluster, ordering and finality come from *Proof of History* (a
verifiable delay function giving each entry a position in time) feeding *Tower
BFT* (a PoH-timestamped variant of practical BFT voting in which validators
commit to forks with exponentially growing lockouts). Block production rotates
across a leader schedule weighted by stake. The programs in this repository are
consensus-agnostic: they see only the SVM account model and cannot tell which
consensus produced the block.

== 8.2 What "permissioned PoA" means here

GridTokenX targets a *permissioned cluster*: the validator set is a closed list
of known operators (utility / market-operator nodes) rather than open
stake-weighted entry. Solana does not have a separate "PoA mode" — permissioning
is operational (who is allowed to run a validator and receive stake delegation),
and the *application-layer* PoA lives in the governance program's
`GovernanceConfig` (§6.2), which gates protocol administration regardless of who
validates blocks. The two layers must be kept distinct:

#table(
  columns: 3,
  align: (left, left, left),
  table.header([*Layer*], [*Authority*], [*Mechanism*]),
  [Block production / finality], [Permissioned validator operators], [PoH + Tower BFT among allowlisted nodes],
  [Protocol administration], [`GovernanceConfig.authority`], [Governance program checks (§6.1–6.2)],
  [Energy attestation], [REC validator set], [energy-token gating (§6.4)],
)

== 8.3 Development topologies

#table(
  columns: 4,
  align: (left, left, left, left),
  table.header([*Mode*], [*Nodes*], [*Consensus reality*], [*How*]),
  [`anchor test` / localnet], [1 × `solana-test-validator`], [None — single node self-produces blocks; PoH runs but no voting quorum], [`anchor test`, or superproject `just solana-up`],
  [Surfpool simnet], [0 local validators], [Simulated against mainnet state], [`npm run simnet` / `npm run simnet:ci`],
  [Target deployment], [N permissioned validators], [Real Tower BFT among allowlisted operators], [Out of scope for this repository],
)

The single-node localnet means development and test runs never exercise fork choice, leader
rotation, or vote lockouts — only the SVM semantics (§4) are faithfully
reproduced. Performance numbers from #link("BENCHMARKS.md")[`BENCHMARKS.md`] are
therefore SVM/runtime measurements, not consensus-throughput measurements.
