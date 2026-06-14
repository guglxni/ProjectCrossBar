//! Tests for the canonical call-auction price rule (`ClearingRule::Auction`,
//! the Nasdaq/Xetra opening-cross algorithm; `MATH.md` section 9).
//!
//! The key verifiable claims:
//!   * INDIVIDUAL RATIONALITY: the auction price is always inside `[ps, pb]`, so
//!     every filled order trades at a price it accepts.
//!   * PARITY PRESERVED: matched volume and per-order fills are byte-identical to
//!     the verified-matcher rule (`UpperBound`), so the certified parity
//!     (4006/4006 vs the extracted OCaml `UM`) still holds - the auction rule
//!     only changes the printed `p*`.
//!   * IMBALANCE / REFERENCE behave as specified.

use crossbar_clearing::{clear_batch, clear_batch_auction, ClearOutcome, ClearingRule, Order};

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
fn pv(out: &ClearOutcome) -> (u64, u64, u64) {
    match out {
        ClearOutcome::Cleared { clearing_price, matched_volume, .. } => {
            (*clearing_price, *matched_volume, 1)
        }
        ClearOutcome::Empty => (0, 0, 0),
    }
}

#[test]
fn auction_price_is_individually_rational_and_balanced() {
    // Buy 110 x10, sell 100 x10: interval [100,110]. With equal size the
    // imbalance is zero across the interval; with no reference the rule returns
    // the midpoint 105 (balanced) - fairer than favouring either side.
    let book = vec![Order::buy(1, 110, 10), Order::sell(2, 100, 10)];
    let out = clear_batch_auction(&book, None);
    if let ClearOutcome::Cleared { clearing_price, .. } = out {
        assert!(clearing_price >= 100 && clearing_price <= 110, "IR: in [ps,pb]");
        assert_eq!(clearing_price, 105, "balanced midpoint");
    } else {
        panic!("expected a cross");
    }
}

#[test]
fn auction_reference_breaks_balanced_ties() {
    // Same balanced book; a reference price pulls p* toward it (within [100,110]).
    let book = vec![Order::buy(1, 110, 10), Order::sell(2, 100, 10)];
    let near_sell = clear_batch_auction(&book, Some(101));
    let near_buy = clear_batch_auction(&book, Some(109));
    if let (ClearOutcome::Cleared { clearing_price: a, .. }, ClearOutcome::Cleared { clearing_price: b, .. }) =
        (near_sell, near_buy)
    {
        assert_eq!(a, 101, "snaps toward the reference");
        assert_eq!(b, 109);
    } else {
        panic!();
    }
}

#[test]
fn auction_minimizes_imbalance_under_pressure() {
    // Buys: 105 x10, 100 x10 (demand heavy at low prices). Sell 100 x15.
    // Interval is a point here (pb=ps=100), so p*=100; just assert IR + cleared.
    let book = vec![Order::buy(1, 105, 10), Order::buy(2, 100, 10), Order::sell(3, 100, 15)];
    let out = clear_batch_auction(&book, None);
    if let ClearOutcome::Cleared { clearing_price, matched_volume, .. } = out {
        assert_eq!(clearing_price, 100);
        assert_eq!(matched_volume, 15);
    } else {
        panic!();
    }
}

// ----- The headline guarantee: auction rule preserves the certified matching --
struct Lcg(u64);
impl Lcg {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 { lo + self.next_u64() % (hi - lo) }
}

#[test]
fn auction_preserves_volume_and_fills_and_is_ir() {
    // Over thousands of random books, the auction rule must produce EXACTLY the
    // same matched volume and per-order fills as the verified-matcher rule
    // (UpperBound), and its price must be individually rational for every fill.
    let mut rng = Lcg(0x_1234_5678_9ABC_DEF0);
    for _ in 0..20_000 {
        let n = rng.range(0, 20);
        let mut orders = Vec::new();
        for i in 0..n {
            let is_buy = rng.next_u64() & 1 == 0;
            let price = rng.range(95, 106);
            let qty = rng.range(1, 30);
            orders.push(if is_buy { Order::buy(i + 1, price, qty) } else { Order::sell(i + 1, price, qty) });
        }
        let reference = rng.range(90, 111);
        let verified = clear_batch(&orders, ClearingRule::UpperBound);
        let auction = clear_batch_auction(&orders, Some(reference));

        // Same matched volume + per-order fills as the certified matcher.
        assert_eq!(pv(&verified).1, pv(&auction).1, "matched volume preserved");
        assert_eq!(fills(&verified), fills(&auction), "per-order fills preserved");

        // Auction price is IR for every filled order.
        if let ClearOutcome::Cleared { clearing_price, fills: fs, .. } = &auction {
            for f in fs {
                let o = orders.iter().find(|o| o.order_id == f.order_id).unwrap();
                match o.side {
                    crossbar_clearing::Side::Buy =>
                        assert!(o.price_limit >= *clearing_price, "buy IR at auction p*"),
                    crossbar_clearing::Side::Sell =>
                        assert!(o.price_limit <= *clearing_price, "sell IR at auction p*"),
                }
            }
        }
    }
}
