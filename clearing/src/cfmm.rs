//! CFMM backstop liquidity for the batch clear (`MATH.md` section 8.3).
//!
//! Ramseyer, Goyal, Goel & Mazieres, "Augmenting Batch Exchanges with Constant
//! Function Market Makers", EC'24 (arXiv 2210.04929), show a constant-function
//! market maker can be folded into a uniform-price batch clear: the pool behaves
//! as a smooth price-monotone curve added to the order demand/supply, everyone
//! (pool included) trades at one `p*`, and the pool's fill is individually
//! rational. This solves the cold-start "thin book" problem: a batch with little
//! resting interest still clears against passive pool liquidity.
//!
//! Integration that PRESERVES the verified matcher: we discretize a
//! constant-product pool (`x * y = k`) into synthetic maker limit orders (a
//! "ladder") across a price band and hand them to the unchanged matcher. With
//! zero reserves the ladder is empty and the clear is byte-identical to the
//! certified baseline (so the 4006/4006 dsam parity still holds). The pool's
//! total fill is the sum of its filled ladder orders; reserves update by that
//! fill, and `k` never decreases (individual rationality).
//!
//! Pure, integer-only (`REQUIREMENTS.md` C5). The one new primitive is an
//! integer square root (the constant-product reserve at price `p` is
//! `x(p) = floor(sqrt(k * PRICE_SCALE / p))`). N1-clean: the ladder depends only
//! on `(reserves, band)`, never on arrival order.

use alloc::vec::Vec;

use crate::{Flow, Order, OrderId, Price, Qty, Side, PRICE_SCALE};

/// Synthetic order ids for the pool occupy a high, reserved range so they never
/// collide with real trader order ids.
pub const CFMM_ORDER_ID_BASE: OrderId = 1 << 60;

/// Integer floor square root (Newton's method). Guarantees
/// `isqrt(n)^2 <= n < (isqrt(n)+1)^2`. No floats (`REQUIREMENTS.md` C5).
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    // Initial guess: 2^(ceil(bits/2)).
    let mut x = 1u128 << ((128 - n.leading_zeros() + 1) / 2);
    loop {
        let y = (x + n / x) / 2;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// A constant-product pool: `base` (x) and `quote` (y) reserves, in atomic units.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cfmm {
    pub base: u128,
    pub quote: u128,
}

impl Cfmm {
    /// The invariant `k = x * y`.
    pub fn k(&self) -> u128 {
        self.base.saturating_mul(self.quote)
    }

    /// Marginal (spot) price = quote per base, at `PRICE_SCALE`.
    pub fn spot(&self) -> Price {
        if self.base == 0 {
            return 0;
        }
        // Audit M6: clamp the u128->u64 cast (saturate) instead of truncating,
        // so an extreme reserve ratio cannot wrap to a nonsense spot price.
        let spot = (self.quote.saturating_mul(PRICE_SCALE as u128)) / self.base;
        u64::try_from(spot).unwrap_or(u64::MAX)
    }

    /// Base reserve the pool would hold at marginal price `p` (scaled):
    /// `x(p) = floor(sqrt(k * PRICE_SCALE / p))`. Monotone decreasing in `p`.
    pub fn base_at(&self, p: Price) -> u128 {
        if p == 0 {
            return self.base;
        }
        isqrt(self.k().saturating_mul(PRICE_SCALE as u128) / p as u128)
    }

    /// Discretize the pool into synthetic maker limit orders across `[lo, hi]`
    /// using `n_levels` steps per side. Above spot the pool offers to SELL base
    /// (it gives base as the price rises); below spot it offers to BUY base.
    /// Each level's quantity is the exact base the constant-product curve trades
    /// across that price increment, so the ladder tracks the true curve.
    pub fn ladder(&self, lo: Price, hi: Price, n_levels: u32) -> Vec<Order> {
        let mut out = Vec::new();
        if self.base == 0 || self.quote == 0 || n_levels == 0 {
            return out;
        }
        let spot = self.spot();
        let mut id = CFMM_ORDER_ID_BASE;

        // SELL side: prices in (spot, hi]. As price rises spot -> p, base reserve
        // falls x(spot)=base -> x(p); the pool sells (base - x(p)).
        if hi > spot {
            let mut prev_x = self.base;
            for i in 1..=n_levels {
                // Audit M5: promote to u128 before the multiply so a wide band
                // (hi-spot large) * level index cannot overflow u64 and abort.
                let p = spot + ((hi - spot) as u128 * i as u128 / n_levels as u128) as Price;
                let x_p = self.base_at(p);
                let qty = prev_x.saturating_sub(x_p); // base sold in this step
                if qty > 0 {
                    out.push(Order {
                        order_id: id,
                        side: Side::Sell,
                        flow: Flow::Maker,
                        price_limit: p,
                        quantity: qty as Qty,
                    });
                    id += 1;
                }
                prev_x = x_p;
            }
        }

        // BUY side: prices in [lo, spot). As price falls spot -> p, base reserve
        // rises base -> x(p); the pool buys (x(p) - base).
        if lo < spot && lo > 0 {
            let mut prev_x = self.base;
            for i in 1..=n_levels {
                let p = spot - ((spot - lo) as u128 * i as u128 / n_levels as u128) as Price;
                let x_p = self.base_at(p.max(1));
                let qty = x_p.saturating_sub(prev_x); // base bought in this step
                if qty > 0 {
                    out.push(Order {
                        order_id: id,
                        side: Side::Buy,
                        flow: Flow::Maker,
                        price_limit: p.max(1),
                        quantity: qty as Qty,
                    });
                    id += 1;
                }
                prev_x = x_p;
            }
        }
        out
    }

