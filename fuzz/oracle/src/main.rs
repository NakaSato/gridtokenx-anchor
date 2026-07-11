//! Crucible invariant-fuzzing harness for the `oracle` program.
//!
//! Focus: the per-meter MeterState PDA accumulators (Sealevel parallel design) and
//! the monotonic timestamp / epoch state machine. Chain-bridge signer authorizes the
//! node-facing instructions, so no governance `aggregator_entry` is needed (the auth
//! helper short-circuits on `signer == chain_bridge`).
//!
//! Invariants (see invariant_test):
//!   I1  per-meter accumulation: MeterState.total_energy_{produced,consumed} == the
//!       fixture's running sum of accepted readings for that meter; total_readings ==
//!       accepted count. Verifies the saturating_add accumulator + PDA isolation
//!       (no cross-meter contamination).
//!   I2  reading monotonicity: MeterState.last_reading_timestamp == the last accepted
//!       reading's timestamp (the program rejects non-increasing timestamps).
//!   I3  epoch monotonicity: OracleData.last_cleared_epoch == the last accepted epoch,
//!       and only ever advances (900-second boundaries, > previous, <= now).

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::rc::Rc;
use std::str::FromStr;

crucible_idl_gen::declare_fuzz_program!("idls/oracle.json");

use oracle::{accounts, instruction, state};

const N_METERS: usize = 4;
const INITIAL_SOL: u64 = 1_000_000_000_000;

// OracleData raw offsets (8-byte anchor discriminator + struct offset).
const OD_CREATED_AT: usize = 8 + 88;
const OD_LAST_CLEARED_EPOCH: usize = 8 + 152;

#[derive(Clone)]
struct Meter {
    id: String,
    pda: Pubkey,
    sum_prod: u64,
    sum_cons: u64,
    count: u64,
    last_ts: i64,
}

#[derive(Clone)]
struct OracleFixture {
    ctx: TestContext,
    program_id: Pubkey,
    admin: Rc<Keypair>, // oracle authority AND chain_bridge (single key)
    oracle_data: Pubkey,
    meters: Vec<Meter>,
    ts_base: i64,     // OracleData.created_at (≈ now)
    ts_next: i64,     // next reading timestamp (strictly increasing, +61 each submit)
    epoch_next: i64,  // next epoch to clear (900-aligned, ascending)
    last_epoch: i64,  // last successfully cleared epoch
}

fn rent_sysvar() -> Pubkey {
    Pubkey::from_str("SysvarRent111111111111111111111111111111111").unwrap()
}
fn align900(x: i64) -> i64 {
    (x / 900) * 900
}

