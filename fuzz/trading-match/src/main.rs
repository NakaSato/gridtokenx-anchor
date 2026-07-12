//! Crucible invariant-fuzzing harness for the trading CDA order-matching path
//! (`match_orders`) — the on-chain continuous-double-auction fill engine.
//!
//! Setup books a fixed pool of buy + sell limit orders (via `submit_limit_order`);
//! `action_match` matches a buy against a sell for a fuzzed amount. `match_orders` is
//! self-contained (no escrow / token CPI): it updates each order's `filled_amount`,
//! writes a per-pair `TradeRecord` PDA, and bumps `zone_market.total_volume`.
//!
//! Invariants:
//!   I1  Fill balance: Σ buy.filled_amount == Σ sell.filled_amount (every match fills
//!       one buy and one sell by the SAME amount).
//!   I2  Volume integrity: Σ buy.filled_amount == zone_market.total_volume.
//!   I3  No over-fill: every order's filled_amount <= its amount (the min() clamp).
//!   I4  One-match-per-pair: the TradeRecord PDA [b"trade", buy, sell] is init-only, so
//!       a (buy,sell) pair can match at most once. A second success trips double_match.

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::rc::Rc;
use std::str::FromStr;

crucible_idl_gen::declare_fuzz_program!("idls/trading.json");

use trading::{accounts, instruction};

const N_BUY: usize = 3;
const N_SELL: usize = 3;
const ZONE: u32 = 0;
const NUM_SHARDS: u8 = 16;
const INITIAL_SOL: u64 = 1_000_000_000_000;
const BUY_PRICE: u64 = 60;
const SELL_PRICE: u64 = 50; // buy >= sell → PriceMismatch passes
const ORDER_AMT: u64 = 1_000_000_000_000; // 1e12 per order
const MATCH_MAX: u64 = 2_000_000_000_000; // fuzzed req spans partial + full fills

const GOVERNANCE_ID: &str = "FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS";

fn spl_token_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

#[derive(Clone)]
struct MatchFixture {
    ctx: TestContext,
    program_id: Pubkey,
    admin: Rc<Keypair>,
    market: Pubkey,
    zone_market: Pubkey,
    governance_config: Pubkey,
    buys: Vec<Pubkey>,
    sells: Vec<Pubkey>,
    matched_pairs: Vec<(usize, usize)>,
    double_match: bool,
}

