#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self as token_interface, Burn as BurnInterface, Mint as MintInterface, MintTo as MintToInterface,
    TokenAccount as TokenAccountInterface, TokenInterface, TransferChecked as TransferCheckedInterface,
};

pub mod error;
pub mod events;
pub mod state;

pub use error::TreasuryError;
pub use events::*;
pub use state::*;

// compute_fn! / compute_checkpoint! — real macros under `localnet`, no-ops otherwise.
#[cfg(feature = "localnet")]
use compute_debug::{compute_checkpoint, compute_fn};

#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => {
        $block
    };
}
#[cfg(not(feature = "localnet"))]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

declare_id!("FfxSQYKUmx9NGdCC9TDPmZSYjWYE1h4ruu3JatzHN5Tn");

/// GRX has 9 decimals; `grx_per_thbg_rate` is THBG-minor-units per **whole** GRX,
/// so converting an atomic GRX amount divides by this.
const GRX_ATOMS_PER_WHOLE: u128 = 1_000_000_000;

/// `pending = amount * acc / ACC_PRECISION - reward_debt` (saturating at 0).
fn accrued_since(amount: u64, acc: u128, reward_debt: u128) -> Result<u64> {
    let gross = (amount as u128)
        .checked_mul(acc)
        .ok_or(TreasuryError::MathOverflow)?
        / ACC_PRECISION;
    let net = gross.saturating_sub(reward_debt);
    u64::try_from(net).map_err(|_| TreasuryError::MathOverflow.into())
}

/// `reward_debt = amount * acc / ACC_PRECISION`.
fn reward_debt_for(amount: u64, acc: u128) -> Result<u128> {
    (amount as u128)
        .checked_mul(acc)
        .ok_or(TreasuryError::MathOverflow)
        .map(|v| v / ACC_PRECISION)
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Accumulator round-trip: fund N GRX against a single staker holding S,
    // the staker's accrued reward must equal ~N (minus integer-division dust).
    #[test]
    fn single_staker_earns_full_pot() {
        let staked: u64 = 10_000_000_000; // 10 GRX
        let pot: u64 = 5_000_000_000; // 5 GRX funded
        // acc += pot * ACC / staked
        let acc = (pot as u128) * ACC_PRECISION / (staked as u128);
        let debt = reward_debt_for(staked, 0).unwrap(); // joined before funding => debt 0
        let earned = accrued_since(staked, acc, debt).unwrap();
        assert_eq!(earned, pot); // exact: ACC_PRECISION absorbs the division
    }

    // Two equal stakers split a pot evenly.
    #[test]
    fn equal_stakers_split_evenly() {
        let each: u64 = 4_000_000_000;
        let total = each * 2;
        let pot: u64 = 1_000_000_000;
        let acc = (pot as u128) * ACC_PRECISION / (total as u128);
        // both joined before funding => debt 0
        let a = accrued_since(each, acc, 0).unwrap();
        let b = accrued_since(each, acc, 0).unwrap();
        assert_eq!(a, b);
        assert_eq!(a + b, pot);
    }

    // A staker who joins AFTER the pot was funded earns nothing from it:
    // their reward_debt is set at the post-funding accumulator.
    #[test]
    fn late_joiner_earns_nothing_from_prior_pot() {
        let acc = 12_345u128 * ACC_PRECISION / 1000; // some nonzero accumulator
        let amount: u64 = 7_000_000_000;
        let debt = reward_debt_for(amount, acc).unwrap();
        let earned = accrued_since(amount, acc, debt).unwrap();
        assert_eq!(earned, 0);
    }

    // Peg arithmetic: thbg_out for a swap = grx_in * rate / 1e9, fee deducted.
    #[test]
    fn swap_output_matches_rate_and_fee() {
        let grx_in: u128 = 3_000_000_000; // 3 GRX
        let rate: u128 = 4_000_000; // 4 THBG (6dp) per whole GRX
        let fee_bps: u128 = 25;
        let gross = grx_in * rate / GRX_ATOMS_PER_WHOLE; // 12_000_000 = 12 THBG
        let fee = gross * fee_bps / 10_000;
        let net = gross - fee;
        assert_eq!(gross, 12_000_000);
        assert_eq!(fee, 30_000);
        assert_eq!(net, 11_970_000);
    }
}

#[program]
pub mod treasury {
    use super::*;