#[fuzz_fixture]
impl OracleFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        let program_id = Pubkey::new_from_array(oracle::ID.to_bytes());
        ctx.add_program(&program_id, "../../target/deploy/oracle.so")
            .unwrap();

        let admin = Rc::new(Keypair::new());
        ctx.create_account()
            .pubkey(admin.pubkey())
            .lamports(INITIAL_SOL)
            .owner(system_program::ID)
            .create()
            .unwrap();

        let (oracle_data, _) = Pubkey::find_program_address(&[b"oracle_data"], &program_id);

        // initialize: authority = admin, chain_bridge = admin (so admin signs everything)
        ctx.program(program_id)
            .call(instruction::Initialize { chain_bridge: admin.pubkey() })
            .accounts(accounts::Initialize {
                oracle_data,
                authority: admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        let mut meters = Vec::new();
        for i in 0..N_METERS {
            let id = format!("meter{}", i);
            let (pda, _) = Pubkey::find_program_address(&[b"meter", id.as_bytes()], &program_id);
            meters.push(Meter { id, pda, sum_prod: 0, sum_cons: 0, count: 0, last_ts: 0 });
        }

        // read created_at (≈ now) to build valid, strictly-increasing reading/epoch timestamps
        let ts_base = read_i64(&ctx, &oracle_data, OD_CREATED_AT);
        // start readings well below `now` so every ts <= now+60; +61 steps clear the 60s rate limit
        let ts_next = ts_base - 500_000;
        let epoch_next = align900(ts_base - 100_000);

        Self {
            ctx,
            program_id,
            admin,
            oracle_data,
            meters,
            ts_base,
            ts_next,
            epoch_next,
            last_epoch: 0,
        }
    }

    // ---- actions ----

    pub fn action_submit(
        &mut self,
        #[range(0..4)] midx: usize,
        produced: u64,
        consumed: u64,
    ) -> bool {
        let ts = self.ts_next;
        self.ts_next += 61;
        let m = &self.meters[midx];
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::SubmitMeterReading {
                meter_id: m.id.clone(),
                energy_produced: produced,
                energy_consumed: consumed,
                reading_timestamp: ts,
                zone_id: 0,
            })
            .accounts(accounts::SubmitMeterReading {
                oracle_data: self.oracle_data,
                meter_state: m.pda,
                authority: self.admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            let m = &mut self.meters[midx];
            m.sum_prod = m.sum_prod.saturating_add(produced);
            m.sum_cons = m.sum_cons.saturating_add(consumed);
            m.count += 1;
            m.last_ts = ts;
        }
        ok
    }

    pub fn action_clear(&mut self) -> bool {
        let epoch = self.epoch_next;
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::TriggerMarketClearing { epoch_timestamp: epoch })
            .accounts(accounts::TriggerMarketClearing {
                oracle_data: self.oracle_data,
                authority: self.admin.pubkey(),
                aggregator_entry: None,
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.last_epoch = epoch;
            self.epoch_next += 900;
        }
        ok
    }

    pub fn action_set_validation(
        &mut self,
        min_energy: u64,
        max_energy: u64,
        anomaly: bool,
    ) -> bool {
        self.ctx
            .program(self.program_id)
            .call(instruction::UpdateValidationConfig {
                min_energy_value: min_energy,
                max_energy_value: max_energy,
                anomaly_detection_enabled: anomaly,
            })
            .accounts(accounts::UpdateValidationConfig {
                oracle_data: self.oracle_data,
                authority: self.admin.pubkey(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_aggregate(
        &mut self,
        produced: u64,
        consumed: u64,
        valid: u64,
        rejected: u64,
    ) -> bool {
        self.ctx
            .program(self.program_id)
            .call(instruction::AggregateReadings {
                total_produced: produced,
                total_consumed: consumed,
                valid_count: valid,
                rejected_count: rejected,
            })
            .accounts(accounts::AggregateReadings {
                oracle_data: self.oracle_data,
                authority: self.admin.pubkey(),
                aggregator_entry: None,
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }
}

fn read_i64(ctx: &TestContext, pk: &Pubkey, off: usize) -> i64 {
    match ctx.read_account(pk) {
        Ok(a) if a.data.len() >= off + 8 => i64::from_le_bytes(a.data[off..off + 8].try_into().unwrap()),
        _ => 0,
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut OracleFixture) {
    for m in &fixture.meters {
        let ms = match fixture.ctx.read_anchor_account::<state::MeterState>(&m.pda) {
            Ok(s) => s,
            Err(_) => continue, // meter not yet created (no accepted reading)
        };

        // I1 — per-meter accumulation exactly tracks accepted readings.
        fuzz_assert_eq!(
            ms.total_energy_produced,
            m.sum_prod,
            "meter {} total_produced {} != expected {}",
            m.id,
            ms.total_energy_produced,
            m.sum_prod
        );
        fuzz_assert_eq!(
            ms.total_energy_consumed,
            m.sum_cons,
            "meter {} total_consumed {} != expected {}",
            m.id,
            ms.total_energy_consumed,
            m.sum_cons
        );
        fuzz_assert_eq!(
            ms.total_readings,
            m.count,
            "meter {} total_readings {} != expected {}",
            m.id,
            ms.total_readings,
            m.count
        );

        // I2 — last reading timestamp matches the last accepted submission.
        if m.count > 0 {
            fuzz_assert_eq!(
                ms.last_reading_timestamp,
                m.last_ts,
                "meter {} last_ts {} != expected {}",
                m.id,
                ms.last_reading_timestamp,
                m.last_ts
            );
        }
    }

    // I3 — epoch monotonicity: on-chain last_cleared_epoch tracks the last accepted epoch.
    let onchain_epoch = read_i64(&fixture.ctx, &fixture.oracle_data, OD_LAST_CLEARED_EPOCH);
    fuzz_assert_eq!(
        onchain_epoch,
        fixture.last_epoch,
        "last_cleared_epoch {} != expected {}",
        onchain_epoch,
        fixture.last_epoch
    );
}