#[fuzz_fixture]
impl MatchFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        let program_id = Pubkey::new_from_array(trading::ID.to_bytes());
        ctx.add_program(&program_id, "../../target/deploy/trading.so").unwrap();
        let governance_id = Pubkey::from_str(GOVERNANCE_ID).unwrap();

        let admin = Rc::new(Keypair::new());
        ctx.create_account()
            .pubkey(admin.pubkey())
            .lamports(INITIAL_SOL)
            .owner(system_program::ID)
            .create()
            .unwrap();

        let (market, _) = Pubkey::find_program_address(&[b"market"], &program_id);
        let (zone_market, _) = Pubkey::find_program_address(
            &[b"zone_market", market.as_ref(), &ZONE.to_le_bytes()],
            &program_id,
        );

        // Forged governance_config. get_governance_config borsh-deserializes the WHOLE
        // GovernanceConfig (~450 B) from data[8..], so the buffer must be big enough
        // (700 B, matching the order-path harness) — a short buffer fails deserialize
        // (InvalidGovernanceAccount). Zeroed → maintenance_mode=false → operational.
        let (governance_config, _) =
            Pubkey::find_program_address(&[b"governance_config"], &governance_id);
        ctx.create_account()
            .pubkey(governance_config)
            .lamports(10_000_000)
            .owner(governance_id)
            .data(&[0u8; 700])
            .create()
            .unwrap();

        ctx.program(program_id)
            .call(instruction::InitializeMarket { num_shards: NUM_SHARDS })
            .accounts(accounts::InitializeMarket {
                market,
                authority: admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*admin])
            .send()
            .unwrap();
        ctx.program(program_id)
            .call(instruction::InitializeZoneMarket {
                zone_id: ZONE,
                num_shards: NUM_SHARDS,
                capacity: 0,
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

        // Book a fixed pool of orders. order_id namespace: buys 0..N_BUY, sells after.
        let order_pda = |oid: u64| {
            Pubkey::find_program_address(
                &[b"order", admin.pubkey().as_ref(), &oid.to_le_bytes()],
                &program_id,
            )
            .0
        };
        let mut submit = |ctx: &mut TestContext, oid: u64, side: u8, price: u64| {
            let order = order_pda(oid);
            ctx.program(program_id)
                .call(instruction::SubmitLimitOrder {
                    order_id_val: oid,
                    side,
                    amount: ORDER_AMT,
                    price,
                })
                .accounts(accounts::SubmitLimitOrder {
                    market,
                    order,
                    authority: admin.pubkey(),
                    system_program: system_program::ID,
                    governance_config,
                })
                .signers(&[&*admin])
                .send()
                .unwrap();
            // send() returns Ok(Failed) for a rejected-but-submitted tx, which unwrap()
            // does NOT catch — assert the order actually booked.
            assert!(
                ctx.read_account(&order).map(|a| a.owner == program_id).unwrap_or(false),
                "submit_limit_order did not create the order account"
            );
            order
        };

        let mut buys = Vec::new();
        for i in 0..N_BUY {
            buys.push(submit(&mut ctx, i as u64, 0, BUY_PRICE));
        }
        let mut sells = Vec::new();
        for i in 0..N_SELL {
            sells.push(submit(&mut ctx, (N_BUY + i) as u64, 1, SELL_PRICE));
        }

        Self {
            ctx,
            program_id,
            admin,
            market,
            zone_market,
            governance_config,
            buys,
            sells,
            matched_pairs: Vec::new(),
            double_match: false,
        }
    }

    /// Order.filled_amount (zero-copy) — struct offset 80 → account.data[88..96].
    fn order_filled(&self, pk: &Pubkey) -> u64 {
        self.read_u64(pk, 88)
    }
    /// Order.amount — struct offset 72 → account.data[80..88].
    fn order_amount(&self, pk: &Pubkey) -> u64 {
        self.read_u64(pk, 80)
    }
    fn read_u64(&self, pk: &Pubkey, off: usize) -> u64 {
        match self.ctx.read_account(pk) {
            Ok(a) if a.data.len() >= off + 8 => {
                u64::from_le_bytes(a.data[off..off + 8].try_into().unwrap())
            }
            _ => 0,
        }
    }

    /// Match buy[bidx] against sell[sidx] for a fuzzed amount. The TradeRecord PDA makes
    /// each pair matchable at most once; a completed order rejects further matches.
    pub fn action_match(
        &mut self,
        #[range(0..3)] bidx: usize,
        #[range(0..3)] sidx: usize,
        amount: u64,
    ) -> bool {
        let buy = self.buys[bidx];
        let sell = self.sells[sidx];
        let match_amount = (amount % MATCH_MAX) + 1;
        let (trade_record, _) = Pubkey::find_program_address(
            &[b"trade", buy.as_ref(), sell.as_ref()],
            &self.program_id,
        );
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::MatchOrders { match_amount })
            .accounts(accounts::MatchOrders {
                market: self.market,
                zone_market: self.zone_market,
                buy_order: buy,
                sell_order: sell,
                trade_record,
                authority: self.admin.pubkey(),
                system_program: system_program::ID,
                governance_config: self.governance_config,
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            if self.matched_pairs.contains(&(bidx, sidx)) {
                // A (buy,sell) pair re-matched → the TradeRecord init guard was bypassed.
                self.double_match = true;
            } else {
                self.matched_pairs.push((bidx, sidx));
            }
        }
        ok
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut MatchFixture) {
    let buy_filled: u64 = fixture.buys.iter().map(|o| fixture.order_filled(o)).sum();
    let sell_filled: u64 = fixture.sells.iter().map(|o| fixture.order_filled(o)).sum();

    // I1 — every match fills a buy and a sell by the same amount.
    fuzz_assert_eq!(
        buy_filled,
        sell_filled,
        "fill imbalance: Σ buy {} != Σ sell {}",
        buy_filled,
        sell_filled
    );

    // I2 — total_volume (zone_market struct offset 40 → data[48..56]) tracks the fills.
    let total_volume = fixture.read_u64(&fixture.zone_market, 48);
    fuzz_assert_eq!(
        buy_filled,
        total_volume,
        "Σ buy filled {} != zone_market.total_volume {}",
        buy_filled,
        total_volume
    );

    // I3 — no order is ever over-filled beyond its amount.
    for o in fixture.buys.iter().chain(fixture.sells.iter()) {
        let filled = fixture.order_filled(o);
        let amount = fixture.order_amount(o);
        fuzz_assert_le!(filled, amount, "order over-filled: {} > {}", filled, amount);
    }

    // I4 — the per-pair TradeRecord init guard was never bypassed.
    fuzz_assert!(
        !fixture.double_match,
        "double-match succeeded: a (buy,sell) pair matched twice"
    );
}
