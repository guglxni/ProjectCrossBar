//! Demand and supply aggregation (`MATH.md` section 2, `clearing/curves.rs`).
//!
//! Two step functions over price:
//!   * `D(p)` = total buy quantity with `price_limit >= p`  (non-increasing).
//!   * `S(p)` = total sell quantity with `price_limit <= p`  (non-decreasing).
//!
//! Both change value only at the distinct limit prices present in the batch,
//! so the crossing is found by walking those breakpoints. Everything here is
//! integer; quantities sum into `u128` to be overflow-safe even at the
//! `MAX_ORDERS_PER_BATCH * u64::MAX` worst case, then the matched volume that
//! survives is always `<= u64::MAX` because it is bounded by one side's total.

use alloc::vec::Vec;

use crate::{Order, Price, Side};

/// Total buy quantity whose limit is `>= p`. Demand is non-increasing in `p`.
pub fn demand_at(orders: &[Order], p: Price) -> u128 {
    let mut total: u128 = 0;
    for o in orders {
        if o.side == Side::Buy && o.price_limit >= p {
            total += o.quantity as u128;
        }
    }
    total
}

/// Total sell quantity whose limit is `<= p`. Supply is non-decreasing in `p`.
pub fn supply_at(orders: &[Order], p: Price) -> u128 {
    let mut total: u128 = 0;
    for o in orders {
        if o.side == Side::Sell && o.price_limit <= p {
            total += o.quantity as u128;
        }
    }
    total
}

/// Executable volume at `p`: `min(D(p), S(p))`.
pub fn executable_at(orders: &[Order], p: Price) -> u128 {
    core::cmp::min(demand_at(orders, p), supply_at(orders, p))
}

/// The sorted, de-duplicated set of candidate prices. The maximum of
/// `min(D, S)` is always attained at one of these breakpoints because both
/// curves are flat between consecutive limit prices.
///
/// Sorted ascending and de-duplicated so the walk is deterministic regardless
/// of input order (`REQUIREMENTS.md` N1).
pub fn candidate_prices(orders: &[Order]) -> Vec<Price> {
    let mut prices: Vec<Price> = orders.iter().map(|o| o.price_limit).collect();
    prices.sort_unstable();
    prices.dedup();
    prices
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Order;

    fn book() -> Vec<Order> {
        // Buys at 105, 103, 100; sells at 98, 100, 102.
        alloc::vec![
            Order::buy(1, 105, 10),
            Order::buy(2, 103, 5),
            Order::buy(3, 100, 7),
            Order::sell(4, 98, 4),
            Order::sell(5, 100, 6),
            Order::sell(6, 102, 8),
        ]
    }

    #[test]
    fn demand_is_non_increasing() {
        let b = book();
        let prices = [97u64, 100, 101, 103, 105, 106];
        let mut last = u128::MAX;
        for p in prices {
            let d = demand_at(&b, p);
            assert!(d <= last, "demand must not increase as price rises");
            last = d;
        }
        // At p=100, buys with limit >= 100 are all three: 10+5+7 = 22.
        assert_eq!(demand_at(&b, 100), 22);
        // At p=104, only the 105 buy qualifies.
        assert_eq!(demand_at(&b, 104), 10);
        // Above every buy limit, demand is zero.
        assert_eq!(demand_at(&b, 106), 0);
    }

    #[test]
    fn supply_is_non_decreasing() {
        let b = book();
        let prices = [97u64, 98, 100, 101, 102, 110];
        let mut last = 0u128;
        for p in prices {
            let s = supply_at(&b, p);
            assert!(s >= last, "supply must not decrease as price rises");
            last = s;
        }
        // At p=100, sells with limit <= 100 are 98 and 100: 4+6 = 10.
        assert_eq!(supply_at(&b, 100), 10);
        // Below every sell limit, supply is zero.
        assert_eq!(supply_at(&b, 97), 0);
        // At/above the top sell, all supply: 4+6+8 = 18.
        assert_eq!(supply_at(&b, 102), 18);
    }

    #[test]
    fn candidates_sorted_and_deduped() {
        let b = book();
        let c = candidate_prices(&b);
        assert_eq!(c, alloc::vec![98, 100, 102, 103, 105]);
    }

    #[test]
    fn candidates_are_order_independent() {
        let mut b = book();
        let c1 = candidate_prices(&b);
        b.reverse();
        let c2 = candidate_prices(&b);
        assert_eq!(c1, c2);
    }
}
