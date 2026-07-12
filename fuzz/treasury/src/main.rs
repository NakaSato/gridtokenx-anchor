//! Crucible invariant-fuzzing harness for the `treasury` program.
//!
//! Fuzzes the GRX↔THBG swap/redeem peg primitive plus GRX yield-staking, driving
//! random sequences of the public instructions against a LiteSVM instance and
//! asserting the program's load-bearing accounting invariants after every action.
//!
//! Invariants checked (see `invariant_test` below):
//!   I1  THBG accounting: on-chain THBG mint supply == treasury.thbg_supply counter.
//!   I2  Peg solvency:    treasury.thbg_supply <= treasury.attested_reserve.
//!   I3  Stake custody:   stake_vault balance == total_staked == Σ position.amount.
//!   I4  Reward pool:     reward_vault balance == treasury.reward_pool.
//!   I5  GRX conservation: total GRX across every account the treasury touches is
//!                         constant (the treasury never mints/burns GRX).
//!   I6  Settlement conservation: global total_settled_thbg + Σ undrained shard
//!                         balances == the exact sum of every value recorded (global
//!                         + sharded). The sharded record + drain-and-fold aggregate
//!                         must never create, lose, or double-count settled value.
//!   I7  Shard count: Σ shard.settlement_count == # successful sharded records
//!                         (settlement_count is cumulative, never zeroed by aggregate).

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
use crucible_fuzzer::anchor_lang::solana_program::instruction::AccountMeta;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::rc::Rc;
use std::str::FromStr;

// Generate `treasury::{ID, instruction, accounts, state}` from the IDL.
crucible_idl_gen::declare_fuzz_program!("idls/treasury.json");

use treasury::{accounts, instruction, state};

const N_USERS: usize = 2;
const INITIAL_SOL: u64 = 100_000_000_000; // 100 SOL for fees + rent
const USER_GRX: u64 = 1_000_000_000_000_000; // 1e6 GRX (9 dec) per user
const FUNDER_GRX: u64 = 1_000_000_000_000_000; // 1e6 GRX for reward funding
const GRX_DECIMALS: u8 = 9;

const INIT_RATE: u64 = 1_000_000; // THBG minor units per whole GRX
const INIT_FEE_BPS: u16 = 30;
const HUGE_TTL: i64 = i64::MAX; // freshness gate always passes; we don't fuzz staleness
const INIT_RESERVE: u64 = 1_000_000_000_000_000_000; // 1e18 THBG headroom
const NUM_SHARDS: u8 = 16; // treasury::state::NUM_SETTLE_SHARDS

#[derive(Clone)]
struct UserAcct {
    kp: Rc<Keypair>,
    grx_ata: Pubkey,
    thbg_ata: Pubkey,
    stake_pos: Pubkey,
}

#[derive(Clone)]
struct TreasuryFixture {
    ctx: TestContext,
    program_id: Pubkey,
    admin: Rc<Keypair>, // authority + attestor
    funder: Rc<Keypair>,
    funder_grx_ata: Pubkey,
    treasury_pda: Pubkey,
    thbg_mint: Pubkey,
    swap_vault: Pubkey,
    stake_vault: Pubkey,
    reward_vault: Pubkey,
    grx_mint: Pubkey,
    users: Vec<UserAcct>,
    /// Sum of every GRX-token account balance at genesis — must stay constant (I5).
    grx_total: u64,
    /// The 16 per-shard settlement accumulator PDAs (index = shard_id).
    shards: Vec<Pubkey>,
    /// Running sum of every settled value the fixture has recorded (global + sharded)
    /// via successful record/record_sharded/batch calls — the ground truth for I6.
    settle_expected: u64,
    /// Count of successful sharded records (record_sharded + batch_sharded) — I7.
    settle_count_expected: u64,
    /// Committed per-(zone,batch) audit records: (ns, zone, batch, value, vat, vat_rate).
    /// ns = 0 record_settlement_batch (seed b"settlement_batch"), 1 batch_sharded
    /// (seed b"settlement"). Ground truth for the I8 commitment-integrity check.
    committed_records: Vec<(u8, u32, u64, u64, u64, u16)>,
    /// A re-record of an already-committed (zone,batch) PDA must FAIL (init guard).
    /// If one ever succeeds, this trips.
    double_record_detected: bool,
    /// Mirror of the on-chain `paused` flag (set_params writes it unconditionally).
    paused: bool,
    /// A swap/redeem that landed while `paused` bypassed the Paused gate (I9).
    pause_violation: bool,
}

