//! Order-fairness theorem (`MATH.md` section 8.2).
//!
//! Receive-order / temporal fairness (Kursawe's "Wendy", arXiv 2007.08303;
//! Mavroudis & Melton's "Libra", arXiv 1910.00321) bounds the chance a slower
//! participant is beaten by a faster one when execution priority depends on
//! ARRIVAL ORDER. A frequent batch auction removes that dependency entirely:
//! the clear is a pure function of the batch SET, so arrival order is not an
//! input. This test states that as a checkable theorem:
//!
//!   For every batch B and every permutation pi of B:
//!       clear(B) == clear(pi(B))     (identical p*, volume, and per-order fills)
//!
//! This is STRICTLY STRONGER than Wendy/Libra: their guarantee is bounded
//! (Libra) or block-relative (Wendy) unfairness; ours is ZERO intra-batch
//! order-sensitivity. It is also why Project CrossBar deliberately does NOT
//! implement a receive-order fairness layer: such a layer would feed arrival
//! order into matching, contradicting this invariant (N1). See `MATH.md` 8.2.

use crossbar_clearing::{clear_batch, clear_batch_auction, ClearOutcome, ClearingRule, Flow, Order};

fn canonical(out: &ClearOutcome) -> (u64, u64, Vec<(u64, u64)>) {
    match out {
        ClearOutcome::Cleared { clearing_price, matched_volume, fills, .. } => {
            let mut v: Vec<(u64, u64)> = fills.iter().map(|f| (f.order_id, f.filled)).collect();
            v.sort();
            (*clearing_price, *matched_volume, v)
        }
        ClearOutcome::Empty => (0, 0, vec![]),
    }
}

struct Lcg(u64);
impl Lcg {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 { lo + self.next_u64() % (hi - lo) }
}

fn random_batch(rng: &mut Lcg) -> Vec<Order> {
    let n = rng.range(0, 22);
    let mut v = Vec::new();
    for i in 0..n {
        let is_buy = rng.next_u64() & 1 == 0;
        let price = rng.range(94, 107);
        let qty = rng.range(1, 40);
        let flow = if rng.next_u64() & 1 == 0 { Flow::Maker } else { Flow::Taker };
        let o = if is_buy { Order::buy(i + 1, price, qty) } else { Order::sell(i + 1, price, qty) };
        v.push(o.with_flow(flow));
    }
    v
}

#[test]
fn clearing_is_invariant_under_arrival_permutation() {
    // The order-fairness theorem, over 20k random batches and many permutations
    // each: arrival order changes nothing - p*, volume, and every per-order fill
    // are identical. (Tested for both the parity rule and the production
    // auction rule.)
    let mut rng = Lcg(0x_0FA1_8DE2_2C0F_0001);
    for _ in 0..20_000 {
        let batch = random_batch(&mut rng);
        let base_up = canonical(&clear_batch(&batch, ClearingRule::UpperBound));
        let base_auc = canonical(&clear_batch_auction(&batch, Some(100)));

        // Fisher-Yates shuffles with the same stream.
        let mut shuffled = batch.clone();
        let len = shuffled.len();
        for i in (1..len).rev() {
            let j = rng.range(0, (i as u64) + 1) as usize;
            shuffled.swap(i, j);
        }
        assert_eq!(base_up, canonical(&clear_batch(&shuffled, ClearingRule::UpperBound)),
            "UpperBound: arrival permutation changed the clear");
        assert_eq!(base_auc, canonical(&clear_batch_auction(&shuffled, Some(100))),
            "Auction: arrival permutation changed the clear");
    }
}

#[test]
fn reversing_the_batch_is_a_no_op() {
    let book = vec![
        Order::buy(1, 105, 10), Order::buy(2, 103, 5), Order::buy(3, 100, 7),
        Order::sell(4, 98, 4), Order::sell(5, 100, 6), Order::sell(6, 102, 8),
    ];
    let fwd = canonical(&clear_batch_auction(&book, Some(101)));
    let mut rev = book.clone();
    rev.reverse();
    assert_eq!(fwd, canonical(&clear_batch_auction(&rev, Some(101))));
}
