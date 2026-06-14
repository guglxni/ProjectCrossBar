//! Marginal pro-rata allocation and the indivisible-remainder hook
//! (`MATH.md` section 4, `clearing/prorata.rs`).
//!
//! At the marginal price level the quantity wanting to trade can exceed the
//! residual matched volume. We allocate pro-rata by quantity with integer math:
//!
//! ```text
//! fill_i = floor( residual * quantity_i / sum_of_marginal_quantities )
//! ```
//!
//! Flooring leaves an indivisible remainder of a few base units. Those units
//! are handed out one each in an order chosen by the caller: a VRF-derived
//! permutation inside the ER, or the deterministic [`lowest_order_id_first`]
//! fallback used here and in tests. This is the entire VRF blast radius: the
//! remainder never moves `p*` and never moves a non-marginal fill
//! (`SKILL.md` invariant 3).
//!
//! The multiply is done in `u128` so `residual * quantity_i` cannot overflow
//! even at `u64::MAX` inputs; the quotient is always `<= residual <= u64::MAX`.

use alloc::vec::Vec;

use crate::{OrderId, Qty};

/// A policy that orders the tied marginal orders for handing out the
/// indivisible remainder. Input is the tied order ids in their original batch
/// order; output is a permutation of indices `0..ids.len()` giving priority
/// (the first index gets the first leftover unit).
pub type RemainderOrder = fn(&[OrderId]) -> Vec<usize>;

/// Deterministic canonical fallback: lowest `order_id` first
/// (`MATH.md` section 4, `architecture.md` section 6). Used when VRF does not
/// return in time, and as the oracle-side rule in tests.
pub fn lowest_order_id_first(ids: &[OrderId]) -> Vec<usize> {
    let mut idx: Vec<usize> = (0..ids.len()).collect();
    idx.sort_by_key(|&i| ids[i]);
    idx
}

/// Result of a pro-rata allocation over the tied marginal orders.
pub struct ProrataAllocation {
    /// Allocation aligned to the input `slots` order.
    pub fills: Vec<Qty>,
    /// Number of indivisible units distributed by the tie-break (the blast
    /// radius). Always `< slots.len()` when `slots` is non-empty.
    pub remainder_units: Qty,
}

/// Allocate `residual` base units across `slots` (each `(order_id, quantity)`)
/// pro-rata by quantity, then distribute the floor remainder one unit each in
/// `order`'s priority. Preconditions enforced by the caller: `residual <=
/// sum(quantity)` and every slot quantity `> 0`.
pub fn allocate_prorata(
    slots: &[(OrderId, Qty)],
    residual: Qty,
    order: RemainderOrder,
) -> ProrataAllocation {
    let n = slots.len();
    if n == 0 {
        return ProrataAllocation { fills: Vec::new(), remainder_units: 0 };
    }

    let sum_q: u128 = slots.iter().map(|&(_, q)| q as u128).sum();
    debug_assert!(sum_q > 0, "marginal slots must have positive total quantity");
    debug_assert!(
        residual as u128 <= sum_q,
        "residual cannot exceed total marginal quantity"
    );

    // Fast path: the whole marginal level trades. Everyone fills fully, no
    // remainder games. This is the common, non-rationed case.
    if residual as u128 == sum_q {
        return ProrataAllocation {
            fills: slots.iter().map(|&(_, q)| q).collect(),
            remainder_units: 0,
        };
    }

    // Floor allocation.
    let mut fills: Vec<Qty> = Vec::with_capacity(n);
    let mut allocated: u128 = 0;
    let residual_u = residual as u128;
    for &(_, q) in slots {
        let f = (residual_u * q as u128) / sum_q; // <= residual, fits u64
        fills.push(f as Qty);
        allocated += f;
    }

    // The leftover is strictly less than the number of slots (a standard
    // largest-remainder fact: each order is short of its exact share by < 1
    // unit, so the total shortfall is < n). Hand them out by the policy.
    let leftover = (residual_u - allocated) as Qty;
    debug_assert!((leftover as usize) < n, "leftover must be < number of tied orders");

    if leftover > 0 {
        let ids: Vec<OrderId> = slots.iter().map(|&(id, _)| id).collect();
        let priority = order(&ids);
        for &i in priority.iter().take(leftover as usize) {
            fills[i] += 1;
        }
    }

    ProrataAllocation { fills, remainder_units: leftover }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_level_trades_no_remainder() {
        let slots = alloc::vec![(1u64, 4u64), (2, 6)];
        let a = allocate_prorata(&slots, 10, lowest_order_id_first);
        assert_eq!(a.fills, alloc::vec![4, 6]);
        assert_eq!(a.remainder_units, 0);
    }

    #[test]
    fn exact_division_no_remainder() {
        // residual 5, equal sizes 5 and 5 -> 2 and 2, remainder 1 to lowest id.
        let slots = alloc::vec![(7u64, 5u64), (3u64, 5u64)];
        let a = allocate_prorata(&slots, 5, lowest_order_id_first);
        // floor(5*5/10)=2 each, leftover 1 -> goes to order_id 3 (index 1).
        assert_eq!(a.fills, alloc::vec![2, 3]);
        assert_eq!(a.remainder_units, 1);
        // Conservation: total allocated == residual.
        assert_eq!(a.fills.iter().sum::<u64>(), 5);
    }

    #[test]
    fn remainder_follows_lowest_order_id() {
        // Three equal slots, residual 10 -> 3 each, leftover 1 to lowest id (2).
        let slots = alloc::vec![(9u64, 5u64), (2u64, 5u64), (5u64, 5u64)];
        let a = allocate_prorata(&slots, 10, lowest_order_id_first);
        // floor(10*5/15)=3 each = 9, leftover 1 to id=2 (index 1).
        assert_eq!(a.fills, alloc::vec![3, 4, 3]);
        assert_eq!(a.fills.iter().sum::<u64>(), 10);
        assert_eq!(a.remainder_units, 1);
    }

    #[test]
    fn proportional_to_size() {
        // residual 10 across sizes 1 and 9 -> floor(10*1/10)=1, floor(10*9/10)=9.
        let slots = alloc::vec![(1u64, 1u64), (2u64, 9u64)];
        let a = allocate_prorata(&slots, 10, lowest_order_id_first);
        assert_eq!(a.fills, alloc::vec![1, 9]);
        assert_eq!(a.remainder_units, 0);
    }

    #[test]
    fn conservation_holds_for_many_sizes() {
        // The sum of allocations always equals the residual, and remainder < n.
        let slots = alloc::vec![(1u64, 3u64), (2, 7), (3, 11), (4, 2), (5, 5)];
        for residual in 0..=(3 + 7 + 11 + 2 + 5u64) {
            let a = allocate_prorata(&slots, residual, lowest_order_id_first);
            assert_eq!(a.fills.iter().sum::<u64>(), residual, "residual {residual}");
            assert!((a.remainder_units as usize) < slots.len());
            // No order is over-filled beyond its size.
            for (i, &(_, q)) in slots.iter().enumerate() {
                assert!(a.fills[i] <= q);
            }
        }
    }

    #[test]
    fn remainder_is_overflow_safe_for_large_quantities() {
        // u64::MAX-scale quantities must not overflow the u128 multiply.
        let big = u64::MAX / 2;
        let slots = alloc::vec![(1u64, big), (2u64, big)];
        let a = allocate_prorata(&slots, big, lowest_order_id_first);
        assert_eq!(a.fills.iter().sum::<u64>(), big);
    }
}
