# MATH.md - Clearing Price, Dual-Flow, and the Verified Matcher

This file specifies the auction math precisely enough that a coding agent can implement `run_batch` and test it against a formally verified oracle. Read `architecture.md` section 2.3 first for where this sits in the system.

## 0. Notation

- A batch is the set of orders whose batch window equals the current tick.
- An order is `(side, price_limit, quantity, order_id)`. Side is buy or sell. `price_limit` is the worst price the order will accept (max for a buy, min for a sell). `quantity` is in base-asset units.
- `p*` is the single uniform clearing price for the batch.
- All prices are integers in quote units per base unit (fixed-point). Never use floats on-chain. Pick a scale factor in `TECHNICALDESIGN.md` and keep it everywhere.

## 1. Frequent Batch Auctions, the why

The seminal argument is Budish, Cramton, Shim, "The High-Frequency Trading Arms Race: Frequent Batch Auctions as a Market Design Response." A continuous limit order book rewards whoever reaches the matching engine first, which turns market quality into a latency race. A frequent batch auction collects orders over a short discrete window and clears them together at one price, so within a window there is no first-mover advantage. Competition moves from time to price.

The MEV framing is in the SoK on MEV countermeasures, arXiv 2212.05111 (https://arxiv.org/pdf/2212.05111). It classifies frequent batch auctions as a market-design MEV countermeasure and surveys on-chain instances (CowSwap, Fair-TraDEX) that outsource settlement to competing solvers. Project CrossBar differs by running the clear itself inside an Ephemeral Rollup as a deterministic on-protocol function rather than delegating it to off-chain solvers.

## 2. Uniform clearing price, single side pair

This is the M2 target (single-side clearing before dual-flow).

Construct two step functions over price:

- Demand `D(p)` = total buy quantity whose `price_limit >= p`. Non-increasing in `p`.
- Supply `S(p)` = total sell quantity whose `price_limit <= p`. Non-decreasing in `p`.

The clearing price `p*` is a price where the curves cross, that is where executable demand meets executable supply:

```
p* = a price at which  min(D(p), S(p))  is maximized
matched_volume(p*) = min(D(p*), S(p*))
```

Because both curves are step functions over the finite set of limit prices in the batch, the crossing is found by sorting the distinct limit prices and walking them. The crossing can be a single price or a flat interval. If it is an interval, pick the rule documented in section 5 (and keep it identical to the oracle's rule, or the differential test will flag a false mismatch).

Fills:

- Every buy with `price_limit > p*` fills fully (up to matched volume).
- Every sell with `price_limit < p*` fills fully (up to matched volume).
- Orders exactly at the margin (`price_limit == p*`) share the residual matched volume pro-rata (section 4).
- Every filled order, on both sides, trades at `p*`. No order trades at its own limit. This single-price property is the fairness guarantee.

## 3. Dual-flow batch auction, the M3 target

The dual-flow construction follows Jump Crypto's Dual Flow Batch Auction writeup, August 2025, https://jumpcrypto.com/resources/dual-flow-batch-auction . The idea: instead of one combined auction, run two independent auctions each tick, one over the maker flow and one over the taker flow, and cross them at a single fair clearing price. This removes the arrival-time privilege on each side independently and gives makers protection from toxic taker flow while still clearing everyone at one price. The reference cadence in that writeup is roughly every 100ms, which is inside Project CrossBar's 50 to 100ms tick band.

Implementation shape:

- Tag each resting order as maker flow or taker flow at submit time (see `TECHNICALDESIGN.md` for the flag on `OpenOrders`).
- Build demand and supply curves per flow.
- Compute the crossing price using the combined executable interest, then fill each flow at that one `p*`.
- The property to preserve: a single `p*` for the whole batch, maker and taker alike. Dual-flow changes how interest is aggregated and protected, not the single-price outcome.

Prior art that is base-L1 only: Archer Exchange uses dual flow batch auctions on a base-L1 CLOB. Project CrossBar's contribution is not the DFBA idea, it is running DFBA clearing inside an Ephemeral Rollup. Keep that distinction honest in `PROPOSAL.md`.

## 4. Pro-rata at the margin and the VRF tie-break

At the marginal price level the total quantity wanting to trade can exceed the residual matched volume. Allocate pro-rata by quantity:

```
fill_i = floor( residual_volume * quantity_i / sum_of_marginal_quantities )
```

Flooring leaves an indivisible remainder of a few base units. Assign that remainder by a VRF-determined order over the tied orders, using `ephemeral-vrf` (request then consume callback, see `INTEGRATIONS.md`). VRF is used only here. It never influences `p*` and never influences any non-marginal fill. If VRF does not return in time, fall back to a deterministic canonical order (lowest `order_id` first) and flag the batch, per `architecture.md` section 6. The fairness cost of the fallback is bounded to a remainder of a few units, which must be stated in the demo notes.

Reason for keeping VRF off the price path: the library is not audited. Blast radius stays at the remainder.

## 5. The impossibility tradeoff, state it openly

The verified-auction literature proves you cannot have everything at once. From Natarajan, Sarswat, Singh, "Verified Double Sided Auctions for Financial Markets," ITP 2021 (arXiv 2104.08437): no single matching algorithm can simultaneously be **fair**, **uniform** (single price), **individually rational**, and **maximal** (maximum matched volume). Real exchanges give up maximality and choose a fair, individually rational, uniform-price matching.

Project CrossBar makes the same choice: fair plus individually rational plus uniform price, sacrificing maximum matched volume. Document this in `PROPOSAL.md` as a deliberate, standard market-design decision rather than a limitation discovered late. The crossing rule in section 2 and the marginal-interval rule must be fixed to the fair-uniform-IR matching, and the oracle must be configured to the same rule.

## 6. The verified matcher as a correctness oracle

This is the single most important correctness control in the project (`architecture.md` section 6).

The TIFR group has machine-checked auction matchers in Coq with extraction to OCaml:

- Sarswat and Singh, "Formally Verified Trades in Financial Markets," ICFEM 2020 (arXiv 2007.10805): verifies properties of uniform-price and maximum-matching algorithms (fairness, uniformity, individual rationality).
- Natarajan, Sarswat, Singh, ITP 2021 (arXiv 2104.08437): double-sided auctions with multiplicity (multiple units per order), proves uniqueness theorems, and shows how to detect a buggy exchange by comparing its output against the verified program. Equal per-order trade volumes is the checkable invariant. Extracts to OCaml and Haskell, demonstrated on real market data.
- Garg and Sarswat, "Efficient and Verified Continuous Double Auctions," 2024 (arXiv 2412.08624): O(n log n) verified continuous double auction, less central here since Project CrossBar is a call auction, but the same group and proof style.

Primary oracle repo, double-sided auctions with multiplicity, which is exactly the call-auction / batch case:

- https://github.com/suneel-sarswat/dsam

Related repos (clone only if needed):

- https://github.com/suneel-sarswat/auction (original single-multiplicity development)
- https://github.com/suneel-sarswat/cda and https://github.com/ganitsutra/ecda (continuous double auction, not the batch case)

Verify exact build steps from the repo's own `Demo.v` and `auction.sh` before depending on file names. Extraction produces certified OCaml (the repos mention OCaml, Haskell, Scheme targets). Build the extracted OCaml matcher once, keep it under `vendor/` read-only, and call it from the test harness.

### 6.1 The differential test

```
for each batch fixture B:
    on_chain  = fills produced by run_batch(B) read out of BatchResult
    oracle    = fills produced by the extracted verified matcher on B
              (configured to fair + uniform-price + individually-rational)
    assert  p* matches
    assert  per-order filled quantity matches for every order_id
    (uniqueness theorem: a correct fair-uniform-IR matching is unique in per-order volumes,
     so any mismatch is a real bug, not a tie-break artifact)
```

Generate fixtures three ways: hand-written edge cases (empty book, one side empty, exact crossing, flat-interval crossing, marginal tie), property-based random batches, and replayed real-market depth if time allows (the ITP paper used real data). The marginal tie-break (VRF or fallback) is the one place where per-order volume can legitimately differ by a few units, so the assertion there is on `p*` and on total matched volume, not on the remainder assignment.

## 7. MEV-elimination argument, written out

Claim: within a batch, there is no profit from transaction ordering.

Sketch: `run_batch` is a pure deterministic function of the batch set and the reference price. It discards arrival order inside the window by construction (it sorts by price, never by time). Every matched order clears at the same `p*`. Therefore inserting, reordering, or sandwiching transactions inside one window cannot produce a better price for the attacker than any other participant gets, and cannot extract a worse price from the victim than `p*`. A sandwich that brackets a victim's order inside the same window fills at the same `p*` as the victim, so it captures nothing. This is the second demo scenario in `prd.md` section 3.

The residual ordering games that batching does not kill (cross-batch timing, choosing which batch to enter) are bounded by tick frequency and by the Pyth Lazer reference band, which rejects a `p*` outside `[p_ref (1 - delta), p_ref (1 + delta)]` so a thin or stale book cannot be cleared at a manipulated price (`architecture.md` section 2.4).

## 8. Auction price determination (research-backed price formation)

Sections 2 and 5 pin the matched volume and the per-order fills. They do not
pin the single number printed as `p*`: any price in the crossing interval
`[ps, pb]` (marginal seller price .. marginal buyer price) is fair, uniform,
and individually rational, and crucially the choice of price inside that
interval does not change matched volume or any per-order fill (proved in
`clearing/src/clear.rs` and exercised in `clearing/tests/auction_price.rs`).

That gives a free hand to adopt the price rule that production exchanges use,
without touching the verified matching. Project CrossBar implements the
**canonical call-auction price determination** (the Nasdaq opening/closing
cross and the Deutsche Boerse Xetra rule). Among the volume-maximizing prices:

1. **Minimize the order imbalance** `|D(p) - S(p)|`: pick the price where
   willing demand and supply are most balanced (least unexecuted quantity).
2. **Market pressure**: if several prices tie on imbalance, the heavy side
   tilts the price (buy-heavy -> higher, sell-heavy -> lower).
3. **Reference price**: if still balanced, anchor to the Pyth Lazer mid
   (clamped into the interval). This is where the oracle enters price
   *formation*, not just the accept/reject band of section 7.

Implementation: `ClearingRule::Auction(Option<p_ref>)`,
`clear::auction_clearing_price`. It is verifiable: the result is always inside
`[ps, pb]` (individually rational for every fill), and matched volume + fills
are byte-identical to the verified-matcher rule (so the 4006/4006 certified
parity against the extracted OCaml `UM` still holds). This is the rule
`run_batch` uses on-chain.

### 8.1 Randomized clearing time (implemented)

Source: Mastrolia & Xu, "Clearing time randomization and transaction fees for
auction market design", arXiv 2405.09764. They prove (Theorem 1) that with a
fixed, predictable close a strategic trader's optimal arrival is always the last
instant, dragging the clear off the efficient price ("bang the close"); making
the close time RANDOM and unknown until it happens flips that optimum. Strikingly
little randomization suffices: in their Bernoulli {9,10} model an ~8% chance of
closing one tick early already moves the optimum off the last instant.

This is the residual cross-batch timing game `section 7` admits batching alone
does not kill. CrossBar randomizes the close by counting crank ticks per window
and closing after a VRF-derived TARGET drawn uniformly from a small band
`[window_min_ticks, window_max_ticks]` (expected close ~ nominal, so the auction
is not systematically shortened). Implementation: `clearing/src/window.rs`
(pure: `next_target`, `should_close`), `Market.window_*` fields, the
window-formation gate in `run_batch` (status `Forming` while accumulating), and
`request_window_vrf` / `consume_window_vrf` (`ephemeral-vrf`), with the
deterministic fallback `target = window_max_ticks` if VRF does not return (a
bounded blast radius, like the marginal tie-break).

N1 is preserved: the gate is window FORMATION (it decides which orders fall in a
batch), reading only an instruction-counter (crank ticks) and the VRF target -
never a clock, slot, or arrival order. The matcher stays a pure function of the
realized set, and the order-fairness theorem (section 8.2) still holds.
Demonstrated on devnet (`tests/randclear-demo.ts`): orders accumulate across
ticks and the window closes only at its target tick.

### 8.2 Order fairness: subsumed by set-determinism, deliberately NOT implemented

Receive-order / temporal fairness widgets - Kursawe, "Wendy, the Good Little
Fairness Widget" (AFT 2020, arXiv 2007.08303), and Mavroudis & Melton, "Libra:
Fair Order-Matching for Electronic Financial Exchanges" (AFT 2019, arXiv
1910.00321) - guarantee properties about how ARRIVAL ORDER maps to execution
priority. Wendy's Order Fairness: if all honest parties saw `r1` before `r2`,
deliver `r1` before `r2`. Libra's Temporal Fairness: the probability a slower
participant beats an equally-responsive faster one is bounded. Both presuppose a
system whose outcome DEPENDS on order (continuous, time-priority books).

A frequent batch auction removes that dependency. `run_batch` is a pure function
of the batch SET and the reference price; it sorts by price and clears everyone
at one `p*`. Formally, for any permutation `pi` of a batch `B`,
`run_batch(B) = run_batch(pi(B))` - identical `p*`, volume, and per-order fills.
So intra-batch there is no "opportunity captured at the expense of a faster
participant" to bound (Libra's quantity is identically zero) and no "before /
after" to enforce (Wendy is vacuous on a set-valued clear). This is the STRONGEST
form of what those papers pursue: zero intra-batch order-sensitivity, vs Libra's
bounded-but-nonzero or Wendy's block-relative. Libra's own paper analyzes FBA as
a fairness mechanism for exactly this reason (within a batch, win probability is
0.5, arrival-symmetric).

Therefore CrossBar deliberately does NOT add a receive-order fairness layer:
honoring an arrival-derived order inside `run_batch` would feed sequence/time
into matching, contradicting N1 (`REQUIREMENTS.md` N1). It would be dead weight
at best and a determinism violation at worst. The theorem is enforced as a test:
`clearing/tests/order_fairness.rs` asserts permutation-invariance of `p*`,
volume, and every fill over ~20k random batches (for both the parity and auction
rules). The only residual ordering games are at the batch BOUNDARY (cross-batch
entry timing, placeholder/batch-trigger attacks), addressed by the randomized
clearing time of section 8.1.

### 8.3 CFMM backstop liquidity (implemented)

Source: Ramseyer, Goyal, Goel & Mazieres, "Augmenting Batch Exchanges with
Constant Function Market Makers", EC'24 (arXiv 2210.04929). A constant-function
market maker can be folded into a uniform-price batch clear: the pool behaves as
a smooth, price-monotone curve added to the order demand/supply, everyone (the
pool included) trades at one `p*`, and the pool's fill is individually rational.
This solves the cold-start "thin book" problem every batch DEX faces: a window
with little resting interest still clears against passive pool liquidity.

CrossBar implements this for a constant-product pool (`x * y = k`) in a way that
PRESERVES the verified matcher: the pool is discretized into synthetic maker
limit orders (a "ladder") across a price band and handed to the unchanged
matcher (`clearing/src/cfmm.rs`, `clear_batch_with_cfmm`). The one new numeric
primitive is an integer square root (`x(p) = floor(sqrt(k * PRICE_SCALE / p))`),
no floats. On-chain, `Market.cfmm_*` reserve fields drive the ladder in
`run_batch`; the pool's net fill updates the reserves at `p*`.

Verifiability (`clearing/tests/cfmm.rs`):
- PARITY PRESERVED: with zero reserves the augmented clear is byte-identical to
  the baseline auction, so the 4006/4006 dsam parity is untouched. The pool leg
  itself is outside dsam's model and is verified by its own property suite, not
  the Coq oracle (stated honestly).
- BACKSTOP: a thin book that would not cross on its own clears against the pool.
- SINGLE PRICE incl. the pool, base/quote CONSERVATION, and POOL INDIVIDUAL
  RATIONALITY (`k` never decreases - the pool trades at `p*`, at least as good
  as its own curve), property-tested over ~15k random (batch, pool) pairs.
- N1-clean: the ladder depends only on `(reserves, band)`, not arrival order.

Demonstrated on devnet (`tests/cfmm-demo.ts`): one buyer, no seller, clears
against the pool at one `p*`; reserves move along the constant-product curve.

Companion metric (Bertucci et al., arXiv 2405.00537): `band::price_improvement_bps`
quantifies execution quality (basis points of `p*` vs the Pyth reference) - used
to show the value the backstop and the auction rule add on thin books.

## 9. Citations

- Budish, Cramton, Shim. The High-Frequency Trading Arms Race: Frequent Batch Auctions as a Market Design Response. (FBA, seminal.)
- Jump Crypto. Dual Flow Batch Auction. Aug 2025. https://jumpcrypto.com/resources/dual-flow-batch-auction
- SoK MEV countermeasures. arXiv 2212.05111. https://arxiv.org/pdf/2212.05111
- Sarswat, Singh. Formally Verified Trades in Financial Markets. ICFEM 2020. arXiv 2007.10805.
- Natarajan, Sarswat, Singh. Verified Double Sided Auctions for Financial Markets. ITP 2021. arXiv 2104.08437.
- Garg, Sarswat. Efficient and Verified Continuous Double Auctions. 2024. arXiv 2412.08624.
- Oracle repo: https://github.com/suneel-sarswat/dsam
- Call-auction price determination (max volume, min imbalance, market pressure, reference): Nasdaq Opening/Closing Cross fact sheet; SEC SR-NASDAQ filings; Deutsche Boerse Xetra trading model. Analytic treatment: Derksen et al., "Exact and asymptotic solutions of the call auction problem", arXiv 1407.4512.
- Mastrolia, Xu. Clearing time randomization and transaction fees for auction market design. arXiv 2405.09764.
- Kursawe. Wendy, the Good Little Fairness Widget. AFT 2020. arXiv 2007.08303.
- Mavroudis, Melton. Libra: Fair Order-Matching for Electronic Financial Exchanges. AFT 2019. arXiv 1910.00321.
- Ramseyer, Goyal, Goel, Mazieres. Augmenting Batch Exchanges with Constant Function Market Makers. EC 2024. arXiv 2210.04929.
- Bertucci et al. Quantifying Price Improvement in Order Flow Auctions. arXiv 2405.00537.
