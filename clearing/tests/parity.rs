//! Differential parity test (`MATH.md` section 6.1, `REQUIREMENTS.md` F12,
//! `PLAN.md` T2.7).
//!
//! The gold-standard oracle is `vendor/dsam`'s extracted OCaml `UM` matcher.
//! Building it needs Coq + OCaml, which were not installed in the scaffold
//! environment, so `tests/parity/run_parity.sh` runs that path when the
//! toolchain is present.
//!
//! This file provides a parity test that runs *today* with `cargo test`: an
//! INDEPENDENT re-implementation of dsam's uniform matching (UM) algorithm,
//! written straight from the Coq definitions (`vendor/dsam/mUM.v`), with no
//! shared code with the engine under test. Two independent implementations
//! agreeing across thousands of random books is strong evidence of correctness;
//! the OCaml oracle then certifies it.
//!
//! dsam UM, from the Coq source:
//!   * bids sorted by decreasing price (`by_dbp`, mFair_Bid.v:50),
//!   * asks sorted by increasing price (`by_sp`, mFair_Ask.v:22),
//!   * greedy two-pointer match while `bid.price >= ask.price`,
//!   * uniform price = `bp (bid_of (last fill))` (mUM.v:131) = the price of the
//!     lowest matched bid = the marginal buyer price.
//!
//! Per MATH.md 6.1, the checkable invariants are `p*`, total matched volume,
//! and per-order fills for every NON-marginal order. At the marginal price the
//! split may legitimately differ (the engine rations pro-rata; dsam UM fills
//! sequentially), so there we assert only that the marginal level's totals
//! agree, not the per-order remainder.

use crossbar_clearing::{clear_batch, ClearOutcome, ClearingRule, Order, Side};

// ----- Independent reference: dsam UM ---------------------------------------

#[derive(Clone, Copy)]
struct Leg {
    id: u64,
    price: u64,
    qty: u64,
}

struct UmResult {
    clearing_price: u64,
    total: u64,
    /// (order_id, filled) for every order with a positive fill.
    fills: Vec<(u64, u64)>,
}

/// Reference uniform matching, transcribed from `vendor/dsam/mUM.v`.
fn dsam_um(orders: &[Order]) -> Option<UmResult> {
    let mut bids: Vec<Leg> = orders
        .iter()
        .filter(|o| o.side == Side::Buy)
        .map(|o| Leg { id: o.order_id, price: o.price_limit, qty: o.quantity })
        .collect();
    let mut asks: Vec<Leg> = orders
        .iter()
        .filter(|o| o.side == Side::Sell)
        .map(|o| Leg { id: o.order_id, price: o.price_limit, qty: o.quantity })
        .collect();

    // by_dbp: decreasing bid price. by_sp: increasing ask price. Ties broken by
    // id for a deterministic reference (does not affect p* or totals).
    bids.sort_by(|a, b| b.price.cmp(&a.price).then(a.id.cmp(&b.id)));
    asks.sort_by(|a, b| a.price.cmp(&b.price).then(a.id.cmp(&b.id)));

    let mut fills: std::collections::HashMap<u64, u64> = std::collections::HashMap::new();
    let mut total: u64 = 0;
    let mut last_bid_price: Option<u64> = None;

    let (mut i, mut j) = (0usize, 0usize);
    let mut brem = bids.first().map(|b| b.qty).unwrap_or(0);
    let mut arem = asks.first().map(|a| a.qty).unwrap_or(0);

    while i < bids.len() && j < asks.len() && bids[i].price >= asks[j].price {
        let t = brem.min(arem);
        if t > 0 {
            *fills.entry(bids[i].id).or_insert(0) += t;
            *fills.entry(asks[j].id).or_insert(0) += t;
            total += t;
            last_bid_price = Some(bids[i].price);
            brem -= t;
            arem -= t;
        }
        if brem == 0 {
            i += 1;
            brem = bids.get(i).map(|b| b.qty).unwrap_or(0);
        }
        if arem == 0 {
            j += 1;
            arem = asks.get(j).map(|a| a.qty).unwrap_or(0);
        }
    }

    last_bid_price.map(|p| UmResult {
        clearing_price: p,
        total,
        fills: {
            let mut v: Vec<(u64, u64)> = fills.into_iter().filter(|&(_, q)| q > 0).collect();
            v.sort();
            v
        },
    })
}

// ----- The differential assertion -------------------------------------------

