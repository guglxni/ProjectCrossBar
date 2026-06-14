//! Uniform clearing price and the dual-flow crossing (`MATH.md` sections 2, 3,
//! 5; `clearing/clear.rs`).
//!
//! Construction (proven correct in this module's tests and notes):
//!
//!   1. `V* = max over candidate prices of min(D(p), S(p))` is the matched
//!      volume. If `V* == 0` the book does not cross: `Empty`.
//!   2. The marginal buyer price `pb = max{ p : D(p) >= V* }` and marginal
//!      seller price `ps = min{ p : S(p) >= V* }`. We prove `ps <= pb` always
//!      (when `V* > 0`), so `[ps, pb]` is a non-empty, individually-rational
//!      uniform-price interval.
//!   3. Per-order fills are pinned by `V*`, `pb`, and `ps` alone: every buy
//!      priced strictly above `pb` fills fully, buys at exactly `pb` share the
//!      residual pro-rata; symmetrically for sells around `ps`. So the fills
//!      are UNIQUE up to the indivisible marginal remainder (the ITP-2021
//!      uniqueness theorem, `MATH.md` section 6.1). The selection rule only
//!      sets the printed trade price `p*` inside `[ps, pb]`; it cannot move any
//!      fill.
//!
//! Why `ps <= pb`: suppose `pb < ps`. `V*` is attained at some price `p0` with
//! `D(p0) >= V*` and `S(p0) >= V*`. `D(p0) >= V*` forces `p0 <= pb` (demand
//! above `pb` totals `< V*`); `S(p0) >= V*` forces `p0 >= ps` (supply below
//! `ps` totals `< V*`). Then `ps <= p0 <= pb`, contradicting `pb < ps`.

use alloc::vec::Vec;

use crate::curves::{candidate_prices, demand_at, supply_at};
use crate::prorata::{allocate_prorata, RemainderOrder};
use crate::{ClearOutcome, ClearingRule, Fill, MarginalReport, Order, Price, Qty, Side};

/// Clear one batch with an explicit remainder-assignment policy. [`crate::clear_batch`]
/// is the convenience wrapper that passes the deterministic fallback.
pub fn clear_batch_with(
    orders: &[Order],
    rule: ClearingRule,
    remainder_order: RemainderOrder,
) -> ClearOutcome {
    clear_batch_inner(orders, rule, remainder_order, false)
}

/// Dual-flow clearing (`MATH.md` section 3, `PLAN.md` T3.2). Price discovery is
/// over the COMBINED book, so there is still exactly one `p*` and the matched
/// volume is identical to the single-flow clear (single-price invariant, N4).
/// The only difference is at the marginal price level: maker flow is filled
/// before taker flow (maker protection from toxic taker flow). With a
/// single-flow book this reduces exactly to [`clear_batch_with`].
pub fn clear_batch_dual_flow_with(
    orders: &[Order],
    rule: ClearingRule,
    remainder_order: RemainderOrder,
) -> ClearOutcome {
    clear_batch_inner(orders, rule, remainder_order, true)
}

fn clear_batch_inner(
    orders: &[Order],
    rule: ClearingRule,
    remainder_order: RemainderOrder,
    maker_priority: bool,
) -> ClearOutcome {
    let candidates = candidate_prices(orders);
    if candidates.is_empty() {
        return ClearOutcome::Empty;
    }

    // Step 1: matched volume V* = max_p min(D(p), S(p)).
    let mut matched: u128 = 0;
    for &p in &candidates {
        let ex = core::cmp::min(demand_at(orders, p), supply_at(orders, p));
        if ex > matched {
            matched = ex;
        }
    }
    if matched == 0 {
        return ClearOutcome::Empty;
    }
    // V* is bounded by one side's total quantity, which fits u64.
    let v_star: Qty = matched as Qty;

    // Step 2: marginal prices.
    //   pb = max{ p in candidates : D(p) >= V* }
    //   ps = min{ p in candidates : S(p) >= V* }
    let pb = candidates
        .iter()
        .copied()
        .filter(|&p| demand_at(orders, p) >= matched)
        .max()
        .expect("V* attained => some price has demand >= V*");
    let ps = candidates
        .iter()
        .copied()
        .filter(|&p| supply_at(orders, p) >= matched)
        .min()
        .expect("V* attained => some price has supply >= V*");
    debug_assert!(ps <= pb, "clearing interval must be non-empty (ps <= pb)");

    // Step 3: the single trade price, selected inside [ps, pb] by the rule.
    // The fills below depend only on V*, pb, ps - NOT on this price - so every
    // rule yields the same matched volume and per-order fills (verified-matcher
    // parity holds); the rule only sets the printed `p*`.
    let clearing_price = match rule {
        ClearingRule::Auction(reference) => auction_clearing_price(orders, ps, pb, reference),
        _ => select_clearing_price(ps, pb, rule),
    };

    // Step 4: fills. Each side fills exactly V*; rationing only at its margin.
    let mut fills: Vec<Fill> = Vec::new();
    let mut marginal = MarginalReport {
        buy_marginal_price: pb,
        sell_marginal_price: ps,
        ..Default::default()
    };

    fill_side(
        orders,
        Side::Buy,
        pb,
        v_star,
        remainder_order,
        maker_priority,
        &mut fills,
        &mut marginal.buy_tied,
        &mut marginal.buy_remainder,
    );
    fill_side(
        orders,
        Side::Sell,
        ps,
        v_star,
        remainder_order,
        maker_priority,
        &mut fills,
        &mut marginal.sell_tied,
        &mut marginal.sell_remainder,
    );

    // Deterministic, order-independent readout.
    fills.sort_unstable_by_key(|f| f.order_id);

    ClearOutcome::Cleared {
        clearing_price,
        matched_volume: v_star,
        fills,
        marginal,
    }
}

