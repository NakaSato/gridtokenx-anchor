import * as anchor from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';

// Grant the welcome airdrop to a wallet whose automatic claim never landed.
//
// WHY THIS EXISTS: IAM claims the 10 GRX welcome airdrop right after email
// verification, but it gives up after 5 attempts and has no recovery path. A user
// who registers during a transient Chain Bridge outage (e.g. the bridge degraded
// to in-memory audit because it booted before Postgres) is therefore left
// permanently at 0 GRX, with a valid, verified, on-chain-registered wallet and
// nothing to detect or repair it. Observed 2026-07-30: `test_1` registered in the
// minute after a `docker compose down -v` and its 5 attempts all failed with
// InstructionError(1, Custom(3007)); a user registered minutes later succeeded.
//
// `claim_airdrop` authorizes either the user signing for themselves OR the
// registry admin signing on their behalf, so the dev wallet can repair it without
// the user's key. The on-chain `airdrop_claimed` flag still guards against a
// double grant — re-running for an already-funded wallet fails at the program,
// which is the intended behaviour, not a bug in this script.
//
// Usage:
//   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=../dev-wallet.json \
//     WALLET=<user-wallet-pubkey> npx tsx scripts/grant-airdrop.ts
async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const registryProgram = anchor.workspace.Registry;
    const energyToken = anchor.workspace.EnergyToken;
    const payer = provider.wallet;

    const walletArg = process.env.WALLET;
    if (!walletArg) throw new Error('set WALLET=<user wallet pubkey>');
    const authority = new PublicKey(walletArg);

    const [userAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from('user'), authority.toBuffer()], registryProgram.programId);
    const [registry] = PublicKey.findProgramAddressSync(
        [Buffer.from('registry')], registryProgram.programId);
    const [mint] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_2022')], energyToken.programId);
    const [tokenInfo] = PublicKey.findProgramAddressSync(
        [Buffer.from('token_info_2022')], energyToken.programId);

    // The energy mint is Token-2022, so the ATA must be derived under that program —
    // a classic-SPL derivation is a different address the program would reject.
    const userTokenAccount = getAssociatedTokenAddressSync(
        mint, authority, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

    console.log('wallet        :', authority.toBase58());
    console.log('user_account  :', userAccount.toBase58());
    console.log('mint          :', mint.toBase58());
    console.log('user ATA      :', userTokenAccount.toBase58());

    const before = await provider.connection.getTokenAccountBalance(userTokenAccount).catch(() => null);
    console.log('balance before:', before?.value.uiAmountString ?? '(no account)');

    // Idempotent so a wallet whose ATA was never created still works.
    const ataIx = createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey, userTokenAccount, authority, mint,
        TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

    const tx = await registryProgram.methods
        .claimAirdrop()
        .accounts({
            userAccount,
            registry,
            authority,
            payer: payer.publicKey,
            energyTokenProgram: energyToken.programId,
            mint,
            userTokenAccount,
            tokenInfo,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
        } as any)
        .preInstructions([ataIx])
        .rpc();

    console.log('✅ claimed:', tx);
    const after = await provider.connection.getTokenAccountBalance(userTokenAccount).catch(() => null);
    console.log('balance after :', after?.value.uiAmountString ?? '(no account)');
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