    /// Is a given order id one of this pool's synthetic ladder orders?
    pub fn is_cfmm_order(order_id: OrderId) -> bool {
        order_id >= CFMM_ORDER_ID_BASE
    }

    /// Apply the pool's net fill and return the updated reserves. `base_in` is
    /// base the pool RECEIVED (it bought), `base_out` base it gave (sold);
    /// likewise quote. `k` must not decrease (individual rationality).
    pub fn apply(&self, base_in: u128, base_out: u128, quote_in: u128, quote_out: u128) -> Cfmm {
        // Audit L5: saturating ops so a malformed net can never panic/underflow
        // (this is not yet wired into settlement; harden before it is, and assert
        // k() non-decreasing at the call site when it is).
        Cfmm {
            base: self.base.saturating_add(base_in).saturating_sub(base_out),
            quote: self.quote.saturating_add(quote_in).saturating_sub(quote_out),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isqrt_is_floor_sqrt() {
        for n in [0u128, 1, 2, 3, 4, 8, 15, 16, 17, 99, 100, 101, 1_000_000, u128::from(u64::MAX)] {
            let r = isqrt(n);
            assert!(r * r <= n, "isqrt({n})={r} too big");
            assert!((r + 1).checked_mul(r + 1).map_or(true, |sq| sq > n), "isqrt({n})={r} too small");
        }
        // a few large values
        let big = 1u128 << 100;
        let r = isqrt(big);
        assert!(r * r <= big && (r + 1) * (r + 1) > big);
    }

    #[test]
    fn spot_and_base_at_round_trip() {
        let pool = Cfmm { base: 1_000_000, quote: 100_000_000 }; // spot = 100 * SCALE
        assert_eq!(pool.spot(), 100 * PRICE_SCALE);
        // x(spot) == base (to within integer sqrt rounding).
        let x = pool.base_at(pool.spot());
        assert!((x as i128 - pool.base as i128).abs() <= 2, "x(spot)={x} vs base={}", pool.base);
        // base reserve falls as price rises (pool sells base).
        assert!(pool.base_at(110 * PRICE_SCALE) < pool.base);
        // base reserve rises as price falls (pool buys base).
        assert!(pool.base_at(90 * PRICE_SCALE) > pool.base);
    }

    #[test]
    fn ladder_is_empty_for_zero_reserves() {
        let pool = Cfmm { base: 0, quote: 0 };
        assert!(pool.ladder(90 * PRICE_SCALE, 110 * PRICE_SCALE, 8).is_empty());
    }

    #[test]
    fn ladder_sells_above_spot_buys_below() {
        let pool = Cfmm { base: 1_000_000, quote: 100_000_000 }; // spot 100
        let lad = pool.ladder(95 * PRICE_SCALE, 105 * PRICE_SCALE, 8);
        assert!(!lad.is_empty());
        for o in &lad {
            match o.side {
                Side::Sell => assert!(o.price_limit > pool.spot(), "sell above spot"),
                Side::Buy => assert!(o.price_limit < pool.spot(), "buy below spot"),
            }
            assert!(o.flow == Flow::Maker, "pool liquidity is maker flow");
            assert!(CfmmOrderIds::is(o.order_id));
        }
    }

    // helper to keep the test readable
    struct CfmmOrderIds;
    impl CfmmOrderIds {
        fn is(id: OrderId) -> bool { Cfmm::is_cfmm_order(id) }
    }
}
