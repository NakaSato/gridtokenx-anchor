//! Crucible invariant-fuzzing harness for `trading::settle_offchain_match` — the
//! crown-jewel off-chain-signed match settlement path.
//!
//! Each `action_settle` builds the real 3-instruction transaction the on-chain path
//! demands — `[ed25519(buyer), ed25519(seller), settle_offchain_match]` — with genuine
//! Ed25519 signatures over each party's `OffchainOrderPayload`, the governance /
//! tariff / aggregator gate accounts (forged directly at their canonical PDAs), and
//! the buyer/seller currency+energy escrows. The fuzzer drives random match amounts,
//! prices and per-match `trade_id`s (keyed by a fuzzed `seed`), and — crucially —
//! naturally REPLAYS the same seed, exercising the per-match `TradeNullifier`
//! double-settle guard.
//!
//! Invariants:
//!   I1  Currency conservation: buyer+seller currency escrows + the 3 fee collectors
//!       sum to a constant. settle only ever MOVES currency between these accounts
//!       (transfer_checked, never mint/burn), so the total is invariant.
//!   I2  Energy conservation: seller+buyer energy escrows sum to a constant.
//!   I3  Delivered-energy accounting: buyer energy escrow == Σ match_amount over the
//!       matches that settled for the FIRST time. A replay that wrongly bypassed the
//!       TradeNullifier would move extra energy and break this equality.
//!   I4  Double-settle guard: re-settling an already-committed trade_id must FAIL
//!       (MatchAlreadySettled). If one ever succeeds, `double_settle_detected` trips.

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
use crucible_fuzzer::anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::rc::Rc;
use std::str::FromStr;

crucible_idl_gen::declare_fuzz_program!("idls/trading.json");

use trading::{accounts, instruction, types};

const ZONE: u32 = 0;
const NUM_SHARDS: u8 = 16;
const INITIAL_SOL: u64 = 1_000_000_000_000; // payer fees + rent for nullifier inits
const BUYER_PRICE: u64 = 60; // 6-dec currency per kWh
const SELLER_PRICE: u64 = 50;
const ORDER_ENERGY: u64 = 1_000_000_000_000_000; // payload energy_amount (order headroom)
const MATCH_MAX: u64 = 1_000_000_000_000; // per-match cap (≤1000 kWh atomic)
const CURRENCY_FUND: u64 = 1_000_000_000_000_000; // buyer currency escrow seed
const ENERGY_FUND: u64 = 1_000_000_000_000_000; // seller energy escrow seed
const CURRENCY_DECIMALS: u8 = 6;
const ENERGY_DECIMALS: u8 = 9;
const TOK_AMOUNT: usize = 64; // classic spl_token Account.amount offset

const GOVERNANCE_ID: &str = "FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS";

fn spl_token_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}
fn ix_sysvar_id() -> Pubkey {
    Pubkey::from_str("Sysvar1nstructions1111111111111111111111111").unwrap()
}
fn ed25519_program_id() -> Pubkey {
    // Ed25519SigVerify111111111111111111111111111
    Pubkey::new_from_array([
        3, 125, 70, 214, 124, 147, 251, 190, 18, 249, 66, 143, 131, 141, 64, 255, 5, 112, 116, 73,
        39, 244, 138, 100, 252, 202, 112, 68, 128, 0, 0, 0,
    ])
}

/// Derive a stable 16-byte id from `seed` + a role marker (buyer=0/seller=1/trade=2),
/// so a replay of the same seed reconstructs the SAME order ids + trade_id.
fn id16(seed: u32, marker: u8) -> [u8; 16] {
    let mut b = [0u8; 16];
    b[0..4].copy_from_slice(&seed.to_le_bytes());
    b[15] = marker;
    b
}

/// The 77-byte message the on-chain `OffchainOrderPayload::get_message()` reconstructs
/// and the Ed25519 precompile verifies. Field order must match exactly.
#[allow(clippy::too_many_arguments)]
fn order_message(
    order_id: &[u8; 16],
    user: &Pubkey,
    energy_amount: u64,
    price: u64,
    side: u8,
    zone_id: u32,
    expires_at: i64,
) -> Vec<u8> {
    let mut m = Vec::with_capacity(77);
    m.extend_from_slice(order_id);
    m.extend_from_slice(user.as_ref());
    m.extend_from_slice(&energy_amount.to_le_bytes());
    m.extend_from_slice(&price.to_le_bytes());
    m.push(side);
    m.extend_from_slice(&zone_id.to_le_bytes());
    m.extend_from_slice(&expires_at.to_le_bytes());
    m
}

