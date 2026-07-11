//! Crucible invariant-fuzzing harness for the `governance` program.
//!
//! Focus: the 2-step authority-transfer state machine and the PoA aggregator
//! allow-list. Authority rotates only among keypairs the harness controls, so it
//! can always sign as whoever is currently authority.
//!
//! Invariants:
//!   I1  on-chain authority == the harness's tracked current authority (changes
//!       ONLY via a completed approve).
//!   I2  on-chain pending_authority == the tracked pending (default when none) —
//!       set by propose, cleared by approve/cancel; never approvable without a
//!       matching pending, never transferable to self.
//!   I3  each aggregator's AggregatorEntry.active tracks admit(true)/revoke(false)
//!       and its .aggregator matches the admitted key.

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::rc::Rc;

crucible_idl_gen::declare_fuzz_program!("idls/governance.json");

use governance::{accounts, instruction, state};

const N_CAND: usize = 3; // candidate authority keypairs
const N_AGG: usize = 3; // aggregator keys
const INITIAL_SOL: u64 = 1_000_000_000_000;

#[derive(Clone)]
struct GovFixture {
    ctx: TestContext,
    program_id: Pubkey,
    cands: Vec<Rc<Keypair>>,
    gov_config: Pubkey,
    agg_keys: Vec<Pubkey>,
    agg_entries: Vec<Pubkey>,
    authority_idx: usize,
    pending_idx: Option<usize>,
    agg_active: Vec<bool>,
    agg_admitted_once: Vec<bool>,
}

#[fuzz_fixture]
impl GovFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        let program_id = Pubkey::new_from_array(governance::ID.to_bytes());
        ctx.add_program(&program_id, "../../target/deploy/governance.so")
            .unwrap();

        let mut cands = Vec::new();
        for _ in 0..N_CAND {
            let kp = Rc::new(Keypair::new());
            ctx.create_account()
                .pubkey(kp.pubkey())
                .lamports(INITIAL_SOL)
                .owner(system_program::ID)
                .create()
                .unwrap();
            cands.push(kp);
        }

        let (gov_config, _) = Pubkey::find_program_address(&[b"governance_config"], &program_id);

        // initialize_governance — authority = cands[0]
        ctx.program(program_id)
            .call(instruction::InitializeGovernance {})
            .accounts(accounts::InitializeGovernance {
                governance_config: gov_config,
                authority: cands[0].pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*cands[0]])
            .send()
            .unwrap();

        let mut agg_keys = Vec::new();
        let mut agg_entries = Vec::new();
        for _ in 0..N_AGG {
            let k = Keypair::new().pubkey();
            let (entry, _) = Pubkey::find_program_address(&[b"aggregator", k.as_ref()], &program_id);
            agg_keys.push(k);
            agg_entries.push(entry);
        }

        Self {
            ctx,
            program_id,
            cands,
            gov_config,
            agg_keys,
            agg_entries,
            authority_idx: 0,
            pending_idx: None,
            agg_active: vec![false; N_AGG],
            agg_admitted_once: vec![false; N_AGG],
        }
    }

    fn cur_kp(&self) -> Rc<Keypair> {
        self.cands[self.authority_idx].clone()
    }

    // ---- authority 2-step ----

    pub fn action_propose(&mut self, #[range(0..3)] target: usize) -> bool {
        let new_auth = self.cands[target].pubkey();
        let cur = self.cur_kp();
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::ProposeAuthorityChange { new_authority: new_auth })
            .accounts(accounts::ProposeAuthorityChange {
                governance_config: self.gov_config,
                authority: cur.pubkey(),
            })
            .signers(&[&*cur])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.pending_idx = Some(target);
        }
        ok
    }

    pub fn action_approve(&mut self) -> bool {
        let signer_idx = self.pending_idx.unwrap_or(0);
        let signer = self.cands[signer_idx].clone();
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::ApproveAuthorityChange {})
            .accounts(accounts::ApproveAuthorityChange {
                governance_config: self.gov_config,
                new_authority: signer.pubkey(),
            })
            .signers(&[&*signer])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            if let Some(p) = self.pending_idx {
                self.authority_idx = p;
            }
            self.pending_idx = None;
        }
        ok
    }

    pub fn action_cancel(&mut self) -> bool {
        let cur = self.cur_kp();
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::CancelAuthorityChange {})
            .accounts(accounts::CancelAuthorityChange {
                governance_config: self.gov_config,
                authority: cur.pubkey(),
            })
            .signers(&[&*cur])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.pending_idx = None;
        }
        ok
    }

    // ---- aggregator allow-list ----

    pub fn action_admit(&mut self, #[range(0..3)] aidx: usize, #[range(0..2)] segment: u8) -> bool {
        let cur = self.cur_kp();
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::AdmitAggregator {
                aggregator: self.agg_keys[aidx],
                segment,
            })
            .accounts(accounts::AdmitAggregator {
                governance_config: self.gov_config,
                aggregator_entry: self.agg_entries[aidx],
                authority: cur.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*cur])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.agg_active[aidx] = true;
            self.agg_admitted_once[aidx] = true;
        }
        ok
    }

    pub fn action_revoke(&mut self, #[range(0..3)] aidx: usize) -> bool {
        let cur = self.cur_kp();
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::RevokeAggregator {})
            .accounts(accounts::RevokeAggregator {
                governance_config: self.gov_config,
                aggregator_entry: self.agg_entries[aidx],
                authority: cur.pubkey(),
            })
            .signers(&[&*cur])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.agg_active[aidx] = false;
        }
        ok
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut GovFixture) {
    let cfg = fixture
        .ctx
        .read_anchor_account::<state::GovernanceConfig>(&fixture.gov_config)
        .expect("governance_config must exist");

    // I1 — authority tracks the completed transfers.
    let want_auth = fixture.cands[fixture.authority_idx].pubkey();
    fuzz_assert_eq!(
        cfg.authority.to_bytes(),
        want_auth.to_bytes(),
        "authority mismatch"
    );

    // I2 — pending_authority tracks propose/approve/cancel.
    let want_pending = match fixture.pending_idx {
        Some(p) => fixture.cands[p].pubkey().to_bytes(),
        None => [0u8; 32],
    };
    fuzz_assert_eq!(
        cfg.pending_authority.to_bytes(),
        want_pending,
        "pending_authority mismatch"
    );

    // I3 — each admitted aggregator entry matches its tracked active flag.
    for i in 0..N_AGG {
        if !fixture.agg_admitted_once[i] {
            continue;
        }
        let entry = fixture
            .ctx
            .read_anchor_account::<state::AggregatorEntry>(&fixture.agg_entries[i])
            .expect("admitted aggregator entry must exist");
        fuzz_assert_eq!(
            entry.aggregator.to_bytes(),
            fixture.agg_keys[i].to_bytes(),
            "aggregator key mismatch"
        );
        let active = entry.active;
        fuzz_assert_eq!(
            active,
            fixture.agg_active[i],
            "aggregator {} active {} != expected {}",
            i,
            active,
            fixture.agg_active[i]
        );
    }
}
