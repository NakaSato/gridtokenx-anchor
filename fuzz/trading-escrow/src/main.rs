//! Crucible invariant-fuzzing harness for the `trading` program escrow path.
//!
//! Fuzzes deposit_escrow / withdraw_escrow — the self-signed custody primitive that
//! backs off-chain settlement — and asserts token conservation. This is also the
//! escrow scaffolding the (still-deferred) settle_offchain harness will build on.
//!
//! Invariant:
//!   I1  per-(user,mint) conservation: user_wallet.amount + user_escrow.amount ==
//!       the amount originally funded. deposit moves wallet→escrow, withdraw moves
//!       escrow→wallet (market_authority PDA signs), so the sum is invariant and a
//!       withdraw can never exceed the escrow balance.

use crucible_fuzzer::*;
use crucible_fuzzer::anchor_lang::system_program;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::rc::Rc;
use std::str::FromStr;

crucible_idl_gen::declare_fuzz_program!("idls/trading.json");

use trading::{accounts, instruction};

const N_USERS: usize = 3;
const INITIAL_SOL: u64 = 1_000_000_000_000;
const FUNDED: u64 = 1_000_000_000_000; // starting wallet balance per user
const MINT_DECIMALS: u8 = 9;
const TOK_AMOUNT: usize = 64; // classic spl_token Account.amount offset

fn spl_token_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

#[derive(Clone)]
struct User {
    kp: Rc<Keypair>,
    wallet: Pubkey,
    escrow: Pubkey,
}

#[derive(Clone)]
struct EscrowFixture {
    ctx: TestContext,
    program_id: Pubkey,
    mint: Pubkey,
    market_authority: Pubkey,
    users: Vec<User>,
}

#[fuzz_fixture]
impl EscrowFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        let program_id = Pubkey::new_from_array(trading::ID.to_bytes());
        ctx.add_program(&program_id, "../../target/deploy/trading.so")
            .unwrap();

        let mint_kp = Keypair::new();
        let mint = ctx
            .create_mint()
            .pubkey(mint_kp.pubkey())
            .mint_authority(Keypair::new().pubkey())
            .decimals(MINT_DECIMALS)
            .create()
            .unwrap();

        let (market_authority, _) =
            Pubkey::find_program_address(&[b"market_authority"], &program_id);

        let mut users = Vec::new();
        for _ in 0..N_USERS {
            let kp = Rc::new(Keypair::new());
            ctx.create_account()
                .pubkey(kp.pubkey())
                .lamports(INITIAL_SOL)
                .owner(system_program::ID)
                .create()
                .unwrap();

            let wallet = Keypair::new().pubkey();
            ctx.create_token_account()
                .pubkey(wallet)
                .mint(mint)
                .token_owner(kp.pubkey())
                .amount(FUNDED)
                .create()
                .unwrap();

            let (escrow, _) = Pubkey::find_program_address(
                &[b"escrow", kp.pubkey().as_ref(), mint.as_ref()],
                &program_id,
            );
            users.push(User { kp, wallet, escrow });
        }

        Self { ctx, program_id, mint, market_authority, users }
    }

    fn amt(&self, pk: &Pubkey) -> u64 {
        match self.ctx.read_account(pk) {
            Ok(a) if a.data.len() >= TOK_AMOUNT + 8 => {
                u64::from_le_bytes(a.data[TOK_AMOUNT..TOK_AMOUNT + 8].try_into().unwrap())
            }
            _ => 0,
        }
    }

    pub fn action_deposit(&mut self, #[range(0..3)] uidx: usize, amount: u64) -> bool {
        let u = self.users[uidx].clone();
        let bal = self.amt(&u.wallet);
        if bal == 0 {
            return false;
        }
        let a = (amount % bal).max(1);
        self.ctx
            .program(self.program_id)
            .call(instruction::DepositEscrow { amount: a })
            .accounts(accounts::DepositEscrow {
                user: u.kp.pubkey(),
                mint: self.mint,
                user_wallet: u.wallet,
                user_escrow: u.escrow,
                market_authority: self.market_authority,
                token_program: spl_token_id(),
                system_program: system_program::ID,
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }

    pub fn action_withdraw(&mut self, #[range(0..3)] uidx: usize, amount: u64) -> bool {
        let u = self.users[uidx].clone();
        let esc = self.amt(&u.escrow);
        if esc == 0 {
            return false;
        }
        let a = (amount % esc).max(1);
        self.ctx
            .program(self.program_id)
            .call(instruction::WithdrawEscrow { amount: a })
            .accounts(accounts::WithdrawEscrow {
                user: u.kp.pubkey(),
                mint: self.mint,
                user_escrow: u.escrow,
                user_wallet: u.wallet,
                market_authority: self.market_authority,
                token_program: spl_token_id(),
            })
            .signers(&[&*u.kp])
            .send()
            .map(|o| o.is_success())
            .unwrap_or(false)
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut EscrowFixture) {
    for (i, u) in fixture.users.iter().enumerate() {
        let total = fixture.amt(&u.wallet) + fixture.amt(&u.escrow);
        fuzz_assert_eq!(
            total,
            FUNDED,
            "user {} wallet+escrow {} != funded {}",
            i,
            total,
            FUNDED
        );
    }
}
