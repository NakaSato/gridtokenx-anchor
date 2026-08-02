//! Crucible invariant-fuzzing harness for `trading::batch_settle_offchain_match` — the
//! parallel-friendly BATCH settlement path (sibling of `settle_offchain_match`).
//!
//! Distinct code exercised vs the single-match harness: the batch loop, per-pair
//! `ensure_nullifier_initialized` (manual create, not `init_if_needed`), the SHARDED
//! fee/wheeling/loss collectors (`[b"fee_collector", currency_mint, &[settle_shard_id]]`),
//! and the accumulated `batch_total_value`. Each `action_batch_settle` submits a
//! single-match batch (the real single-tx cap — Ed25519-per-match data can't ALT-compress)
//! as `[ed25519(buyer)@0, ed25519(seller)@1, batch_settle@2]`, with a fuzzed
//! `settle_shard_id` routing to one of the 16 sharded collector sets.
//!
//! Invariants:
//!   I1  Currency conservation: buyer+seller currency escrows + ALL 16×3 sharded
//!       collectors sum to a constant (settle only MOVES currency between them).
//!   I2  Energy RETIREMENT: settle burns the seller's energy, so escrowed == funded - Σ
//!       burned AND the mint supply falls by exactly Σ burned (both halves required).
//!   I3  The buyer is never credited energy: their escrow stays 0. Load-bearing rather
//!       than vacuous — the batch context still CARRIES a buyer energy escrow (its
//!       remaining_accounts layout is fixed at 7 per match), present and writable.
//!   I4  Double-settle guard: re-settling an already-committed trade_id must FAIL
//!       (per-match TradeNullifier). A success trips `double_settle_detected`.

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
const NUM_SETTLE_SHARDS: u8 = 16; // treasury::NUM_SETTLE_SHARDS (collector shard count)
const INITIAL_SOL: u64 = 1_000_000_000_000;
const BUYER_PRICE: u64 = 60;
const SELLER_PRICE: u64 = 50;
const ORDER_ENERGY: u64 = 1_000_000_000_000_000;
const MATCH_MAX: u64 = 1_000_000_000_000;
const CURRENCY_FUND: u64 = 1_000_000_000_000_000;
const ENERGY_FUND: u64 = 1_000_000_000_000_000;
const CURRENCY_DECIMALS: u8 = 6;
const ENERGY_DECIMALS: u8 = 9;
const TOK_AMOUNT: usize = 64;
/// Mint-level supply the energy mint starts with. Must exceed everything the fuzzer can
/// burn (bounded by ENERGY_FUND, all of which sits in the seller's escrow), or the burn
/// underflows instead of failing an invariant.
const ENERGY_SUPPLY_SEED: u64 = ENERGY_FUND * 2;
/// classic spl_token Mint.supply offset: COption<Pubkey> mint_authority (4 + 32).
const MINT_SUPPLY: usize = 36;

const GOVERNANCE_ID: &str = "FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS";

fn spl_token_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}
fn ix_sysvar_id() -> Pubkey {
    Pubkey::from_str("Sysvar1nstructions1111111111111111111111111").unwrap()
}
fn ed25519_program_id() -> Pubkey {
    Pubkey::new_from_array([
        3, 125, 70, 214, 124, 147, 251, 190, 18, 249, 66, 143, 131, 141, 64, 255, 5, 112, 116, 73,
        39, 244, 138, 100, 252, 202, 112, 68, 128, 0, 0, 0,
    ])
}

fn id16(seed: u32, marker: u8) -> [u8; 16] {
    let mut b = [0u8; 16];
    b[0..4].copy_from_slice(&seed.to_le_bytes());
    b[15] = marker;
    b
}

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

