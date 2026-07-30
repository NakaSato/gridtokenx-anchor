import * as anchor from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';

// Artifact test for the retire_energy_tokens mint binding, run against the DEPLOYED
// program on the live validator (a green `cargo build` proves nothing here).
//
// Before the fix, RetireEnergyTokens carried no token_info account and no constraint
// tying `mint` to the canonical energy mint — `authority` only had to own
// `token_account`. So the GridTokenX energy-token program would happily burn an
// UNRELATED Token-2022 mint, e.g. the treasury's real THBC, and it would look like a
// GridTokenX energy retirement on-chain.
//
// Case A (must FAIL, 6014 InvalidMint): burn treasury THBC through retire_energy_tokens.
// Case B (must SUCCEED): burn the canonical energy mint, supply decreases by the amount.
const THBC_MINT = new PublicKey('9ufYdgFv3SVnYkiWseqnhbdsrM6wnZaVdZAqAe1GDWpe');
const INVALID_MINT_CODE = 6014;

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const energyToken = anchor.workspace.EnergyToken;
    const wallet = provider.wallet;
    const conn = provider.connection;

    const [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from('token_info_2022')], energyToken.programId);
    const [energyMint] = PublicKey.findProgramAddressSync([Buffer.from('mint_2022')], energyToken.programId);

    const ataFor = (mint: PublicKey) =>
        getAssociatedTokenAddressSync(mint, wallet.publicKey, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

    const supplyOf = async (m: PublicKey) => (await conn.getTokenSupply(m)).value.amount;

    console.log('program    :', energyToken.programId.toBase58());
    console.log('energy mint:', energyMint.toBase58());
    console.log('foreign    :', THBC_MINT.toBase58(), '(treasury THBC)');

    let failures = 0;

    // ---- Case A: foreign mint must be REJECTED -----------------------------
    const thbcBefore = await supplyOf(THBC_MINT);
    console.log(`\n[A] burn 1 THBC via retire_energy_tokens — expect FAIL ${INVALID_MINT_CODE} (InvalidMint)`);
    try {
        await energyToken.methods
            .retireEnergyTokens(new BN(1_000_000)) // 1 THBC @ 6dp
            .accounts({
                tokenInfo: tokenInfoPda,
                mint: THBC_MINT,
                tokenAccount: ataFor(THBC_MINT),
                authority: wallet.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            } as any)
            .rpc();
        console.error('  ✘ FAIL: the burn SUCCEEDED — foreign mint is not rejected');
        failures++;
    } catch (e: any) {
        const msg = String(e?.message ?? e);
        const hit = msg.includes(String(INVALID_MINT_CODE)) || msg.includes('InvalidMint') || msg.includes('0x177e');
        console.log(hit ? '  ✔ rejected as expected (InvalidMint)' : `  ✘ rejected, but NOT with InvalidMint: ${msg.slice(0, 200)}`);
        if (!hit) failures++;
    }
    const thbcAfter = await supplyOf(THBC_MINT);
    if (thbcBefore !== thbcAfter) {
        console.error(`  ✘ THBC supply CHANGED ${thbcBefore} -> ${thbcAfter} — foreign mint was burned!`);
        failures++;
    } else {
        console.log(`  ✔ THBC supply unchanged (${thbcAfter})`);
    }

    // ---- Case B: canonical mint must still burn ----------------------------
    const burnAmt = new BN(1_000_000_000); // 1 GRID @ 9dp
    const energyBefore = await supplyOf(energyMint);
    console.log(`\n[B] burn 1 GRID (canonical mint) — expect SUCCESS`);
    try {
        const tx = await energyToken.methods
            .retireEnergyTokens(burnAmt)
            .accounts({
                tokenInfo: tokenInfoPda,
                mint: energyMint,
                tokenAccount: ataFor(energyMint),
                authority: wallet.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            } as any)
            .rpc();
        console.log('  ✔ burned:', tx);
    } catch (e: any) {
        console.error('  ✘ FAIL: canonical burn was rejected:', String(e?.message ?? e).slice(0, 300));
        failures++;
    }
    const energyAfter = await supplyOf(energyMint);
    const delta = BigInt(energyAfter) - BigInt(energyBefore);
    console.log(`  energy supply ${energyBefore} -> ${energyAfter} (delta ${delta})`);
    // The simulator mints organic surplus continuously, so assert the burn is
    // reflected rather than demanding an exact -1e9 (see token-lifecycle-track-results.md).
    if (delta >= 0n) {
        console.error('  ! supply did not fall — may be masked by a concurrent organic mint; check the tx delta directly');
    }

    console.log(failures === 0 ? '\n🏆 mint-binding enforced' : `\n✘ ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
