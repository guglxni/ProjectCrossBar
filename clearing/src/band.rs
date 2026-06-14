//! Reference-price band (`TECHNICALDESIGN.md` section 7, `MATH.md` section 7,
//! `architecture.md` section 2.4).
//!
//! A thin or stale book must not clear at a manipulated price. The band bounds
//! the accepted clearing price around a reference price `p_ref` (Pyth Lazer):
//!
//! ```text
//! half = p_ref * band_delta_bps / 10_000
//! band = [p_ref - half, p_ref + half]
//! accept p* iff band.contains(p*)   (and the feed is fresh, checked on-chain)
//! ```
//!
//! Pure integer math (`REQUIREMENTS.md` C5); lives in the matcher crate so it is
//! unit-tested off-chain and called unchanged from `run_batch`.

use crate::Price;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Band {
    pub lo: Price,
    pub hi: Price,
}

/// Build the band around `p_ref` with half-width `band_delta_bps` basis points.
/// `band_delta_bps == 0` yields a degenerate band `[p_ref, p_ref]`; callers
/// treat that (or a zero `p_ref`) as "band disabled" rather than rejecting
/// everything (see `run_batch`).
pub fn reference_band(p_ref: Price, band_delta_bps: u16) -> Band {
    let half = ((p_ref as u128) * (band_delta_bps as u128) / 10_000) as Price;
    Band {
        lo: p_ref.saturating_sub(half),
        hi: p_ref.saturating_add(half),
    }
}

impl Band {
    pub fn contains(&self, p: Price) -> bool {
        self.lo <= p && p <= self.hi
    }
}

/// Price improvement of a clear versus a reference price, in basis points
/// (signed): `(p_ref - p_star) * 10_000 / p_ref`. Positive means buyers paid
/// below the reference (improvement for buyers); negative the reverse. A
/// companion metric for quantifying execution quality vs the Pyth mid (the
/// methodology of Bertucci et al., "Quantifying Price Improvement in Order Flow
/// Auctions", arXiv 2405.00537). Pure, integer-only.
pub fn price_improvement_bps(p_star: Price, p_ref: Price) -> i64 {
    if p_ref == 0 {
        return 0;
    }
    ((p_ref as i128 - p_star as i128) * 10_000 / p_ref as i128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn band_is_symmetric_around_reference() {
        // p_ref = 100 * SCALE, delta 100bps (1%) -> +/- 1 * SCALE.
        let p_ref = 100 * crate::PRICE_SCALE;
        let b = reference_band(p_ref, 100);
        assert_eq!(b.lo, 99 * crate::PRICE_SCALE);
        assert_eq!(b.hi, 101 * crate::PRICE_SCALE);
        assert!(b.contains(p_ref));
        assert!(b.contains(b.lo));
        assert!(b.contains(b.hi));
    }

    #[test]
    fn out_of_band_rejected() {
        let p_ref = 100 * crate::PRICE_SCALE;
        let b = reference_band(p_ref, 50); // 0.5%
        assert!(!b.contains(b.hi + 1));
        assert!(!b.contains(b.lo - 1));
    }

    #[test]
    fn zero_delta_is_degenerate_point() {
        let p_ref = 100 * crate::PRICE_SCALE;
        let b = reference_band(p_ref, 0);
        assert_eq!(b.lo, p_ref);
        assert_eq!(b.hi, p_ref);
    }

    #[test]
    fn price_improvement_metric() {
        let r = 100 * crate::PRICE_SCALE;
        // cleared 1% below reference -> +100 bps improvement for buyers.
        assert_eq!(price_improvement_bps(99 * crate::PRICE_SCALE, r), 100);
        // cleared at reference -> 0.
        assert_eq!(price_improvement_bps(r, r), 0);
        // cleared above reference -> negative.
        assert_eq!(price_improvement_bps(101 * crate::PRICE_SCALE, r), -100);
        assert_eq!(price_improvement_bps(r, 0), 0); // safe on zero ref
    }

    #[test]
    fn no_overflow_at_extremes() {
        // Large p_ref with wide band must not overflow (saturating).
        let b = reference_band(u64::MAX - 10, 10_000);
        assert_eq!(b.hi, u64::MAX);
    }
}
