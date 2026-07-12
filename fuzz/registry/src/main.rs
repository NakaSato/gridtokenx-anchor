//! Crucible invariant-fuzzing harness for the `registry` program.
//!
//! Focus: the 16-shard distributed counters and the validator GRX bond vault.
//! Drives random register/stake sequences and asserts:
//!   I1  Σ shard.user_count  == number of successful register_user calls.
//!   I2  Σ shard.meter_count == number of successful register_meter calls.
//!   I3  global registry counters never exceed the shard truth (stale-but-safe);
//!       after aggregate_shards they equal it.
//!   I4  bond conservation: grx_vault balance == Σ UserAccount.staked_grx.
//!   I5  GRX conservation: Σ user GRX ATAs + grx_vault == genesis total.
//!
//! Skipped (need external `aggregator_entry` gate / energy-token CPI): validator
//! registration, slashing, claim_airdrop, settle_and_mint.
//!
//! State is read by raw byte offset (not IDL-gen Pod cast) to stay robust against
//! zero-copy enum-repr differences in generated types.

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::rc::Rc;
use std::str::FromStr;

crucible_idl_gen::declare_fuzz_program!("idls/registry.json");

use registry::{accounts, instruction, types};

const N_USERS: usize = 3;
const N_SHARDS: u8 = 16;
const INITIAL_SOL: u64 = 100_000_000_000;
const USER_GRX: u64 = 1_000_000_000_000_000; // 1e6 GRX (9 dec)
const GRX_DECIMALS: u8 = 9;

// ---- on-chain layout offsets (struct offset + 8-byte anchor discriminator) ----
const REG_USER_COUNT: usize = 8 + 72;
const REG_METER_COUNT: usize = 8 + 80;
const SHARD_USER_COUNT: usize = 8 + 8;
const SHARD_METER_COUNT: usize = 8 + 16;
const USER_STAKED_GRX: usize = 8 + 80;
const TOK_AMOUNT: usize = 64; // classic spl_token Account.amount

const MIN_VALIDATOR_STAKE: u64 = 10_000_000_000_000; // 10,000 GRX

const ORACLE_ID: &str = "64Vgos61STZ8pW9NnHi2iGtXMTQr7NqBoMorK6Zg8RJU";
const READER_METER_ID: &str = "rdr"; // dedicated meter for the update_meter_reading path
const ORACLE_CAP: u64 = 5_000_000_000; // forged oracle total (gen+cons upper bound)
// MeterAccount offsets in account.data (8-byte disc + struct): status@73,
// last_reading_at@[88..96], total_generation@[96..104], total_consumption@[104..112].
const METER_TOTAL_GEN: usize = 96;
const METER_TOTAL_CONS: usize = 104;

#[derive(Clone)]
struct UserAcct {
    kp: Rc<Keypair>,
    grx_ata: Pubkey,
    user_pda: Pubkey,
    agg_entry: Pubkey, // forged governance AggregatorEntry PDA (PoA gate)
    shard_id: u8,
    registered: bool,
    meters: u32,
}

#[derive(Clone)]
struct RegistryFixture {
    ctx: TestContext,
    program_id: Pubkey,
    admin: Rc<Keypair>,
    registry_pda: Pubkey,
    grx_vault: Pubkey,
    grx_mint: Pubkey,
    slash_dest: Pubkey, // GRX token account: slashed-bond fund remainder
    victim: Pubkey,     // GRX token account: victim compensation sink
    shards: Vec<Pubkey>, // index = shard_id
    users: Vec<UserAcct>,
    n_users_registered: u64,
    n_meters_registered: u64,
    grx_total: u64,
    // --- update_meter_reading path (dedicated Active reader meter) ---
    reader_kp: Rc<Keypair>,
    reader_meter: Pubkey,
    oracle_meter_state: Pubkey, // forged oracle MeterState, caps registry totals
    exp_gen: u64,               // Σ accepted energy_generated == reader_meter.total_generation
    exp_cons: u64,              // Σ accepted energy_consumed  == reader_meter.total_consumption
    reader_last_ts: i64,        // mirror of last_reading_at (monotonic + rate-limit)
}

