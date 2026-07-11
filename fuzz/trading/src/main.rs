//! Crucible invariant-fuzzing harness for the `trading` program (order path).
//!
//! Scope: the non-custodial order lifecycle — create_buy_order / create_sell_order /
//! cancel_order — and the `ZoneMarket.active_orders` counter they maintain. The
//! Ed25519 off-chain settlement path (settle_offchain_match) is intentionally out of
//! scope (needs a 3-instruction Ed25519-signed tx + full escrow/market setup).
//!
//! `governance_config` is FORGED as an all-zeros buffer: trading's `get_governance_config`
//! reads `data[8..]` and borsh-decodes a `GovernanceConfig` without an owner check, and a
//! zeroed struct has `maintenance_mode == false` → `is_operational() == true`.
//!
//! Invariant:
//!   I1  ZoneMarket.active_orders == (successful creates − successful cancels). Verifies
//!       the counter is bumped on every create and decremented exactly once per cancel
//!       (no double-cancel, no missed decrement, no phantom order).

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::rc::Rc;
use std::str::FromStr;

crucible_idl_gen::declare_fuzz_program!("idls/trading.json");

use trading::{accounts, instruction};

const N_USERS: usize = 2;
const INITIAL_SOL: u64 = 1_000_000_000_000;
const ZONE_ID: u32 = 0;
const PRICE: u64 = 1_000; // >= market.min_price_per_kwh (1), max unbounded
const ZM_ACTIVE_ORDERS: usize = 56; // ZoneMarket.active_orders (u32) byte offset

fn governance_program_id() -> Pubkey {
    Pubkey::from_str("FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS").unwrap()
}

#[derive(Clone)]
struct OrderRec {
    uidx: usize,
    order_id: u64,
    pda: Pubkey,
    active: bool,
}

#[derive(Clone)]
struct TradingFixture {
    ctx: TestContext,
    program_id: Pubkey,
    users: Vec<Rc<Keypair>>,
    market: Pubkey,
    zone_market: Pubkey,
    gov_config: Pubkey,
    orders: Vec<OrderRec>,
    next_id: u64,
    active_expected: u32,
}

#[fuzz_fixture]
impl TradingFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        let program_id = Pubkey::new_from_array(trading::ID.to_bytes());
        ctx.add_program(&program_id, "../../target/deploy/trading.so")
            .unwrap();

        let mut users = Vec::new();
        for _ in 0..N_USERS {
            let kp = Rc::new(Keypair::new());
            ctx.create_account()
                .pubkey(kp.pubkey())
                .lamports(INITIAL_SOL)
                .owner(system_program::ID)
                .create()
                .unwrap();
            users.push(kp);
        }
        let admin = users[0].clone();

        let (market, _) = Pubkey::find_program_address(&[b"market"], &program_id);
        let (zone_market, _) = Pubkey::find_program_address(
            &[b"zone_market", market.as_ref(), &ZONE_ID.to_le_bytes()],
            &program_id,
        );

        // Forge governance_config: all-zeros → maintenance_mode = false → operational.
        let (gov_config, _) =
            Pubkey::find_program_address(&[b"governance_config"], &governance_program_id());
        ctx.create_account()
            .pubkey(gov_config)
            .lamports(1_000_000_000)
            .owner(governance_program_id())
            .data(&[0u8; 700])
            .create()
            .unwrap();

        // initialize_market
        ctx.program(program_id)
            .call(instruction::InitializeMarket { num_shards: 4 })
            .accounts(accounts::InitializeMarket {
                market,
                authority: admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // initialize_zone_market
        ctx.program(program_id)
            .call(instruction::InitializeZoneMarket {
                zone_id: ZONE_ID,
                num_shards: 4,
                capacity: 1_000_000_000,
                segment: 0,
            })
            .accounts(accounts::InitializeZoneMarket {
                market,
                zone_market,
                authority: admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        Self {
            ctx,
            program_id,
            users,
            market,
            zone_market,
            gov_config,
            orders: Vec::new(),
            next_id: 1,
            active_expected: 0,
        }
    }

    fn read_u32(&self, pk: &Pubkey, off: usize) -> u32 {
        match self.ctx.read_account(pk) {
            Ok(a) if a.data.len() >= off + 4 => {
                u32::from_le_bytes(a.data[off..off + 4].try_into().unwrap())
            }
            _ => 0,
        }
    }

    fn order_pda(&self, user: &Pubkey, order_id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[b"order", user.as_ref(), &order_id.to_le_bytes()],
            &self.program_id,
        )
        .0
    }

    // ---- actions ----

    pub fn action_sell(&mut self, #[range(0..2)] uidx: usize, energy: u64) -> bool {
        let amt = (energy % 100_000).max(1);
        let user = self.users[uidx].clone();
        let order_id = self.next_id;
        let pda = self.order_pda(&user.pubkey(), order_id);
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::CreateSellOrder {
                order_id_val: order_id,
                energy_amount: amt,
                price_per_kwh: PRICE,
            })
            .accounts(accounts::CreateSellOrder {
                market: self.market,
                zone_market: self.zone_market,
                order: pda,
                erc_certificate: None,
                authority: user.pubkey(),
                system_program: system_program::ID,
                governance_config: self.gov_config,
            })
            .signers(&[&*user])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.next_id += 1;
            self.orders.push(OrderRec { uidx, order_id, pda, active: true });
            self.active_expected += 1;
        }
        ok
    }

    pub fn action_buy(&mut self, #[range(0..2)] uidx: usize, energy: u64) -> bool {
        let amt = (energy % 100_000).max(1);
        let user = self.users[uidx].clone();
        let order_id = self.next_id;
        let pda = self.order_pda(&user.pubkey(), order_id);
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::CreateBuyOrder {
                order_id_val: order_id,
                energy_amount: amt,
                max_price_per_kwh: PRICE,
            })
            .accounts(accounts::CreateBuyOrder {
                market: self.market,
                zone_market: self.zone_market,
                order: pda,
                authority: user.pubkey(),
                system_program: system_program::ID,
                governance_config: self.gov_config,
            })
            .signers(&[&*user])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.next_id += 1;
            self.orders.push(OrderRec { uidx, order_id, pda, active: true });
            self.active_expected += 1;
        }
        ok
    }

    pub fn action_cancel(&mut self, sel: u32) -> bool {
        if self.orders.is_empty() {
            return false;
        }
        let idx = (sel as usize) % self.orders.len();
        let rec = self.orders[idx].clone();
        let user = self.users[rec.uidx].clone();
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::CancelOrder {})
            .accounts(accounts::CancelOrder {
                market: self.market,
                zone_market: self.zone_market,
                order: rec.pda,
                authority: user.pubkey(),
                governance_config: self.gov_config,
            })
            .signers(&[&*user])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok && self.orders[idx].active {
            self.orders[idx].active = false;
            self.active_expected = self.active_expected.saturating_sub(1);
        }
        ok
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut TradingFixture) {
    // I1 — zone-market active-order counter tracks creates minus cancels exactly.
    let onchain = fixture.read_u32(&fixture.zone_market, ZM_ACTIVE_ORDERS);
    fuzz_assert_eq!(
        onchain,
        fixture.active_expected,
        "active_orders {} != expected {}",
        onchain,
        fixture.active_expected
    );
}
