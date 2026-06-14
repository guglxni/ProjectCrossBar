//! Property-based invariant tests for the clearing engine (`MATH.md` section
//! 6.1 "property-based random batches", `REQUIREMENTS.md` N1/N4).
//!
//! These assert the invariants that must hold for EVERY batch, over thousands
//! of pseudo-random books. They are the off-chain safety net that complements
//! the differential parity test against `vendor/dsam` (which checks the engine
//! against an independent verified implementation; this checks the engine
//! against its own specification).
//!
//! Invariants checked per batch:
//!   * N4 single price: there is one `p*`; it is individually rational for
//!     every filled order (buy limit >= p*, sell limit <= p*).
//!   * Conservation: total filled buy volume == total filled sell volume ==
//!     matched_volume.
//!   * No over-fill: no order fills more than its quantity.
//!   * Maximality-of-uniform-volume: matched_volume == max_p min(D(p), S(p)).
//!   * N1 determinism: a shuffled batch yields identical fills and p*.
//!
//! The PRNG is a tiny dependency-free LCG so the crate keeps zero deps and the
//! fixtures are reproducible from the seed.

use crossbar_clearing::{clear_batch, ClearOutcome, ClearingRule, Order, Side};

/// Reproducible LCG (Numerical Recipes constants). Deterministic by seed so a
/// failing case can be replayed.
struct Lcg(u64);
impl Lcg {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        debug_assert!(hi > lo);
        lo + self.next_u64() % (hi - lo)
    }
}

fn random_batch(rng: &mut Lcg, max_orders: u64) -> Vec<Order> {
    let n = rng.range(0, max_orders + 1);
    let mut orders = Vec::new();
    for i in 0..n {
        let side = if rng.next_u64() & 1 == 0 { Side::Buy } else { Side::Sell };
        // Prices in a tight band so books actually cross often.
        let price = rng.range(90, 111);
        let qty = rng.range(1, 50);
        let o = match side {
            Side::Buy => Order::buy(i + 1, price, qty),
            Side::Sell => Order::sell(i + 1, price, qty),
        };
        orders.push(o);
    }
    orders
}

fn max_uniform_volume(orders: &[Order]) -> u128 {
    let mut prices: Vec<u64> = orders.iter().map(|o| o.price_limit).collect();
    prices.sort_unstable();
    prices.dedup();
    let mut best: u128 = 0;
    for &p in &prices {
        let d: u128 = orders
            .iter()
            .filter(|o| o.side == Side::Buy && o.price_limit >= p)
            .map(|o| o.quantity as u128)
            .sum();
        let s: u128 = orders
            .iter()
            .filter(|o| o.side == Side::Sell && o.price_limit <= p)
            .map(|o| o.quantity as u128)
            .sum();
        best = best.max(d.min(s));
    }
    best
}

fn check_invariants(orders: &[Order], rule: ClearingRule) {
    let out = clear_batch(orders, rule);
    let expected_volume = max_uniform_volume(orders);

    match out {
        ClearOutcome::Empty => {
            assert_eq!(expected_volume, 0, "Empty only when no uniform volume exists");
        }
        ClearOutcome::Cleared { clearing_price, matched_volume, ref fills, .. } => {
            assert_eq!(
                matched_volume as u128, expected_volume,
                "matched volume must equal max uniform-price volume"
            );
            assert!(matched_volume > 0, "Cleared implies positive volume");

            // Map order_id -> order for IR and over-fill checks.
            let mut buy_filled: u128 = 0;
            let mut sell_filled: u128 = 0;
            for f in fills {
                let o = orders
                    .iter()
                    .find(|o| o.order_id == f.order_id)
                    .expect("fill references a real order");
                assert!(f.filled <= o.quantity, "no order over-fills");
                match o.side {
                    Side::Buy => {
                        // Individual rationality + single price.
                        assert!(
                            o.price_limit >= clearing_price,
                            "filled buy must be IR at p* (limit {} >= p* {})",
                            o.price_limit,
                            clearing_price
                        );
                        buy_filled += f.filled as u128;
                    }
                    Side::Sell => {
                        assert!(
                            o.price_limit <= clearing_price,
                            "filled sell must be IR at p* (limit {} <= p* {})",
                            o.price_limit,
                            clearing_price
                        );
                        sell_filled += f.filled as u128;
                    }
                }
            }
            // Conservation: both sides trade exactly the matched volume.
            assert_eq!(buy_filled, matched_volume as u128, "buy volume == matched");
            assert_eq!(sell_filled, matched_volume as u128, "sell volume == matched");
        }
    }
}

#[test]
fn invariants_hold_over_random_books() {
    let rules = [
        ClearingRule::MidpointFloor,
        ClearingRule::LowerBound,
        ClearingRule::UpperBound,
    ];
    let mut rng = Lcg(0x_C0FF_EE_1234_5678);
    for _ in 0..20_000 {
        let batch = random_batch(&mut rng, 24);
        for &rule in &rules {
            check_invariants(&batch, rule);
        }
    }
}

#[test]
fn determinism_over_random_shuffles() {
    // N1: a shuffled batch must clear to identical p* and fills.
    let mut rng = Lcg(0x_1357_9BDF_2468_ACE0);
    for _ in 0..5_000 {
        let batch = random_batch(&mut rng, 24);
        let canonical = clear_batch(&batch, ClearingRule::MidpointFloor);

        // Fisher-Yates shuffle with the same rng stream.
        let mut shuffled = batch.clone();
        let len = shuffled.len();
        for i in (1..len).rev() {
            let j = (rng.range(0, (i as u64) + 1)) as usize;
            shuffled.swap(i, j);
        }
        let reclear = clear_batch(&shuffled, ClearingRule::MidpointFloor);
        assert_eq!(reclear, canonical, "shuffling a batch changed the clearing");
    }
}

#[test]
fn reference_clamped_rule_stays_in_band() {
    // ReferenceClamped must always print a price inside the IR interval, so it
    // can never break single-price IR regardless of the reference value.
    let mut rng = Lcg(0x_DEAD_BEEF_F00D_2222);
    for _ in 0..5_000 {
        let batch = random_batch(&mut rng, 16);
        let p_ref = rng.range(50, 160);
        check_invariants(&batch, ClearingRule::ReferenceClamped(p_ref));
    }
}
