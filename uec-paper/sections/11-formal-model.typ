= 11. Formal Model: Pricing, Settlement, and Economic Equations

All on-chain monetary arithmetic uses integer `checked_mul` with `u128` intermediates —
overflow *rejects* the transaction, never clamps. $floor(dot)$ denotes the
integer floor division the SBF program performs.

== 11.1 Notation

#table(
  columns: (auto, auto, auto),
  align: (left, left, left),
  table.header([*Symbol*], [*Meaning*], [*Scale*]),
  [$q$],        [matched energy quantity (`match_amount`)], [9-dec, $1 "kWh" = 10^9$],
  [$p$],        [clearing price (`match_price`)],           [6-dec THBC/kWh],
  [$V$],        [trade gross value],                        [6-dec THBC],
  [$phi_m$],    [market fee (`market_fee_bps`)],            [bps],
  [$w$],        [wheeling rate (`wheeling_rate_per_kwh`)],  [6-dec THBC/kWh],
  [$ell$],      [loss rate (`loss_bps`)],                   [bps],
  [$r$],        [peg rate (`grx_per_thbc_rate`)],           [THBC-minor / whole GRX],
  [$phi_s$],    [swap fee (`swap_fee_bps`)],                [bps],
  [$A$],        [staking accumulator (`acc_reward_per_share`)], [$times 10^12$],
  [$T$],        [total staked GRX (`total_staked`)],        [atoms],
)

== 11.2 Price formation

Prices are limit prices quoted in THBC per kilowatt-hour (6-decimal fixed point).
The market operates two coordinated mechanisms — a continuous double auction for
immediate execution and a uniform-price auction over 15-minute epochs — and both
resolve to the same settlement arithmetic of §11.3.

*Order admission.* Every order carries a strictly positive limit price and must
fall within the market's configured band (`programs/trading/src/lib.rs:221`,
`lib.rs:226`–`233`); orders outside $[p_min , p_max]$ are rejected at entry, which
bounds the price domain before any matching occurs:

$ p_min <= p <= p_max $ <eq-band>

*Continuous double auction (on-chain path).* Two orders may match only when they
cross (`programs/trading/src/lib.rs:454`):

$ p_b >= p_s $ <eq-cross>

and the execution price is the seller's limit (`lib.rs:462`;
`instructions/sharded_match_orders.rs:40`):

$ p^* = p_s $ <eq-exec>

That is, the full bid–ask spread accrues to the buyer, a deliberately conservative
rule for a market in which buyers are predominantly consumers.

*Off-chain matching (settled on-chain).* The off-chain CDA engine is free to
choose any execution price, but settlement enforces that the price lies within
the limits *signed by both counterparties* in their Ed25519 payloads
(`instructions/settle_offchain.rs:718`–`719`, `SlippageExceeded`):

$ p_s <= p^* <= p_b $ <eq-bounds>

so no participant can be settled at a price worse than the limit they signed,
regardless of engine behaviour. The reference engine splits the spread at the
midpoint, $p^* = floor((p_b + p_s) \/ 2)$
(`scripts/simulate-market-clearing.ts:131`), which divides the surplus equally
between the counterparties.

*Uniform-price epoch clearing.* Accumulated bids clear at a single price per
15-minute epoch. The oracle admits a clearing trigger only on an exact 900-second
boundary strictly newer than the last cleared epoch
(`programs/oracle/src/lib.rs:202`–`212`), and each executed match records its
price as the zone's `last_clearing_price` (`programs/trading/src/lib.rs:494`;
`settle_offchain.rs:946`).

*Uniform-price clearing, algorithmically.* The on-chain clearing instruction
(`clear_auction`, `programs/trading/src/lib.rs:344`) computes the epoch price
from the submitted order tranches in four integer-only steps. Asks are sorted
ascending and bids descending by limit price; each sorted side is folded into
a cumulative step curve of `(price, cumulative_volume)` points using
saturating accumulation. The clearing point is then the volume-maximising
feasible pair: a scan over all supply×demand point pairs keeps the pair with
`ask_price ≤ bid_price` that maximises
`min(cumulative_supply, cumulative_demand)`, and sets $p^*$ to the *marginal
ask* price at that pair (`find_clearing_point`,
`programs/trading/src/lib.rs:1054`) — the seller side of the crossing, which
makes the epoch price consistent with the CDA rule's seller-quote execution
(@eq-exec). Volume ties keep the first (lowest-ask) maximum, and a
non-crossing ladder — every ask above every bid — is rejected rather than
cleared at zero (`InvalidPrice`/`InvalidAmount`,
`programs/trading/src/lib.rs:1073`). Eligible orders (asks at or below $p^*$,
bids at or above) are then matched at $p^*$ up to their unfilled remainders.
Two operational bounds follow from earlier sections: the tranche vectors
travel in instruction data, so a clearing call carries at most a few orders
per side within the §4.5 packet (the §9.6 sweep drove it with four sell and
four buy tranches per transaction), and the nested scan is $O(S times D)$ in
tranche counts — negligible at packet-bounded sizes, but the reason tranche
batching, not order-book scale, is the unit of on-chain clearing.