    /// Bootstrap the treasury: config PDA, the THBG mint (authority = treasury PDA),
    /// and the three GRX vaults (swap collateral, stake custody, reward pool).
    pub fn initialize(
        ctx: Context<Initialize>,
        attestor: Pubkey,
        settlement_recorder: Pubkey,
        grx_per_thbg_rate: u64,
        swap_fee_bps: u16,
        attestation_ttl: i64,
    ) -> Result<()> {
        compute_fn!("initialize" => {
            let now = Clock::get()?.unix_timestamp;
            let mut t = ctx.accounts.treasury.load_init()?;
            t.acc_reward_per_share = 0;
            t.authority = ctx.accounts.authority.key();
            t.attestor = attestor;
            t.grx_mint = ctx.accounts.grx_mint.key();
            t.thbg_mint = ctx.accounts.thbg_mint.key();
            t.settlement_recorder = settlement_recorder;
            t.attested_reserve = 0;
            t.attestation_ts = 0;
            t.attestation_ttl = attestation_ttl;
            t.thbg_supply = 0;
            t.grx_per_thbg_rate = grx_per_thbg_rate;
            t.total_staked = 0;
            t.reward_pool = 0;
            t.created_at = now;
            t.total_settled_thbg = 0;
            t.swap_fee_bps = swap_fee_bps;
            t.paused = 0;
            t.bump = ctx.bumps.treasury;
            t.thbg_mint_bump = ctx.bumps.thbg_mint;
            t.swap_vault_bump = ctx.bumps.swap_vault;
            t.stake_vault_bump = ctx.bumps.stake_vault;
            t.reward_vault_bump = ctx.bumps.reward_vault;
        });
        Ok(())
    }

    /// Admin: update swap rate, fee, attestation TTL, pause flag, and the
    /// authorized settlement recorder (the trading market_authority PDA).
    pub fn set_params(
        ctx: Context<SetParams>,
        grx_per_thbg_rate: u64,
        swap_fee_bps: u16,
        attestation_ttl: i64,
        paused: bool,
        settlement_recorder: Pubkey,
    ) -> Result<()> {
        let mut t = ctx.accounts.treasury.load_mut()?;
        require!(t.authority == ctx.accounts.authority.key(), TreasuryError::UnauthorizedAuthority);
        t.grx_per_thbg_rate = grx_per_thbg_rate;
        t.swap_fee_bps = swap_fee_bps;
        t.attestation_ttl = attestation_ttl;
        t.paused = if paused { 1 } else { 0 };
        t.settlement_recorder = settlement_recorder;
        Ok(())
    }

