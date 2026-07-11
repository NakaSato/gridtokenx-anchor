//! Crucible invariant-fuzzing harness for the `energy-token` program (GRID/GRX mint).
//!
//! Focus: the REC-co-signature-gated mint paths + token supply/balance conservation.
//! Uses a CLASSIC SPL mint (token_program = spl_token) — the program is written
//! against `token_interface` so classic vs Token-2022 is transparent, and crucible's
//! account builders only produce classic SPL accounts.
//!
//! The `governance_config` PDA that gates `add_rec_validator` is FORGED in setup
//! (an account owned by the governance program with `authority = admin` at bytes
//! [8..40]) so the harness can register a REC validator without the governance program.
//!
//! Invariants:
//!   I1  conservation: Σ wallet balances == on-chain mint supply.
//!   I2  supply integrity: mint supply == Σ(valid mints) − Σ(burns). Because the
//!       fixture only credits `expected_supply` for mints co-signed by the REGISTERED
//!       REC validator, a mint that wrongly succeeds with an UNREGISTERED co-signer
//!       (a broken REC gate) makes supply exceed expected → I2 fires.

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::rc::Rc;
use std::str::FromStr;

crucible_idl_gen::declare_fuzz_program!("idls/energy_token.json");

use energy_token::{accounts, instruction};

const N_WALLETS: usize = 3;
const INITIAL_SOL: u64 = 1_000_000_000_000;
const MINT_DECIMALS: u8 = 9;

const TOK_AMOUNT: usize = 64; // classic spl_token Account.amount offset
const MINT_SUPPLY: usize = 36; // classic spl_token Mint.supply offset

fn spl_token_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}
fn ata_program_id() -> Pubkey {
    Pubkey::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap()
}
fn governance_program_id() -> Pubkey {
    Pubkey::from_str("FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS").unwrap()
}
fn rent_sysvar() -> Pubkey {
    Pubkey::from_str("SysvarRent111111111111111111111111111111111").unwrap()
}

#[derive(Clone)]
struct Wallet {
    owner: Rc<Keypair>,
    token_acct: Pubkey,
}

#[derive(Clone)]
struct EnergyTokenFixture {
    ctx: TestContext,
    program_id: Pubkey,
    admin: Rc<Keypair>,
    registry_kp: Rc<Keypair>, // registry_authority (alt mint_tokens_direct caller)
    recval: Rc<Keypair>,      // the single REGISTERED REC validator co-signer
    bad_val: Rc<Keypair>,     // an UNREGISTERED key (must be rejected by the REC gate)
    token_info: Pubkey,
    mint: Pubkey,
    wallets: Vec<Wallet>,
    expected_supply: u64,
    windows: Vec<i64>,        // 900_000-ms-aligned settlement windows (<= now)
    minted_window: Vec<bool>, // idempotency: has this (gen_meter, window) already minted?
}

const N_WINDOWS: usize = 4;
const GEN_METER: [u8; 16] = [7u8; 16];
const TI_CREATED_AT: usize = 8 + 136; // TokenInfo.created_at (i64) offset

