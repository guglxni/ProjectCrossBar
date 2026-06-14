//! `Market` PDA: per-market config and lifecycle status (`TECHNICALDESIGN.md` section 6,
//! `architecture.md` section 3).

use anchor_lang::prelude::*;

/// Lifecycle status. Encoded as a Borsh enum on this normal (non zero-copy)
/// account, so a real enum is fine here (`REQUIREMENTS.md` C4 only constrains
/// the zero-copy accounts).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketStatus {
    OnBase,
    Delegated,
    Settling,
}

#[account]
pub struct Market {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    /// Batch tick cadence (`TECHNICALDESIGN.md` section 3, default 50).
    pub tick_interval_ms: u32,
    /// Checkpoint cadence in ticks (`REQUIREMENTS.md` C7).
    pub commit_every_ticks: u32,
    /// Reference-band half-width in basis points (`TECHNICALDESIGN.md` section 7). Zero
    /// disables the band (clear without a reference check).
    pub band_delta_bps: u16,
    pub fee_bps: u16,
    /// Max age (in slots) of the oracle price before a tick is skipped as stale
    /// (`REQUIREMENTS.md` oracle max-age). Zero disables the staleness check.
    pub oracle_max_age_slots: u32,
    /// Slab capacity per batch; must match `BatchBook`/`BatchResult` capacity
    /// and fit the `run_batch` CU budget (`REQUIREMENTS.md` C1, C2).
    pub max_orders_per_batch: u16,
    pub status: MarketStatus,
    pub lazer_feed_id: u64,
    /// Only legitimate caller of `run_batch` (`TECHNICALDESIGN.md` section 5).
    pub crank_authority: Pubkey,
    /// The forming batch window id; bumped each tick.
    pub current_window: u64,
    /// Monotonic order-id source.
    pub next_order_id: u64,
    /// Slot of the last `commit` checkpoint; drives the `force_undelegate`
    /// stall timeout (`REQUIREMENTS.md` F-timeout).
    pub last_commit_slot: u64,
    /// After this many slots without a commit, anyone may `force_undelegate`
    /// so escrow is never stuck (`REQUIREMENTS.md` F11). Zero disables.
    pub force_undelegate_timeout_slots: u32,
    /// Randomized clearing-time band, in crank ticks (`MATH.md` section 8.1,
    /// arXiv 2405.09764). The window closes after `window_target_ticks` crank
    /// ticks; the target is drawn from `[window_min_ticks, window_max_ticks]`
    /// by VRF and is unpredictable until the window closes. `window_max_ticks
    /// <= 1` disables randomization (close every tick, original cadence).
    pub window_min_ticks: u32,
    pub window_max_ticks: u32,
    /// Current window's close target (set to max as a deterministic fallback at
    /// window open; re-randomized into the band by `consume_window_vrf`).
    pub window_target_ticks: u32,
    /// Crank ticks elapsed in the forming window.
    pub window_ticks_elapsed: u32,
    /// Constant-product CFMM backstop reserves (`MATH.md` section 8.3, arXiv
    /// 2210.04929). When both are non-zero, `run_batch` adds the pool's
    /// synthetic maker ladder to the batch so a thin book still clears against
    /// passive liquidity. `cfmm_band_bps` is the ladder half-width around spot;
    /// `cfmm_levels` is the discretization per side.
    pub cfmm_base: u64,
    pub cfmm_quote: u64,
    pub cfmm_band_bps: u16,
    pub cfmm_levels: u16,
    /// Slot at which the market was last delegated (set in `set_delegated`).
    /// Used as the `force_undelegate` stall baseline before the first commit so
    /// a freshly-delegated market cannot be torn down instantly (audit M3).
    pub delegated_at_slot: u64,
    pub bump: u8,
}

impl Market {
    /// 8 discriminator + fields, with generous slack for added fields.
    pub const SPACE: usize = 8 + 160 + 8 + 6 + 4 + 8 + 32 + 8 + 8 + 8 + 4 + 1 + 64;
}
