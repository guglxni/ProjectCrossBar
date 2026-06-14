//! `OraclePrice` PDA: the latest reference price used for the clearing band
//! (`TECHNICALDESIGN.md` section 7, `architecture.md` section 2.4).
//!
//! Source of truth is Pyth Lazer (50ms channel, `INTEGRATIONS.md` section 7).
//! A keeper (or, in the full wiring, the Lazer receiver via CPI) writes the
//! latest scaled price here through `update_reference_price`; `run_batch` reads
//! it inside the ER to bound `p*`. The account is part of the delegated set so
//! the read is local to the ER. Staleness is checked against the slot at write
//! time (gating, not matching, so it does not violate N1).

use anchor_lang::prelude::*;

#[account]
pub struct OraclePrice {
    pub market: Pubkey,
    /// Who may push prices (the Lazer keeper / receiver authority).
    pub authority: Pubkey,
    /// Reference price scaled to `PRICE_SCALE`. Zero means "unset": the band is
    /// treated as disabled until a real price is pushed (so a market can run
    /// before the oracle is wired, e.g. in the demo).
    pub price: u64,
    /// Slot at which `price` was last written; used for the staleness check.
    pub last_update_slot: u64,
    pub bump: u8,
}

impl OraclePrice {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 1 + 8; // + slack
}