*Price transparency.* The market maintains a 24-slot ring buffer of recent trade
prices and recomputes a volume-weighted average price on each update
(`programs/trading/src/lib.rs:820`–`863`):

$ "VWAP" = floor(frac(sum_i p_i v_i, sum_i v_i)) $ <eq-vwap>

Network charges (market fee, wheeling, and loss, §11.3) are levied on top of the
execution price and are bounded by the 20% cap of @eq-cap, so the effective
delivered price a buyer faces is $p^*$ plus a capped, auditable surcharge.

*Surplus allocation across price rules.* The three market rules above — and a
non-market feed-in baseline — divide the same bid–ask spread $Delta = p_b - p_s$
differently, while the settlement arithmetic of §11.3 applies identically on top
of whichever $p^*$ each rule selects. Writing the seller's spread share as
$(p^* - p_s) \/ Delta$ and the buyer's as its complement $(p_b - p^*) \/ Delta$,
the rules span the full range from buyer-favourable to even-split, and a feed-in
tariff removes the bilateral trade entirely — paying the seller an exogenous rate
$p_"fit"$ regardless of any bid, so the surplus $q Delta$ accrues to the single
off-taker rather than the counterparties. @tab-price-rules states each rule and
works a representative intra-zone match at $p_s = 3.00$, $p_b = 4.00$ THBC/kWh
($Delta = 1.00$), with an illustrative $p_"fit" = 2.20$ THBC/kWh — a reference
export rate, not a measured value.

#figure(
  caption: [Execution price and bid–ask-spread allocation under each price rule,
    for a representative match ($p_s = 3.00$, $p_b = 4.00$ THBC/kWh,
    $Delta = 1.00$). Network charges (§11.3) apply identically on top of $p^*$ and
    are omitted here to isolate the spread split. All three market rules keep
    $p^*$ inside the counterparties' signed limits (@eq-bounds); the feed-in row
    is a non-market baseline (no bilateral match) and $p_"fit"$ is illustrative.],
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (left, center, right, right, left),
    table.header([*Price rule*], [*$p^*$*], [*Seller*], [*Buyer*], [*Source*]),
    [CDA on-chain (immediate)], [$p_s = 3.00$], [0%], [100%],
      [`lib.rs:462`; `sharded_match_orders.rs:40`],
    [Off-chain midpoint (ref. engine)], [$3.50$], [50%], [50%],
      [`simulate-market-clearing.ts:131`],
    [Uniform-price epoch ($p_c = 3.40$)], [$3.40$], [40%], [60%],
      [`lib.rs:494`; oracle `lib.rs:202`–`212`],
    [Feed-in tariff (non-market)], [$p_"fit" = 2.20$], [—], [—],
      [exogenous off-taker; no @eq-bounds match],
  ),
) <tab-price-rules>

Relative to the 2.20 THBC/kWh feed-in baseline, even the most buyer-favourable
market rule — CDA on-chain, $p^* = p_s$ — already lifts the seller to 3.00
THBC/kWh (a 36% premium) before charges, and the midpoint rule to 3.50 (+59%);
the surplus a feed-in tariff would transfer wholesale to the single off-taker is
instead divided between the two P2P counterparties. Because every market rule
constrains $p^*$ to the signed interval $[p_s, p_b]$ (@eq-bounds), the choice of
rule only *redistributes* the fixed gains-from-trade $q Delta$ between buyer and
seller; it never settles either side outside the price it authorised, and a
head-to-head welfare measurement of the three rules on matched trade data is left
to future work.

