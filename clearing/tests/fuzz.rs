//! Adversarial fuzz harness for the clearing engine (audit round 2, grade-A
//! "fuzz tested" requirement). Where `invariants.rs` uses a tight, crossing
//! price band, this file hammers EXTREME and ADVERSARIAL inputs across every
//! public entry point and the CFMM backstop, asserting the safety invariants on
//! each iteration. Because the test/dev profile keeps `overflow-checks = true`
//! (as does the on-chain release profile, `Cargo.toml`), any arithmetic overflow
//! or division-by-zero surfaces as a panic and FAILS the test — so a clean run
//! over hundreds of thousands of adversarial books is a proof of panic-freedom
//! plus invariant-preservation on those paths.
//!
//! Magnitude tiers (price/qty upper bounds): up to ~1e15. That is the
//! adversarial ceiling that keeps `price * qty` within `u128` (1e15 * 1e15 = 1e30
//! << u128::MAX ~ 3.4e38) while far exceeding any real token supply — i.e. it
//! stresses the matcher well past anything reachable on-chain (escrow caps real
//! quantities far lower) without testing meaningless out-of-u128 inputs.
//!
//! Dependency-free (a tiny LCG), reproducible by seed.

use crossbar_clearing::{
    clear_batch, clear_batch_auction, clear_batch_dual_flow, clear_batch_with_cfmm, Cfmm,
    ClearOutcome, ClearingRule, Flow, Order, Price, Qty, Side,
};

struct Lcg(u64);
impl Lcg {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0
    }
    /// Inclusive-exclusive range; `hi > lo`.
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next_u64() % (hi - lo)
    }
    fn upto(&mut self, hi_inclusive: u64) -> u64 {
        if hi_inclusive == 0 { 0 } else { self.next_u64() % (hi_inclusive + 1) }
    }
}

/// Generate an adversarial batch. `pmax`/`qmax` are the price/quantity ceilings.
/// Mixes uniform draws with edge values (1, pmax, and a few shared "hot" prices
/// so books still cross at high magnitudes).
fn adversarial_batch(rng: &mut Lcg, n: usize, pmax: u64, qmax: u64) -> Vec<Order> {
    // A few shared hot prices so supply/demand actually cross.
    let hot = [
        1u64,
        pmax.max(1),
        rng.range(1, pmax.max(2)),
        rng.range(1, pmax.max(2)),
        pmax / 2 + 1,
    ];
    let mut orders = Vec::with_capacity(n);
    for i in 0..n {
        let side = if rng.next_u64() & 1 == 0 { Side::Buy } else { Side::Sell };
        let price = match rng.upto(3) {
            0 => 1,
            1 => pmax.max(1),
            2 => hot[(rng.upto(4)) as usize].max(1),
            _ => rng.range(1, pmax.max(2)),
        };
        let qty = match rng.upto(3) {
            0 => 1,
            1 => qmax.max(1),
            _ => rng.range(1, qmax.max(2)),
        };
        let flow = if rng.next_u64() & 1 == 0 { Flow::Maker } else { Flow::Taker };
        let o = match side {
            Side::Buy => Order::buy(i as u64 + 1, price, qty),
            Side::Sell => Order::sell(i as u64 + 1, price, qty),
        }
        .with_flow(flow);
        orders.push(o);
    }
    orders
}

/// The oracle: maximum uniform-price volume over the distinct order prices.
fn max_uniform_volume(orders: &[Order]) -> u128 {
    let mut prices: Vec<Price> = orders.iter().map(|o| o.price_limit).collect();
    prices.sort_unstable();
    prices.dedup();
    let mut best: u128 = 0;
    for &p in &prices {
        let d: u128 = orders.iter().filter(|o| o.side == Side::Buy && o.price_limit >= p)
            .map(|o| o.quantity as u128).sum();
        let s: u128 = orders.iter().filter(|o| o.side == Side::Sell && o.price_limit <= p)
            .map(|o| o.quantity as u128).sum();
        best = best.max(d.min(s));
    }
    best
}

