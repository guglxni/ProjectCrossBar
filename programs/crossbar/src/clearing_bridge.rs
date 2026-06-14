//! Bridge between the on-chain zero-copy slab and the pure clearing engine.
//!
//! The matcher (`crossbar-clearing`) is Solana-free on purpose: this is the
//! ONLY place that converts between the on-chain `Order` slab and the engine's
//! `Order` type, then writes the engine's fills back into `BatchResult`. Keep
//! all Solana <-> matcher coupling here so the engine stays identical to the
//! version the off-chain parity test runs (`MATH.md` section 6, `TECHNICALDESIGN.md`
//! section 1).

use crossbar_clearing::{ClearOutcome, Flow, Order as MatchOrder, Side};

use crate::state::book::{Order as SlabOrder, SIDE_BUY};
use crate::state::result::{BatchResult, BATCH_CLEARED, BATCH_EMPTY};

/// Convert one slab order into a matcher order. `remaining` is the live size.
fn to_match_order(o: &SlabOrder) -> MatchOrder {
    let side = if o.side == SIDE_BUY { Side::Buy } else { Side::Sell };
    let flow = if o.flow == crate::state::book::FLOW_MAKER {
        Flow::Maker
    } else {
        Flow::Taker
    };
    MatchOrder {
        order_id: o.order_id,
        side,
        flow,
        price_limit: o.price_limit,
        quantity: o.remaining,
    }
}

/// Run the pure matcher over the live orders of one window and record the
/// outcome into `BatchResult`. `rule` is the clearing-price selection rule
/// (the oracle band's reference price plugs in via
/// `ClearingRule::ReferenceClamped` once the Lazer read lands in M3).
///
/// Returns the cleared price and matched volume so the caller can credit
/// `OpenOrders` (M4 settlement wiring). This function is deterministic and
/// reads no clock or slot (`REQUIREMENTS.md` N1).
/// Net base the CFMM pool traded this clear: `(base_bought, base_sold)`.
pub struct PoolNet {
    pub base_bought: u128,
    pub base_sold: u128,
}

pub fn clear_window_into(
    live: &[SlabOrder],
    reference: Option<u64>,
    pool: Option<(crossbar_clearing::Cfmm, u64, u64, u32)>, // (pool, lo, hi, levels)
    result: &mut BatchResult,
) -> (u64, u64, PoolNet) {
    // Build the matcher input. alloc is fine here; CU optimization (a no-alloc
    // path over the slab) is a documented follow-up, not done before parity
    // (`prd.md` section 5).
    let orders: Vec<MatchOrder> = live
        .iter()
        .filter(|o| o.remaining > 0)
        .map(to_match_order)
        .collect();

    // CFMM backstop (MATH.md 8.3): if a pool is present, the augmented clear
    // adds its synthetic maker ladder. We regenerate the (deterministic) ladder
    // to map pool fills back to a reserve delta; book fills settle as usual.
    let outcome = match pool {
        Some((p, lo, hi, lv)) => crossbar_clearing::clear_batch_with_cfmm(&orders, reference, p, lo, hi, lv),
        None => crossbar_clearing::clear_batch_auction(&orders, reference),
    };
    let ladder: Vec<MatchOrder> = match pool {
        Some((p, lo, hi, lv)) => p.ladder(lo, hi, lv),
        None => Vec::new(),
    };

    let mut net = PoolNet { base_bought: 0, base_sold: 0 };
    match outcome {
        ClearOutcome::Empty => {
            result.status = BATCH_EMPTY;
            result.clearing_price = 0;
            result.matched_volume = 0;
            (0, 0, net)
        }
        ClearOutcome::Cleared { clearing_price, matched_volume, fills, marginal } => {
            result.status = BATCH_CLEARED;
            result.clearing_price = clearing_price;
            result.matched_volume = matched_volume;
            let mut tied: Vec<u64> = marginal.buy_tied.clone();
            tied.extend_from_slice(&marginal.sell_tied);
            let remainder = marginal.buy_remainder + marginal.sell_remainder;
            if remainder > 0 {
                result.set_marginal(&tied, remainder);
            }
            for f in &fills {
                if crossbar_clearing::Cfmm::is_cfmm_order(f.order_id) {
                    // Pool fill: accumulate the reserve delta (not a trader fill).
                    if let Some(o) = ladder.iter().find(|o| o.order_id == f.order_id) {
                        match o.side {
                            crossbar_clearing::Side::Buy => net.base_bought += f.filled as u128,
                            crossbar_clearing::Side::Sell => net.base_sold += f.filled as u128,
                        }
                    }
                } else if let Some(o) = live.iter().find(|o| o.order_id == f.order_id) {
                    // Book order: self-describing record for settlement.
                    // Audit M2: must never truncate (book cap == fills cap). The
                    // assert catches any future regression in the parity tests;
                    // on-chain it is compiled out (and is unreachable anyway).
                    let recorded = result.record_fill(f.order_id, o.owner, o.side, f.filled);
                    debug_assert!(recorded, "fills capacity must equal book capacity");
                    let _ = recorded;
                }
            }
            (clearing_price, matched_volume, net)
        }
    }
}
