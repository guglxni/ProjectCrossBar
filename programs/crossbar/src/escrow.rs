//! L1-boundary escrow: the only place real SPL tokens move (`INTEGRATIONS.md`
//! section 5, two-plane model in `architecture.md` section 1).
//!
//! Design decision (see `scratchpad.md`): `ephemeral-rollups-spl` is a
//! standalone native reference program, and the current canonical token
//! pattern (the `spl-tokens` example) is plain `anchor_spl::token` transfers.
//! Because order flow runs inside the ER, escrow is kept as an internal
//! claimable/reserved ledger on `OpenOrders`: `submit_order`/`cancel_order`
//! only move ledger entries (no token CPI in the ER), and the actual SPL
//! transfers happen here on L1 - `deposit` before delegation, `withdraw`
//! (and `settle`) after undelegation. This keeps custody on L1 (N3, N5) and
//! avoids moving raw token accounts across the ER boundary by hand.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::err::CrossbarError;
use crate::EscrowTransfer;
use crate::MARKET_SEED;

/// Deposit `amount` of the base or quote mint into the market vault and credit
/// the trader's claimable balance. Runs on L1 before delegation.
pub fn deposit(ctx: Context<EscrowTransfer>, amount: u64, is_base: bool) -> Result<()> {
    let market = &ctx.accounts.market;
    let expected_vault = if is_base { market.base_vault } else { market.quote_vault };
    require_keys_eq!(ctx.accounts.vault.key(), expected_vault, CrossbarError::MarketMismatch);
    // Audit M1/H4: bind the `is_base` flag to the actual mint moved, so the
    // ledger field credited always matches the token deposited. (Token-2022 fee
    // mints are out of scope: the context pins the classic `Token` program.)
    let expected_mint = if is_base { market.base_mint } else { market.quote_mint };
    require_keys_eq!(ctx.accounts.vault.mint, expected_mint, CrossbarError::MarketMismatch);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    let oo = &mut ctx.accounts.open_orders;
    if oo.owner == Pubkey::default() {
        oo.owner = ctx.accounts.owner.key();
        oo.market = market.key();
        oo.bump = ctx.bumps.open_orders;
        oo.last_settled_window = u64::MAX; // sentinel: never settled (audit C1)
    }
    if is_base {
        oo.base_claimable = oo.base_claimable.checked_add(amount).ok_or(CrossbarError::Overflow)?;
    } else {
        oo.quote_claimable = oo.quote_claimable.checked_add(amount).ok_or(CrossbarError::Overflow)?;
    }
    Ok(())
}

/// Withdraw `amount` of the base or quote mint from the market vault back to
/// the trader, debiting their claimable balance. Runs on L1 (after
/// undelegation for settled funds). The vault is owned by the `Market` PDA, so
/// the program signs the transfer with the market seeds.
pub fn withdraw(ctx: Context<EscrowTransfer>, amount: u64, is_base: bool) -> Result<()> {
    let market = &ctx.accounts.market;
    // Audit R2-Low (D-2): never pay out against the L1 copy of `OpenOrders` while
    // the authoritative ledger is delegated to the ER — that would let the
    // committed-back ER state overwrite (and thus undo) the debit. Withdraw only
    // when the ledger lives on L1 (OnBase after settlement, or Settling).
    use crate::state::market::MarketStatus;
    require!(market.status != MarketStatus::Delegated, CrossbarError::WrongStatus);
    let expected_vault = if is_base { market.base_vault } else { market.quote_vault };
    require_keys_eq!(ctx.accounts.vault.key(), expected_vault, CrossbarError::MarketMismatch);
    let expected_mint = if is_base { market.base_mint } else { market.quote_mint };
    require_keys_eq!(ctx.accounts.vault.mint, expected_mint, CrossbarError::MarketMismatch);

    {
        let oo = &ctx.accounts.open_orders;
        let avail = if is_base { oo.base_claimable } else { oo.quote_claimable };
        require!(avail >= amount, CrossbarError::InsufficientFunds);
    }

    let base_mint = market.base_mint;
    let quote_mint = market.quote_mint;
    let bump = market.bump;
    let seeds: &[&[u8]] = &[MARKET_SEED, base_mint.as_ref(), quote_mint.as_ref(), &[bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    let oo = &mut ctx.accounts.open_orders;
    if is_base {
        oo.base_claimable -= amount;
    } else {
        oo.quote_claimable -= amount;
    }
    Ok(())
}

// The `EscrowTransfer` Accounts context lives in `lib.rs` alongside the other
// instruction contexts so the `#[program]` macro can resolve its generated
// client-accounts modules.