#[fuzz_fixture]
impl EnergyTokenFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        let program_id = Pubkey::new_from_array(energy_token::ID.to_bytes());
        ctx.add_program(&program_id, "../../target/deploy/energy_token.so")
            .unwrap();
        let token_program = spl_token_id();

        let admin = Rc::new(Keypair::new());
        let registry_kp = Rc::new(Keypair::new());
        let recval = Rc::new(Keypair::new());
        let bad_val = Rc::new(Keypair::new());
        ctx.create_account()
            .pubkey(admin.pubkey())
            .lamports(INITIAL_SOL)
            .owner(system_program::ID)
            .create()
            .unwrap();

        let (token_info, _) = Pubkey::find_program_address(&[b"token_info_2022"], &program_id);
        let (mint, _) = Pubkey::find_program_address(&[b"mint_2022"], &program_id);

        // initialize_token — creates token_info + the (classic) mint (authority = token_info PDA)
        ctx.program(program_id)
            .call(instruction::InitializeToken {
                registry_program_id: program_id, // unused by our actions
                registry_authority: registry_kp.pubkey(),
            })
            .accounts(accounts::InitializeToken {
                token_info,
                mint,
                authority: admin.pubkey(),
                system_program: system_program::ID,
                token_program,
                rent: rent_sysvar(),
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // Forge the governance_config PDA so add_rec_validator's ERC-authority gate passes.
        // Layout the handler reads: [0..8] discriminator | [8..40] authority (= admin).
        let (gov_config, _) =
            Pubkey::find_program_address(&[b"governance_config"], &governance_program_id());
        let mut gov_data = vec![0u8; 40];
        gov_data[8..40].copy_from_slice(&admin.pubkey().to_bytes());
        ctx.create_account()
            .pubkey(gov_config)
            .lamports(1_000_000_000)
            .owner(governance_program_id())
            .data(&gov_data)
            .create()
            .unwrap();

        // Register the single REC validator.
        ctx.program(program_id)
            .call(instruction::AddRecValidator {
                validator_pubkey: recval.pubkey(),
                _authority_name: "erc".to_string(),
            })
            .accounts(accounts::AddRecValidator {
                token_info,
                governance_config: gov_config,
                authority: admin.pubkey(),
            })
            .signers(&[&*admin])
            .send()
            .unwrap();

        // wallets (classic token accounts for the mint)
        let mut wallets = Vec::new();
        for _ in 0..N_WALLETS {
            let owner = Rc::new(Keypair::new());
            ctx.create_account()
                .pubkey(owner.pubkey())
                .lamports(INITIAL_SOL)
                .owner(system_program::ID)
                .create()
                .unwrap();
            let token_acct = Keypair::new().pubkey();
            ctx.create_token_account()
                .pubkey(token_acct)
                .mint(mint)
                .token_owner(owner.pubkey())
                .amount(0)
                .create()
                .unwrap();
            wallets.push(Wallet { owner, token_acct });
        }

        // Build 900_000-ms-aligned windows strictly below `now` (= TokenInfo.created_at),
        // so mint_generation's `window_start_ms/1000 <= now+900` bound always passes.
        let created_at = match ctx.read_account(&token_info) {
            Ok(a) if a.data.len() >= TI_CREATED_AT + 8 => {
                i64::from_le_bytes(a.data[TI_CREATED_AT..TI_CREATED_AT + 8].try_into().unwrap())
            }
            _ => 0,
        };
        let base_ms = (created_at * 1000 / 900_000) * 900_000; // align down
        let windows: Vec<i64> = (0..N_WINDOWS)
            .map(|i| base_ms - ((N_WINDOWS - i) as i64) * 900_000)
            .collect();

        Self {
            ctx,
            program_id,
            admin,
            registry_kp,
            recval,
            bad_val,
            token_info,
            mint,
            wallets,
            expected_supply: 0,
            windows,
            minted_window: vec![false; N_WINDOWS],
        }
    }

    fn read_u64(&self, pk: &Pubkey, off: usize) -> u64 {
        match self.ctx.read_account(pk) {
            Ok(a) if a.data.len() >= off + 8 => {
                u64::from_le_bytes(a.data[off..off + 8].try_into().unwrap())
            }
            _ => 0,
        }
    }

    // ---- actions ----

    /// mint_to_wallet with either the registered (`valid`) or an unregistered co-signer.
    pub fn action_mint(&mut self, #[range(0..3)] widx: usize, amount: u64, valid: bool) -> bool {
        let amt = amount % 1_000_000_000_000; // keep supply well below u64 max
        let w = &self.wallets[widx];
        let cosigner: &Keypair = if valid { &self.recval } else { &self.bad_val };
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::MintToWallet { amount: amt })
            .accounts(accounts::MintToWallet {
                mint: self.mint,
                token_info: self.token_info,
                destination: w.token_acct,
                destination_owner: w.owner.pubkey(),
                authority: self.admin.pubkey(),
                rec_validator: Some(cosigner.pubkey()),
                payer: self.admin.pubkey(),
                token_program: spl_token_id(),
                associated_token_program: ata_program_id(),
                system_program: system_program::ID,
            })
            .signers(&[&*self.admin, cosigner])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        // Only credit expected_supply for a VALID mint — an invalid one that succeeds is a
        // REC-gate breach and must show up as supply > expected (I2).
        if ok && valid {
            self.expected_supply = self.expected_supply.saturating_add(amt);
        }
        ok
    }

    /// mint_tokens_direct via the registry authority (alt caller), registered co-signer.
    pub fn action_mint_direct(&mut self, #[range(0..3)] widx: usize, amount: u64) -> bool {
        let amt = amount % 1_000_000_000_000;
        let w = &self.wallets[widx];
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::MintTokensDirect { amount: amt })
            .accounts(accounts::MintTokensDirect {
                token_info: self.token_info,
                mint: self.mint,
                user_token_account: w.token_acct,
                authority: self.registry_kp.pubkey(),
                registry_authority: self.registry_kp.pubkey(),
                rec_validator: self.recval.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*self.registry_kp, &*self.recval])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.expected_supply = self.expected_supply.saturating_add(amt);
        }
        ok
    }

    pub fn action_burn(&mut self, #[range(0..3)] widx: usize, amount: u64) -> bool {
        let w = &self.wallets[widx];
        let bal = self.read_u64(&w.token_acct, TOK_AMOUNT);
        if bal == 0 {
            return false;
        }
        let amt = (amount % bal).max(1);
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::BurnTokens { amount: amt })
            .accounts(accounts::BurnTokens {
                mint: self.mint,
                token_account: w.token_acct,
                authority: w.owner.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*w.owner])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        if ok {
            self.expected_supply = self.expected_supply.saturating_sub(amt);
        }
        ok
    }

    pub fn action_transfer(
        &mut self,
        #[range(0..3)] from: usize,
        #[range(0..3)] to: usize,
        amount: u64,
    ) -> bool {
        if from == to {
            return false;
        }
        let f = &self.wallets[from];
        let bal = self.read_u64(&f.token_acct, TOK_AMOUNT);
        if bal == 0 {
            return false;
        }
        let amt = (amount % bal).max(1);
        let t = &self.wallets[to];
        self.ctx
            .program(self.program_id)
            .call(instruction::TransferTokens { amount: amt })
            .accounts(accounts::TransferTokens {
                from_token_account: f.token_acct,
                to_token_account: t.token_acct,
                mint: self.mint,
                from_authority: f.owner.pubkey(),
                token_program: spl_token_id(),
            })
            .signers(&[&*f.owner])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_sync(&mut self) -> bool {
        self.ctx
            .program(self.program_id)
            .call(instruction::SyncTotalSupply {})
            .accounts(accounts::SyncTotalSupply {
                token_info: self.token_info,
                mint: self.mint,
                authority: self.admin.pubkey(),
            })
            .signers(&[&*self.admin])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    /// Idempotent generation mint keyed by (GEN_METER, window). A replay of an
    /// already-minted window must be a no-op — the fixture credits expected_supply
    /// only on the FIRST mint of a window, so a double-mint would push supply past
    /// expected and trip I2.
    pub fn action_mint_generation(
        &mut self,
        #[range(0..3)] widx: usize,
        #[range(0..4)] window_idx: usize,
        amount: u64,
    ) -> bool {
        let amt = (amount % 1_000_000_000_000).max(1);
        let w = self.windows[window_idx];
        let (record, _) = Pubkey::find_program_address(
            &[b"gen_mint", &GEN_METER, &w.to_le_bytes()],
            &self.program_id,
        );
        let dest = self.wallets[widx].token_acct;
        let dest_owner = self.wallets[widx].owner.pubkey();
        let ok = self
            .ctx
            .program(self.program_id)
            .call(instruction::MintGeneration {
                meter_id: GEN_METER,
                window_start_ms: w,
                amount: amt,
            })
            .accounts(accounts::MintGeneration {
                mint: self.mint,
                token_info: self.token_info,
                destination: dest,
                destination_owner: dest_owner,
                mint_record: record,
                authority: self.admin.pubkey(),
                rec_validator: Some(self.recval.pubkey()),
                payer: self.admin.pubkey(),
                token_program: spl_token_id(),
                associated_token_program: ata_program_id(),
                system_program: system_program::ID,
            })
            .signers(&[&*self.admin, &*self.recval])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false);
        // Credit supply ONLY on the first successful mint of this window; a replay
        // no-ops on-chain, so crediting again would mask a real double-mint.
        if ok && !self.minted_window[window_idx] {
            self.minted_window[window_idx] = true;
            self.expected_supply = self.expected_supply.saturating_add(amt);
        }
        ok
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut EnergyTokenFixture) {
    let supply = fixture.read_u64(&fixture.mint, MINT_SUPPLY);

    // I1 — conservation: Σ wallet balances == on-chain mint supply.
    let sum_wallets: u64 = fixture
        .wallets
        .iter()
        .map(|w| fixture.read_u64(&w.token_acct, TOK_AMOUNT))
        .sum();
    fuzz_assert_eq!(
        sum_wallets,
        supply,
        "Σ wallets {} != mint supply {}",
        sum_wallets,
        supply
    );

    // I2 — supply integrity / REC-gate: supply == Σ(valid mints) − Σ(burns).
    fuzz_assert_eq!(
        supply,
        fixture.expected_supply,
        "mint supply {} != expected {} (REC gate breach or CPI drift)",
        supply,
        fixture.expected_supply
    );
}