fn assert_parity(orders: &[Order]) {
    // The engine uses the dsam-matching rule (UpperBound = marginal buyer
    // price). Default rule is UpperBound (see ClearingRule docs), but pass it
    // explicitly here to make the parity intent obvious.
    let engine = clear_batch(orders, ClearingRule::UpperBound);
    let oracle = dsam_um(orders);

    match (engine, oracle) {
        (ClearOutcome::Empty, None) => { /* both: no cross */ }
        (ClearOutcome::Empty, Some(o)) => {
            assert_eq!(o.total, 0, "engine says Empty but oracle matched {}", o.total);
        }
        (ClearOutcome::Cleared { matched_volume, .. }, None) => {
            panic!("engine matched {matched_volume} but oracle found no cross");
        }
        (
            ClearOutcome::Cleared { clearing_price, matched_volume, fills, marginal },
            Some(o),
        ) => {
            // 1. p* must match the verified uniform price exactly.
            assert_eq!(
                clearing_price, o.clearing_price,
                "p* mismatch: engine {clearing_price} vs dsam {}",
                o.clearing_price
            );
            // 2. Total matched volume must match exactly.
            assert_eq!(
                matched_volume, o.total,
                "matched volume mismatch: engine {matched_volume} vs dsam {}",
                o.total
            );

            // 3. Per-order fills must match for every NON-marginal order. At the
            //    marginal price (pb for buys, ps for sells) the split may differ
            //    (pro-rata vs sequential), so those are excluded here; their
            //    aggregate is already covered by the total-volume check.
            let pb = marginal.buy_marginal_price;
            let ps = marginal.sell_marginal_price;
            let engine_map: std::collections::HashMap<u64, u64> =
                fills.iter().map(|f| (f.order_id, f.filled)).collect();
            let oracle_map: std::collections::HashMap<u64, u64> = o.fills.iter().copied().collect();

            for ord in orders {
                let at_margin = match ord.side {
                    Side::Buy => ord.price_limit == pb,
                    Side::Sell => ord.price_limit == ps,
                };
                if at_margin {
                    continue;
                }
                let e = engine_map.get(&ord.order_id).copied().unwrap_or(0);
                let v = oracle_map.get(&ord.order_id).copied().unwrap_or(0);
                assert_eq!(
                    e, v,
                    "non-marginal fill mismatch for order {} (side {:?}, limit {}): engine {} vs dsam {}",
                    ord.order_id, ord.side, ord.price_limit, e, v
                );
            }
        }
    }
}

// ----- Hand-written edge fixtures (MATH.md 6.1) -----------------------------

#[test]
fn parity_edge_fixtures() {
    let fixtures: Vec<Vec<Order>> = vec![
        // empty book
        vec![],
        // one side empty
        vec![Order::buy(1, 100, 10)],
        vec![Order::sell(1, 100, 10)],
        // exact cross
        vec![Order::buy(1, 100, 10), Order::sell(2, 100, 10)],
        // no cross
        vec![Order::buy(1, 99, 10), Order::sell(2, 100, 10)],
        // spread at crossing
        vec![Order::buy(1, 110, 10), Order::sell(2, 100, 10)],
        // inframarginal + marginal rationing
        vec![
            Order::buy(1, 105, 10),
            Order::buy(2, 100, 10),
            Order::sell(3, 100, 15),
        ],
        // multi-level book
        vec![
            Order::buy(1, 105, 10),
            Order::buy(2, 103, 5),
            Order::buy(3, 100, 7),
            Order::sell(4, 98, 4),
            Order::sell(5, 100, 6),
            Order::sell(6, 102, 8),
        ],
        // marginal tie: two buys at the marginal price
        vec![
            Order::buy(1, 100, 5),
            Order::buy(2, 100, 5),
            Order::sell(3, 100, 7),
        ],
    ];
    for (n, f) in fixtures.iter().enumerate() {
        // Run each fixture and a reversed copy: parity AND determinism.
        assert_parity(f);
        let mut rev = f.clone();
        rev.reverse();
        assert_parity(&rev);
        let _ = n;
    }
}

// ----- Property-based random parity -----------------------------------------

struct Lcg(u64);
impl Lcg {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next_u64() % (hi - lo)
    }
}

#[test]
fn parity_random_books() {
    let mut rng = Lcg(0x_5EED_0000_DA21_7000); // fixed seed for reproducibility
    for _ in 0..30_000 {
        let n = rng.range(0, 20);
        let mut orders = Vec::new();
        for i in 0..n {
            let is_buy = rng.next_u64() & 1 == 0;
            let price = rng.range(95, 106);
            let qty = rng.range(1, 30);
            orders.push(if is_buy {
                Order::buy(i + 1, price, qty)
            } else {
                Order::sell(i + 1, price, qty)
            });
        }
        assert_parity(&orders);
    }
}