*Three price surfaces, one system.* A reviewer of the full platform meets
three quantities that could each be mistaken for "the price", and they are
deliberately not connected. First, the *market price* above: discovered
off-chain (or by epoch clearing), bounded on-chain by the counterparties'
signed limits — the only surface on which price discovery occurs. Second,
the *treasury rate* `grx_per_thbc_rate` (§11.4): an administrative
conversion set by the treasury authority and gated by reserve attestation,
not derived from market activity — the peg is a custody claim, not a price
feed. Third, the *oracle epoch*: despite the name "market clearing", the
oracle carries no price at all — it is a quantity-and-quality anchor whose
epoch boundary merely gates when clearing may run (§11.6). Energy quantities
flow from the oracle to minting; settled value flows from trading to the
treasury's accounting; no price flows between any pair of surfaces.

== 11.3 Trade settlement

Gross value — rescale the $10^15$-scaled product (9-dec energy $times$ 6-dec
price) back to 6-dec currency by the energy divisor $D_E = 10^9$
(`settle_offchain.rs:1145`):

$ V = floor(frac(q dot p, 10^9)) $ <eq-value>

Market fee (`settle_offchain.rs:788`):

$ F_m = floor(frac(V dot phi_m, 10^4)) $ <eq-fee>

Wheeling — flat per-kWh, *not* ad-valorem; same energy rescale as @eq-value
(`settle_offchain.rs:1160`):

$ C_w = floor(frac(q dot w, 10^9)) $ <eq-wheel>

Line loss (`settle_offchain.rs:1189`):

$ C_ell = floor(frac(V dot ell, 10^4)) $ <eq-loss>

Network charge and its cap invariant, $Theta = 2000$ bps (20%);
`ChargesExceedCap` if violated (`settle_offchain.rs:116`):

$ C_"net" = C_w + C_ell, quad C_"net" <= floor(frac(V dot Theta, 10^4)) $ <eq-cap>

Seller net proceeds, with feasibility $F_m + C_"net" <= V$ enforced
(`ChargesExceedValue`, `settle_offchain.rs:123`):

$ N_"seller" = V - F_m - C_"net" $ <eq-net>

*Rounding topology.* Four floors appear in @eq-value–@eq-loss and nowhere
else; their placement decides who absorbs integer dust. The value floor
(@eq-value) discards up to one currency atom ($10^(-6)$ THBC) of the exact
product $q p \/ 10^9$ — a truncation *against the seller*, since $V$ is both
the buyer's escrow debit and the settlement base. Each charge floor
(@eq-fee, @eq-wheel, @eq-loss) discards up to one atom of the exact charge —
truncations *for the seller*, since @eq-net subtracts floored deductions
from $V$ exactly. Per match, the seller's net therefore deviates from the
real-valued model by at most $plus.minus 3$ atoms and the buyer's cost by at
most $1$; because flooring is applied per match rather than per batch, the
worst-case drift across $n$ settlements is $O(n)$ atoms — at $10^6$ matches,
at most a few THBC — while the *on-chain* conservation identity
$V = N_"seller" + F_m + C_"net"$ holds exactly in atoms for every match by
construction (@eq-net is a subtraction of already-floored terms, verified as
identity I2 of §11.12). Dust never accumulates in any account: it simply
never leaves the buyer's escrow, because $V$ itself is the floored figure.

*Net proceeds under each price rule.* Applying @eq-value–@eq-net to the four
price rules of @tab-price-rules makes the difference in net proceeds concrete. The buyer's
escrow debit is the gross value $V$ (@eq-value) and splits into seller proceeds plus
the fee/wheeling/loss collectors (the on-chain conservation identity of §11.12),
so the buyer's delivered cost per kWh is $p^*$ while the network charges reduce
the *seller's* net. @tab-net-proceeds evaluates a $q = 10$ kWh intra-zone match
under representative charges — market fee $phi_m = 25$ bps (the on-chain default,
`initialize_market.rs:23`), wheeling $w = 0$ (intra-zone), and loss
$ell = 100$ bps — so the combined deduction is a flat $1.25%$ of $V$.