/// Pick the uniform trade price inside `[ps, pb]`. See [`ClearingRule`] for the
/// parity gate: the fills do not depend on this, only the printed `p*` does.
pub fn select_clearing_price(ps: Price, pb: Price, rule: ClearingRule) -> Price {
    debug_assert!(ps <= pb);
    match rule {
        ClearingRule::LowerBound => ps,
        ClearingRule::UpperBound => pb,
        // Floor midpoint, computed without overflow.
        ClearingRule::MidpointFloor => ps + (pb - ps) / 2,
        ClearingRule::ReferenceClamped(p_ref) => p_ref.clamp(ps, pb),
        // Auction rule needs the order book; handled in clear_batch_inner. As a
        // safe fallback here, use the midpoint.
        ClearingRule::Auction(p_ref) => match p_ref {
            Some(r) => r.clamp(ps, pb),
            None => ps + (pb - ps) / 2,
        },
    }
}

/// Canonical call-auction price determination (`MATH.md` section 9). Among the
/// volume-maximizing prices in `[ps, pb]`, in order:
///   1. minimize the order imbalance `|D(p) - S(p)|`,
///   2. break ties by market pressure (buy-heavy -> higher, sell-heavy -> lower),
///   3. break remaining ties by closeness to the reference price.
///
/// This is the Nasdaq opening/closing cross and Xetra rule. The result is always
/// inside `[ps, pb]`, hence individually rational, and (being a price-in-interval
/// choice) leaves matched volume and per-order fills unchanged.
pub fn auction_clearing_price(
    orders: &[Order],
    ps: Price,
    pb: Price,
    reference: Option<Price>,
) -> Price {
    debug_assert!(ps <= pb);
    if ps == pb {
        return ps;
    }
    // Candidate prices inside the interval: the limit prices in range + endpoints.
    let mut cands: Vec<Price> = orders
        .iter()
        .map(|o| o.price_limit)
        .filter(|&p| p >= ps && p <= pb)
        .collect();
    cands.push(ps);
    cands.push(pb);
    cands.sort_unstable();
    cands.dedup();

    // 1. minimize imbalance |D(p) - S(p)|.
    let imbalance = |p: Price| -> u128 {
        let d = crate::curves::demand_at(orders, p);
        let s = crate::curves::supply_at(orders, p);
        if d > s { d - s } else { s - d }
    };
    let min_imb = cands.iter().map(|&p| imbalance(p)).min().unwrap();
    let min_set: Vec<Price> = cands.into_iter().filter(|&p| imbalance(p) == min_imb).collect();
    if min_set.len() == 1 {
        return min_set[0];
    }
    let lo = *min_set.first().unwrap();
    let hi = *min_set.last().unwrap();

    // 2. market pressure: at a representative min-imbalance price, the heavy
    //    side tilts the price (more demand -> higher, more supply -> lower).
    let mid = min_set[min_set.len() / 2];
    let d = crate::curves::demand_at(orders, mid);
    let s = crate::curves::supply_at(orders, mid);
    if d > s {
        return hi;
    }
    if s > d {
        return lo;
    }

    // 3. balanced (imbalance flat across [lo, hi]): every price here is
    //    equally optimal and individually rational, so anchor to the reference
    //    price (clamped into the band), else the midpoint.
    match reference {
        Some(r) => r.clamp(lo, hi),
        None => lo + (hi - lo) / 2,
    }
}