fn spl_token_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}
fn rent_sysvar() -> Pubkey {
    Pubkey::from_str("SysvarRent111111111111111111111111111111111").unwrap()
}

#[fuzz_fixture]
impl TreasuryFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        let program_id = Pubkey::new_from_array(treasury::ID.to_bytes());
        ctx.add_program(&program_id, "../../target/deploy/treasury.so")
            .unwrap();

        let token_program = spl_token_id();

        // --- keypairs / SOL ---
        let admin = Rc::new(Keypair::new());
        let funder = Rc::new(Keypair::new());
        for kp in [&admin, &funder] {
            ctx.create_account()
                .pubkey(kp.pubkey())
                .lamports(INITIAL_SOL)
                .owner(system_program::ID)
                .create()
                .unwrap();
        }

        // --- GRX mint (classic SPL; treasury reads it via token_interface) ---
        let grx_mint_kp = Keypair::new();
        let grx_mint = ctx
            .create_mint()
            .pubkey(grx_mint_kp.pubkey())
            .mint_authority(admin.pubkey())
            .decimals(GRX_DECIMALS)
            .create()
            .unwrap();

        // --- PDAs ---
        let (treasury_pda, _) = Pubkey::find_program_address(&[b"treasury"], &program_id);
        let (thbg_mint, _) = Pubkey::find_program_address(&[b"thbg_mint"], &program_id);
        let (swap_vault, _) = Pubkey::find_program_address(&[b"swap_vault"], &program_id);
        let (stake_vault, _) = Pubkey::find_program_address(&[b"stake_vault"], &program_id);
        let (reward_vault, _) = Pubkey::find_program_address(&[b"reward_vault"], &program_id);

        // --- funder GRX account (pre-funded) ---
        let funder_grx_ata = Keypair::new().pubkey();
        ctx.create_token_account()
            .pubkey(funder_grx_ata)
            .mint(grx_mint)
            .token_owner(funder.pubkey())
            .amount(FUNDER_GRX)
            .create()
            .unwrap();

        let mut grx_total: u64 = FUNDER_GRX;

        // --- users: SOL + pre-funded GRX ATA + empty THBG ATA ---
        let mut users = Vec::new();
        for _ in 0..N_USERS {
            let kp = Rc::new(Keypair::new());
            ctx.create_account()
                .pubkey(kp.pubkey())
                .lamports(INITIAL_SOL)
                .owner(system_program::ID)
                .create()
                .unwrap();

            let grx_ata = Keypair::new().pubkey();
            ctx.create_token_account()
                .pubkey(grx_ata)
                .mint(grx_mint)
                .token_owner(kp.pubkey())
                .amount(USER_GRX)
                .create()
                .unwrap();
            grx_total += USER_GRX;

            let thbg_ata = Keypair::new().pubkey();
            ctx.create_token_account()
                .pubkey(thbg_ata)
                .mint(thbg_mint)
                .token_owner(kp.pubkey())
                .amount(0)
                .create()
                .unwrap();

            let (stake_pos, _) =
                Pubkey::find_program_address(&[b"stake", kp.pubkey().as_ref()], &program_id);

            users.push(UserAcct { kp, grx_ata, thbg_ata, stake_pos });
        }

        // --- initialize treasury (creates thbg_mint + 3 vaults) ---
        ctx.program(program_id)
            .call(instruction::Initialize {
                attestor: admin.pubkey(),
                settlement_recorder: admin.pubkey(),
                grx_per_thbg_rate: INIT_RATE,
                swap_fee_bps: INIT_FEE_BPS,
                attestation_ttl: HUGE_TTL,
            })
            .accounts(accounts::Initialize {
                treasury: treasury_pda,
                grx_mint,
                thbg_mint,
                swap_vault,
                stake_vault,
                reward_vault,
                authority: admin.pubkey(),
                token_program,
                system_program: system_program::ID,
                rent: rent_sysvar(),
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // --- seed a fresh, generous reserve attestation so swaps are allowed ---
        ctx.program(program_id)
            .call(instruction::UpdateAttestation { attested_reserve: INIT_RESERVE })
            .accounts(accounts::UpdateAttestation { treasury: treasury_pda, attestor: admin.pubkey() })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // --- initialize all 16 settlement-accumulator shards ---
        let mut shards = Vec::new();
        for id in 0..NUM_SHARDS {
            let (shard, _) =
                Pubkey::find_program_address(&[b"settle_shard", &[id]], &program_id);
            ctx.program(program_id)
                .call(instruction::InitializeSettlementShard { shard_id: id })
                .accounts(accounts::InitializeSettlementShard {
                    treasury: treasury_pda,
                    shard,
                    authority: admin.pubkey(),
                    system_program: system_program::ID,
                })
                .signers(&[&*admin])
                .send()
                .unwrap();
            shards.push(shard);
        }

        Self {
            ctx,
            program_id,
            admin,
            funder,
            funder_grx_ata,
            treasury_pda,
            thbg_mint,
            swap_vault,
            stake_vault,
            reward_vault,
            grx_mint,
            users,
            grx_total,
            shards,
            settle_expected: 0,
            settle_count_expected: 0,
            committed_records: Vec::new(),
            double_record_detected: false,
            paused: false,
            pause_violation: false,
        }
    }

    // --------------------------------------------------------------------- //
    // Reader helpers
    // --------------------------------------------------------------------- //

    fn treasury(&self) -> state::Treasury {
        let acc = self.ctx.read_account(&self.treasury_pda).unwrap();
        let sz = core::mem::size_of::<state::Treasury>();
        bytemuck::pod_read_unaligned::<state::Treasury>(&acc.data[8..8 + sz])
    }

    /// classic spl_token::Account.amount lives at bytes [64..72].
    fn token_amount(&self, pk: &Pubkey) -> u64 {
        match self.ctx.read_account(pk) {
            Ok(a) if a.data.len() >= 72 => {
                u64::from_le_bytes(a.data[64..72].try_into().unwrap())
            }
            _ => 0,
        }
    }

    /// classic spl_token::Mint.supply lives at bytes [36..44].
    fn mint_supply(&self, pk: &Pubkey) -> u64 {
        match self.ctx.read_account(pk) {
            Ok(a) if a.data.len() >= 44 => {
                u64::from_le_bytes(a.data[36..44].try_into().unwrap())
            }
            _ => 0,
        }
    }

    fn position_amount(&self, pk: &Pubkey) -> u64 {
        self.ctx
            .read_anchor_account::<state::StakePosition>(pk)
            .map(|p| p.amount)
            .unwrap_or(0)
    }

    /// SettlementShard is zero-copy → read the Pod after the 8-byte discriminator.
    fn shard(&self, pk: &Pubkey) -> state::SettlementShard {
        let acc = self.ctx.read_account(pk).unwrap();
        let sz = core::mem::size_of::<state::SettlementShard>();
        bytemuck::pod_read_unaligned::<state::SettlementShard>(&acc.data[8..8 + sz])
    }

    // --------------------------------------------------------------------- //
    // Actions
    // --------------------------------------------------------------------- //

    /// Swap GRX → THBG (mints THBG, pulls GRX collateral into swap_vault).
    pub fn action_swap(&mut self, #[range(0..2)] uidx: usize, grx_in: u64) -> bool {
        let u = &self.users[uidx];
        let bal = self.token_amount(&u.grx_ata);
        if bal == 0 {
            return false;
        }
        let amt = (grx_in % bal).max(1);
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::SwapGrxForThbg { grx_in: amt })
            .accounts(accounts::SwapGrxForThbg {
                treasury: self.treasury_pda,
                grx_mint: self.grx_mint,
                thbg_mint: self.thbg_mint,
                swap_vault: self.swap_vault,
                user_grx_ata: u.grx_ata,
                user_thbg_ata: u.thbg_ata,
                user: u.kp.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok && self.paused {
            self.pause_violation = true; // a swap that landed while paused bypassed the gate
        }
        ok
    }

    /// Redeem THBG → GRX (burns THBG, returns GRX from swap_vault).
    pub fn action_redeem(&mut self, #[range(0..2)] uidx: usize, thbg_in: u64) -> bool {
        let u = &self.users[uidx];
        let bal = self.token_amount(&u.thbg_ata);
        if bal == 0 {
            return false;
        }
        let amt = (thbg_in % bal).max(1);
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::RedeemThbgForGrx { thbg_in: amt })
            .accounts(accounts::RedeemThbgForGrx {
                treasury: self.treasury_pda,
                grx_mint: self.grx_mint,
                thbg_mint: self.thbg_mint,
                swap_vault: self.swap_vault,
                user_grx_ata: u.grx_ata,
                user_thbg_ata: u.thbg_ata,
                user: u.kp.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok && self.paused {
            self.pause_violation = true; // a redeem that landed while paused bypassed the gate
        }
        ok
    }

    /// Attest a fresh reserve. Kept >= current supply so I2 stays a meaningful
    /// regression guard on the swap over-mint check (never a spurious failure).
    pub fn action_attest(&mut self, headroom: u64) -> bool {
        let supply = self.treasury().thbg_supply;
        let reserve = supply.saturating_add(headroom);
        self.ctx
            .program(self.program_id)
            .call(instruction::UpdateAttestation { attested_reserve: reserve })
            .accounts(accounts::UpdateAttestation {
                treasury: self.treasury_pda,
                attestor: self.admin.pubkey(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    /// Admin re-parameterizes rate + fee (ttl huge, unpaused). Exercises the
    /// redeem collateral guard under a rate that differs from the swap-time rate.
    pub fn action_set_params(
        &mut self,
        #[range(1..10_000_000)] rate: u64,
        #[range(0..10_001)] fee_bps: u16,
    ) -> bool {
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::SetParams {
                grx_per_thbg_rate: rate,
                swap_fee_bps: fee_bps,
                attestation_ttl: HUGE_TTL,
                paused: false,
                settlement_recorder: self.admin.pubkey(),
            })
            .accounts(accounts::SetParams {
                treasury: self.treasury_pda,
                authority: self.admin.pubkey(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.paused = false; // set_params unconditionally writes paused = false here
        }
        ok
    }

    /// Toggle the pause flag via set_params. When paused, swap_grx_for_thbg and
    /// redeem_thbg_for_grx must halt (TreasuryError::Paused) — the pause-violation
    /// invariant (I9) checks no swap/redeem lands while `self.paused`.
    pub fn action_set_pause(&mut self, paused: bool) -> bool {
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::SetParams {
                grx_per_thbg_rate: INIT_RATE,
                swap_fee_bps: INIT_FEE_BPS,
                attestation_ttl: HUGE_TTL,
                paused,
                settlement_recorder: self.admin.pubkey(),
            })
            .accounts(accounts::SetParams {
                treasury: self.treasury_pda,
                authority: self.admin.pubkey(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.paused = paused; // mirror on-chain paused (set_params writes it unconditionally)
        }
        ok
    }

    /// Stake GRX into the yield vault (init_if_needed position).
    pub fn action_stake(&mut self, #[range(0..2)] uidx: usize, amount: u64) -> bool {
        let u = &self.users[uidx];
        let bal = self.token_amount(&u.grx_ata);
        if bal == 0 {
            return false;
        }
        let amt = (amount % bal).max(1);
        self.ctx
            .program(self.program_id)
            .call(instruction::StakeGrx { amount: amt })
            .accounts(accounts::StakeGrx {
                treasury: self.treasury_pda,
                position: u.stake_pos,
                grx_mint: self.grx_mint,
                stake_vault: self.stake_vault,
                user_grx_ata: u.grx_ata,
                user: u.kp.pubkey(),
                token_program: spl_token_id(),
                system_program: system_program::ID,
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_unstake(&mut self, #[range(0..2)] uidx: usize, amount: u64) -> bool {
        let u = &self.users[uidx];
        let staked = self.position_amount(&u.stake_pos);
        if staked == 0 {
            return false;
        }
        let amt = (amount % staked).max(1);
        self.ctx
            .program(self.program_id)
            .call(instruction::UnstakeGrx { amount: amt })
            .accounts(accounts::UnstakeGrx {
                treasury: self.treasury_pda,
                position: u.stake_pos,
                grx_mint: self.grx_mint,
                stake_vault: self.stake_vault,
                user_grx_ata: u.grx_ata,
                user: u.kp.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_claim(&mut self, #[range(0..2)] uidx: usize) -> bool {
        let u = &self.users[uidx];
        self.ctx
            .program(self.program_id)
            .call(instruction::ClaimRewards {})
            .accounts(accounts::ClaimRewards {
                treasury: self.treasury_pda,
                position: u.stake_pos,
                grx_mint: self.grx_mint,
                reward_vault: self.reward_vault,
                user_grx_ata: u.grx_ata,
                user: u.kp.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    /// Fund the reward pool from the funder's GRX (requires total_staked > 0).
    pub fn action_fund(&mut self, amount: u64) -> bool {
        let bal = self.token_amount(&self.funder_grx_ata);
        if bal == 0 {
            return false;
        }
        let amt = (amount % bal).max(1);
        self.ctx
            .program(self.program_id)
            .call(instruction::FundRewards { amount: amt })
            .accounts(accounts::FundRewards {
                treasury: self.treasury_pda,
                grx_mint: self.grx_mint,
                reward_vault: self.reward_vault,
                funder_grx_ata: self.funder_grx_ata,
                funder: self.funder.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*self.funder])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    /// Admin slashes a staker's principal (moves GRX stake_vault → reward_vault).
    pub fn action_slash(&mut self, #[range(0..2)] uidx: usize, amount: u64) -> bool {
        let u = &self.users[uidx];
        let staked = self.position_amount(&u.stake_pos);
        if staked == 0 {
            return false;
        }
        let amt = (amount % staked).max(1);
        self.ctx
            .program(self.program_id)
            .call(instruction::SlashStake { amount: amt })
            .accounts(accounts::SlashStake {
                treasury: self.treasury_pda,
                target_owner: u.kp.pubkey(),
                position: u.stake_pos,
                grx_mint: self.grx_mint,
                stake_vault: self.stake_vault,
                reward_vault: self.reward_vault,
                authority: self.admin.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    // ------------------- settlement-shard accounting path ------------------ //

    /// Record a single-match settlement against the GLOBAL total_settled_thbg
    /// (record_settlement) — the recorder is the treasury's settlement_recorder (admin).
    pub fn action_record_settlement(&mut self, value: u64) -> bool {
        let v = (value % 1_000_000_000) + 1; // >0 (ZeroAmount), bounded so no overflow
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::RecordSettlement { value: v })
            .accounts(accounts::RecordSettlement {
                treasury: self.treasury_pda,
                recorder: self.admin.pubkey(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.settle_expected += v;
        }
        ok
    }

    /// Record a settlement onto the per-shard accumulator for `sid`
    /// (record_settlement_sharded) — bumps the shard, not the global total.
    pub fn action_record_sharded(&mut self, #[range(0..16)] sid: usize, value: u64) -> bool {
        let v = (value % 1_000_000_000) + 1;
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::RecordSettlementSharded { value: v, shard_id: sid as u8 })
            .accounts(accounts::RecordSettlementSharded {
                treasury: self.treasury_pda,
                shard: self.shards[sid],
                recorder: self.admin.pubkey(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.settle_expected += v;
            self.settle_count_expected += 1;
        }
        ok
    }

    /// Drain-and-fold reconcile: add every shard's balance into the global total and
    /// zero the shards. Shards MUST be passed writable (the program checks is_writable),
    /// so use writable metas — remaining_accounts() would push read-only ones.
    pub fn action_aggregate(&mut self) -> bool {
        let metas: Vec<AccountMeta> =
            self.shards.iter().map(|s| AccountMeta::new(*s, false)).collect();
        self.ctx
            .program(self.program_id)
            .call(instruction::AggregateSettlementShards {})
            .accounts(accounts::AggregateSettlementShards {
                treasury: self.treasury_pda,
                authority: self.admin.pubkey(),
            })
            .remaining_accounts_metas(metas)
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    /// Deterministic Merkle root from (zone, batch) so the harness can assert the
    /// commitment round-trips through the SettlementRecord.
    fn merkle_for(zone: u32, batch: u64) -> [u8; 32] {
        let mut r = [0u8; 32];
        r[0..4].copy_from_slice(&zone.to_le_bytes());
        r[4..12].copy_from_slice(&batch.to_le_bytes());
        r
    }

    /// Record a batch to the GLOBAL total with an audit commitment
    /// (record_settlement_batch → SettlementRecord PDA [b"settlement_batch", zone, batch]).
    pub fn action_record_batch(
        &mut self,
        value: u64,
        #[range(0..4)] zone: u32,
        #[range(0..8)] batch: u64,
        vat: u64,
        vat_rate: u16,
    ) -> bool {
        let v = (value % 1_000_000_000) + 1;
        let vat_amount = vat % 1_000_000;
        let vat_rate_bps = vat_rate % 10_000;
        let (record, _) = Pubkey::find_program_address(
            &[b"settlement_batch", &zone.to_le_bytes(), &batch.to_le_bytes()],
            &self.program_id,
        );
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::RecordSettlementBatch {
                value: v,
                merkle_root: Self::merkle_for(zone, batch),
                vat_amount,
                vat_rate_bps,
                zone_id: zone,
                batch_id: batch,
            })
            .accounts(accounts::RecordSettlementBatch {
                treasury: self.treasury_pda,
                settlement_record: record,
                recorder: self.admin.pubkey(),
                payer: self.admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        self.note_record(ok, 0, zone, batch, v, vat_amount, vat_rate_bps, None);
        ok
    }

    /// Record a batch to a per-shard accumulator with an audit commitment
    /// (record_settlement_batch_sharded → SettlementRecord PDA [b"settlement", zone, batch]).
    pub fn action_record_batch_sharded(
        &mut self,
        value: u64,
        #[range(0..16)] sid: usize,
        #[range(0..4)] zone: u32,
        #[range(0..8)] batch: u64,
        vat: u64,
        vat_rate: u16,
    ) -> bool {
        let v = (value % 1_000_000_000) + 1;
        let vat_amount = vat % 1_000_000;
        let vat_rate_bps = vat_rate % 10_000;
        let (record, _) = Pubkey::find_program_address(
            &[b"settlement", &zone.to_le_bytes(), &batch.to_le_bytes()],
            &self.program_id,
        );
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::RecordSettlementBatchSharded {
                value: v,
                merkle_root: Self::merkle_for(zone, batch),
                vat_amount,
                vat_rate_bps,
                zone_id: zone,
                batch_id: batch,
                shard_id: sid as u8,
            })
            .accounts(accounts::RecordSettlementBatchSharded {
                treasury: self.treasury_pda,
                shard: self.shards[sid],
                settlement_record: record,
                recorder: self.admin.pubkey(),
                payer: self.admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        self.note_record(ok, 1, zone, batch, v, vat_amount, vat_rate_bps, Some(sid));
        ok
    }

    /// Update the ground-truth after a batch-record attempt: a first commit of a
    /// (ns, zone, batch) credits the settled total (+shard count); a re-commit of an
    /// already-recorded (zone,batch) MUST have failed (init guard) — a success trips
    /// `double_record_detected`.
    #[allow(clippy::too_many_arguments)]
    fn note_record(
        &mut self,
        ok: bool,
        ns: u8,
        zone: u32,
        batch: u64,
        value: u64,
        vat: u64,
        vat_rate: u16,
        sharded: Option<usize>,
    ) {
        if !ok {
            return;
        }
        let already = self
            .committed_records
            .iter()
            .any(|r| r.0 == ns && r.1 == zone && r.2 == batch);
        if already {
            self.double_record_detected = true;
            return;
        }
        self.committed_records.push((ns, zone, batch, value, vat, vat_rate));
        self.settle_expected += value;
        if sharded.is_some() {
            self.settle_count_expected += 1;
        }
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut TreasuryFixture) {
    let t = fixture.treasury();

    // I1 — THBG accounting integrity: minted supply must equal the tracked counter.
    let onchain_thbg = fixture.mint_supply(&fixture.thbg_mint);
    fuzz_assert_eq!(
        onchain_thbg,
        t.thbg_supply,
        "THBG mint supply {} != treasury.thbg_supply {}",
        onchain_thbg,
        t.thbg_supply
    );

    // I2 — Peg solvency: outstanding THBG never exceeds the attested reserve.
    fuzz_assert_le!(
        t.thbg_supply,
        t.attested_reserve,
        "peg breach: thbg_supply {} > attested_reserve {}",
        t.thbg_supply,
        t.attested_reserve
    );

    // I3 — Stake custody: vault == counter == Σ positions.
    let stake_vault_bal = fixture.token_amount(&fixture.stake_vault);
    fuzz_assert_eq!(
        stake_vault_bal,
        t.total_staked,
        "stake_vault {} != total_staked {}",
        stake_vault_bal,
        t.total_staked
    );
    let sum_positions: u64 = fixture
        .users
        .iter()
        .map(|u| fixture.position_amount(&u.stake_pos))
        .sum();
    fuzz_assert_eq!(
        sum_positions,
        t.total_staked,
        "Σ position.amount {} != total_staked {}",
        sum_positions,
        t.total_staked
    );

    // I4 — Reward pool: vault balance tracks the reward_pool counter.
    let reward_vault_bal = fixture.token_amount(&fixture.reward_vault);
    fuzz_assert_eq!(
        reward_vault_bal,
        t.reward_pool,
        "reward_vault {} != reward_pool {}",
        reward_vault_bal,
        t.reward_pool
    );

    // I5 — GRX conservation: the treasury never mints/burns GRX, so the sum across
    // every account it can move GRX between is invariant.
    let mut grx_now: u64 = 0;
    grx_now += fixture.token_amount(&fixture.funder_grx_ata);
    grx_now += fixture.token_amount(&fixture.swap_vault);
    grx_now += fixture.token_amount(&fixture.stake_vault);
    grx_now += fixture.token_amount(&fixture.reward_vault);
    for u in &fixture.users {
        grx_now += fixture.token_amount(&u.grx_ata);
    }
    fuzz_assert_eq!(
        grx_now,
        fixture.grx_total,
        "GRX conservation broken: {} != genesis {}",
        grx_now,
        fixture.grx_total
    );

    // I6 — Settlement conservation across the sharded record + drain-and-fold aggregate.
    // Every recorded value lands either in a shard (undrained) or already folded into the
    // global; the two together must always equal the exact sum recorded. A lost/duplicated
    // shard fold, a misrouted shard, or a double-drain would break this.
    let shard_sum: u64 = fixture.shards.iter().map(|s| fixture.shard(s).settled_thbg).sum();
    let settled_total = t.total_settled_thbg.wrapping_add(shard_sum);
    fuzz_assert_eq!(
        settled_total,
        fixture.settle_expected,
        "settlement conservation: global {} + shards {} != recorded {}",
        t.total_settled_thbg,
        shard_sum,
        fixture.settle_expected
    );

    // I7 — Shard settlement_count is cumulative (aggregate zeroes settled_thbg but NEVER
    // the count), so Σ count == number of successful sharded records.
    let count_sum: u64 = fixture.shards.iter().map(|s| fixture.shard(s).settlement_count).sum();
    fuzz_assert_eq!(
        count_sum,
        fixture.settle_count_expected,
        "Σ shard.settlement_count {} != sharded records {}",
        count_sum,
        fixture.settle_count_expected
    );

    // I8 — Audit-commitment integrity: each committed (zone,batch) SettlementRecord holds
    // exactly the values recorded on its FIRST commit, and the init guard never let a
    // (zone,batch) be re-recorded (double_record_detected). SettlementRecord (zero-copy,
    // after 8-byte disc): merkle_root@8, total_value@72, vat_amount@80, batch_id@96,
    // zone_id@104, vat_rate_bps@108.
    fuzz_assert!(
        !fixture.double_record_detected,
        "double-record succeeded: a re-recorded (zone,batch) bypassed the init guard"
    );
    // I9 — pause safety: swap_grx_for_thbg / redeem_thbg_for_grx must halt while paused.
    // Any that landed while the mirror said paused bypassed the TreasuryError::Paused gate.
    fuzz_assert!(
        !fixture.pause_violation,
        "swap/redeem succeeded while treasury was paused"
    );

    for (ns, zone, batch, value, vat, vat_rate) in fixture.committed_records.iter() {
        let seed: &[u8] = if *ns == 0 { b"settlement_batch" } else { b"settlement" };
        let (record, _) = Pubkey::find_program_address(
            &[seed, &zone.to_le_bytes(), &batch.to_le_bytes()],
            &fixture.program_id,
        );
        let a = fixture.ctx.read_account(&record).unwrap();
        let rd_u64 = |off: usize| u64::from_le_bytes(a.data[off..off + 8].try_into().unwrap());
        let total_value = rd_u64(72);
        let vat_amount = rd_u64(80);
        let batch_id = rd_u64(96);
        let zone_id = u32::from_le_bytes(a.data[104..108].try_into().unwrap());
        let vat_rate_bps = u16::from_le_bytes(a.data[108..110].try_into().unwrap());
        let merkle_ok = a.data[8..40] == TreasuryFixture::merkle_for(*zone, *batch);
        fuzz_assert!(
            total_value == *value
                && vat_amount == *vat
                && batch_id == *batch
                && zone_id == *zone
                && vat_rate_bps == *vat_rate
                && merkle_ok,
            "SettlementRecord (ns {} zone {} batch {}) mismatch: value {}/{} vat {}/{} zone {}/{} batch {}/{} rate {}/{} merkle_ok {}",
            ns, zone, batch, total_value, value, vat_amount, vat, zone_id, zone, batch_id, batch, vat_rate_bps, vat_rate, merkle_ok
        );
    }
}