#figure(
  caption: [Seller net proceeds and buyer cost under each price rule, for a
    $q = 10$ kWh intra-zone match with $phi_m = 25$ bps, $w = 0$, $ell = 100$ bps
    (deduction $= 1.25%$ of $V$; @eq-value–@eq-net). Buyer cost per kWh is $p^*$
    (the charges are carved out of the seller side, §11.12). The feed-in row is a
    non-market baseline: the seller is paid $p_"fit"$ by a single off-taker with
    no P2P charges. Premium is seller net per kWh over the feed-in rate.],
  table(
    columns: (auto, auto, auto, auto, auto, auto),
    align: (left, center, right, right, right, right),
    table.header(
      [*Price rule*], [*$p^*$ (THBC/kWh)*], [*$V$ (THBC)*], [*fee+loss (THBC)*],
      [*seller net (THBC/kWh)*], [*vs feed-in*],
    ),
    [CDA on-chain ($p^* = p_s$)], [3.00], [30.00], [0.375], [2.9625], [+34.7%],
    [Uniform-price epoch ($p_c$)], [3.40], [34.00], [0.425], [3.3575], [+52.6%],
    [Off-chain midpoint], [3.50], [35.00], [0.4375], [3.4563], [+57.1%],
    [Feed-in tariff (baseline)], [2.20], [—], [—], [2.2000], [—],
  ),
) <tab-net-proceeds>

Two points follow. First, because the deduction is a fixed fraction of $V$ and
$V$ is monotone in $p^*$, the ranking of seller net across rules is identical to
the ranking of $p^*$ itself: the price rule chosen sets the seller's net proceeds,
and the charges scale it uniformly rather than reordering it. Second, every
market rule clears the feed-in baseline by a wide margin — the most
buyer-favourable rule (CDA on-chain) still nets the seller 2.96 THBC/kWh after
charges, a 34.7% premium over the 2.20 THBC/kWh export rate, and the midpoint rule
57.1% — so the on-chain charge load (1.25% here, capped at 20% by @eq-cap) is
small against the gains from trade the market realises relative to selling to a
single off-taker.

*The charge cap as an induced price floor.* The cap of @eq-cap is enforced in
two tiers: network charges (wheeling + loss) must stay within
`MAX_NETWORK_CHARGE_BPS` $= 2000$ basis points of $V$ (`ChargesExceedCap`),
and total deductions must not exceed $V$ (`ChargesExceedValue`,
`settle_offchain.rs:124` — defence in depth against a stale tariff
configuration). Because wheeling is flat per kWh while the cap is ad
valorem, the binding condition is a *price floor*: with wheeling rate $w$
and loss share $ell$, a match settles only if
$w \/ p^* + ell \/ 10^4 <= 0.20$, i.e.

$ p^* >= frac(w, 0.20 - ell \/ 10^4) $ <eq-price-floor>

At the representative Thai transmission charge of $w = 1.15$ THBC/kWh and
$ell = 5$ bps this floor is $p^* gt.eq 5.77$ THBC/kWh — *above* the entire
2.00–3.45 THBC/kWh band the fleet study trades in. The accounting comparison
below therefore models such tariffs off-chain (the §9.6 sweep records
matches through the discovery path, which levies no charges); pushing them
through escrow settlement unchanged would be rejected by the cap. The design
consequence is stated rather than hidden: at realistic flat wheeling rates,
either clearing prices must sit well above today's retail band, wheeling
must be subsidised or tiered, or the 20% ad-valorem cap must be
re-legislated for P2P — the cap converts a tariff-policy question into an
explicit protocol parameter.

*Wheeling sensitivity of the rule ranking.* The same flat-vs-ad-valorem
asymmetry reorders the price rules' seller outcomes. On the 80-meter,
30-day fleet dataset (1,734.5 kWh matched volume, ask ladder
3.00–3.45 THBC/kWh), the accounting model of @eq-value–@eq-net gives, in
seller net THBC/kWh:

#table(
  columns: (auto, auto, auto),
  align: (left, right, right),
  table.header([*Price rule*], [*$w = 0$*], [*$w = 1.15$ THBC/kWh*]),
  [Uniform-price ($p^* = 3.45$)], [3.44], [2.29],
  [CDA, seller-quote ($p^*$ per ask)], [3.22], [2.07],
  [Regulated buyback (2.20, exempt from network charges)], [2.20], [2.20],
)

With free wheeling both P2P rules dominate the buyback tariff by 46–56%;
at $w = 1.15$ the flat deduction — identical for both P2P rules because it
scales with energy, not value — compresses their advantage to 4% (uniform)
and *inverts* it for CDA, which falls 6% below the buyback rate. Whether P2P
trading benefits sellers at all is therefore decided less by the market
mechanism than by who bears the wheeling charge — a policy lever entirely
outside the protocol, made visible by the integer accounting above.

