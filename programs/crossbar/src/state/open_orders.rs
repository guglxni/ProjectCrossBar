//! `OpenOrders` PDA, per trader (`TECHNICALDESIGN.md` section 6). A normal account with
//! bounded vecs (C4 permits this for non zero-copy accounts). Mirrors a
//! trader's live orders and their claimable balances, settled on `settle`.

use anchor_lang::prelude::*;

/// Max live orders a single trader can have resting across forming windows.
pub const MAX_LIVE_ORDERS: usize = 32;

#[account]
pub struct OpenOrders {
    pub owner: Pubkey,
    pub market: Pubkey,
    /// Free balance the trader has deposited and can spend or withdraw.
    /// Credited by `deposit` (L1) and by clearing fills; debited by `withdraw`
    /// (L1) and when an order is submitted (moved to `*_reserved`).
    pub base_claimable: u64,
    pub quote_claimable: u64,
    /// Balance locked behind live orders (the escrow). Moved here from
    /// claimable on `submit_order`, back on `cancel_order`, and converted at
    /// `p*` on settlement. This is the internal escrow ledger that lets
    /// `submit_order` run inside the ER with no token CPI (the real SPL moves
    /// happen only at the L1 boundary, `deposit`/`withdraw`).
    pub base_reserved: u64,
    pub quote_reserved: u64,
    pub live_order_ids: Vec<u64>,
    pub bump: u8,
    /// Window id of the last `BatchResult` this trader was settled against
    /// (`u64::MAX` = never settled). Makes `settle` one-shot per (trader, window)
    /// so fills cannot be re-credited and the vault drained (audit C1).
    pub last_settled_window: u64,
}

impl OpenOrders {
    pub const SPACE: usize = 8
        + 32
        + 32
        + 8
        + 8
        + 8
        + 8
        + 4 + (8 * MAX_LIVE_ORDERS) // vec len prefix + capacity
        + 1
        + 8; // last_settled_window

    pub fn add_order(&mut self, order_id: u64) -> std::result::Result<(), crate::err::CrossbarError> {
        if self.live_order_ids.len() >= MAX_LIVE_ORDERS {
            return Err(crate::err::CrossbarError::BatchFull);
        }
        self.live_order_ids.push(order_id);
        Ok(())
    }

    pub fn remove_order(&mut self, order_id: u64) {
        self.live_order_ids.retain(|&id| id != order_id);
    }

    /// Move escrow from free (claimable) to locked (reserved) when an order is
    /// submitted. Errors if the trader has not deposited enough.
    pub fn reserve(
        &mut self,
        base: u64,
        quote: u64,
    ) -> std::result::Result<(), crate::err::CrossbarError> {
        use crate::err::CrossbarError;
        if self.base_claimable < base || self.quote_claimable < quote {
            return Err(CrossbarError::InsufficientFunds);
        }
        self.base_claimable -= base;
        self.quote_claimable -= quote;
        // checked: reserved is the escrow ledger; never silently wrap (audit L2).
        self.base_reserved = self
            .base_reserved
            .checked_add(base)
            .ok_or(CrossbarError::Overflow)?;
        self.quote_reserved = self
            .quote_reserved
            .checked_add(quote)
            .ok_or(CrossbarError::Overflow)?;
        Ok(())
    }

    /// Move escrow back from locked to free on cancel. Infallible (saturating);
    /// a claimable balance large enough to overflow u64 is not economically
    /// reachable, and cancel must never abort.
    pub fn unreserve(&mut self, base: u64, quote: u64) {
        self.base_reserved = self.base_reserved.saturating_sub(base);
        self.quote_reserved = self.quote_reserved.saturating_sub(quote);
        self.base_claimable = self.base_claimable.saturating_add(base);
        self.quote_claimable = self.quote_claimable.saturating_add(quote);
    }
}

/// Escrow (max spend) an order locks at submit time, in (base, quote) atomic
/// units (`TECHNICALDESIGN.md` section 4.3, `MATH.md` section 0 fixed-point):
///   * a BUY locks quote = ceil(price_limit * quantity / PRICE_SCALE),
///   * a SELL locks base = quantity.
/// Uses u128 intermediate and integer ceil; no floats (`REQUIREMENTS.md` C5).
pub fn order_escrow(side: u8, price_limit: u64, quantity: u64) -> (u64, u64) {
    use crate::state::book::SIDE_BUY;
    if side == SIDE_BUY {
        let scale = crossbar_clearing::PRICE_SCALE as u128;
        let cost = (price_limit as u128) * (quantity as u128);
        let quote = ((cost + scale - 1) / scale) as u64; // ceil
        (0, quote)
    } else {
        (quantity, 0)
    }
}