/// Assert the universal safety invariants on a clear outcome.
fn assert_invariants(orders: &[Order], out: &ClearOutcome, expect_vol: u128, ctx: &str) {
    match out {
        ClearOutcome::Empty => {
            assert_eq!(expect_vol, 0, "{ctx}: Empty but a positive uniform volume exists");
        }
        ClearOutcome::Cleared { clearing_price, matched_volume, fills, .. } => {
            assert!(*matched_volume > 0, "{ctx}: Cleared with zero volume");
            assert_eq!(*matched_volume as u128, expect_vol, "{ctx}: matched != max uniform volume");
            let mut buy: u128 = 0;
            let mut sell: u128 = 0;
            for f in fills {
                let o = orders.iter().find(|o| o.order_id == f.order_id)
                    .unwrap_or_else(|| panic!("{ctx}: fill for unknown order {}", f.order_id));
                assert!(f.filled <= o.quantity, "{ctx}: over-fill ({} > {})", f.filled, o.quantity);
                match o.side {
                    Side::Buy => {
                        assert!(o.price_limit >= *clearing_price, "{ctx}: buy not IR at p*");
                        buy += f.filled as u128;
                    }
                    Side::Sell => {
                        assert!(o.price_limit <= *clearing_price, "{ctx}: sell not IR at p*");
                        sell += f.filled as u128;
                    }
                }
            }
            // Single-price conservation: both sides trade exactly matched_volume.
            assert_eq!(buy, *matched_volume as u128, "{ctx}: buy fills != matched");
            assert_eq!(sell, *matched_volume as u128, "{ctx}: sell fills != matched");
        }
    }
}

const TIERS: &[(u64, u64)] = &[
    (110, 50),                       // tight (crossing)
    (1_000, 1_000),                  // small
    (1_000_000, 1_000_000),          // medium
    (1_000_000_000_000, 1_000_000),  // large price
    (1_000_000, 1_000_000_000_000),  // large qty
    (1_000_000_000_000_000, 1_000_000_000_000_000), // extreme (u128-safe ceiling)
];

#[test]
fn fuzz_all_rules_extreme_inputs() {
    let mut rng = Lcg(0xF1F0_1234_5678_9ABC);
    let rules = [
        ClearingRule::LowerBound,
        ClearingRule::UpperBound,
        ClearingRule::MidpointFloor,
        ClearingRule::Auction(None),
    ];
    // Up to 70 orders > MAX_ORDERS_PER_BATCH (64) to stress beyond on-chain cap.
    for _ in 0..60_000 {
        let n = rng.upto(70) as usize;
        let (pmax, qmax) = TIERS[(rng.upto((TIERS.len() - 1) as u64)) as usize];
        let batch = adversarial_batch(&mut rng, n, pmax, qmax);
        let vol = max_uniform_volume(&batch);
        for &rule in &rules {
            let out = clear_batch(&batch, rule);
            assert_invariants(&batch, &out, vol, "clear_batch");
        }
        // Reference-clamped + auction-with-reference over an adversarial ref.
        let p_ref = rng.range(1, pmax.max(2));
        assert_invariants(&batch, &clear_batch(&batch, ClearingRule::ReferenceClamped(p_ref)), vol, "ref_clamped");
        assert_invariants(&batch, &clear_batch_auction(&batch, Some(p_ref)), vol, "auction");
        // Dual-flow: same matched volume + single price (maker priority at margin
        // changes WHO fills, not the cleared volume).
        assert_invariants(&batch, &clear_batch_dual_flow(&batch, rule_pick(&mut rng, &rules)), vol, "dual_flow");
    }
}

fn rule_pick(rng: &mut Lcg, rules: &[ClearingRule]) -> ClearingRule {
    rules[(rng.upto((rules.len() - 1) as u64)) as usize]
}

#[test]
fn fuzz_determinism_shuffle_extreme() {
    // N1 must hold at every magnitude: a permuted adversarial batch clears
    // identically.
    let mut rng = Lcg(0x0BAD_F00D_1357_2468);
    for _ in 0..30_000 {
        let n = rng.upto(40) as usize;
        let (pmax, qmax) = TIERS[(rng.upto((TIERS.len() - 1) as u64)) as usize];
        let batch = adversarial_batch(&mut rng, n, pmax, qmax);
        let canon = clear_batch(&batch, ClearingRule::Auction(None));
        let mut sh = batch.clone();
        for i in (1..sh.len()).rev() {
            let j = rng.upto(i as u64) as usize;
            sh.swap(i, j);
        }
        assert_eq!(clear_batch(&sh, ClearingRule::Auction(None)), canon, "N1 broken under shuffle");
    }
}