== 11.4 Treasury peg (GRX $arrow.l.r$ THBC)

Swap GRX $arrow.r$ THBC, divisor $D_G = 10^9$ atoms/whole-GRX
(`treasury/src/lib.rs:58`):

$ G = floor(frac(g_"in" dot r, 10^9)), quad
  F = floor(frac(G dot phi_s, 10^4)), quad
  n = G - F $ <eq-swap>

Peg invariants — reserve attestation freshness and full backing
(`PegBreach`, `treasury/src/lib.rs:70`):

$ t_"now" - t_"att" <= tau_"ttl", quad S_"thbc" + n <= R_"att" $ <eq-peg>

Redeem THBC $arrow.r$ GRX with collateral guards $a_"in" <= S_"thbc"$
(`SupplyUnderflow`) and $g_"out" <= V_"swap"$ (`InsufficientVault`)
(`treasury/src/lib.rs:91`):

$ g_"out" = floor(frac(a_"in" dot 10^9, r)) $ <eq-redeem>

== 11.5 MasterChef staking (GRX yield)

Accumulator update on `fund_rewards`, precision $Pi = 10^12$, requires $T > 0$
(`treasury/src/lib.rs:975`):

$ A <- A + floor(frac(a dot 10^12, T)) $ <eq-acc>

Pending reward and debt baseline for a position of size $s$; $Pi$ absorbs the
division loss (exactness unit-tested, `lib.rs:126`):

$ rho = max(0, floor(frac(s dot A, 10^12)) - d), quad
  d = floor(frac(s dot A, 10^12)) $ <eq-reward>

== 11.6 Oracle validation (15-min epoch)

Anomaly gate — integer cross-multiplication avoids float division, $kappa$ =
`max_production_consumption_ratio` (`oracle/src/lib.rs:462`):

$ E_"prod" dot 100 <= kappa dot E_"cons" $ <eq-anomaly>

Reading quality score (`oracle/src/lib.rs:370`):

$ Q = min(100, floor(frac(100 dot n_"valid", n_"valid" + n_"reject"))) $ <eq-quality>

Range admission: $E_"min" <= E <= E_"max"$.

== 11.7 Surplus tokenisation (generation mint)

Surplus energy that survives the validation of §11.6 is tokenised by the
energy-token program's `mint_generation` instruction (§6.4): the off-chain
pipeline aggregates a meter's net surplus over a 15-minute window and the
bridge submits one mint per (meter, window). The kWh-to-atoms conversion is a
single function shared by the producer and the bridge verifier, so both sides
agree on the exact bound and scaling
(`gridtokenx-blockchain-core/src/rpc/nats_schema.rs:127`). A window surplus of
$E$ kWh (an IEEE-754 double on the wire) mints

$ A = floor(E dot 10^9), quad "admitted iff" E "is finite" and 0 < E <= E_"max" and A >= 1 $ <eq-mint-scale>

with $E_"max" = 10^6$ kWh per meter-window (`nats_schema.rs:117`). The cap is
load-bearing rather than cosmetic: it bounds $A lt.approx 10^15 << 2^64$
*before* the float-to-integer cast, which for an adversarially large `f64`
would otherwise saturate to $2^64 - 1$ (Rust float casts saturate, not wrap)
and request an astronomical mint. Non-finite, non-positive, over-cap, and
rounds-to-zero values are rejected on both sides of the trust boundary.

On-chain, the mint executes only if three predicates hold
(`programs/energy-token/src/lib.rs:278`, `lib.rs:287`, `lib.rs:308`):

$ w equiv 0 space (mod 900 dot 10^3) and w > 0, quad
  M(m, w) = 0, quad
  k_"rec" in cal(V) $ <eq-mint-guards>

The window start $w$ (milliseconds) must sit on the same 900-second epoch grid
the oracle's clearing trigger enforces in seconds (§11.6); $M(m, w)$ is a
per-(meter, window) idempotency record — a replayed mint intent is a no-op
success, and the record is stamped only *after* a successful mint CPI, so a
failed mint leaves the window retryable while a completed one can never
double-mint; and the co-signing key $k_"rec"$ must be a member of the
registered REC-validator set $cal(V)$, with no opt-out — an empty set rejects
every generation mint (§6.4). The token supply then advances by exactly the
attested amount, $S arrow.l S + A$, tying issuance one-to-one to metered
surplus at $1 "kWh" = 10^9$ atoms.

== 11.8 Registry sharding & slashing

