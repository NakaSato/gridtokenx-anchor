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

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
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
        self.ctx
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
            .unwrap_or(false)
    }

    /// Redeem THBG → GRX (burns THBG, returns GRX from swap_vault).
    pub fn action_redeem(&mut self, #[range(0..2)] uidx: usize, thbg_in: u64) -> bool {
        let u = &self.users[uidx];
        let bal = self.token_amount(&u.thbg_ata);
        if bal == 0 {
            return false;
        }
        let amt = (thbg_in % bal).max(1);
        self.ctx
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
            .unwrap_or(false)
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
        self.ctx
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
            .unwrap_or(false)
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
}
