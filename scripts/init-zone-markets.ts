import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';

// Initialize ZoneMarket PDAs for a set of zones — idempotent, additive, and safe to
// re-run against a live chain.
//
// WHY THIS EXISTS SEPARATELY FROM bootstrap.ts: a zone whose ZoneMarket was never
// created cannot settle. `record_order_custodial` takes zone_market as an
// AccountLoader (programs/trading/src/instructions/record_order_custodial.rs:11),
// so an uninitialized zone is still system-owned and the instruction fails with
// AccountOwnedByWrongProgram (Custom 3007). The failure is quiet in the worst way:
// POST /api/v1/orders still returns 200, the CDA still matches the order off-chain
// and marks it `filled`, but trading_orders.order_pda stays NULL and the settlement
// later flips to permanently_failed. bootstrap.ts only covered zones 0-3, so orders
// in zones 4-9 looked fine and could never reach the chain.
//
// Usage (zones default to 0-9 plus the MEA/PEA codes):
//   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=../dev-wallet.json \
//     npx tsx scripts/init-zone-markets.ts
//   ZONES=4,5,6 npx tsx scripts/init-zone-markets.ts
async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgram = anchor.workspace.Trading;
    const authority = provider.wallet;

    const zones = (process.env.ZONES
        ? process.env.ZONES.split(',').map((z) => parseInt(z.trim(), 10))
        : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 7583, 7584, 7585, 7586, 7587, 7588]
    ).filter((z) => Number.isInteger(z) && z >= 0);

    if (zones.length === 0) throw new Error('no valid zone ids given in ZONES');

    const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('market')],
        tradingProgram.programId,
    );

    console.log('Trading program :', tradingProgram.programId.toBase58());
    console.log('Market PDA      :', marketPda.toBase58());
    console.log('Zones           :', zones.join(', '));

    let created = 0;
    let existing = 0;
    const failed: number[] = [];

    for (const zoneId of zones) {
        const [zoneMarketPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('zone_market'), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, 'le', 4)],
            tradingProgram.programId,
        );

        // Skip the tx entirely when the account already exists, so a re-run is cheap
        // and does not spam the validator with failing transactions.
        const info = await provider.connection.getAccountInfo(zoneMarketPda);
        if (info !== null) {
            console.log(`  = zone ${zoneId} already initialized (${zoneMarketPda.toBase58()})`);
            existing++;
            continue;
        }

        try {
            await tradingProgram.methods
                .initializeZoneMarket(zoneId, 1, new BN(0), 0) // 1 shard, 0 capacity = uncapped
                .accounts({
                    market: marketPda,
                    zoneMarket: zoneMarketPda,
                    authority: authority.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            console.log(`  + zone ${zoneId} initialized (${zoneMarketPda.toBase58()})`);
            created++;
        } catch (e: any) {
            if (String(e?.message ?? '').includes('already in use')) {
                console.log(`  = zone ${zoneId} already initialized (raced)`);
                existing++;
            } else {
                console.error(`  ! zone ${zoneId} FAILED: ${e?.message ?? e}`);
                failed.push(zoneId);
            }
        }
    }

    console.log(`\nzone markets: ${created} created, ${existing} already present, ${failed.length} failed`);
    if (failed.length > 0) {
        // Exit non-zero so a caller can gate on this — a missing zone is a silent
        // unsettleable-order trap, not a cosmetic warning.
        throw new Error(`failed to initialize zones: ${failed.join(', ')}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