Deterministic shard from the first byte of the authority key $k$
(`registry/src/lib.rs:71`):

$ sigma(k) = k[0] mod 16 $ <eq-shard>

Validator-active predicate, $beta_"min" = 10^13$ atoms $= 10{,}000$ GRX
(`registry/src/lib.rs:35`):

$ "active" <==> s_"grx" >= beta_"min" $ <eq-active>

== 11.9 Parameters (data)

#table(
  columns: (auto, auto, auto),
  align: (left, right, left),
  table.header([*Parameter*], [*Value*], [*Meaning*]),
  [$D_E$, $D_G$], [$10^9$],       [energy / GRX atomic divisor],
  [$Pi$],         [$10^12$],      [staking accumulator precision],
  [$Theta$],      [$2000$ bps],   [max network-charge cap (20%)],
  [$beta_"min"$], [$10^13$ atoms],[min validator stake (10,000 GRX)],
  [shards],       [$16$],         [registry counter shards],
  [epoch],        [$900$ s],      [oracle market-clearing window],
  [$E_"max"$], [$10^6$ kWh],   [max single generation mint (@eq-mint-scale)],
  [GRID/GRX dec], [$9$],          [$1 "kWh" = 10^9$ atoms],
  [THBC dec],     [$6$],          [$1 "THB" = 10^6$ minor],
  [REC dec],      [$6$],          [$1$ token $= 1 "MWh"$],
)

== 11.10 Fleet-ingest benchmark: metric definitions and test data

The meter-scaling benchmark of §9.3 is defined formally as follows. A run at
fleet size $N$ submits one transaction per meter per epoch over $E = 2$ epochs.
Let $N_"ok"$ denote confirmed transactions, and attribute every non-confirmed
transaction to exactly one class: $N_"send"$ (rejected at submission),
$N_"val"$ (executed, failed an oracle guard), or $N_"exp"$ (accepted, never
confirmed within $tau_"conf"$). Conservation holds by construction:

$ N = N_"ok" + N_"send" + N_"val" + N_"exp" $ <eq-conserve>

Confirmed goodput over a burst starting at $t_0$ with last observed confirmation
at $t_"last"$ (the value reported as TPS throughout §9):

$ "TPS" = frac(N_"ok", t_"last" - t_0) $ <eq-goodput>

Per-transaction latency is $L_i = t_i^"conf" - t_i^"send"$, quantised by the
status-poll period $tau_"poll"$ (reported: median, 95th percentile, maximum).
The loss decomposition of Table 4 separates the validation-rejection rate from
true delivery loss:

$ nu = frac(N_"val", N), quad delta = frac(N_"send" + N_"exp", N) $ <eq-loss-split>

Because resubmission is idempotent (§9.3), $k$ independent retry rounds reduce
effective delivery loss to $delta^(k+1)$; the measured worst case
$delta = 0.0035$ (100,000 meters) yields $delta^2 approx 1.2 times 10^(-5)$
after a single retry. In the 200,000-meter extension sweep
(@tab-meter-scaling-ext) the measured $delta$ is exactly zero at every scale
over 1,020,000 first-attempt submissions.

The synthetic workload assigns meter $i$ the reading pair

$ E_"prod" (i) = 80 + (7i mod 420), quad E_"cons" (i) = 40 + (3i mod 210) $ <eq-workload>

which deliberately drives a fixed ≈0.47% of indices into violation of the anomaly gate
(@eq-anomaly with $kappa = 1000$): those transactions fail with `AnomalousReading` in every epoch, incurring a fee — a deterministic, in-band probe
that the oracle's input validation continues to fire under full fleet load. The
per-transaction compute figures (Table 4) are sampled from the tail of each
epoch's confirmed set, because the rotating ledger prunes older transaction
history under loads above roughly $10^5$ transactions.

Harness parameterisation (data):

#table(
  columns: (auto, auto, auto),
  align: (left, right, left),
  table.header([*Parameter*], [*Value*], [*Meaning*]),
  [$N$],            [80 … $2 times 10^5$],  [fleet size (distinct meter PDAs)],
  [$E$],            [2],            [epochs per run (init + steady-state)],
  [epoch spacing],  [$>= 61$ s],    [on-chain `min_reading_interval` + 1 (on-chain clock)],
  [$W$],            [3,000 tx],     [in-flight window (unconfirmed cap)],
  [$tau_"poll"$],   [1.5 s],        [bulk `getSignatureStatuses` sweep period],
  [$tau_"conf"$],   [90 s],         [confirmation deadline before a send is `expired`],
  [blockhash refresh], [10 s],      [cached recent-blockhash renewal],
  [send workers],   [64],           [concurrent submission tasks],
  [CU sample],      [≤200 tx/epoch],[tail-of-burst `getTransaction` sample],
  [retry],          [none],         [loss figures are first-attempt delivery],
  [commitment],     [`confirmed`],  [counting threshold for $N_"ok"$],
)

