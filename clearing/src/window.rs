//! Randomized clearing-time window boundary (`MATH.md` section 8.1; Mastrolia &
//! Xu, "Clearing time randomization and transaction fees for auction market
//! design", arXiv 2405.09764).
//!
//! Frequent batch auctions kill intra-window time priority, but a residual game
//! survives at the BATCH BOUNDARY: a strategic trader can wait for the last
//! instant before a predictable close to act on the latest information ("bang
//! the close" / cross-batch entry timing; `MATH.md` section 7). Mastrolia & Xu
//! prove that with a fixed close the optimal arrival is always the last instant,
//! and that making the close time RANDOM (unpredictable until it happens) flips
//! that optimum: even an ~8% chance of closing one tick early was enough in
//! their Bernoulli {9,10} model.
//!
//! Project CrossBar randomizes the close by counting crank ticks per window and
//! closing after a VRF-derived TARGET number of ticks drawn from a small band
//! `[min, max]` (expected close ~ nominal, so the auction is not systematically
//! shortened). The target is set from the ephemeral-vrf output and is
//! unpredictable until the window actually closes.
//!
//! N1 IS PRESERVED. This is window-FORMATION logic: it decides WHICH orders fall
//! in a batch, not how they are matched. The matcher (`clear::*`) stays a pure
//! function of the realized batch set and the reference price, and shuffling the
//! set still yields identical fills (the order-fairness theorem,
//! `tests/order_fairness.rs`). The only inputs here are an instruction-counter
//! (crank ticks) and the VRF target - never a clock, slot, or arrival order.
//!
//! Pure and integer-only (`REQUIREMENTS.md` C5); unit-tested off-chain and
//! called unchanged on-chain.

/// Map a VRF random value uniformly onto the inclusive tick band
/// `[min_ticks, max_ticks]`. Degenerate/disabled cases collapse to a sane
/// positive target (a window must span at least one tick).
pub fn next_target(randomness: u64, min_ticks: u32, max_ticks: u32) -> u32 {
    let lo = min_ticks.max(1);
    let hi = max_ticks.max(lo);
    if hi == lo {
        return lo;
    }
    let span = (hi - lo) as u64 + 1;
    lo + (randomness % span) as u32
}

/// Whether the forming window should close now: the crank has ticked at least
/// `target_ticks` times since the window opened.
pub fn should_close(elapsed_ticks: u32, target_ticks: u32) -> bool {
    elapsed_ticks >= target_ticks.max(1)
}

/// Is randomization enabled for this market? `max_ticks == 0` (or `<= 1`) means
/// "close every tick" - the original deterministic-cadence behaviour.
pub fn randomization_enabled(min_ticks: u32, max_ticks: u32) -> bool {
    max_ticks > 1 && max_ticks >= min_ticks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_is_always_in_band() {
        // Over many random seeds, next_target stays within [min, max].
        let (min, max) = (3u32, 7u32);
        for r in 0..10_000u64 {
            // vary the seed nonlinearly
            let seed = r.wrapping_mul(6364136223846793005).wrapping_add(1);
            let t = next_target(seed, min, max);
            assert!(t >= min && t <= max, "target {t} out of [{min},{max}]");
        }
    }

    #[test]
    fn target_covers_the_whole_band() {
        // A uniform map should hit every value in a small band.
        let (min, max) = (2u32, 5u32);
        let mut seen = [false; 8];
        for r in 0..1000u64 {
            seen[next_target(r, min, max) as usize] = true;
        }
        for v in min..=max {
            assert!(seen[v as usize], "band value {v} never produced");
        }
    }

    #[test]
    fn degenerate_bands_are_safe() {
        assert_eq!(next_target(123, 0, 0), 1); // disabled -> at least 1 tick
        assert_eq!(next_target(123, 5, 5), 5); // point band
        assert_eq!(next_target(123, 9, 4), 9); // inverted -> clamps to lo
    }

    #[test]
    fn should_close_at_or_after_target() {
        assert!(!should_close(0, 3));
        assert!(!should_close(2, 3));
        assert!(should_close(3, 3));
        assert!(should_close(4, 3));
        // target 0 is treated as 1 (a window is at least one tick).
        assert!(should_close(1, 0));
    }

    #[test]
    fn randomization_flag() {
        assert!(!randomization_enabled(1, 1)); // close every tick
        assert!(!randomization_enabled(0, 0));
        assert!(randomization_enabled(3, 7));
        assert!(randomization_enabled(1, 5));
    }
}