fn spl_token_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}
fn governance_program_id() -> Pubkey {
    Pubkey::from_str("FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS").unwrap()
}
fn rent_sysvar() -> Pubkey {
    Pubkey::from_str("SysvarRent111111111111111111111111111111111").unwrap()
}
fn shard_for(pk: &Pubkey) -> u8 {
    pk.to_bytes()[0] % N_SHARDS
}

#[fuzz_fixture]
impl RegistryFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        let program_id = Pubkey::new_from_array(registry::ID.to_bytes());
        ctx.add_program(&program_id, "../../target/deploy/registry.so")
            .unwrap();
        let token_program = spl_token_id();

        let admin = Rc::new(Keypair::new());
        ctx.create_account()
            .pubkey(admin.pubkey())
            .lamports(INITIAL_SOL)
            .owner(system_program::ID)
            .create()
            .unwrap();

        let grx_mint_kp = Keypair::new();
        let grx_mint = ctx
            .create_mint()
            .pubkey(grx_mint_kp.pubkey())
            .mint_authority(admin.pubkey())
            .decimals(GRX_DECIMALS)
            .create()
            .unwrap();

        let (registry_pda, _) = Pubkey::find_program_address(&[b"registry"], &program_id);
        let (grx_vault, _) = Pubkey::find_program_address(&[b"grx_vault"], &program_id);

        // initialize registry
        ctx.program(program_id)
            .call(instruction::Initialize {})
            .accounts(accounts::Initialize {
                registry: registry_pda,
                authority: admin.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // initialize all 16 shards
        let mut shards = Vec::new();
        for sid in 0..N_SHARDS {
            let (shard, _) =
                Pubkey::find_program_address(&[b"registry_shard", &[sid]], &program_id);
            ctx.program(program_id)
                .call(instruction::InitializeShard { shard_id: sid })
                .accounts(accounts::InitializeShard {
                    shard,
                    authority: admin.pubkey(),
                    system_program: system_program::ID,
                })
                .signers(&[&*admin])
                .send()
                .unwrap();
            shards.push(shard);
        }

        // initialize the GRX staking vault (authority = registry PDA)
        ctx.program(program_id)
            .call(instruction::InitializeVault {})
            .accounts(accounts::InitializeVault {
                registry: registry_pda,
                grx_vault,
                grx_mint,
                authority: admin.pubkey(),
                token_program,
                system_program: system_program::ID,
                rent: rent_sysvar(),
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // GRX sinks for slashing: fund remainder + victim compensation (start empty).
        let slash_dest = Keypair::new().pubkey();
        ctx.create_token_account()
            .pubkey(slash_dest)
            .mint(grx_mint)
            .token_owner(admin.pubkey())
            .amount(0)
            .create()
            .unwrap();
        let victim = Keypair::new().pubkey();
        ctx.create_token_account()
            .pubkey(victim)
            .mint(grx_mint)
            .token_owner(admin.pubkey())
            .amount(0)
            .create()
            .unwrap();

        // Point the registry's slash destination at slash_dest (required before any slash).
        ctx.program(program_id)
            .call(instruction::SetSlashDestination { destination: slash_dest })
            .accounts(accounts::SetSlashDestination {
                registry: registry_pda,
                authority: admin.pubkey(),
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // users: SOL + pre-funded GRX ATA + forged governance AggregatorEntry (PoA gate)
        let mut users = Vec::new();
        let mut grx_total = 0u64;
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
            let (user_pda, _) =
                Pubkey::find_program_address(&[b"user", kp.pubkey().as_ref()], &program_id);

            // Forge the governance AggregatorEntry admitting this user as an aggregator.
            // Layout read by register_validator: owner==governance, PDA=[b"aggregator",user],
            // data[8..40]=user, data[56]=1 (active), len>=57.
            let (agg_entry, _) = Pubkey::find_program_address(
                &[b"aggregator", kp.pubkey().as_ref()],
                &governance_program_id(),
            );
            let mut agg_data = vec![0u8; 58];
            agg_data[8..40].copy_from_slice(&kp.pubkey().to_bytes());
            agg_data[56] = 1; // active
            ctx.create_account()
                .pubkey(agg_entry)
                .lamports(1_000_000_000)
                .owner(governance_program_id())
                .data(&agg_data)
                .create()
                .unwrap();

            let shard_id = shard_for(&kp.pubkey());
            users.push(UserAcct {
                kp,
                grx_ata,
                user_pda,
                agg_entry,
                shard_id,
                registered: false,
                meters: 0,
            });
        }

        // --- update_meter_reading setup: oracle authority + a dedicated Active meter ---
        // Point the registry oracle authority at admin (gates update_meter_reading).
        let oracle_id = Pubkey::from_str(ORACLE_ID).unwrap();
        ctx.program(program_id)
            .call(instruction::SetOracleAuthority { oracle: admin.pubkey() })
            .accounts(accounts::SetOracleAuthority {
                registry: registry_pda,
                authority: admin.pubkey(),
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // Dedicated reader user (registered) + reader meter (Active) with a fixed id.
        let reader_kp = Rc::new(Keypair::new());
        ctx.create_account()
            .pubkey(reader_kp.pubkey())
            .lamports(INITIAL_SOL)
            .owner(system_program::ID)
            .create()
            .unwrap();
        let reader_shard = shard_for(&reader_kp.pubkey());
        let (reader_user_pda, _) =
            Pubkey::find_program_address(&[b"user", reader_kp.pubkey().as_ref()], &program_id);
        ctx.program(program_id)
            .call(instruction::RegisterUser {
                user_type: types::UserType::Prosumer,
                lat_e7: 0,
                long_e7: 0,
                h3_index: 0,
                shard_id: reader_shard,
            })
            .accounts(accounts::RegisterUser {
                user_account: reader_user_pda,
                registry_shard: shards[reader_shard as usize],
                registry: registry_pda,
                authority: reader_kp.pubkey(),
                payer: reader_kp.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*reader_kp])
            .send()
            .unwrap();
        let (reader_meter, _) = Pubkey::find_program_address(
            &[b"meter", reader_kp.pubkey().as_ref(), READER_METER_ID.as_bytes()],
            &program_id,
        );
        ctx.program(program_id)
            .call(instruction::RegisterMeter {
                meter_id: READER_METER_ID.to_string(),
                meter_type: types::MeterType::Solar,
                shard_id: reader_shard,
                zone_id: 0,
            })
            .accounts(accounts::RegisterMeter {
                meter_account: reader_meter,
                user_account: reader_user_pda,
                registry_shard: shards[reader_shard as usize],
                registry: registry_pda,
                owner: reader_kp.pubkey(),
                payer: reader_kp.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*reader_kp])
            .send()
            .unwrap();

        // Forge the oracle MeterState [b"meter", meter_id] at ORACLE_ID. update_meter_reading
        // raw-reads total_energy_produced@62 / total_energy_consumed@70 (borsh, no disc check)
        // and requires the registry cumulative totals stay <= these — the anti-inflation bound.
        let (oracle_meter_state, _) =
            Pubkey::find_program_address(&[b"meter", READER_METER_ID.as_bytes()], &oracle_id);
        let mut oms = vec![0u8; 80];
        oms[62..70].copy_from_slice(&ORACLE_CAP.to_le_bytes());
        oms[70..78].copy_from_slice(&ORACLE_CAP.to_le_bytes());
        ctx.create_account()
            .pubkey(oracle_meter_state)
            .lamports(5_000_000)
            .owner(oracle_id)
            .data(&oms)
            .create()
            .unwrap();

        Self {
            ctx,
            program_id,
            admin,
            registry_pda,
            grx_vault,
            grx_mint,
            slash_dest,
            victim,
            shards,
            users,
            // Start at 1 each: the dedicated reader user + meter are registered in setup,
            // so they already count toward the shard user/meter counters (I1/I2).
            n_users_registered: 1,
            n_meters_registered: 1,
            grx_total,
            reader_kp,
            reader_meter,
            oracle_meter_state,
            exp_gen: 0,
            exp_cons: 0,
            reader_last_ts: 0,
        }
    }

    // ---- raw readers ----
    fn read_u64(&self, pk: &Pubkey, off: usize) -> u64 {
        match self.ctx.read_account(pk) {
            Ok(a) if a.data.len() >= off + 8 => {
                u64::from_le_bytes(a.data[off..off + 8].try_into().unwrap())
            }
            _ => 0,
        }
    }

    fn sum_shard(&self, off: usize) -> u64 {
        self.shards.iter().map(|s| self.read_u64(s, off)).sum()
    }

    // ---- actions ----

    pub fn action_register_user(&mut self, #[range(0..3)] uidx: usize) -> bool {
        let u = &self.users[uidx];
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::RegisterUser {
                user_type: types::UserType::Prosumer,
                lat_e7: 0,
                long_e7: 0,
                h3_index: 0,
                shard_id: u.shard_id,
            })
            .accounts(accounts::RegisterUser {
                user_account: u.user_pda,
                registry_shard: self.shards[u.shard_id as usize],
                registry: self.registry_pda,
                authority: u.kp.pubkey(),
                payer: u.kp.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok && !self.users[uidx].registered {
            self.users[uidx].registered = true;
            self.n_users_registered += 1;
        }
        ok
    }

    pub fn action_register_meter(&mut self, #[range(0..3)] uidx: usize, seed: u32) -> bool {
        let u = &self.users[uidx];
        if !u.registered {
            return false;
        }
        let meter_id = format!("m{}-{}", uidx, seed);
        let (meter_account, _) = Pubkey::find_program_address(
            &[b"meter", u.kp.pubkey().as_ref(), meter_id.as_bytes()],
            &self.program_id,
        );
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::RegisterMeter {
                meter_id,
                meter_type: types::MeterType::Solar,
                shard_id: u.shard_id,
                zone_id: 0,
            })
            .accounts(accounts::RegisterMeter {
                meter_account,
                user_account: u.user_pda,
                registry_shard: self.shards[u.shard_id as usize],
                registry: self.registry_pda,
                owner: u.kp.pubkey(),
                payer: u.kp.pubkey(),
                system_program: system_program::ID,
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.users[uidx].meters += 1;
            self.n_meters_registered += 1;
        }
        ok
    }

    /// Push a meter reading (oracle-authority gated). Timestamps advance monotonically
    /// past the 60s rate-limit. The registry's cumulative totals are bounded by the forged
    /// oracle totals (ORACLE_CAP) — a reading that would exceed them is rejected
    /// (OracleTotalMismatch, atomic → no partial write), so the mirror stays exact.
    pub fn action_update_reading(&mut self, gen: u64, cons: u64) -> bool {
        let g = gen % 1_000_000_000; // <= MAX_READING_DELTA (1e12); small enough to fit under cap
        let c = cons % 1_000_000_000;
        let ts = self.reader_last_ts + 61; // > last AND >= last + 60
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::UpdateMeterReading {
                energy_generated: g,
                energy_consumed: c,
                reading_timestamp: ts,
            })
            .accounts(accounts::UpdateMeterReading {
                registry: self.registry_pda,
                meter_account: self.reader_meter,
                oracle_meter_state: self.oracle_meter_state,
                oracle_authority: self.admin.pubkey(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.exp_gen += g;
            self.exp_cons += c;
            self.reader_last_ts = ts;
        }
        ok
    }

    pub fn action_stake(&mut self, #[range(0..3)] uidx: usize, amount: u64) -> bool {
        let u = &self.users[uidx];
        if !u.registered {
            return false;
        }
        let bal = self.read_u64(&u.grx_ata, TOK_AMOUNT);
        if bal == 0 {
            return false;
        }
        let amt = (amount % bal).max(1);
        self.ctx
            .program(self.program_id)
            .call(instruction::StakeGrx { amount: amt })
            .accounts(accounts::StakeGrx {
                user_account: u.user_pda,
                grx_vault: self.grx_vault,
                registry: self.registry_pda,
                user_grx_ata: u.grx_ata,
                grx_mint: self.grx_mint,
                authority: u.kp.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_unstake(&mut self, #[range(0..3)] uidx: usize, amount: u64) -> bool {
        let u = &self.users[uidx];
        if !u.registered {
            return false;
        }
        let staked = self.read_u64(&u.user_pda, USER_STAKED_GRX);
        if staked == 0 {
            return false;
        }
        let amt = (amount % staked).max(1);
        self.ctx
            .program(self.program_id)
            .call(instruction::UnstakeGrx { amount: amt })
            .accounts(accounts::UnstakeGrx {
                user_account: u.user_pda,
                grx_vault: self.grx_vault,
                registry: self.registry_pda,
                user_grx_ata: u.grx_ata,
                grx_mint: self.grx_mint,
                authority: u.kp.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_update_status(&mut self, #[range(0..3)] uidx: usize, #[range(0..3)] st: u8) -> bool {
        let u = &self.users[uidx];
        if !u.registered {
            return false;
        }
        let status = match st {
            0 => types::UserStatus::Active,
            1 => types::UserStatus::Suspended,
            _ => types::UserStatus::Inactive,
        };
        self.ctx
            .program(self.program_id)
            .call(instruction::UpdateUserStatus { new_status: status })
            .accounts(accounts::UpdateUserStatus {
                registry: self.registry_pda,
                user_account: u.user_pda,
                authority: self.admin.pubkey(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_aggregate(&mut self) -> bool {
        let shards = self.shards.clone();
        self.ctx
            .program(self.program_id)
            .call(instruction::AggregateShards {})
            .accounts(accounts::AggregateShards {
                registry: self.registry_pda,
                authority: self.admin.pubkey(),
            })
            .remaining_accounts(shards)
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    /// Stake enough to clear MIN_VALIDATOR_STAKE so the user can register as validator.
    pub fn action_stake_min(&mut self, #[range(0..3)] uidx: usize) -> bool {
        let u = self.users[uidx].clone();
        if !u.registered {
            return false;
        }
        let bal = self.read_u64(&u.grx_ata, TOK_AMOUNT);
        let amt = (MIN_VALIDATOR_STAKE + MIN_VALIDATOR_STAKE / 10).min(bal);
        if amt == 0 {
            return false;
        }
        self.ctx
            .program(self.program_id)
            .call(instruction::StakeGrx { amount: amt })
            .accounts(accounts::StakeGrx {
                user_account: u.user_pda,
                grx_vault: self.grx_vault,
                registry: self.registry_pda,
                user_grx_ata: u.grx_ata,
                grx_mint: self.grx_mint,
                authority: u.kp.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_register_validator(&mut self, #[range(0..3)] uidx: usize) -> bool {
        let u = self.users[uidx].clone();
        if !u.registered {
            return false;
        }
        self.ctx
            .program(self.program_id)
            .call(instruction::RegisterValidator {})
            .accounts(accounts::RegisterValidator {
                user_account: u.user_pda,
                aggregator_entry: u.agg_entry,
                authority: u.kp.pubkey(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_deregister_validator(&mut self, #[range(0..3)] uidx: usize) -> bool {
        let u = self.users[uidx].clone();
        if !u.registered {
            return false;
        }
        self.ctx
            .program(self.program_id)
            .call(instruction::DeregisterValidator {})
            .accounts(accounts::DeregisterValidator {
                user_account: u.user_pda,
                authority: u.kp.pubkey(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    /// Slash a validator (admin only). Splits bond into victim compensation + fund
    /// remainder, both drawn from grx_vault — GRX conservation (I5) covers both sinks;
    /// bond conservation (I4) holds since grx_vault and staked_grx drop by the same amount.
    pub fn action_slash(
        &mut self,
        #[range(0..3)] uidx: usize,
        #[range(1..10_001)] slash_bps: u16,
        proven_loss: u64,
    ) -> bool {
        let u = self.users[uidx].clone();
        self.ctx
            .program(self.program_id)
            .call(instruction::SlashValidator { slash_bps, proven_loss })
            .accounts(accounts::SlashValidator {
                target_authority: u.kp.pubkey(),
                target_user_account: u.user_pda,
                grx_vault: self.grx_vault,
                registry: self.registry_pda,
                slash_destination: self.slash_dest,
                victim_token_account: self.victim,
                grx_mint: self.grx_mint,
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
fn invariant_test(fixture: &mut RegistryFixture) {
    // I1 — shard user counters track successful registrations exactly.
    let shard_users = fixture.sum_shard(SHARD_USER_COUNT);
    fuzz_assert_eq!(
        shard_users,
        fixture.n_users_registered,
        "Σ shard.user_count {} != registrations {}",
        shard_users,
        fixture.n_users_registered
    );

    // I2 — shard meter counters track successful meter registrations exactly.
    let shard_meters = fixture.sum_shard(SHARD_METER_COUNT);
    fuzz_assert_eq!(
        shard_meters,
        fixture.n_meters_registered,
        "Σ shard.meter_count {} != meter regs {}",
        shard_meters,
        fixture.n_meters_registered
    );

    // I3 — global counters never exceed the shard truth (equal only after aggregate).
    let reg_users = fixture.read_u64(&fixture.registry_pda, REG_USER_COUNT);
    let reg_meters = fixture.read_u64(&fixture.registry_pda, REG_METER_COUNT);
    fuzz_assert_le!(
        reg_users,
        shard_users,
        "global user_count {} > shard truth {}",
        reg_users,
        shard_users
    );
    fuzz_assert_le!(
        reg_meters,
        shard_meters,
        "global meter_count {} > shard truth {}",
        reg_meters,
        shard_meters
    );

    // I4 — bond conservation: vault balance == Σ staked_grx.
    let vault = fixture.read_u64(&fixture.grx_vault, TOK_AMOUNT);
    let sum_staked: u64 = fixture
        .users
        .iter()
        .map(|u| fixture.read_u64(&u.user_pda, USER_STAKED_GRX))
        .sum();
    fuzz_assert_eq!(
        vault,
        sum_staked,
        "grx_vault {} != Σ staked_grx {}",
        vault,
        sum_staked
    );

    // I5 — GRX conservation across user ATAs + vault + slash sinks (slashing moves GRX
    // from grx_vault to victim/slash_dest, all within this sum).
    let mut grx_now = vault;
    grx_now += fixture.read_u64(&fixture.slash_dest, TOK_AMOUNT);
    grx_now += fixture.read_u64(&fixture.victim, TOK_AMOUNT);
    for u in &fixture.users {
        grx_now += fixture.read_u64(&u.grx_ata, TOK_AMOUNT);
    }
    fuzz_assert_eq!(
        grx_now,
        fixture.grx_total,
        "GRX conservation broken: {} != genesis {}",
        grx_now,
        fixture.grx_total
    );

    // I6 — meter-reading accounting + anti-inflation bound: the registry's cumulative
    // totals equal exactly the accepted readings AND never exceed the oracle's own totals
    // (ORACLE_CAP). update_meter_reading rejects any reading that would push the registry
    // past what the AMI gateway recorded, so a corrupt oracle_authority can't inflate the
    // settleable/mintable balance.
    let total_gen = fixture.read_u64(&fixture.reader_meter, METER_TOTAL_GEN);
    let total_cons = fixture.read_u64(&fixture.reader_meter, METER_TOTAL_CONS);
    fuzz_assert_eq!(
        total_gen,
        fixture.exp_gen,
        "meter total_generation {} != Σ accepted gen {}",
        total_gen,
        fixture.exp_gen
    );
    fuzz_assert_eq!(
        total_cons,
        fixture.exp_cons,
        "meter total_consumption {} != Σ accepted cons {}",
        total_cons,
        fixture.exp_cons
    );
    fuzz_assert_le!(total_gen, ORACLE_CAP, "total_generation {} > oracle cap {}", total_gen, ORACLE_CAP);
    fuzz_assert_le!(total_cons, ORACLE_CAP, "total_consumption {} > oracle cap {}", total_cons, ORACLE_CAP);
}