    /// Record a baht-denominated trade settlement. Called via CPI by the trading
    /// program after it pays a seller in THBG; bumps the cumulative settled total.
    /// Non-custodial — moves no funds. Authorized by the `settlement_recorder`
    /// signer (the trading market_authority PDA), so only genuine trading
    /// settlements can advance the counter.
    pub fn record_settlement(ctx: Context<RecordSettlement>, value: u64) -> Result<()> {
        compute_fn!("record_settlement" => {
            let now = Clock::get()?.unix_timestamp;
            let mut t = ctx.accounts.treasury.load_mut()?;
            require!(
                t.settlement_recorder == ctx.accounts.recorder.key(),
                TreasuryError::UnauthorizedRecorder
            );
            t.total_settled_thbg = t
                .total_settled_thbg
                .checked_add(value)
                .ok_or(TreasuryError::MathOverflow)?;
            emit!(SettlementRecorded {
                recorder: ctx.accounts.recorder.key(),
                value,
                total_settled_thbg: t.total_settled_thbg,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Record a settlement BATCH with an audit commitment. Bumps the cumulative
    /// settled total (as `record_settlement` does) and writes a per-`(zone, batch)`
    /// `SettlementRecord` binding the Merkle root over the batch's matches plus the
    /// VAT amount/rate. Commit-only — no on-chain verification of the root; off-chain
    /// verifiers recompute it and e-Tax issuance consumes the VAT fields. Authorized
    /// by the `settlement_recorder` (the trading market_authority PDA).
    pub fn record_settlement_batch(
        ctx: Context<RecordSettlementBatch>,
        value: u64,
        merkle_root: [u8; 32],
        vat_amount: u64,
        vat_rate_bps: u16,
        zone_id: u32,
        batch_id: u64,
    ) -> Result<()> {
        compute_fn!("record_settlement_batch" => {
            let now = Clock::get()?.unix_timestamp;
            let total = {
                let mut t = ctx.accounts.treasury.load_mut()?;
                require!(
                    t.settlement_recorder == ctx.accounts.recorder.key(),
                    TreasuryError::UnauthorizedRecorder
                );
                t.total_settled_thbg = t
                    .total_settled_thbg
                    .checked_add(value)
                    .ok_or(TreasuryError::MathOverflow)?;
                t.total_settled_thbg
            };

            let mut rec = ctx.accounts.settlement_record.load_init()?;
            rec.merkle_root = merkle_root;
            rec.recorder = ctx.accounts.recorder.key();
            rec.total_value = value;
            rec.vat_amount = vat_amount;
            rec.committed_ts = now;
            rec.batch_id = batch_id;
            rec.zone_id = zone_id;
            rec.vat_rate_bps = vat_rate_bps;
            rec.bump = ctx.bumps.settlement_record;

            emit!(SettlementBatchRecorded {
                recorder: ctx.accounts.recorder.key(),
                zone_id,
                batch_id,
                total_value: value,
                vat_amount,
                vat_rate_bps,
                merkle_root,
                total_settled_thbg: total,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Create one settlement accumulator shard PDA (`[b"settle_shard", &[shard_id]]`).
    /// Admin-only, idempotent per shard_id. Run once per shard (0..NUM_SETTLE_SHARDS)
    /// at deploy/init so the sharded settle path has its destination accounts.
    pub fn initialize_settlement_shard(
        ctx: Context<InitializeSettlementShard>,
        shard_id: u8,
    ) -> Result<()> {
        compute_fn!("initialize_settlement_shard" => {
            require!(shard_id < NUM_SETTLE_SHARDS, TreasuryError::InvalidShardId);
            require!(
                ctx.accounts.treasury.load()?.authority == ctx.accounts.authority.key(),
                TreasuryError::UnauthorizedAuthority
            );
            let mut shard = ctx.accounts.shard.load_init()?;
            shard.shard_id = shard_id;
            shard.bump = ctx.bumps.shard;
            shard.settled_thbg = 0;
            shard.settlement_count = 0;
        });
        Ok(())
    }

    /// Parallel-friendly variant of `record_settlement`: bumps the per-shard
    /// accumulator for `shard_id` instead of the global `total_settled_thbg`, so
    /// settles whose buyers fall on different shards don't write-lock one account.
    /// `treasury` is read-only here (recorder gate only) — read locks are shared
    /// across parallel txs, so it does not serialize. The shard account is bound to
    /// `shard_id` by its PDA seeds, so a recorder cannot scatter onto an arbitrary
    /// account. Reconcile the global total via `aggregate_settlement_shards`.
    pub fn record_settlement_sharded(
        ctx: Context<RecordSettlementSharded>,
        value: u64,
        shard_id: u8,
    ) -> Result<()> {
        compute_fn!("record_settlement_sharded" => {
            require!(shard_id < NUM_SETTLE_SHARDS, TreasuryError::InvalidShardId);
            let now = Clock::get()?.unix_timestamp;
            require!(
                ctx.accounts.treasury.load()?.settlement_recorder == ctx.accounts.recorder.key(),
                TreasuryError::UnauthorizedRecorder
            );
            let mut shard = ctx.accounts.shard.load_mut()?;
            shard.settled_thbg = shard
                .settled_thbg
                .checked_add(value)
                .ok_or(TreasuryError::MathOverflow)?;
            shard.settlement_count = shard
                .settlement_count
                .checked_add(1)
                .ok_or(TreasuryError::MathOverflow)?;
            emit!(SettlementShardRecorded {
                recorder: ctx.accounts.recorder.key(),
                shard_id,
                value,
                shard_total: shard.settled_thbg,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Reconcile the global `total_settled_thbg` from the per-shard accumulators.
    /// Admin-only.
    ///
    /// **Drain-and-fold:** each `SettlementShard` passed in `remaining_accounts`
    /// (validated by program owner + stored-bump PDA, deduped by a shard-id bitmask)
    /// has its `settled_thbg` ADDED to the running global and then ZEROED. Folding
    /// into — instead of overwriting — the live global is deliberate: the single-match
    /// settle path (`record_settlement`) bumps `total_settled_thbg` directly, while the
    /// batch path bumps shards. Overwriting `global = sum(shards)` (the previous
    /// behaviour) silently wiped every single-match contribution on each reconcile.
    /// Folding preserves both; zeroing the shard makes it a delta-since-last-aggregate,
    /// so re-running with no new settles is a no-op (no double counting). Shards must
    /// therefore be passed writable. `settlement_count` is left cumulative.
    pub fn aggregate_settlement_shards(ctx: Context<AggregateSettlementShards>) -> Result<()> {
        compute_fn!("aggregate_settlement_shards" => {
            let mut t = ctx.accounts.treasury.load_mut()?;
            require!(t.authority == ctx.accounts.authority.key(), TreasuryError::UnauthorizedAuthority);

            // Start from the live global so single-match `record_settlement` writes are
            // preserved across reconciles.
            let mut running: u64 = t.total_settled_thbg;
            // Bitmask of shard_ids already counted — reject duplicates so a shard
            // passed twice cannot inflate the total.
            let mut seen: u16 = 0;
            const SHARD_LEN: usize = std::mem::size_of::<SettlementShard>();

            for account_info in ctx.remaining_accounts.iter() {
                require_keys_eq!(*account_info.owner, crate::ID, TreasuryError::UnauthorizedAuthority);
                let mut data = account_info.try_borrow_mut_data()?;
                if data.len() >= 8 + SHARD_LEN {
                    let shard = SettlementShard::load_mut_from_bytes(&mut data[8..8 + SHARD_LEN])?;
                    require!(shard.shard_id < NUM_SETTLE_SHARDS, TreasuryError::InvalidShardId);

                    // Validate via the stored canonical bump (create_program_address)
                    // instead of re-deriving with find_program_address.
                    let expected_pda = Pubkey::create_program_address(
                        &[b"settle_shard", &[shard.shard_id], &[shard.bump]], &crate::ID
                    ).map_err(|_| TreasuryError::InvalidShardId)?;
                    require_keys_eq!(account_info.key(), expected_pda, TreasuryError::InvalidShardId);

                    let bit = 1u16 << shard.shard_id;
                    require!(seen & bit == 0, TreasuryError::DuplicateShard);
                    seen |= bit;

                    // Must be writable: the drain below mutates the shard's data.
                    require!(account_info.is_writable, TreasuryError::ShardNotWritable);

                    running = running
                        .checked_add(shard.settled_thbg)
                        .ok_or(TreasuryError::MathOverflow)?;
                    shard.settled_thbg = 0; // drain — shard now holds the next delta window
                }
            }

            t.total_settled_thbg = running;
        });
        Ok(())
    }

    /// Parallel-friendly variant of `record_settlement_batch`: bumps the per-shard
    /// accumulator for `shard_id` instead of the global `total_settled_thbg`, while
    /// still writing the per-`(zone, batch)` `SettlementRecord` audit commitment (which
    /// is already non-global — unique per batch). Treasury is read-only here (recorder
    /// gate only), so parallel batch settles on distinct shards don't serialize on it.
    /// Reconcile the global total via `aggregate_settlement_shards`.
    #[allow(clippy::too_many_arguments)]
    pub fn record_settlement_batch_sharded(
        ctx: Context<RecordSettlementBatchSharded>,
        value: u64,
        merkle_root: [u8; 32],
        vat_amount: u64,
        vat_rate_bps: u16,
        zone_id: u32,
        batch_id: u64,
        shard_id: u8,
    ) -> Result<()> {
        compute_fn!("record_settlement_batch_sharded" => {
            require!(shard_id < NUM_SETTLE_SHARDS, TreasuryError::InvalidShardId);
            let now = Clock::get()?.unix_timestamp;
            require!(
                ctx.accounts.treasury.load()?.settlement_recorder == ctx.accounts.recorder.key(),
                TreasuryError::UnauthorizedRecorder
            );

            let shard_total = {
                let mut shard = ctx.accounts.shard.load_mut()?;
                shard.settled_thbg = shard
                    .settled_thbg
                    .checked_add(value)
                    .ok_or(TreasuryError::MathOverflow)?;
                shard.settlement_count = shard
                    .settlement_count
                    .checked_add(1)
                    .ok_or(TreasuryError::MathOverflow)?;
                shard.settled_thbg
            };

            let mut rec = ctx.accounts.settlement_record.load_init()?;
            rec.merkle_root = merkle_root;
            rec.recorder = ctx.accounts.recorder.key();
            rec.total_value = value;
            rec.vat_amount = vat_amount;
            rec.committed_ts = now;
            rec.batch_id = batch_id;
            rec.zone_id = zone_id;
            rec.vat_rate_bps = vat_rate_bps;
            rec.bump = ctx.bumps.settlement_record;

            emit!(SettlementShardRecorded {
                recorder: ctx.accounts.recorder.key(),
                shard_id,
                value,
                shard_total,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Custodian: refresh the off-chain THB reserve figure that caps THBG supply.
    /// This is the peg's source of truth — mints are blocked once it goes stale.
    pub fn update_attestation(ctx: Context<UpdateAttestation>, attested_reserve: u64) -> Result<()> {
        compute_fn!("update_attestation" => {
            let now = Clock::get()?.unix_timestamp;
            let mut t = ctx.accounts.treasury.load_mut()?;
            require!(t.attestor == ctx.accounts.attestor.key(), TreasuryError::UnauthorizedAttestor);
            t.attested_reserve = attested_reserve;
            t.attestation_ts = now;
            emit!(ReserveAttested {
                attestor: ctx.accounts.attestor.key(),
                attested_reserve,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Swap GRX → THBG. This is the baht-denominated settlement primitive: a
    /// producer's GRX is converted to THB-pegged value at `grx_per_thbg_rate`.
    ///
    /// Peg invariants enforced here:
    ///   1. The reserve attestation must be fresh (`now - attestation_ts <= ttl`).
    ///   2. Outstanding `thbg_supply + minted` must never exceed `attested_reserve`.
    /// Staked GRX is held in a separate vault and never backs the peg.
    pub fn swap_grx_for_thbg(ctx: Context<SwapGrxForThbg>, grx_in: u64) -> Result<()> {
        compute_fn!("swap_grx_for_thbg" => {
            require!(grx_in > 0, TreasuryError::ZeroAmount);
            let now = Clock::get()?.unix_timestamp;

            let (bump, thbg_net, fee, new_supply) = {
                let t = ctx.accounts.treasury.load()?;
                require!(t.paused == 0, TreasuryError::Paused);
                require!(t.grx_per_thbg_rate > 0, TreasuryError::RateNotSet);
                require!(
                    now.saturating_sub(t.attestation_ts) <= t.attestation_ttl,
                    TreasuryError::StaleAttestation
                );

                let gross = (grx_in as u128)
                    .checked_mul(t.grx_per_thbg_rate as u128)
                    .ok_or(TreasuryError::MathOverflow)?
                    / GRX_ATOMS_PER_WHOLE;
                let fee = gross
                    .checked_mul(t.swap_fee_bps as u128)
                    .ok_or(TreasuryError::MathOverflow)?
                    / 10_000;
                let net = gross.saturating_sub(fee);
                require!(net > 0, TreasuryError::ZeroAmount);

                let new_supply = (t.thbg_supply as u128)
                    .checked_add(net)
                    .ok_or(TreasuryError::MathOverflow)?;
                require!(new_supply <= t.attested_reserve as u128, TreasuryError::PegBreach);

                (
                    t.bump,
                    u64::try_from(net).map_err(|_| TreasuryError::MathOverflow)?,
                    u64::try_from(fee).map_err(|_| TreasuryError::MathOverflow)?,
                    u64::try_from(new_supply).map_err(|_| TreasuryError::MathOverflow)?,
                )
            };

            // Pull GRX collateral from the user into the swap vault.
            let xfer = TransferCheckedInterface {
                from: ctx.accounts.user_grx_ata.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
                to: ctx.accounts.swap_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            compute_checkpoint!("before_grx_pull");
            token_interface::transfer_checked(
                CpiContext::new(ctx.accounts.token_program.key(), xfer),
                grx_in,
                ctx.accounts.grx_mint.decimals,
            )?;
            compute_checkpoint!("after_grx_pull");

            // Mint THBG to the user, signed by the treasury PDA.
            let seeds: &[&[u8]] = &[b"treasury", &[bump]];
            let signer = &[seeds];
            let mint_to = MintToInterface {
                mint: ctx.accounts.thbg_mint.to_account_info(),
                to: ctx.accounts.user_thbg_ata.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            };
            compute_checkpoint!("before_thbg_mint");
            token_interface::mint_to(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), mint_to, signer),
                thbg_net,
            )?;
            compute_checkpoint!("after_thbg_mint");

            ctx.accounts.treasury.load_mut()?.thbg_supply = new_supply;

            emit!(SwappedGrxForThbg {
                user: ctx.accounts.user.key(),
                grx_in,
                thbg_out: thbg_net,
                fee,
                thbg_supply: new_supply,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Redeem THBG → GRX from the swap vault. Burns the user's THBG (shrinking the
    /// peg liability) and returns GRX at the configured rate.
    pub fn redeem_thbg_for_grx(ctx: Context<RedeemThbgForGrx>, thbg_in: u64) -> Result<()> {
        compute_fn!("redeem_thbg_for_grx" => {
            require!(thbg_in > 0, TreasuryError::ZeroAmount);
            let now = Clock::get()?.unix_timestamp;

            let (bump, grx_out, new_supply) = {
                let t = ctx.accounts.treasury.load()?;
                require!(t.paused == 0, TreasuryError::Paused);
                require!(t.grx_per_thbg_rate > 0, TreasuryError::RateNotSet);

                // Burning more THBG than the tracked supply would desync the peg ledger.
                require!(thbg_in <= t.thbg_supply, TreasuryError::SupplyUnderflow);

                let grx_out = (thbg_in as u128)
                    .checked_mul(GRX_ATOMS_PER_WHOLE)
                    .ok_or(TreasuryError::MathOverflow)?
                    / (t.grx_per_thbg_rate as u128);
                require!(grx_out > 0, TreasuryError::ZeroAmount);
                let grx_out = u64::try_from(grx_out).map_err(|_| TreasuryError::MathOverflow)?;

                // The swap vault is the redemption collateral; never pay out more GRX than it
                // physically holds. Guards against rate changes (set_params) decoupling the
                // payout from deposited collateral and draining other swappers' GRX.
                require!(
                    grx_out <= ctx.accounts.swap_vault.amount,
                    TreasuryError::InsufficientVault
                );

                let new_supply = t
                    .thbg_supply
                    .checked_sub(thbg_in)
                    .ok_or(TreasuryError::SupplyUnderflow)?;
                (t.bump, grx_out, new_supply)
            };

            // Burn the user's THBG.
            let burn = BurnInterface {
                mint: ctx.accounts.thbg_mint.to_account_info(),
                from: ctx.accounts.user_thbg_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token_interface::burn(
                CpiContext::new(ctx.accounts.token_program.key(), burn),
                thbg_in,
            )?;

            // Return GRX from the swap vault, signed by the treasury PDA.
            let seeds: &[&[u8]] = &[b"treasury", &[bump]];
            let signer = &[seeds];
            let xfer = TransferCheckedInterface {
                from: ctx.accounts.swap_vault.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
                to: ctx.accounts.user_grx_ata.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
                grx_out,
                ctx.accounts.grx_mint.decimals,
            )?;

            ctx.accounts.treasury.load_mut()?.thbg_supply = new_supply;

            emit!(RedeemedThbgForGrx {
                user: ctx.accounts.user.key(),
                thbg_in,
                grx_out,
                thbg_supply: new_supply,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Stake GRX into the staking vault. Settles any pending reward before changing
    /// the position so the accumulator stays consistent.
    pub fn stake_grx(ctx: Context<StakeGrx>, amount: u64) -> Result<()> {
        compute_fn!("stake_grx" => {
            require!(amount > 0, TreasuryError::ZeroAmount);
            let now = Clock::get()?.unix_timestamp;

            let (acc, new_total) = {
                let t = ctx.accounts.treasury.load()?;
                let new_total = t.total_staked.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;
                (t.acc_reward_per_share, new_total)
            };

            // Settle pending against the OLD position before it grows.
            let pos = &mut ctx.accounts.position;
            if pos.amount > 0 {
                let acc_rew = accrued_since(pos.amount, acc, pos.reward_debt)?;
                pos.pending = pos.pending.checked_add(acc_rew).ok_or(TreasuryError::MathOverflow)?;
            }

            let xfer = TransferCheckedInterface {
                from: ctx.accounts.user_grx_ata.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new(ctx.accounts.token_program.key(), xfer),
                amount,
                ctx.accounts.grx_mint.decimals,
            )?;

            pos.owner = ctx.accounts.user.key();
            pos.amount = pos.amount.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;
            pos.reward_debt = reward_debt_for(pos.amount, acc)?;
            pos.bump = ctx.bumps.position;

            ctx.accounts.treasury.load_mut()?.total_staked = new_total;

            emit!(Staked {
                user: ctx.accounts.user.key(),
                amount,
                total_staked: new_total,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Unstake GRX. Settles pending reward, returns principal from the staking vault.
    pub fn unstake_grx(ctx: Context<UnstakeGrx>, amount: u64) -> Result<()> {
        compute_fn!("unstake_grx" => {
            require!(amount > 0, TreasuryError::ZeroAmount);
            let now = Clock::get()?.unix_timestamp;

            let (acc, bump) = {
                let t = ctx.accounts.treasury.load()?;
                (t.acc_reward_per_share, t.bump)
            };

            let pos = &mut ctx.accounts.position;
            require!(amount <= pos.amount, TreasuryError::InsufficientStake);
            let acc_rew = accrued_since(pos.amount, acc, pos.reward_debt)?;
            pos.pending = pos.pending.checked_add(acc_rew).ok_or(TreasuryError::MathOverflow)?;
            pos.amount -= amount;
            pos.reward_debt = reward_debt_for(pos.amount, acc)?;

            let seeds: &[&[u8]] = &[b"treasury", &[bump]];
            let signer = &[seeds];
            let xfer = TransferCheckedInterface {
                from: ctx.accounts.stake_vault.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
                to: ctx.accounts.user_grx_ata.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
                amount,
                ctx.accounts.grx_mint.decimals,
            )?;

            let new_total = {
                let mut t = ctx.accounts.treasury.load_mut()?;
                t.total_staked = t.total_staked.saturating_sub(amount);
                t.total_staked
            };

            emit!(Unstaked {
                user: ctx.accounts.user.key(),
                amount,
                total_staked: new_total,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Claim accrued staking rewards (paid in GRX from the reward pool).
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        compute_fn!("claim_rewards" => {
            let now = Clock::get()?.unix_timestamp;
            let (acc, bump) = {
                let t = ctx.accounts.treasury.load()?;
                (t.acc_reward_per_share, t.bump)
            };

            let payout = {
                let pos = &mut ctx.accounts.position;
                let acc_rew = accrued_since(pos.amount, acc, pos.reward_debt)?;
                let total = pos.pending.checked_add(acc_rew).ok_or(TreasuryError::MathOverflow)?;
                pos.pending = 0;
                pos.reward_debt = reward_debt_for(pos.amount, acc)?;
                total
            };
            require!(payout > 0, TreasuryError::ZeroAmount);

            {
                let t = ctx.accounts.treasury.load()?;
                require!(t.reward_pool >= payout, TreasuryError::InsufficientRewardPool);
            }

            let seeds: &[&[u8]] = &[b"treasury", &[bump]];
            let signer = &[seeds];
            let xfer = TransferCheckedInterface {
                from: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
                to: ctx.accounts.user_grx_ata.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
                payout,
                ctx.accounts.grx_mint.decimals,
            )?;

            ctx.accounts.treasury.load_mut()?.reward_pool -= payout;

            emit!(RewardsClaimed {
                user: ctx.accounts.user.key(),
                amount: payout,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Deposit GRX into the reward pool, distributing it pro-rata to current stakers
    /// via the accumulator. Requires a non-zero total stake.
    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        compute_fn!("fund_rewards" => {
            require!(amount > 0, TreasuryError::ZeroAmount);
            let now = Clock::get()?.unix_timestamp;

            let total_staked = {
                let t = ctx.accounts.treasury.load()?;
                require!(t.total_staked > 0, TreasuryError::NoStakeToReward);
                t.total_staked
            };

            let xfer = TransferCheckedInterface {
                from: ctx.accounts.funder_grx_ata.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
                authority: ctx.accounts.funder.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new(ctx.accounts.token_program.key(), xfer),
                amount,
                ctx.accounts.grx_mint.decimals,
            )?;

            let delta = (amount as u128)
                .checked_mul(ACC_PRECISION)
                .ok_or(TreasuryError::MathOverflow)?
                / (total_staked as u128);
            let mut t = ctx.accounts.treasury.load_mut()?;
            t.acc_reward_per_share = t.acc_reward_per_share.checked_add(delta).ok_or(TreasuryError::MathOverflow)?;
            t.reward_pool = t.reward_pool.checked_add(amount).ok_or(TreasuryError::MathOverflow)?;

            emit!(RewardsFunded {
                funder: ctx.accounts.funder.key(),
                amount,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Slash a staker's principal for misbehaviour (treasury authority only).
    ///
    /// The slashed GRX moves from the staking vault into the reward vault and is redistributed
    /// pro-rata to the *remaining* stakers via the reward accumulator (same mechanism as
    /// `fund_rewards`) — "redistributed to honest stakers, not burned". The slashed staker's
    /// already-accrued rewards are preserved (settled into `pending`); only principal is taken,
    /// and they are excluded from this redistribution (their `reward_debt` is rebased at the new
    /// accumulator). If no stake remains after slashing, the amount is parked in `reward_pool`.
    pub fn slash_stake(ctx: Context<SlashStake>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::ZeroAmount);
        compute_fn!("slash_stake" => {
            let now = Clock::get()?.unix_timestamp;

            let (acc_old, total_staked, bump) = {
                let t = ctx.accounts.treasury.load()?;
                (t.acc_reward_per_share, t.total_staked, t.bump)
            };

            // Settle the slashed staker's accrued reward at the OLD accumulator, then take principal.
            let slashed = {
                let pos = &mut ctx.accounts.position;
                require!(pos.amount > 0, TreasuryError::InsufficientStake);
                let acc_rew = accrued_since(pos.amount, acc_old, pos.reward_debt)?;
                pos.pending = pos.pending.checked_add(acc_rew).ok_or(TreasuryError::MathOverflow)?;
                let slashed = amount.min(pos.amount);
                pos.amount -= slashed;
                slashed
            };

            let total_after = total_staked.saturating_sub(slashed);

            // Redistribute to remaining stakers (acc bump); if none remain, just hold in pool.
            let acc_new = if total_after > 0 {
                let delta = (slashed as u128)
                    .checked_mul(ACC_PRECISION)
                    .ok_or(TreasuryError::MathOverflow)?
                    / (total_after as u128);
                acc_old.checked_add(delta).ok_or(TreasuryError::MathOverflow)?
            } else {
                acc_old
            };

            // Rebase the slashed staker at the new accumulator so they don't share their own slash.
            {
                let pos = &mut ctx.accounts.position;
                pos.reward_debt = reward_debt_for(pos.amount, acc_new)?;
            }

            {
                let mut t = ctx.accounts.treasury.load_mut()?;
                t.acc_reward_per_share = acc_new;
                t.total_staked = total_after;
                t.reward_pool = t.reward_pool.checked_add(slashed).ok_or(TreasuryError::MathOverflow)?;
            }

            let seeds: &[&[u8]] = &[b"treasury", &[bump]];
            let signer = &[seeds];
            let xfer = TransferCheckedInterface {
                from: ctx.accounts.stake_vault.to_account_info(),
                mint: ctx.accounts.grx_mint.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), xfer, signer),
                slashed,
                ctx.accounts.grx_mint.decimals,
            )?;

            emit!(StakeSlashed {
                authority: ctx.accounts.authority.key(),
                owner: ctx.accounts.position.owner,
                slashed_amount: slashed,
                total_staked: total_after,
                timestamp: now,
            });
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<Treasury>(),
        seeds = [b"treasury"],
        bump,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    /// GRX SPL mint (owned by the energy-token program).
    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// THBG stablecoin mint, created here with the treasury PDA as mint authority.
    #[account(
        init,
        payer = authority,
        seeds = [b"thbg_mint"],
        bump,
        mint::decimals = 6,
        mint::authority = treasury,
        mint::token_program = token_program,
    )]
    pub thbg_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// GRX received from swaps (peg collateral source for redemptions).
    #[account(
        init,
        payer = authority,
        seeds = [b"swap_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = treasury,
        token::token_program = token_program,
    )]
    pub swap_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// GRX held in custody for stakers (NEVER backs the peg).
    #[account(
        init,
        payer = authority,
        seeds = [b"stake_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = treasury,
        token::token_program = token_program,
    )]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// GRX reward pool paid out to stakers.
    #[account(
        init,
        payer = authority,
        seeds = [b"reward_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = treasury,
        token::token_program = token_program,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetParams<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateAttestation<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,
    pub attestor: Signer<'info>,
}

#[derive(Accounts)]
pub struct SwapGrxForThbg<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
        constraint = thbg_mint.key() == treasury.load()?.thbg_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(mut)]
    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"thbg_mint"], bump = treasury.load()?.thbg_mint_bump)]
    pub thbg_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(mut, seeds = [b"swap_vault"], bump = treasury.load()?.swap_vault_bump)]
    pub swap_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,
    #[account(mut, token::mint = thbg_mint, token::authority = user)]
    pub user_thbg_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RedeemThbgForGrx<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
        constraint = thbg_mint.key() == treasury.load()?.thbg_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(mut)]
    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"thbg_mint"], bump = treasury.load()?.thbg_mint_bump)]
    pub thbg_mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(mut, seeds = [b"swap_vault"], bump = treasury.load()?.swap_vault_bump)]
    pub swap_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,
    #[account(mut, token::mint = thbg_mint, token::authority = user)]
    pub user_thbg_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct StakeGrx<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + StakePosition::LEN,
        seeds = [b"stake", user.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, StakePosition>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"stake_vault"], bump = treasury.load()?.stake_vault_bump)]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeGrx<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(
        mut,
        seeds = [b"stake", user.key().as_ref()],
        bump = position.bump,
        has_one = owner @ TreasuryError::UnauthorizedAuthority,
    )]
    pub position: Account<'info, StakePosition>,

    /// CHECK: bound by `has_one = owner` on `position` against the signer below.
    #[account(address = user.key())]
    pub owner: UncheckedAccount<'info>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"stake_vault"], bump = treasury.load()?.stake_vault_bump)]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(
        mut,
        seeds = [b"stake", user.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, StakePosition>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"reward_vault"], bump = treasury.load()?.reward_vault_bump)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = user)]
    pub user_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"reward_vault"], bump = treasury.load()?.reward_vault_bump)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut, token::mint = grx_mint, token::authority = funder)]
    pub funder_grx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub funder: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RecordSettlement<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    /// The authorized settlement recorder — the trading market_authority PDA,
    /// passed as a signer via `invoke_signed` from the trading program.
    pub recorder: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(value: u64, merkle_root: [u8; 32], vat_amount: u64, vat_rate_bps: u16, zone_id: u32, batch_id: u64)]
pub struct RecordSettlementBatch<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    /// Per-`(zone, batch)` audit commitment, created on first record for the batch.
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<SettlementRecord>(),
        seeds = [b"settlement", zone_id.to_le_bytes().as_ref(), batch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub settlement_record: AccountLoader<'info, SettlementRecord>,

    /// The authorized settlement recorder — the trading market_authority PDA.
    pub recorder: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(shard_id: u8)]
pub struct InitializeSettlementShard<'info> {
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<SettlementShard>(),
        seeds = [b"settle_shard".as_ref(), &[shard_id]],
        bump
    )]
    pub shard: AccountLoader<'info, SettlementShard>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(value: u64, shard_id: u8)]
pub struct RecordSettlementSharded<'info> {
    /// Read-only: only the recorder gate reads it. A shared read lock does not
    /// serialize parallel settles (unlike the `mut` treasury in `record_settlement`).
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    /// The per-shard accumulator; bound to `shard_id` by its seeds.
    #[account(mut, seeds = [b"settle_shard".as_ref(), &[shard_id]], bump = shard.load()?.bump)]
    pub shard: AccountLoader<'info, SettlementShard>,

    /// The authorized settlement recorder — the trading market_authority PDA.
    pub recorder: Signer<'info>,
}

#[derive(Accounts)]
pub struct AggregateSettlementShards<'info> {
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    pub authority: Signer<'info>,
    // Shards passed via remaining_accounts.
}

#[derive(Accounts)]
#[instruction(value: u64, merkle_root: [u8; 32], vat_amount: u64, vat_rate_bps: u16, zone_id: u32, batch_id: u64, shard_id: u8)]
pub struct RecordSettlementBatchSharded<'info> {
    /// Read-only: only the recorder gate reads it (shared read lock does not serialize).
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: AccountLoader<'info, Treasury>,

    /// The per-shard accumulator; bound to `shard_id` by its seeds.
    #[account(mut, seeds = [b"settle_shard".as_ref(), &[shard_id]], bump = shard.load()?.bump)]
    pub shard: AccountLoader<'info, SettlementShard>,

    /// Per-`(zone, batch)` audit commitment, created on first record for the batch.
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<SettlementRecord>(),
        seeds = [b"settlement", zone_id.to_le_bytes().as_ref(), batch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub settlement_record: AccountLoader<'info, SettlementRecord>,

    /// The authorized settlement recorder — the trading market_authority PDA.
    pub recorder: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashStake<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        has_one = authority @ TreasuryError::UnauthorizedAuthority,
        constraint = grx_mint.key() == treasury.load()?.grx_mint @ TreasuryError::UnauthorizedAuthority,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    /// CHECK: identifies the slashed staker; only used to derive the position PDA and label the event.
    pub target_owner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"stake", target_owner.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, StakePosition>,

    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    #[account(mut, seeds = [b"stake_vault"], bump = treasury.load()?.stake_vault_bump)]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,
    #[account(mut, seeds = [b"reward_vault"], bump = treasury.load()?.reward_vault_bump)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// Treasury authority — must equal `treasury.authority`.
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}
