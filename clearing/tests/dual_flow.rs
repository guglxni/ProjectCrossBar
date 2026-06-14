//! Dual-flow clearing tests (`MATH.md` section 3, `PLAN.md` T3.2).
//!
//! Invariants: dual-flow keeps a single `p*` and the same matched volume as the
//! combined clear (N4), and protects makers by filling them first at the
//! marginal price. With a single-flow book it is identical to `clear_batch`.

use crossbar_clearing::{
    clear_batch, clear_batch_dual_flow, ClearOutcome, ClearingRule, Flow, Order,
};

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

fn price_volume(out: &ClearOutcome) -> (u64, u64) {
    match out {
        ClearOutcome::Cleared { clearing_price, matched_volume, .. } => {
            (*clearing_price, *matched_volume)
        }
        ClearOutcome::Empty => (0, 0),
    }
}

#[test]
fn dual_flow_equals_single_flow_when_one_flow() {
    // All-taker book: dual-flow must match clear_batch exactly.
    let book = vec![
        Order::buy(1, 105, 10),
        Order::buy(2, 100, 10),
        Order::sell(3, 100, 15),
    ];
    let single = clear_batch(&book, ClearingRule::UpperBound);
    let dual = clear_batch_dual_flow(&book, ClearingRule::UpperBound);
    assert_eq!(fills(&single), fills(&dual));
    assert_eq!(price_volume(&single), price_volume(&dual));
}

#[test]
fn dual_flow_preserves_single_price_and_volume() {
    // Mixed maker/taker at the margin: p* and total volume must be unchanged
    // versus the combined clear.
    let book = vec![
        Order::buy(1, 105, 10),                        // inframarginal taker buy
        Order::buy(2, 100, 6).with_flow(Flow::Maker),  // marginal maker buy
        Order::buy(3, 100, 6).with_flow(Flow::Taker),  // marginal taker buy
        Order::sell(4, 100, 15),
    ];
    let single = clear_batch(&book, ClearingRule::UpperBound);
    let dual = clear_batch_dual_flow(&book, ClearingRule::UpperBound);
    assert_eq!(price_volume(&single), price_volume(&dual), "p* and volume must match");
}

#[test]
fn dual_flow_fills_makers_before_takers_at_margin() {
    // Marginal buy level has a maker (id 2) and a taker (id 3), each qty 6.
    // Residual at the margin is 5 (V*=15, inframarginal buy id1=10).
    // Maker-priority: maker fills 5, taker fills 0. (Combined pro-rata would
    // split ~2/3 each.)
    let book = vec![
        Order::buy(1, 105, 10),                        // fills fully (10)
        Order::buy(2, 100, 6).with_flow(Flow::Maker),  // marginal maker
        Order::buy(3, 100, 6).with_flow(Flow::Taker),  // marginal taker
        Order::sell(4, 100, 15),                       // fills 15
    ];
    let dual = clear_batch_dual_flow(&book, ClearingRule::UpperBound);
    let f = fills(&dual);
    // maker (2) gets the whole residual 5, taker (3) gets nothing.
    assert!(f.contains(&(1, 10)), "inframarginal buy fills fully");
    assert!(f.contains(&(2, 5)), "marginal maker filled before taker: {f:?}");
    assert!(!f.iter().any(|&(id, q)| id == 3 && q > 0), "marginal taker starved: {f:?}");
    assert!(f.contains(&(4, 15)), "sell fills fully");
    // Conservation: buy volume == sell volume == 15.
    let buy: u64 = f.iter().filter(|&&(id, _)| id != 4).map(|&(_, q)| q).sum();
    assert_eq!(buy, 15);
}

#[test]
fn dual_flow_taker_gets_leftover_after_makers() {
    // Marginal makers can't absorb the whole residual; takers get the rest.
    // V*: sell 12 @100. buys: id1 105x4 (infra), id2 maker 100x3, id3 taker 100x10.
    // residual = 12 - 4 = 8. makers total 3 -> maker fills 3, taker fills 5.
    let book = vec![
        Order::buy(1, 105, 4),
        Order::buy(2, 100, 3).with_flow(Flow::Maker),
        Order::buy(3, 100, 10).with_flow(Flow::Taker),
        Order::sell(4, 100, 12),
    ];
    let f = fills(&clear_batch_dual_flow(&book, ClearingRule::UpperBound));
    assert!(f.contains(&(2, 3)), "maker fully filled at margin: {f:?}");
    assert!(f.contains(&(3, 5)), "taker gets leftover residual: {f:?}");
}