Harness: `scripts/bench-meter-throughput.ts`, driven across scales by
`scripts/run-meter-scale-sweep.sh`; per-run artifacts under
`test-results/meter-throughput-<N>m-<timestamp>.{json,md}` with the combined
tables in `test-results/meter-scale-summary-<timestamp>.{json,md}` (generated
by `scripts/summarize-meter-scale.ts`).

== 11.11 Order-entry benchmark: metric definitions and test data

The order-entry benchmark of §9.2 (Table 3, "CDA order entry") reuses the
metric definitions of §11.10 unchanged — outcome conservation (@eq-conserve),
confirmed goodput (@eq-goodput), and the loss split (@eq-loss-split) — applied
to a single burst of $N = 10^4$ `submit_limit_order_sharded` transactions
rather than per-meter epochs. The synthetic workload assigns order
$i in {0, dots, N-1}$ deterministically
(`scripts/bench-trading-throughput.ts:166`–`169`):

$ s(i) = i mod 2, quad
  q(i) = (1 + (i mod 50)) dot 10^9, quad
  p(i) = 3 dot 10^6 + (i mod 100) dot 10^4 $ <eq-order-workload>

alternating buy/sell side $s$, energy amount $q$ sweeping 1–50 kWh in
9-decimal atoms, and limit price $p$ sweeping 3.00–3.99 THBC/kWh in 6-decimal
minor units. Every price lies inside the admission band of @eq-band, so —
unlike the meter workload, which deliberately trips the anomaly gate — no order
is validation-rejected by design and the expected on-chain error rate is
$nu = 0$. Each order initialises its own PDA
(`[b"order", authority, order_id]` with `order_id` = base $+ i$) and lands on
zone shard

$ sigma_"ord" (i) = i mod 16 $ <eq-order-shard>

(round-robin, in contrast to the key-derived registry shard of @eq-shard). The
write set of order $i$ is thus its own order PDA plus shard
$sigma_"ord" (i)$ — 16-way disjoint by construction — plus two *shared*
writable accounts that serialise the path: the single fee-payer/authority, and
the zone-market account, which the account context declares writable
(`programs/trading/src/lib.rs:1755`) although the handler mutates only the
per-shard account. Transport and parameterisation are identical to §11.10
($W = 3{,}000$, $tau_"poll" = 1.5$ s, $tau_"conf" = 90$ s, 64 send workers, no
retry, `confirmed` commitment); zone 701, 16 pre-initialised shards.

Measured outcome (data, single run, 2026-07-07):

#table(
  columns: (auto, auto, auto),
  align: (left, right, left),
  table.header([*Quantity*], [*Value*], [*Definition*]),
  [$N$],            [10,000],        [orders submitted (one tx each)],
  [$N_"ok"$],       [9,977],         [confirmed (@eq-conserve)],
  [$N_"send"$ / $N_"val"$ / $N_"exp"$], [0 / 0 / 23], [send-rejected / on-chain error / expired],
  [$nu$],           [0%],            [validation-rejection rate (@eq-loss-split) — as designed],
  [$delta$],        [0.23%],         [delivery loss (@eq-loss-split); $delta^2 approx 5 times 10^(-6)$ after one retry],
  [$t_"last" - t_0$], [55.5 s],      [burst wall time],
  [TPS],            [179.65],        [confirmed goodput (@eq-goodput)],
  [$L$ p50 / p95 / max], [2,173 / 3,565 / 4,563 ms], [send→confirmed latency ($plus.minus tau_"poll"$)],
  [CU min / med / max], [9,884 / 12,886 / 23,384], [per-tx compute, $n = 200$ tail sample],
)

