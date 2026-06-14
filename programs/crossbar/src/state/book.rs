//! `BatchBook` PDA: the fixed-capacity, zero-copy order slab (`TECHNICALDESIGN.md`
//! section 6, `REQUIREMENTS.md` C2-C4).
//!
//! Layout reference, not copy: OpenBook v2's `bookside`/slab shape was read for
//! this (`vendor/openbook-v2`, `INTEGRATIONS.md` section 9). We use a flat
//! fixed array rather than a critbit slab because a batch is bounded and the
//! clearing pass sorts by price anyway.
//!
//! Zero-copy rules (C4): `#[repr(C)]`, no `Vec`, no payload enums. `side`,
//! `flow` are `u8`; explicit padding keeps the struct `Pod`-friendly.

use anchor_lang::prelude::*;

/// Start small per `REQUIREMENTS.md` C2; raise only after measuring
/// `run_batch` compute units against the 1.4M CU cap (C1). This is the slab
/// capacity for `BatchBook` and `BatchResult` and must equal
/// `Market.max_orders_per_batch`.
pub const MAX_ORDERS_PER_BATCH: usize = 64;

pub const SIDE_BUY: u8 = 0;
pub const SIDE_SELL: u8 = 1;
pub const FLOW_MAKER: u8 = 0;
pub const FLOW_TAKER: u8 = 1;

#[zero_copy]
#[derive(Default)]
#[repr(C)]
pub struct Order {
    pub order_id: u64,
    pub owner: Pubkey,
    pub price_limit: u64, // quote per base at PRICE_SCALE
    pub quantity: u64,    // base atomic units
    pub remaining: u64,
    pub window: u64,
    pub side: u8, // SIDE_BUY | SIDE_SELL
    pub flow: u8, // FLOW_MAKER | FLOW_TAKER
    pub _pad: [u8; 6],
}

#[account(zero_copy)]
#[repr(C)]
pub struct BatchBook {
    pub market: Pubkey,
    pub window: u64,
    pub n_orders: u16,
    pub _pad: [u8; 6],
    pub orders: [Order; MAX_ORDERS_PER_BATCH],
}

impl BatchBook {
    // 8-byte Anchor discriminator + the exact zero-copy struct size.
    pub const SPACE: usize = 8 + core::mem::size_of::<BatchBook>();

    /// Append an order to the forming window. Returns `BatchFull` when at
    /// capacity (`REQUIREMENTS.md` F3).
    pub fn push(&mut self, order: Order) -> std::result::Result<(), crate::err::CrossbarError> {
        let n = self.n_orders as usize;
        if n >= MAX_ORDERS_PER_BATCH {
            return Err(crate::err::CrossbarError::BatchFull);
        }
        self.orders[n] = order;
        self.n_orders += 1;
        Ok(())
    }

    pub fn live(&self) -> &[Order] {
        &self.orders[..self.n_orders as usize]
    }
}
