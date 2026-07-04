use anchor_lang::prelude::*;

/// Hard ceiling on combined network charges (wheeling + line loss) as a fraction of trade
/// value. Bounds both the tariff-authority-set bps (at config-write time) and, as
/// defense-in-depth, the computed charge at settlement time (`net_seller_after_charges`).
pub const MAX_NETWORK_CHARGE_BPS: u64 = 2000;

/// Singleton on-chain tariff schedule, seeds = `[b"tariff_config"]`. Replaces the former
/// caller-supplied `wheeling_charge_val`/`loss_cost_val` settlement args — those let whoever
/// signed the settle tx pick any number (bounded only by a 20% cap), with no tie to an actual
/// tariff authority. `wheeling_bps` is set only by `wheeling_authority` (EGAT — transmission);
/// `loss_bps` only by `loss_authority` (MEA/PEA — distribution). Every settlement path
/// (single, batch, atomic) computes its charges from these rates instead of trusting the
/// caller.
#[account]
pub struct TariffConfig {
    pub wheeling_authority: Pubkey,
    pub loss_authority: Pubkey,
    pub wheeling_bps: u16,
    pub loss_bps: u16,
    pub bump: u8,
}

impl TariffConfig {
    // 32 + 32 + 2 + 2 + 1
    pub const LEN: usize = 69;
}