fn ed25519_ix(signer: &Keypair, msg: &[u8]) -> Instruction {
    let sig = signer.sign_message(msg);
    let pk = signer.pubkey();
    let sig_off: u16 = 16;
    let pk_off: u16 = 16 + 64;
    let msg_off: u16 = 16 + 64 + 32;
    let cur: u16 = u16::MAX;
    let mut d: Vec<u8> = Vec::new();
    d.push(1);
    d.push(0);
    d.extend_from_slice(&sig_off.to_le_bytes());
    d.extend_from_slice(&cur.to_le_bytes());
    d.extend_from_slice(&pk_off.to_le_bytes());
    d.extend_from_slice(&cur.to_le_bytes());
    d.extend_from_slice(&msg_off.to_le_bytes());
    d.extend_from_slice(&(msg.len() as u16).to_le_bytes());
    d.extend_from_slice(&cur.to_le_bytes());
    d.extend_from_slice(sig.as_ref());
    d.extend_from_slice(pk.as_ref());
    d.extend_from_slice(msg);
    Instruction { program_id: ed25519_program_id(), accounts: vec![], data: d }
}

#[derive(Clone)]
struct BatchFixture {
    ctx: TestContext,
    program_id: Pubkey,
    admin: Rc<Keypair>,
    buyer: Rc<Keypair>,
    seller: Rc<Keypair>,
    currency_mint: Pubkey,
    energy_mint: Pubkey,
    market: Pubkey,
    zone_market: Pubkey,
    market_authority: Pubkey,
    market_shard: Pubkey,
    zone_shard: Pubkey,
    governance_config: Pubkey,
    tariff_config: Pubkey,
    aggregator_entry: Pubkey,
    buyer_cur_escrow: Pubkey,
    seller_cur_escrow: Pubkey,
    seller_eng_escrow: Pubkey,
    buyer_eng_escrow: Pubkey,
    // sharded collectors, index = settle_shard_id
    fee_collectors: Vec<Pubkey>,
    wheeling_collectors: Vec<Pubkey>,
    loss_collectors: Vec<Pubkey>,
    currency_total: u64,
    energy_total: u64,
    settled_seeds: Vec<u32>,
    expected_burned_energy: u64,
    double_settle_detected: bool,
}

