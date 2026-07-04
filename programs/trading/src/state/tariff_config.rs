use anchor_lang::prelude::*;

/// Hard ceiling on the distribution line-loss rate itself, as bps of trade value — loss is
/// genuinely proportional to trade value (lost energy is re-purchased at the agreed
/// price), unlike wheeling. Bounds the tariff-authority-set bps at config-write time
/// (`set_loss_rate`/`initialize_tariff_config`).
pub const MAX_LOSS_BPS: u64 = 2000;

/// Hard ceiling on *computed* combined network charges (wheeling + loss, whatever their
/// individual units) as a fraction of THIS trade's value — settlement-time defense-in-depth
/// (`net_seller_after_charges`), independent of the tariff-set-time caps above. A flat
/// wheeling rate can still consume an outsized fraction of a very small/cheap trade even
/// when the rate itself is sane, so this stays a per-settlement check, not just a
/// per-rate one.
pub const MAX_NETWORK_CHARGE_BPS: u64 = 2000;

/// Hard ceiling on the wheeling (distribution network-usage) rate, in 6-decimal currency
/// base units per kWh — matches `price_per_kwh`'s representation. Wheeling is a flat
/// per-kWh network-access fee (cost of physical delivery), not proportional to trade
/// value, so it is capped as an absolute per-kWh rate rather than bps. 10_000_000 = 10.00
/// THB/kWh, a generous ceiling above realistic MEA/PEA distribution wheeling tariffs
/// (real-world figures run roughly 1-2 THB/kWh).
pub const MAX_WHEELING_RATE_PER_KWH: u64 = 10_000_000;

/// Singleton on-chain tariff schedule, seeds = `[b"tariff_config"]`. Replaces the former
/// caller-supplied `wheeling_charge_val`/`loss_cost_val` settlement args — those let whoever
/// signed the settle tx pick any number, with no tie to an actual tariff authority.
/// `wheeling_rate_per_kwh` is a flat rate (6-decimal currency units per kWh, same
/// representation as `price_per_kwh`) settable only by `wheeling_authority` (MEA/PEA —
/// distribution network usage; retail trades stay off EGAT's transmission grid) — flat
/// because the physical cost of delivering 1 kWh doesn't scale with the commodity price
/// two parties agreed on. `loss_bps` (proportional to trade value, since lost energy is
/// re-purchased at the agreed price) only by `loss_authority` (MEA/PEA — distribution line
/// loss). Every settlement path (single, batch, atomic) computes its charges from these
/// rates instead of trusting the caller.
#[account]
pub struct TariffConfig {
    pub wheeling_authority: Pubkey,
    pub loss_authority: Pubkey,
    pub wheeling_rate_per_kwh: u64,
    pub loss_bps: u16,
    pub bump: u8,
}

impl TariffConfig {
    // 32 + 32 + 8 + 2 + 1
    pub const LEN: usize = 75;
}
