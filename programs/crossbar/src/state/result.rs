//! `BatchResult` PDA: the per-tick clearing readout (`TECHNICALDESIGN.md` section 6).
//! Doubles as the differential-test readout (`MATH.md` section 6.1): the parity
//! harness reads `clearing_price` and `fills` straight out of this account.

use anchor_lang::prelude::*;

use super::book::MAX_ORDERS_PER_BATCH;

pub const BATCH_CLEARED: u8 = 0;
pub const BATCH_SKIPPED_STALE_ORACLE: u8 = 1;
pub const BATCH_REJECTED_OUT_OF_BAND: u8 = 2;
pub const BATCH_EMPTY: u8 = 3;
/// The window has not reached its (randomized) close target yet; orders keep
/// accumulating, no clear this tick (`MATH.md` section 8.1).
pub const BATCH_FORMING: u8 = 4;

#[zero_copy]
#[derive(Default)]
#[repr(C)]
pub struct Fill {
    pub order_id: u64,
    pub owner: Pubkey,
    pub filled: u64,
    /// SIDE_BUY | SIDE_SELL (`book.rs`), so settlement is self-describing from
    /// `BatchResult` alone without re-reading the book.
    pub side: u8,
    pub _pad: [u8; 7],
}

/// Capacity for the marginal tied-order set carried for the VRF tie-break. A
/// tie with more than this many orders is rare; the deterministic fallback
/// still covers it (`MATH.md` section 4).
pub const MAX_MARGINAL_TIED: usize = 16;

#[account(zero_copy)]
#[repr(C)]
pub struct BatchResult {
    pub market: Pubkey,
    pub window: u64,
    pub status: u8, // BATCH_*
    pub _pad: [u8; 7],
    pub clearing_price: u64, // p*
    pub matched_volume: u64,
    pub n_fills: u16,
    pub _pad2: [u8; 6],
    /// Indivisible base units left at the margin after integer pro-rata, summed
    /// across both sides. This (and only this) is the VRF blast radius.
    pub marginal_remainder: u64,
    /// Order ids tied at the margin that share the remainder.
    pub n_marginal_tied: u8,
    pub _pad3: [u8; 7],
    /// The tied order assigned the remainder (set deterministically by
    /// `run_batch`; overwritten by the VRF callback if it lands in time).
    pub vrf_winner: u64,
    pub marginal_tied: [u64; MAX_MARGINAL_TIED],
    pub fills: [Fill; MAX_ORDERS_PER_BATCH],
}

impl BatchResult {
    // 8-byte Anchor discriminator + the exact zero-copy struct size. Using
    // size_of::<Self>() keeps SPACE correct as fields change (the earlier
    // hand-counted value went stale when the marginal record was added and
    // panicked AccountLoader::load_init on a too-small account).
    pub const SPACE: usize = 8 + core::mem::size_of::<BatchResult>();

    pub fn reset(&mut self, market: Pubkey, window: u64) {
        self.market = market;
        self.window = window;
        self.status = BATCH_EMPTY;
        self.clearing_price = 0;
        self.matched_volume = 0;
        self.n_fills = 0;
        self.marginal_remainder = 0;
        self.n_marginal_tied = 0;
        self.vrf_winner = 0;
        self.marginal_tied = [0; MAX_MARGINAL_TIED];
        for f in self.fills.iter_mut() {
            *f = Fill::default();
        }
    }

    /// Record the marginal tied set + remainder (the VRF blast radius). The
    /// deterministic winner is the lowest order id (matching the engine's
    /// fallback); the VRF callback may overwrite `vrf_winner` later.
    pub fn set_marginal(&mut self, tied: &[u64], remainder: u64) {
        let n = tied.len().min(MAX_MARGINAL_TIED);
        self.n_marginal_tied = n as u8;
        self.marginal_remainder = remainder;
        self.marginal_tied = [0; MAX_MARGINAL_TIED];
        for (i, &id) in tied.iter().take(n).enumerate() {
            self.marginal_tied[i] = id;
        }
        self.vrf_winner = tied.iter().copied().min().unwrap_or(0);
    }

    /// Record a settlement fill. Returns `false` if the fills array is at
    /// capacity (audit M2): the caller must treat that as an invariant violation
    /// rather than silently dropping a fill (which would let one side trade while
    /// the counterparty is fully refunded). Truncation is unreachable in practice
    /// because the book caps at `MAX_ORDERS_PER_BATCH` == this array's capacity,
    /// and only book (non-CFMM) orders are recorded here.
    #[must_use]
    pub fn record_fill(&mut self, order_id: u64, owner: Pubkey, side: u8, filled: u64) -> bool {
        let n = self.n_fills as usize;
        if n < MAX_ORDERS_PER_BATCH {
            self.fills[n] = Fill { order_id, owner, filled, side, _pad: [0; 7] };
            self.n_fills += 1;
            true
        } else {
            false
        }
    }
}