#[fuzz_fixture]
impl BatchFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        // Register the Ed25519 precompile (crucible builds LiteSVM without it).
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
        let buyer = Rc::new(Keypair::new());
        let seller = Rc::new(Keypair::new());

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
            // Settlement BURNS this mint, and a burn decrements the mint's own supply
            // counter. The escrows below are forged by writing balances directly, which
            // never touches that counter — so a mint left at the builder's default 0 makes
            // the very first burn underflow (`Operation overflowed`, 0xe) even though the
            // escrow is full, and every generated batch would be rejected for a reason that
            // has nothing to do with the invariants. Assertions compare deltas.
            .supply(ENERGY_SUPPLY_SEED)
            .create()
            .unwrap();

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
        // Settlement refuses to burn energy until the market pins WHICH mint it may burn
        // (SettlementEnergyMintUnset). Without this every generated batch would be rejected
        // before reaching a single invariant — the harness would still run green while
        // fuzzing nothing at all.
        ctx.program(program_id)
            .call(instruction::SetSettlementEnergyMint { energy_mint })
            .accounts(accounts::SetSettlementEnergyMint {
                market,
                authority: admin.pubkey(),
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

        let escrow = |user: &Pubkey, mint: &Pubkey| {
            Pubkey::find_program_address(&[b"escrow", user.as_ref(), mint.as_ref()], &program_id).0
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

        // Sharded collectors: one fee/wheeling/loss triple per settle_shard_id.
        let sharded = |label: &[u8], sid: u8| {
            Pubkey::find_program_address(&[label, currency_mint.as_ref(), &[sid]], &program_id).0
        };
        let mut fee_collectors = Vec::new();
        let mut wheeling_collectors = Vec::new();
        let mut loss_collectors = Vec::new();
        for sid in 0..NUM_SETTLE_SHARDS {
            let f = sharded(b"fee_collector", sid);
            let w = sharded(b"wheeling_collector", sid);
            let l = sharded(b"loss_collector", sid);
            forge_tok(f, currency_mint, 0);
            forge_tok(w, currency_mint, 0);
            forge_tok(l, currency_mint, 0);
            fee_collectors.push(f);
            wheeling_collectors.push(w);
            loss_collectors.push(l);
        }

        // forged gate accounts
        let (governance_config, _) =
            Pubkey::find_program_address(&[b"governance_config"], &governance_id);
        ctx.create_account()
            .pubkey(governance_config)
            .lamports(10_000_000)
            .owner(governance_id)
            .data(&[0u8; 300])
            .create()
            .unwrap();
        let (tariff_config, _) = Pubkey::find_program_address(&[b"tariff_config"], &program_id);
        ctx.create_account()
            .pubkey(tariff_config)
            .lamports(10_000_000)
            .owner(program_id)
            .data(&[0u8; 100])
            .create()
            .unwrap();
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
            fee_collectors,
            wheeling_collectors,
            loss_collectors,
            currency_total: CURRENCY_FUND,
            energy_total: ENERGY_FUND,
            settled_seeds: Vec::new(),
            expected_burned_energy: 0,
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

    /// The mint's own supply counter. Settlement RETIRES energy, so this — not a debited
    /// escrow — is what distinguishes a burn from a transfer: a handler that quietly moved
    /// the tokens somewhere instead of destroying them would leave supply untouched.
    fn mint_supply(&self, pk: &Pubkey) -> u64 {
        match self.ctx.read_account(pk) {
            Ok(a) if a.data.len() >= MINT_SUPPLY + 8 => {
                u64::from_le_bytes(a.data[MINT_SUPPLY..MINT_SUPPLY + 8].try_into().unwrap())
            }
            _ => 0,
        }
    }

    /// Submit a single-match batch on `sid`'s sharded collectors. `seed` keys the order
    /// ids + trade_id so replays re-hit the same TradeNullifier (double-settle path).
    pub fn action_batch_settle(
        &mut self,
        seed: u32,
        amount: u64,
        price: u64,
        #[range(0..16)] sid: usize,
    ) -> bool {
        let match_amount = (amount % MATCH_MAX) + 1;
        let match_price = SELLER_PRICE + (price % (BUYER_PRICE - SELLER_PRICE + 1));
        if match_amount > self.tok(&self.seller_eng_escrow) {
            return false;
        }

        let buyer_oid = id16(seed, 0);
        let seller_oid = id16(seed, 1);
        let trade_id = id16(seed, 2);

        let buyer_msg =
            order_message(&buyer_oid, &self.buyer.pubkey(), ORDER_ENERGY, BUYER_PRICE, 0, ZONE, 0);
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
        let pair = types::BatchMatchPair {
            buyer_payload,
            seller_payload,
            match_amount,
            match_price,
            trade_id,
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

        // Per-pair layout (offset 0): buyer_null, seller_null, buyer_cur_esc, seller_cur_esc,
        // seller_eng_esc, buyer_eng_esc, trade_null — then gov_config, tariff, aggregator.
        let remaining = vec![
            AccountMeta::new(buyer_nullifier, false),
            AccountMeta::new(seller_nullifier, false),
            AccountMeta::new(self.buyer_cur_escrow, false),
            AccountMeta::new(self.seller_cur_escrow, false),
            AccountMeta::new(self.seller_eng_escrow, false),
            AccountMeta::new(self.buyer_eng_escrow, false),
            AccountMeta::new(trade_nullifier, false),
            AccountMeta::new_readonly(self.governance_config, false),
            AccountMeta::new_readonly(self.tariff_config, false),
            AccountMeta::new_readonly(self.aggregator_entry, false),
        ];

        self.ctx.raw_call(buyer_ed).add_transaction().unwrap();
        self.ctx.raw_call(seller_ed).add_transaction().unwrap();
        self.ctx
            .program(self.program_id)
            .call(instruction::BatchSettleOffchainMatch {
                matches: vec![pair],
                merkle_root: [0u8; 32],
                vat_amount: 0,
                vat_rate_bps: 0,
                batch_id: seed as u64,
                settle_shard_id: sid as u8,
            })
            .accounts(accounts::BatchSettleOffchainMatch {
                market: self.market,
                zone_market: self.zone_market,
                currency_mint: self.currency_mint,
                energy_mint: self.energy_mint,
                market_authority: self.market_authority,
                market_shard: self.market_shard,
                zone_shard: self.zone_shard,
                fee_collector: self.fee_collectors[sid],
                wheeling_collector: self.wheeling_collectors[sid],
                loss_collector: self.loss_collectors[sid],
                payer: self.admin.pubkey(),
                sysvar_instructions: ix_sysvar_id(),
                token_program: spl_token_id(),
                secondary_token_program: spl_token_id(),
                system_program: system_program::ID,
                // Anchor None sentinel = executing program id (no treasury recording).
                treasury_program: Some(self.program_id),
                treasury_state: Some(self.program_id),
                settlement_shard: Some(self.program_id),
                settlement_record: Some(self.program_id),
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
                self.double_settle_detected = true;
            } else {
                self.settled_seeds.push(seed);
                self.expected_burned_energy += match_amount;
            }
        }
        ok
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut BatchFixture) {
    // I1 — currency conservation: both escrows + every sharded collector.
    let mut currency_now = fixture.tok(&fixture.buyer_cur_escrow)
        + fixture.tok(&fixture.seller_cur_escrow);
    for i in 0..fixture.fee_collectors.len() {
        currency_now += fixture.tok(&fixture.fee_collectors[i])
            + fixture.tok(&fixture.wheeling_collectors[i])
            + fixture.tok(&fixture.loss_collectors[i]);
    }
    fuzz_assert_eq!(
        currency_now,
        fixture.currency_total,
        "currency conservation broken: {} != {}",
        currency_now,
        fixture.currency_total
    );

    // I2 — energy RETIREMENT, not conservation. The batch path burns the seller's energy
    // per match, so the escrows no longer sum to a constant. Both halves asserted: either
    // alone is satisfiable by a bug — a debited seller with no burn passes the escrow
    // check, a burn that skipped the escrow passes the supply check.
    let energy_now =
        fixture.tok(&fixture.seller_eng_escrow) + fixture.tok(&fixture.buyer_eng_escrow);
    let expected_escrowed = fixture.energy_total - fixture.expected_burned_energy;
    fuzz_assert_eq!(
        energy_now,
        expected_escrowed,
        "escrowed energy {} != funded {} - burned {}",
        energy_now,
        fixture.energy_total,
        fixture.expected_burned_energy
    );
    let supply_now = fixture.mint_supply(&fixture.energy_mint);
    let expected_supply = ENERGY_SUPPLY_SEED - fixture.expected_burned_energy;
    fuzz_assert_eq!(
        supply_now,
        expected_supply,
        "energy supply {} != seeded {} - burned {}",
        supply_now,
        ENERGY_SUPPLY_SEED,
        fixture.expected_burned_energy
    );

    // I3 — the buyer is never credited energy. The batch context still CARRIES a buyer
    // energy escrow (its remaining_accounts layout is fixed at 7 per match and every client
    // builds that list), which makes this assertion load-bearing rather than vacuous: the
    // account is present and writable, and must still end at 0.
    let buyer_energy = fixture.tok(&fixture.buyer_eng_escrow);
    fuzz_assert_eq!(
        buyer_energy,
        0,
        "buyer was credited {} energy — settlement must burn, not transfer",
        buyer_energy
    );

    // I4 — the per-match TradeNullifier double-settle guard was never bypassed.
    fuzz_assert!(
        !fixture.double_settle_detected,
        "double-settle succeeded: a replayed trade_id bypassed the TradeNullifier"
    );
}