/// Fill one side at its marginal price `margin`, targeting exactly `target`
/// (`V*`) total. Orders strictly more aggressive than `margin` fill fully;
/// orders exactly at `margin` share the residual pro-rata; the indivisible
/// remainder is handed out by `remainder_order` (`MATH.md` section 4).
#[allow(clippy::too_many_arguments)]
fn fill_side(
    orders: &[Order],
    side: Side,
    margin: Price,
    target: Qty,
    remainder_order: RemainderOrder,
    maker_priority: bool,
    fills: &mut Vec<Fill>,
    tied_out: &mut Vec<crate::OrderId>,
    remainder_out: &mut Qty,
) {
    // "Strictly more aggressive": a buy wants the highest fill priority at the
    // highest price, a sell at the lowest price.
    let strictly_inframarginal = |limit: Price| match side {
        Side::Buy => limit > margin,
        Side::Sell => limit < margin,
    };

    let mut strict_total: Qty = 0;
    // tied exactly at the marginal price, in input order, with maker flag.
    let mut tied: Vec<(crate::OrderId, Qty, bool)> = Vec::new();

    for o in orders {
        if o.side != side {
            continue;
        }
        if strictly_inframarginal(o.price_limit) {
            // Full fill for inframarginal orders (regardless of flow).
            fills.push(Fill { order_id: o.order_id, filled: o.quantity });
            strict_total = strict_total.saturating_add(o.quantity);
        } else if o.price_limit == margin {
            tied.push((o.order_id, o.quantity, o.flow == crate::Flow::Maker));
        }
        // Orders worse than the margin do not trade.
    }

    // Residual to ration at the marginal price. By construction strict_total
    // < target (demand above pb, or supply below ps, totals < V*), so this is
    // in `[1, sum(tied)]`.
    debug_assert!(strict_total <= target);
    let residual = target - strict_total;

    let total_remainder: Qty;
    if maker_priority {
        // Dual-flow: makers at the margin fill before takers. Allocate the
        // residual to maker-tied first (pro-rata), then any leftover to
        // taker-tied (pro-rata). Single-flow books have one partition, so this
        // is identical to the combined pro-rata below.
        let makers: Vec<(crate::OrderId, Qty)> =
            tied.iter().filter(|t| t.2).map(|&(id, q, _)| (id, q)).collect();
        let takers: Vec<(crate::OrderId, Qty)> =
            tied.iter().filter(|t| !t.2).map(|&(id, q, _)| (id, q)).collect();
        let qm: u128 = makers.iter().map(|&(_, q)| q as u128).sum();
        let maker_residual = core::cmp::min(residual as u128, qm) as Qty;

        let alloc_m = allocate_prorata(&makers, maker_residual, remainder_order);
        let maker_filled: Qty = alloc_m.fills.iter().sum();
        for (i, &(order_id, _)) in makers.iter().enumerate() {
            if alloc_m.fills[i] > 0 {
                fills.push(Fill { order_id, filled: alloc_m.fills[i] });
            }
        }
        let taker_residual = residual - maker_filled;
        let alloc_t = allocate_prorata(&takers, taker_residual, remainder_order);
        for (i, &(order_id, _)) in takers.iter().enumerate() {
            if alloc_t.fills[i] > 0 {
                fills.push(Fill { order_id, filled: alloc_t.fills[i] });
            }
        }
        total_remainder = alloc_m.remainder_units + alloc_t.remainder_units;
    } else {
        let flat: Vec<(crate::OrderId, Qty)> =
            tied.iter().map(|&(id, q, _)| (id, q)).collect();
        let alloc = allocate_prorata(&flat, residual, remainder_order);
        for (i, &(order_id, _)) in flat.iter().enumerate() {
            if alloc.fills[i] > 0 {
                fills.push(Fill { order_id, filled: alloc.fills[i] });
            }
        }
        total_remainder = alloc.remainder_units;
    }

    if total_remainder > 0 {
        // Record the tied set and the blast-radius size for diagnostics / VRF.
        // Sorted so the whole BatchResult readout is order-independent (N1):
        // the tied set is a set, not a sequence.
        let mut ids: Vec<crate::OrderId> = tied.iter().map(|&(id, _, _)| id).collect();
        ids.sort_unstable();
        *tied_out = ids;
        *remainder_out = total_remainder;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{clear_batch, ClearOutcome, Order};

    fn fills_map(out: &ClearOutcome) -> alloc::vec::Vec<(crate::OrderId, Qty)> {
        match out {
            ClearOutcome::Cleared { fills, .. } => {
                fills.iter().map(|f| (f.order_id, f.filled)).collect()
            }
            ClearOutcome::Empty => alloc::vec![],
        }
    }

    #[test]
    fn simple_exact_cross() {
        // One buy @100 x10, one sell @100 x10. Clears 10 @100.
        let b = alloc::vec![Order::buy(1, 100, 10), Order::sell(2, 100, 10)];
        let out = clear_batch(&b, ClearingRule::MidpointFloor);
        match out {
            ClearOutcome::Cleared { clearing_price, matched_volume, .. } => {
                assert_eq!(clearing_price, 100);
                assert_eq!(matched_volume, 10);
            }
            _ => panic!("expected a cross"),
        }
        assert_eq!(fills_map(&out), alloc::vec![(1, 10), (2, 10)]);
    }

    #[test]
    fn no_cross_is_empty() {
        // Buyer below seller: no trade.
        let b = alloc::vec![Order::buy(1, 99, 10), Order::sell(2, 101, 10)];
        assert_eq!(clear_batch(&b, ClearingRule::MidpointFloor), ClearOutcome::Empty);
    }

    #[test]
    fn one_side_empty_is_empty() {
        let b = alloc::vec![Order::buy(1, 100, 10), Order::buy(2, 101, 5)];
        assert_eq!(clear_batch(&b, ClearingRule::MidpointFloor), ClearOutcome::Empty);
    }

    #[test]
    fn empty_book_is_empty() {
        assert_eq!(clear_batch(&[], ClearingRule::MidpointFloor), ClearOutcome::Empty);
    }

    #[test]
    fn spread_at_crossing_picks_midpoint_but_fills_are_fixed() {
        // Buy @110 x10, sell @100 x10. Interval [100,110]; midpoint floor 105.
        // Fills are independent of the printed price.
        let b = alloc::vec![Order::buy(1, 110, 10), Order::sell(2, 100, 10)];
        let mid = clear_batch(&b, ClearingRule::MidpointFloor);
        let lo = clear_batch(&b, ClearingRule::LowerBound);
        let hi = clear_batch(&b, ClearingRule::UpperBound);
        if let ClearOutcome::Cleared { clearing_price, .. } = mid {
            assert_eq!(clearing_price, 105);
        } else {
            panic!();
        }
        if let ClearOutcome::Cleared { clearing_price, .. } = lo {
            assert_eq!(clearing_price, 100);
        } else {
            panic!();
        }
        if let ClearOutcome::Cleared { clearing_price, .. } = hi {
            assert_eq!(clearing_price, 110);
        } else {
            panic!();
        }
        // Same fills regardless of rule.
        assert_eq!(fills_map(&mid), alloc::vec![(1, 10), (2, 10)]);
        assert_eq!(fills_map(&lo), fills_map(&mid));
        assert_eq!(fills_map(&hi), fills_map(&mid));
    }

    #[test]
    fn inframarginal_fills_fully_marginal_rations() {
        // Buys: 105 x10 (strict), 100 x10 (marginal). Sells: 100 x15.
        // V*: at p=100, D=20, S=15, min=15. pb=100 (D(100)=20>=15, D(101)=10<15
        // => pb=100). ps=100. Strict buys above 100 = 10. Residual buy = 5 to
        // ration among the one marginal buy (id 2) -> 5.
        let b = alloc::vec![
            Order::buy(1, 105, 10),
            Order::buy(2, 100, 10),
            Order::sell(3, 100, 15),
        ];
        let out = clear_batch(&b, ClearingRule::MidpointFloor);
        match &out {
            ClearOutcome::Cleared { clearing_price, matched_volume, .. } => {
                assert_eq!(*clearing_price, 100);
                assert_eq!(*matched_volume, 15);
            }
            _ => panic!(),
        }
        // Order 1 full (10), order 2 rationed to 5, sell 3 full 15.
        assert_eq!(fills_map(&out), alloc::vec![(1, 10), (2, 5), (3, 15)]);
    }

    #[test]
    fn determinism_under_shuffle() {
        // N1: shuffling the batch must not change the output.
        let base = alloc::vec![
            Order::buy(1, 105, 10),
            Order::buy(2, 103, 5),
            Order::buy(3, 100, 7),
            Order::sell(4, 98, 4),
            Order::sell(5, 100, 6),
            Order::sell(6, 102, 8),
        ];
        let canonical = clear_batch(&base, ClearingRule::MidpointFloor);
        // Every rotation produces identical output.
        let mut rotated = base.clone();
        for _ in 0..base.len() {
            rotated.rotate_left(1);
            assert_eq!(clear_batch(&rotated, ClearingRule::MidpointFloor), canonical);
        }
        let mut reversed = base.clone();
        reversed.reverse();
        assert_eq!(clear_batch(&reversed, ClearingRule::MidpointFloor), canonical);
    }
}
