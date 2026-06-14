//! CFMM-augmented batch clear tests (`MATH.md` section 8.3, arXiv 2210.04929).
//!
//! Verifiable claims:
//!   * PARITY PRESERVED: an empty pool clears byte-identically to the baseline
//!     auction (so the 4006/4006 dsam parity is untouched).
//!   * BACKSTOP LIQUIDITY: a thin book that would NOT cross on its own clears
//!     against the pool.
//!   * SINGLE PRICE incl. the pool, and base/quote CONSERVATION.
//!   * POOL INDIVIDUAL RATIONALITY: the pool only trades at a price at least as
//!     good as its curve, so its invariant k never decreases.

use crossbar_clearing::{
    clear_batch_auction, clear_batch_with_cfmm, Cfmm, ClearOutcome, Order, PRICE_SCALE, Side,
};
use crossbar_clearing::cfmm::Cfmm as CfmmTy;

const SCALE: u64 = PRICE_SCALE;

fn fills(out: &ClearOutcome) -> Vec<(u64, u64)> {
    match out {
        ClearOutcome::Cleared { fills, .. } => {
            let mut v: Vec<(u64, u64)> = fills.iter().map(|f| (f.order_id, f.filled)).collect();
            v.sort();
            v
        }
        ClearOutcome::Empty => vec![],
    }
}

#[test]
fn empty_pool_equals_baseline_auction() {
    // The whole point: with no pool, the CFMM-augmented clear is identical to
    // the certified baseline -> the 4006/4006 parity is preserved.
    let empty = Cfmm { base: 0, quote: 0 };
    let books: Vec<Vec<Order>> = vec![
        vec![],
        vec![Order::buy(1, 100 * SCALE, 10), Order::sell(2, 100 * SCALE, 10)],
        vec![Order::buy(1, 105 * SCALE, 10), Order::buy(2, 100 * SCALE, 10), Order::sell(3, 100 * SCALE, 15)],
        vec![Order::buy(1, 99 * SCALE, 10), Order::sell(2, 101 * SCALE, 10)], // no cross
    ];
    for b in &books {
        let base = clear_batch_auction(b, Some(100 * SCALE));
        let aug = clear_batch_with_cfmm(b, Some(100 * SCALE), empty, 90 * SCALE, 110 * SCALE, 8);
        assert_eq!(fills(&base), fills(&aug), "empty pool must equal baseline");
    }
}

#[test]
fn thin_book_clears_against_pool() {
    // One lonely buyer, no seller in the book. On its own this does NOT cross.
    // With a pool (spot 100), the buyer clears against the pool's sell ladder.
    let book = vec![Order::buy(1, 102 * SCALE, 50)];
    let alone = clear_batch_auction(&book, Some(100 * SCALE));
    assert!(matches!(alone, ClearOutcome::Empty), "no cross without the pool");

    let pool = Cfmm { base: 1_000_000, quote: 100_000_000 }; // spot = 100
    let aug = clear_batch_with_cfmm(&book, Some(100 * SCALE), pool, 95 * SCALE, 105 * SCALE, 16);
    match aug {
        ClearOutcome::Cleared { matched_volume, clearing_price, .. } => {
            assert!(matched_volume > 0, "pool provides backstop liquidity");
            assert!(clearing_price >= 100 * SCALE && clearing_price <= 102 * SCALE,
                "p* between spot and the buyer's limit: {}", clearing_price);
        }
        ClearOutcome::Empty => panic!("expected a clear against the pool"),
    }
}

// ---- property test: single price, conservation, pool IR (k non-decreasing) --
struct Lcg(u64);
impl Lcg {
    fn next_u64(&mut self) -> u64 { self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1); self.0 }
    fn range(&mut self, lo: u64, hi: u64) -> u64 { lo + self.next_u64() % (hi - lo) }
}

#[test]
fn pool_is_individually_rational_and_clear_conserves() {
    let mut rng = Lcg(0x_C0FF_EE_CF31_0001);
    let mut checked = 0;
    for _ in 0..15_000 {
        // random book
        let n = rng.range(0, 14);
        let mut orders = Vec::new();
        for i in 0..n {
            let is_buy = rng.next_u64() & 1 == 0;
            let price = rng.range(96, 105) * SCALE;
            let qty = rng.range(1, 40);
            orders.push(if is_buy { Order::buy(i + 1, price, qty) } else { Order::sell(i + 1, price, qty) });
        }
        // random pool around spot ~100
        let base = rng.range(500_000, 2_000_000) as u128;
        let quote = (base as u64 * rng.range(95, 106)) as u128; // spot ~ 95..105
        let pool = CfmmTy { base, quote };
        let (lo, hi) = (90 * SCALE, 110 * SCALE);
        let out = clear_batch_with_cfmm(&orders, Some(100 * SCALE), pool, lo, hi, 12);

        let (p_star, matched) = match &out {
            ClearOutcome::Cleared { clearing_price, matched_volume, .. } => (*clearing_price, *matched_volume),
            ClearOutcome::Empty => continue,
        };
        // Single price + IR for every fill (incl. pool ladder orders).
        let ladder = pool.ladder(lo, hi, 12);
        let mut pool_base_in: u128 = 0;  // pool bought base (BUY ladder fills)
        let mut pool_base_out: u128 = 0; // pool sold base   (SELL ladder fills)
        let mut buy_vol: u128 = 0;
        let mut sell_vol: u128 = 0;
        if let ClearOutcome::Cleared { fills, .. } = &out {
            for f in fills {
                // find the order (book or ladder) this fill belongs to
                let o = orders.iter().chain(ladder.iter()).find(|o| o.order_id == f.order_id).unwrap();
                match o.side {
                    Side::Buy => { assert!(o.price_limit >= p_star); buy_vol += f.filled as u128; }
                    Side::Sell => { assert!(o.price_limit <= p_star); sell_vol += f.filled as u128; }
                }
                if CfmmTy::is_cfmm_order(f.order_id) {
                    match o.side {
                        Side::Buy => pool_base_in += f.filled as u128,
                        Side::Sell => pool_base_out += f.filled as u128,
                    }
                }
            }
        }
        // Conservation: total base bought == total base sold == matched volume.
        assert_eq!(buy_vol, sell_vol, "base conservation");
        assert_eq!(buy_vol as u64, matched, "matched volume == buy volume");

        // Pool individual rationality: applying its net fill at p* must not
        // decrease k (it trades at p* which is >= its sell limits / <= its buy
        // limits, i.e. at least as good as its own curve).
        if pool_base_in > 0 || pool_base_out > 0 {
            let p = p_star as u128;
            let quote_in = pool_base_out.saturating_mul(p) / SCALE as u128;  // sold base -> got quote
            let quote_out = pool_base_in.saturating_mul(p) / SCALE as u128;  // bought base -> paid quote
            let np = pool.apply(pool_base_in, pool_base_out, quote_in, quote_out);
            // allow a tiny slack for integer/discretization rounding
            let k0 = pool.k();
            let k1 = np.k();
            assert!(k1 + k0 / 10_000 >= k0, "pool k decreased: {k0} -> {k1}");
            checked += 1;
        }
    }
    assert!(checked > 100, "expected many batches to actually use the pool ({checked})");
}
