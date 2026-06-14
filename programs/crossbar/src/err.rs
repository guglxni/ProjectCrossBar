//! Error codes (`TECHNICALDESIGN.md` section 8). Each maps to a failure mode in
//! `architecture.md` section 6.

use anchor_lang::prelude::*;

#[error_code]
pub enum CrossbarError {
    #[msg("The forming batch window is at max_orders_per_batch")]
    BatchFull,
    #[msg("Cannot cancel: the order's batch window has already closed for clearing")]
    WindowClosed,
    #[msg("Clearing price fell outside the Pyth Lazer reference band")]
    OutOfBand,
    #[msg("Pyth Lazer feed is older than the configured max age; tick skipped")]
    StaleOracle,
    #[msg("run_batch may only be invoked by the configured crank authority")]
    NotCrankAuthority,
    #[msg("Market is not in the expected lifecycle status for this instruction")]
    WrongStatus,
    #[msg("VRF did not return in time; fell back to the deterministic tie-break")]
    VrfTimeout,
    #[msg("Order references a market it does not belong to")]
    MarketMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Order not found in the forming window")]
    OrderNotFound,
    #[msg("Insufficient deposited balance to escrow this order")]
    InsufficientFunds,
    #[msg("Permission-program account is not the canonical MagicBlock permission program")]
    InvalidPermissionProgram,
    #[msg("This trader has already been settled for this batch window")]
    AlreadySettled,
    #[msg("Filled quantity exceeds the trader's reserved escrow (matcher/escrow desync)")]
    FillExceedsReserved,
    #[msg("Reference price update is zero or deviates too far from the previous price")]
    OracleDeviation,
}
