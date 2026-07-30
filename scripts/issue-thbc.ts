import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { createHash } from 'crypto';
import BN from 'bn.js';

// Bring real (treasury-issued) THBC into existence so trades can settle in it.
//
// THBC starts at supply 0 and cannot be minted until a reserve is attested: issue_thbc
// checks F5 (attestation freshness) BEFORE F1 (supply + amount <= attested_reserve -
// reserve_encumbered), and a never-attested treasury has attestation_ts = 0, which is
// permanently stale. So this does both, in order:
//   1. update_attestation(reserve, encumbered)  — signed by Treasury.attestor
//   2. issue_thbc(amount, bank_ref_hash)        — signed by Treasury.authority
//
// F3: the [b"deposit", bank_ref_hash] nullifier is created with `init` in the same
// instruction as the mint, so re-running with the SAME BANK_REF fails at the runtime
// level by design. Pass a fresh BANK_REF to issue again — that is the anti-replay
// guarantee working, not a bug.
//
// Usage:
//   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=../dev-wallet.json \
//     npx tsx scripts/issue-thbc.ts
//   RESERVE_THBC=10000000 ISSUE_THBC=1000000 BANK_REF=seed-2 npx tsx scripts/issue-thbc.ts
const DECIMALS = 6;

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const treasuryProgram = anchor.workspace.Treasury;
    const wallet = provider.wallet;

    // Whole-THBC inputs, converted to 6-dec base units.
    const whole = (s: string | undefined, d: number) => new BN(s ?? String(d)).mul(new BN(10).pow(new BN(DECIMALS)));
    const reserve = whole(process.env.RESERVE_THBC, 10_000_000);
    const issueAmt = whole(process.env.ISSUE_THBC, 1_000_000);
    const encumbered = whole(process.env.ENCUMBERED_THBC, 0);
    const bankRef = process.env.BANK_REF ?? 'localnet-seed-deposit-1';

    const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('treasury')], treasuryProgram.programId);
    const [thbcMint] = PublicKey.findProgramAddressSync([Buffer.from('thbc_mint')], treasuryProgram.programId);

    const t0 = await treasuryProgram.account.treasury.fetch(treasuryPda);
    console.log('treasury   :', treasuryPda.toBase58());
    console.log('thbc_mint  :', thbcMint.toBase58());
    console.log('authority  :', t0.authority.toBase58(), '(signer:', wallet.publicKey.toBase58() + ')');
    console.log('supply now :', t0.thbcSupply.toString());

    // 1. Attest the reserve. F1's ceiling is attested_reserve - reserve_encumbered,
    //    and F5 requires the timestamp to be within attestation_ttl.
    console.log(`\n[1/3] update_attestation(reserve=${reserve.toString()}, encumbered=${encumbered.toString()})`);
    const attestTx = await treasuryProgram.methods
        .updateAttestation(reserve, encumbered)
        .accounts({ treasury: treasuryPda, attestor: wallet.publicKey })
        .rpc();
    console.log('  ✅ attested:', attestTx);

    // 2. Beneficiary ATA. THBC is Token-2022, so the ATA MUST be derived under
    //    TOKEN_2022_PROGRAM_ID — deriving it under classic SPL yields a different
    //    address that `token::mint = thbc_mint` would reject.
    const ata = getAssociatedTokenAddressSync(thbcMint, wallet.publicKey, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    console.log(`\n[2/3] beneficiary ATA ${ata.toBase58()}`);
    const ataIx = createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey, ata, wallet.publicKey, thbcMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // 3. Issue. bank_ref_hash is the F3 nullifier seed.
    const bankRefDigest = createHash('sha256').update(bankRef).digest();
    const bankRefHash = Array.from(bankRefDigest);
    // Derived explicitly: the seed comes from an instruction ARG, which this Anchor
    // version does not auto-resolve.
    const [depositNullifier] = PublicKey.findProgramAddressSync(
        [Buffer.from('deposit'), bankRefDigest],
        treasuryProgram.programId,
    );
    console.log(`\n[3/3] issue_thbc(amount=${issueAmt.toString()}, bank_ref="${bankRef}")`);
    console.log('  deposit nullifier:', depositNullifier.toBase58());
    try {
        const tx = await treasuryProgram.methods
            .issueThbc(issueAmt, bankRefHash)
            .accounts({
                treasury: treasuryPda,
                thbcMint,
                beneficiaryThbcAta: ata,
                depositNullifier,
                issuer: wallet.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .preInstructions([ataIx])
            .rpc();
        console.log('  ✅ issued:', tx);
    } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (msg.includes('already in use')) {
            console.log(`  ℹ️  bank_ref "${bankRef}" already used (F3 replay guard). Pass BANK_REF=<new> to issue more.`);
        } else {
            throw e;
        }
    }

    const t1 = await treasuryProgram.account.treasury.fetch(treasuryPda);
    console.log('\n=== after ===');
    console.log('  thbc_supply      :', t1.thbcSupply.toString());
    console.log('  attested_reserve :', t1.attestedReserve.toString());
    console.log('  headroom (F1)    :', t1.attestedReserve.sub(t1.reserveEncumbered ?? new BN(0)).sub(t1.thbcSupply).toString());
}

main().catch((e) => { console.error(e); process.exit(1); });