/// Build a single-signature Ed25519 program instruction whose declared offsets point at
/// its OWN data (ix index = u16::MAX "current"). Layout: [num_sigs=1][pad=0][14-byte
/// offsets header][sig 64][pubkey 32][message N]. The trading verifier reads the pubkey
/// and message at the declared offsets and matches them to the payload.
fn ed25519_ix(signer: &Keypair, msg: &[u8]) -> Instruction {
    let sig = signer.sign_message(msg);
    let pk = signer.pubkey();
    let sig_off: u16 = 16;
    let pk_off: u16 = 16 + 64;
    let msg_off: u16 = 16 + 64 + 32;
    let cur: u16 = u16::MAX;
    let mut d: Vec<u8> = Vec::new();
    d.push(1); // num signatures
    d.push(0); // padding
    d.extend_from_slice(&sig_off.to_le_bytes());
    d.extend_from_slice(&cur.to_le_bytes()); // sig ix idx = current
    d.extend_from_slice(&pk_off.to_le_bytes());
    d.extend_from_slice(&cur.to_le_bytes()); // pk ix idx = current
    d.extend_from_slice(&msg_off.to_le_bytes());
    d.extend_from_slice(&(msg.len() as u16).to_le_bytes());
    d.extend_from_slice(&cur.to_le_bytes()); // msg ix idx = current
    d.extend_from_slice(sig.as_ref()); // 64
    d.extend_from_slice(pk.as_ref()); // 32
    d.extend_from_slice(msg); // N
    Instruction { program_id: ed25519_program_id(), accounts: vec![], data: d }
}

#[derive(Clone)]
struct SettleFixture {
    ctx: TestContext,
    program_id: Pubkey,
    admin: Rc<Keypair>, // payer + market authority-admin + admitted aggregator
    buyer: Rc<Keypair>,
    seller: Rc<Keypair>,
    currency_mint: Pubkey,
    energy_mint: Pubkey,
    market: Pubkey,
    zone_market: Pubkey,
    market_authority: Pubkey,
    market_shard: Pubkey,
    zone_shard: Pubkey,
    // remaining-account gate PDAs
    governance_config: Pubkey,
    tariff_config: Pubkey,
    aggregator_entry: Pubkey,
    // escrows / collectors (conservation-tracked)
    buyer_cur_escrow: Pubkey,
    seller_cur_escrow: Pubkey,
    seller_eng_escrow: Pubkey,
    buyer_eng_escrow: Pubkey,
    fee_collector: Pubkey,
    wheeling_collector: Pubkey,
    loss_collector: Pubkey,
    // ground truth
    currency_total: u64,
    energy_total: u64,
    settled_seeds: Vec<u32>,
    expected_buyer_energy: u64,
    double_settle_detected: bool,
}