#[test]
fn fuzz_cfmm_backstop_extreme() {
    // The CFMM ladder is the path most exposed to overflow (audit M5/M6). Hammer
    // it with extreme reserves, wide/degenerate bands, and large level counts;
    // assert it never panics and the combined clear preserves the invariants.
    let mut rng = Lcg(0xCF11_ABCD_9876_5432);
    for _ in 0..40_000 {
        let base = rng.range(1, 1_000_000_000_000_000);
        let quote = rng.range(1, 1_000_000_000_000_000);
        let pool = Cfmm { base: base as u128, quote: quote as u128 };
        // spot() must never panic or wrap to nonsense.
        let spot = pool.spot();
        // Band can be wide, narrow, inverted, or zero-width; n_levels 0..=64.
        let lo_span = rng.range(1, 1_000_000);
        let lo = rng.upto(spot.saturating_add(lo_span));
        let hi_span = rng.range(1, 1_000_000_000);
        let hi = spot.saturating_add(rng.upto(hi_span));
        let n_levels = rng.upto(64) as u32;

        // ladder() must not panic at any band/level (this exercises the M5 fix).
        let ladder = pool.ladder(lo, hi, n_levels);
        for o in &ladder {
            assert!(o.quantity > 0, "cfmm ladder emitted a zero-qty order");
            assert!(o.price_limit > 0, "cfmm ladder emitted a zero-price order");
        }

        // Combined clear with a small adversarial book + the pool.
        let n = rng.upto(20) as usize;
        let (pmax, qmax) = TIERS[(rng.upto((TIERS.len() - 1) as u64)) as usize];
        let book = adversarial_batch(&mut rng, n, pmax, qmax);
        let reference = if rng.next_u64() & 1 == 0 { Some(rng.range(1, pmax.max(2))) } else { None };
        let out = clear_batch_with_cfmm(&book, reference, pool, lo, hi, n_levels);

        // Invariants over the COMBINED set (book + ladder), which is what the
        // matcher actually cleared.
        let mut combined = book.clone();
        combined.extend(ladder);
        let vol = max_uniform_volume(&combined);
        assert_invariants(&combined, &out, vol, "cfmm_combined");
    }
}

#[test]
fn fuzz_degenerate_shapes() {
    // Explicit degenerate shapes that random draws hit rarely: empty, single
    // order, all-buy, all-sell, all-same-price, and exactly-at-capacity books.
    let mut rng = Lcg(0xDEAD_0001_BEEF_0002);
    let rules = [ClearingRule::Auction(None), ClearingRule::UpperBound, ClearingRule::MidpointFloor];

    // Empty.
    for &r in &rules {
        assert!(matches!(clear_batch(&[], r), ClearOutcome::Empty));
    }
    // Single orders (each side), big values.
    for _ in 0..2_000 {
        let p = rng.range(1, 1_000_000_000_000_000);
        let q = rng.range(1, 1_000_000_000_000_000);
        for o in [Order::buy(1, p, q), Order::sell(1, p, q)] {
            let b = [o];
            let v = max_uniform_volume(&b);
            for &r in &rules {
                assert_invariants(&b, &clear_batch(&b, r), v, "single");
            }
        }
    }
    // All-buy / all-sell (no cross => Empty), and all-same-price (crosses fully).
    for _ in 0..4_000 {
        let n = rng.range(2, 30) as usize;
        let p = rng.range(1, 1_000_000_000);
        let all_buy: Vec<Order> = (0..n).map(|i| Order::buy(i as u64 + 1, p, rng.range(1, 1_000_000))).collect();
        let all_sell: Vec<Order> = (0..n).map(|i| Order::sell(i as u64 + 1, p, rng.range(1, 1_000_000))).collect();
        for &r in &rules {
            assert!(matches!(clear_batch(&all_buy, r), ClearOutcome::Empty), "all-buy must not cross");
            assert!(matches!(clear_batch(&all_sell, r), ClearOutcome::Empty), "all-sell must not cross");
        }
        // Same price, both sides: a perfect cross.
        let mut both = all_buy.clone();
        both.extend((0..n).map(|i| Order::sell((n + i) as u64 + 1, p, rng.range(1, 1_000_000))));
        let v = max_uniform_volume(&both);
        for &r in &rules {
            assert_invariants(&both, &clear_batch(&both, r), v, "same_price");
        }
    }
    let _ = (Qty::default(), Price::default()); // keep imports used across cfgs
}