The base order-entry write (CU min 9,884) is the cheapest hot-path write
measured — below the 13,300–13,600 CU steady-state meter write of §11.10 — yet
its confirmed goodput (180 TPS) is lower than meter ingest by a factor of 2.6 at the same
transaction count on the same harness (462 TPS at $N = 10^4$, Table 4). Since
the transport, in-flight window, and fee-payer topology are identical, the gap
isolates the one structural difference: every order additionally write-locks
the shared zone-market account, so the 16 shards serialise behind it. The
entire measured loss is transport ($N_"val" = 0$, $N_"exp" = 23$), recoverable
by the idempotent-retry argument of §11.10.

Harness: `scripts/bench-trading-throughput.ts`; run artifact
`test-results/trading-order-entry-10000o-2026-07-07T12-58-45-123Z.{json,md}`,
summarised in #link("BENCHMARKS.md")[`BENCHMARKS.md`] §10.

== 11.12 Community-month benchmark: conservation identities and test data

The month simulation of §9.4 adds a *conservation* layer on top of the
delivery metrics of §11.10. Let $S_a (i, d)$ denote prosumer $i$'s
oracle-accepted surplus on day $d$ — the sum of per-interval surpluses over the
readings that passed the anomaly gate — and $C = 10$ kWh the daily sell cap.
The lifecycle mints

$ M(i, d) = min(S_a (i, d), thin C) $ <eq-cap-mint>

as GRID for each prosumer-day above the 0.1 kWh dust floor, and certifies the
remainder as RECs at month end:

$ R(i) = sum_d S_a (i, d) - sum_d M(i, d) $ <eq-rec-claim>

Because `issue_erc` claims through the registry's `mark_erc_claimed` CPI, the
identity GRID + REC ≤ metered generation is enforced *on-chain* per meter, not
merely by harness arithmetic (§11.7). The run must therefore satisfy three
closure identities, each checkable from chain state:

$ sum_(i,d) M(i,d) = E_"settle" = E_"burn", quad
  sum_i R(i) = "REC supply" / 10^3, quad
  sum_m T_m = P_"sell" + W $ <eq-closure>

where $E_"settle"$ and $E_"burn"$ are the energy moved by settlement and
retired by burns, the REC mint carries 1,000 base units per kWh, and for each
match $m$ the buyer-escrow debit $T_m = floor(q_m p^* slash 10^9)$ splits into
seller proceeds $P_"sell"$ and the flat wheeling charge $W$ of @eq-wheel.

Measured outcome (canonical run, 2026-07-07; all values re-derived from live
chain state by `scripts/audit-community-month.ts`, 15/15 assertions passing):

#table(
  columns: (auto, auto, auto),
  align: (left, right, left),
  table.header([*Quantity*], [*Value*], [*On-chain source*]),
  [confirmed readings],  [229,481],  [$Sigma$ per-meter `total_readings` (80 `MeterState` PDAs)],
  [anomaly rejections],  [919],      [deterministic across 7 replays; fee-paid, on-ledger],
  [orders],              [2,396],    [`Order` PDA count],
  [settled matches],     [353],      [`TradeNullifier` count (order nullifiers = 706 = 2×)],
  [GRID minted (Wh)],    [3,290,724],[$Sigma$ `settled_net_generation` over 12 registry meters],
  [GRID supply after burns], [68 Wh], [`getTokenSupply` — only escrow-seed dust remains],
  [REC certified (Wh)],  [4,962,778],[$Sigma$ `claimed_erc_generation` = 12 certificates = supply $slash 10^3$],
  [closure @eq-closure], [3,290,724 + 4,962,778 = 8,253,502], [= oracle-accepted surplus, exact],
  [currency conservation], [13,137 = 12,832 + 305], [buyer outflow = seller proceeds + wheeling],
  [month wall time],     [1,394.7 s], [$1858 times$ real-time compression],
)

Transport and loss taxonomy are those of §11.10 with one addition: the
telemetry phase packs up to $B = 10$ readings per transaction along each
per-meter chain (ordering inside a transaction is free), which raises the
carried reading rate to ≈10× the transaction rate and eliminates delivery loss
entirely in the canonical run ($delta = 0$; the only non-confirmed submissions
are the 919 deliberate anomaly rejections, $nu = 0.40%$).

Harness: `scripts/bench-community-month.ts` (dataset exporter runs against the
smart-meter simulator's Python API); canonical artifact
`test-results/community-month-80m-12p-2026-07-07T16-45-40-924Z.{json,md}`,
audited run `…T17-18-23-134Z`, summarised in
#link("BENCHMARKS.md")[`BENCHMARKS.md`] §11.