#[fuzz_fixture]
impl SettleFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        // Register the Ed25519 precompile on the LiteSVM (crucible builds it without
        // precompiles). `with_precompiles` consumes self, so swap through a throwaway.
        let placeholder = litesvm::LiteSVM::new();
        let real = std::mem::replace(&mut ctx.svm, placeholder);
        ctx.svm = real.with_precompiles();

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
        // Buyer/seller sign payloads off-chain only; they never sign a tx, need no SOL.
        let buyer = Rc::new(Keypair::new());
        let seller = Rc::new(Keypair::new());

        // --- mints: both classic SPL (settle binds token::mint/authority only) ---
        let currency_mint = ctx
            .create_mint()
            .pubkey(Keypair::new().pubkey())
            .mint_authority(admin.pubkey())
            .decimals(CURRENCY_DECIMALS)
            .create()
            .unwrap();
        let energy_mint = ctx
            .create_mint()
            .pubkey(Keypair::new().pubkey())
            .mint_authority(admin.pubkey())
            .decimals(ENERGY_DECIMALS)
            .create()
            .unwrap();

        // --- trading PDAs ---
        let (market, _) = Pubkey::find_program_address(&[b"market"], &program_id);
        let (zone_market, _) = Pubkey::find_program_address(
            &[b"zone_market", market.as_ref(), &ZONE.to_le_bytes()],
            &program_id,
        );
        let (market_authority, _) =
            Pubkey::find_program_address(&[b"market_authority"], &program_id);
        let shard_byte = admin.pubkey().to_bytes()[0] % NUM_SHARDS;
        let (market_shard, _) = Pubkey::find_program_address(
            &[b"market_shard", market.as_ref(), &[shard_byte]],
            &program_id,
        );
        let (zone_shard, _) = Pubkey::find_program_address(
            &[b"zone_shard", zone_market.as_ref(), &[shard_byte]],
            &program_id,
        );

        // --- initialize market + zone + both shards for the payer's shard ---
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
                capacity: 0, // 0 → intra-zone only → cross_zone gate never fires
                segment: 0,  // Retail → aggregator segment check skipped
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
        ctx.program(program_id)
            .call(instruction::InitializeMarketShard { shard_id: shard_byte })
            .accounts(accounts::InitializeMarketShard {
                market,
                market_shard,
                payer: admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*admin])
            .send()
            .unwrap();
        ctx.program(program_id)
            .call(instruction::InitializeZoneMarketShard { shard_id: shard_byte })
            .accounts(accounts::InitializeZoneMarketShard {
                zone_market,
                zone_shard,
                payer: admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // --- escrow / collector token accounts (forged directly at their PDAs, owner =
        //     market_authority). settle moves funds strictly between these. ---
        let escrow = |user: &Pubkey, mint: &Pubkey| {
            Pubkey::find_program_address(&[b"escrow", user.as_ref(), mint.as_ref()], &program_id).0
        };
        let collector = |label: &[u8], mint: &Pubkey| {
            Pubkey::find_program_address(&[label, mint.as_ref()], &program_id).0
        };
        let mut forge_tok = |pk: Pubkey, mint: Pubkey, amount: u64| {
            ctx.create_token_account()
                .pubkey(pk)
                .mint(mint)
                .token_owner(market_authority)
                .amount(amount)
                .create()
                .unwrap();
        };

        let buyer_cur_escrow = escrow(&buyer.pubkey(), &currency_mint);
        let seller_cur_escrow = escrow(&seller.pubkey(), &currency_mint);
        let seller_eng_escrow = escrow(&seller.pubkey(), &energy_mint);
        let buyer_eng_escrow = escrow(&buyer.pubkey(), &energy_mint);
        forge_tok(buyer_cur_escrow, currency_mint, CURRENCY_FUND);
        forge_tok(seller_cur_escrow, currency_mint, 0);
        forge_tok(seller_eng_escrow, energy_mint, ENERGY_FUND);
        forge_tok(buyer_eng_escrow, energy_mint, 0);

        let fee_collector = collector(b"fee_collector", &currency_mint);
        let wheeling_collector = collector(b"wheeling_collector", &currency_mint);
        let loss_collector = collector(b"loss_collector", &currency_mint);
        forge_tok(fee_collector, currency_mint, 0);
        forge_tok(wheeling_collector, currency_mint, 0);
        forge_tok(loss_collector, currency_mint, 0);

        // --- forged gate accounts (remaining_accounts) ---
        // governance_config: governance-owned, byte[235]==0 → operational.
        let (governance_config, _) =
            Pubkey::find_program_address(&[b"governance_config"], &governance_id);
        ctx.create_account()
            .pubkey(governance_config)
            .lamports(10_000_000)
            .owner(governance_id)
            .data(&[0u8; 300])
            .create()
            .unwrap();
        // tariff_config: trading-owned, wheeling_rate@72 = 0, loss_bps@80 = 0 (no charges).
        let (tariff_config, _) = Pubkey::find_program_address(&[b"tariff_config"], &program_id);
        ctx.create_account()
            .pubkey(tariff_config)
            .lamports(10_000_000)
            .owner(program_id)
            .data(&[0u8; 100])
            .create()
            .unwrap();
        // aggregator_entry: governance-owned, data[8..40]==payer, data[56]==1 (active).
        let (aggregator_entry, _) =
            Pubkey::find_program_address(&[b"aggregator", admin.pubkey().as_ref()], &governance_id);
        let mut agg = vec![0u8; 64];
        agg[8..40].copy_from_slice(admin.pubkey().as_ref());
        agg[56] = 1;
        ctx.create_account()
            .pubkey(aggregator_entry)
            .lamports(10_000_000)
            .owner(governance_id)
            .data(&agg)
            .create()
            .unwrap();

        Self {
            ctx,
            program_id,
            admin,
            buyer,
            seller,
            currency_mint,
            energy_mint,
            market,
            zone_market,
            market_authority,
            market_shard,
            zone_shard,
            governance_config,
            tariff_config,
            aggregator_entry,
            buyer_cur_escrow,
            seller_cur_escrow,
            seller_eng_escrow,
            buyer_eng_escrow,
            fee_collector,
            wheeling_collector,
            loss_collector,
            currency_total: CURRENCY_FUND,
            energy_total: ENERGY_FUND,
            settled_seeds: Vec::new(),
            expected_buyer_energy: 0,
            double_settle_detected: false,
        }
    }

    fn tok(&self, pk: &Pubkey) -> u64 {
        match self.ctx.read_account(pk) {
            Ok(a) if a.data.len() >= TOK_AMOUNT + 8 => {
                u64::from_le_bytes(a.data[TOK_AMOUNT..TOK_AMOUNT + 8].try_into().unwrap())
            }
            _ => 0,
        }
    }

    /// Settle one buyer/seller match. `seed` keys the order ids + trade_id, so the fuzzer
    /// replaying a seed re-hits the same TradeNullifier (double-settle path).
    pub fn action_settle(&mut self, seed: u32, amount: u64, price: u64) -> bool {
        let match_amount = (amount % MATCH_MAX) + 1;
        let match_price = SELLER_PRICE + (price % (BUYER_PRICE - SELLER_PRICE + 1)); // [50,60]

        // Skip a match the seller escrow can't cover — a guaranteed transfer failure that
        // would just add noise (the on-chain guard would reject it anyway).
        if match_amount > self.tok(&self.seller_eng_escrow) {
            return false;
        }

        let buyer_oid = id16(seed, 0);
        let seller_oid = id16(seed, 1);
        let trade_id = id16(seed, 2);

        let buyer_msg = order_message(
            &buyer_oid,
            &self.buyer.pubkey(),
            ORDER_ENERGY,
            BUYER_PRICE,
            0,
            ZONE,
            0,
        );
        let seller_msg = order_message(
            &seller_oid,
            &self.seller.pubkey(),
            ORDER_ENERGY,
            SELLER_PRICE,
            1,
            ZONE,
            0,
        );
        let buyer_ed = ed25519_ix(&self.buyer, &buyer_msg);
        let seller_ed = ed25519_ix(&self.seller, &seller_msg);

        let buyer_payload = types::OffchainOrderPayload {
            order_id: buyer_oid,
            user: self.buyer.pubkey(),
            energy_amount: ORDER_ENERGY,
            price_per_kwh: BUYER_PRICE,
            side: 0,
            zone_id: ZONE,
            expires_at: 0,
        };
        let seller_payload = types::OffchainOrderPayload {
            order_id: seller_oid,
            user: self.seller.pubkey(),
            energy_amount: ORDER_ENERGY,
            price_per_kwh: SELLER_PRICE,
            side: 1,
            zone_id: ZONE,
            expires_at: 0,
        };

        let (buyer_nullifier, _) = Pubkey::find_program_address(
            &[b"nullifier", self.buyer.pubkey().as_ref(), &buyer_oid],
            &self.program_id,
        );
        let (seller_nullifier, _) = Pubkey::find_program_address(
            &[b"nullifier", self.seller.pubkey().as_ref(), &seller_oid],
            &self.program_id,
        );
        let (trade_nullifier, _) =
            Pubkey::find_program_address(&[b"trade", &trade_id], &self.program_id);

        // remaining_accounts[0..4] = governance_config, trade_nullifier(w), tariff_config,
        // aggregator_entry. (intra-zone → no ZoneCapacity; no REC/treasury.)
        let remaining = vec![
            AccountMeta::new_readonly(self.governance_config, false),
            AccountMeta::new(trade_nullifier, false),
            AccountMeta::new_readonly(self.tariff_config, false),
            AccountMeta::new_readonly(self.aggregator_entry, false),
        ];

        // Queue the 3-ix atomic tx: ed25519(buyer)@0, ed25519(seller)@1, settle@2.
        self.ctx.raw_call(buyer_ed).add_transaction().unwrap();
        self.ctx.raw_call(seller_ed).add_transaction().unwrap();
        self.ctx
            .program(self.program_id)
            .call(instruction::SettleOffchainMatch {
                buyer_payload,
                seller_payload,
                match_amount,
                match_price,
                trade_id,
            })
            .accounts(accounts::SettleOffchainMatch {
                market: self.market,
                zone_market: self.zone_market,
                buyer_nullifier,
                seller_nullifier,
                currency_mint: self.currency_mint,
                energy_mint: self.energy_mint,
                market_authority: self.market_authority,
                token_program: spl_token_id(),
                secondary_token_program: spl_token_id(),
                buyer_currency_escrow: self.buyer_cur_escrow,
                seller_currency_escrow: self.seller_cur_escrow,
                seller_energy_escrow: self.seller_eng_escrow,
                buyer_energy_escrow: self.buyer_eng_escrow,
                fee_collector: self.fee_collector,
                wheeling_collector: self.wheeling_collector,
                loss_collector: self.loss_collector,
                market_shard: self.market_shard,
                zone_shard: self.zone_shard,
                payer: self.admin.pubkey(),
                sysvar_instructions: ix_sysvar_id(),
                system_program: system_program::ID,
                // Anchor's "None" sentinel for an optional account is the executing
                // program's own id — passing the trading program id makes both resolve
                // to None (no treasury recording on this generic-currency path).
                treasury_program: Some(self.program_id),
                treasury_state: Some(self.program_id),
            })
            .remaining_accounts_metas(remaining)
            .signers(&[&*self.admin])
            .add_transaction()
            .unwrap();

        let ok = self
            .ctx
            .send_batch()
            .map(|o| o.map(|x| x.is_success()).unwrap_or(false))
            .unwrap_or(false);

        if ok {
            if self.settled_seeds.contains(&seed) {
                // A replay of an already-committed trade_id succeeded → the per-match
                // TradeNullifier guard was bypassed. This must never happen.
                self.double_settle_detected = true;
            } else {
                self.settled_seeds.push(seed);
                self.expected_buyer_energy += match_amount;
            }
        }
        ok
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut SettleFixture) {
    // I1 — currency conservation across both escrows + the 3 collectors.
    let currency_now = fixture.tok(&fixture.buyer_cur_escrow)
        + fixture.tok(&fixture.seller_cur_escrow)
        + fixture.tok(&fixture.fee_collector)
        + fixture.tok(&fixture.wheeling_collector)
        + fixture.tok(&fixture.loss_collector);
    fuzz_assert_eq!(
        currency_now,
        fixture.currency_total,
        "currency conservation broken: {} != {}",
        currency_now,
        fixture.currency_total
    );

    // I2 — energy conservation across both energy escrows.
    let energy_now =
        fixture.tok(&fixture.seller_eng_escrow) + fixture.tok(&fixture.buyer_eng_escrow);
    fuzz_assert_eq!(
        energy_now,
        fixture.energy_total,
        "energy conservation broken: {} != {}",
        energy_now,
        fixture.energy_total
    );

    // I3 — buyer's received energy equals exactly the sum of first-time-settled matches.
    let buyer_energy = fixture.tok(&fixture.buyer_eng_escrow);
    fuzz_assert_eq!(
        buyer_energy,
        fixture.expected_buyer_energy,
        "buyer energy {} != Σ settled match_amount {}",
        buyer_energy,
        fixture.expected_buyer_energy
    );

    // I4 — the TradeNullifier double-settle guard was never bypassed.
    fuzz_assert!(
        !fixture.double_settle_detected,
        "double-settle succeeded: a replayed trade_id bypassed the TradeNullifier"
    );
}
