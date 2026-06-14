//! Project CrossBar program: a frequent batch auction DEX that clears inside a
//! MagicBlock Ephemeral Rollup and settles to Solana L1.
//!
//! Read order: `README.md` -> `prd.md` -> `architecture.md` -> `MATH.md` ->
//! `TECHNICALDESIGN.md`. Instruction and PDA names here are canonical (`AGENTS.md`).
//!
//! API provenance (honesty contract): the MagicBlock macros and calls
//! (`#[ephemeral]`, `#[delegate]`, `#[commit]`, `DelegateConfig`,
//! `MagicIntentBundleBuilder`, `ScheduleTask`) are taken verbatim from the
//! pinned vendored examples `vendor/magicblock-engine-examples/anchor-counter`
//! and `.../crank-counter`, which build with anchor-lang 1.0.2 +
//! ephemeral-rollups-sdk 0.14.3. Where this program shells an integration it
//! has not yet verified against vendor source (SPL escrow, Pyth Lazer, VRF),
//! that is called out inline; those are not invented signatures.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction};

use anchor_spl::token::{Mint, Token, TokenAccount};
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;


pub mod clearing_bridge;
pub mod err;
pub mod escrow;
pub mod permission;
pub mod state;

use err::CrossbarError;
use state::book::{BatchBook, Order as SlabOrder, FLOW_MAKER, FLOW_TAKER, SIDE_BUY, SIDE_SELL};
use state::market::{Market, MarketStatus};
use state::open_orders::OpenOrders;
use state::result::BatchResult;

declare_id!("CG4brtfmRvvHLGEfLazSmrTWeUJsDvyKYfosx2Abbzbd");

pub const MARKET_SEED: &[u8] = b"market";
pub const BOOK_SEED: &[u8] = b"book";
pub const RESULT_SEED: &[u8] = b"result";
pub const OPEN_ORDERS_SEED: &[u8] = b"open_orders";
pub const BASE_VAULT_SEED: &[u8] = b"base_vault";
pub const QUOTE_VAULT_SEED: &[u8] = b"quote_vault";
pub const ORACLE_SEED: &[u8] = b"oracle";

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitMarketParams {
    // base/quote mints come from the account context; the vaults are PDAs the
    // program creates and owns (see InitMarket).
    pub tick_interval_ms: u32,   // TECHNICALDESIGN.md section 3, default 50
    pub commit_every_ticks: u32, // REQUIREMENTS.md C7
    pub band_delta_bps: u16,     // TECHNICALDESIGN.md section 7 (0 disables the band)
    pub fee_bps: u16,
    pub max_orders_per_batch: u16,
    pub oracle_max_age_slots: u32, // 0 disables the staleness check
    pub force_undelegate_timeout_slots: u32, // 0 disables the stall escape hatch
    // Randomized clearing-time band in crank ticks (MATH.md 8.1). max <= 1
    // disables randomization (close every tick).
    pub window_min_ticks: u32,
    pub window_max_ticks: u32,
    // CFMM backstop pool (MATH.md 8.3). Zero reserves disable it.
    pub cfmm_base: u64,
    pub cfmm_quote: u64,
    pub cfmm_band_bps: u16,
    pub cfmm_levels: u16,
    pub lazer_feed_id: u64,
    pub crank_authority: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScheduleBatchArgs {
    pub task_id: i64,
    pub execution_interval_millis: i64, // tick cadence, 50ms
    pub iterations: i64,                // -1 / large for "until undelegate"
}

/// Validate a `Market` passed as an `UncheckedAccount` (because it is also handed
/// to a delegation / ScheduleTask CPI): confirm it is a program-owned `Market`,
/// gate on its `crank_authority`, and require the expected lifecycle status.
/// Used by `schedule_batch` / `delegate_*` where the typed `Account<Market>`
/// constraint cannot be used (audit C3/H2).
fn market_guard(
    ai: &AccountInfo,
    expected_authority: &Pubkey,
    expected_status: MarketStatus,
) -> Result<()> {
    require_keys_eq!(*ai.owner, crate::ID, CrossbarError::MarketMismatch);
    let data = ai.try_borrow_data()?;
    let market = Market::try_deserialize(&mut &data[..])
        .map_err(|_| error!(CrossbarError::MarketMismatch))?;
    require_keys_eq!(
        market.crank_authority,
        *expected_authority,
        CrossbarError::NotCrankAuthority
    );
    require!(market.status == expected_status, CrossbarError::WrongStatus);
    Ok(())
}

/// Shared settlement logic: credit one trader's fills at `p*` + refund unspent
/// escrow. One-shot per (trader, window) via the `last_settled_window` cursor
/// (audit C1), bounded by reserved escrow (audit M1). Used by both the direct
/// `settle` and the post-commit `settle_action` (Magic Action) paths so the
/// vault-safety invariants are identical regardless of which one runs.
fn settle_inner(
    batch_result: &AccountLoader<BatchResult>,
    open_orders: &mut Account<OpenOrders>,
) -> Result<()> {
    let scale = crossbar_clearing::PRICE_SCALE as u128;
    let owner = open_orders.owner;
    let (mut bought_base, mut spent_quote, mut sold_base, mut recv_quote) =
        (0u128, 0u128, 0u128, 0u128);
    let window;
    {
        let result = batch_result.load()?;
        window = result.window;
        require!(
            open_orders.last_settled_window != window,
            CrossbarError::AlreadySettled
        );
        let p_star = result.clearing_price as u128;
        for i in 0..result.n_fills as usize {
            let f = result.fills[i];
            if f.owner != owner {
                continue;
            }
            let q = f.filled as u128;
            let quote = q.saturating_mul(p_star) / scale;
            if f.side == SIDE_BUY {
                bought_base += q;
                spent_quote += quote;
            } else {
                sold_base += q;
                recv_quote += quote;
            }
        }
    }
    require!(
        sold_base <= open_orders.base_reserved as u128
            && spent_quote <= open_orders.quote_reserved as u128,
        CrossbarError::FillExceedsReserved
    );
    let base_refund = (open_orders.base_reserved as u128) - sold_base;
    let quote_refund = (open_orders.quote_reserved as u128) - spent_quote;
    open_orders.base_claimable = open_orders
        .base_claimable
        .checked_add((bought_base + base_refund) as u64)
        .ok_or(CrossbarError::Overflow)?;
    open_orders.quote_claimable = open_orders
        .quote_claimable
        .checked_add((recv_quote + quote_refund) as u64)
        .ok_or(CrossbarError::Overflow)?;
    open_orders.base_reserved = 0;
    open_orders.quote_reserved = 0;
    open_orders.live_order_ids.clear();
    open_orders.last_settled_window = window; // audit C1: mark this window settled
    msg!("settle trader {} bought_base={} recv_quote={}", owner, bought_base, recv_quote);
    Ok(())
}

#[ephemeral]
#[program]
pub mod crossbar {
    use super::*;

    /// F1: create the `Market`, `BatchBook`, and `BatchResult` PDAs on L1.
    /// Vault pubkeys are recorded; the SPL escrow vaults themselves are wired
    /// with `ephemeral-rollups-spl` in M1 (see `submit_order`).
    pub fn init_market(ctx: Context<InitMarket>, params: InitMarketParams) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.base_mint = ctx.accounts.base_mint.key();
        market.quote_mint = ctx.accounts.quote_mint.key();
        market.base_vault = ctx.accounts.base_vault.key();
        market.quote_vault = ctx.accounts.quote_vault.key();
        market.tick_interval_ms = if params.tick_interval_ms == 0 { 50 } else { params.tick_interval_ms };
        market.commit_every_ticks = params.commit_every_ticks.max(1);
        market.band_delta_bps = params.band_delta_bps;
        market.fee_bps = params.fee_bps;
        market.oracle_max_age_slots = params.oracle_max_age_slots;
        market.force_undelegate_timeout_slots = params.force_undelegate_timeout_slots;
        market.last_commit_slot = 0;
        market.window_min_ticks = params.window_min_ticks;
        market.window_max_ticks = params.window_max_ticks;
        // Deterministic fallback close target = max; VRF re-randomizes into the band.
        market.window_target_ticks = params.window_max_ticks.max(1);
        market.window_ticks_elapsed = 0;
        market.cfmm_base = params.cfmm_base;
        market.cfmm_quote = params.cfmm_quote;
        market.cfmm_band_bps = params.cfmm_band_bps;
        market.cfmm_levels = params.cfmm_levels;
        market.max_orders_per_batch = params.max_orders_per_batch.min(state::book::MAX_ORDERS_PER_BATCH as u16);
        market.status = MarketStatus::OnBase;
        market.lazer_feed_id = params.lazer_feed_id;
        market.crank_authority = params.crank_authority;
        market.current_window = 0;
        market.next_order_id = 1;
        market.bump = ctx.bumps.market;

        let mut book = ctx.accounts.batch_book.load_init()?;
        book.market = market.key();
        book.window = 0;
        book.n_orders = 0;

        let mut result = ctx.accounts.batch_result.load_init()?;
        result.reset(market.key(), 0);

        let oracle = &mut ctx.accounts.oracle_price;
        oracle.market = market.key();
        oracle.authority = params.crank_authority; // keeper that pushes Lazer prices
        oracle.price = 0; // unset -> band disabled until a price is pushed
        oracle.last_update_slot = 0;
        oracle.bump = ctx.bumps.oracle_price;

        msg!("init_market {} status OnBase", market.key());
        Ok(())
    }

    /// F2 / C6: delegate the PDAs `run_batch` writes into an ER session.
    ///
    /// This delegates the `BatchBook` (the account `run_batch` mutates each
    /// tick) following the verified `anchor-counter` pattern. The full
    /// delegation set required by C6 ("Market + BatchBook + both Vaults,
    /// together, before the first tick") is completed alongside the SPL escrow
    /// wiring in M1; the per-account ergonomics follow `/magicblock`
    /// delegation.md. Status is set to `Delegated` once the set is delegated.
    pub fn delegate_market(ctx: Context<DelegateMarket>) -> Result<()> {
        // C6: delegate the full set of program-owned PDAs that the ER touches,
        // all together before the first tick: Market (run_batch writes
        // current_window; submit_order reads it), BatchBook (the order slab),
        // BatchResult (the clearing readout), OraclePrice (the band reference).
        // Vaults are NOT delegated: they are SPL token accounts owned by the
        // token program, and escrow is an L1-boundary ledger (deposit/withdraw)
        // by design (see escrow.rs). Per-trader OpenOrders are delegated
        // separately via `delegate_open_orders`.
        // Audit H2: only the crank authority may delegate (and pick the ER
        // validator via remaining_accounts). set_delegated runs first in the
        // lifecycle, so the market is already `Delegated` here.
        market_guard(
            &ctx.accounts.market,
            &ctx.accounts.authority.key(),
            MarketStatus::Delegated,
        )?;
        let validator = ctx.remaining_accounts.first().map(|acc| acc.key());
        let market_key = ctx.accounts.market.key();
        let bm = ctx.accounts.base_mint.key();
        let qm = ctx.accounts.quote_mint.key();
        ctx.accounts.delegate_market(
            &ctx.accounts.payer,
            &[MARKET_SEED, bm.as_ref(), qm.as_ref()],
            DelegateConfig { validator, ..Default::default() },
        )?;
        ctx.accounts.delegate_book(
            &ctx.accounts.payer,
            &[BOOK_SEED, market_key.as_ref()],
            DelegateConfig { validator, ..Default::default() },
        )?;
        ctx.accounts.delegate_result(
            &ctx.accounts.payer,
            &[RESULT_SEED, market_key.as_ref()],
            DelegateConfig { validator, ..Default::default() },
        )?;
        ctx.accounts.delegate_oracle(
            &ctx.accounts.payer,
            &[ORACLE_SEED, market_key.as_ref()],
            DelegateConfig { validator, ..Default::default() },
        )?;
        Ok(())
    }

    /// Delegate one trader's `OpenOrders` into the ER so `submit_order` /
    /// `cancel_order` can update their reserved/claimable ledger inside the
    /// rollup. Called per trader before they submit (`C6` for per-trader state).
    pub fn delegate_open_orders(
        ctx: Context<DelegateOpenOrders>,
        owner: Pubkey,
    ) -> Result<()> {
        // NB: no crank_authority gate here. `delegate_market` runs first in the
        // lifecycle, so by this point the Market PDA is owned by the delegation
        // program and its `crank_authority` is no longer readable on L1 (the
        // earlier `market_guard` here failed on the real ER for exactly this
        // reason). The H2 concern (validator positioning) is enforced on
        // `delegate_market`; delegating a per-trader OpenOrders to a wrong
        // validator only self-griefs (the OO must share the market's ER to be
        // usable) and the trader can re-delegate after undelegating. The OO PDA
        // is still seed-bound to `[OPEN_ORDERS_SEED, market, owner]` by the
        // delegate CPI, so it cannot be delegated under a foreign market.
        let validator = ctx.remaining_accounts.first().map(|acc| acc.key());
        let market_key = ctx.accounts.market.key();
        ctx.accounts.delegate_open_orders(
            &ctx.accounts.payer,
            &[OPEN_ORDERS_SEED, market_key.as_ref(), owner.as_ref()],
            DelegateConfig { validator, ..Default::default() },
        )?;
        Ok(())
    }

    /// Mark the market delegated. Separated so it runs after the (possibly
    /// multi-account) delegation set is in place. Kept on L1.
    pub fn set_delegated(ctx: Context<UpdateStatus>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.crank_authority,
            ctx.accounts.authority.key(),
            CrossbarError::NotCrankAuthority
        );
        // Audit R2-Info: only enter Delegated from OnBase (never re-stamp the
        // baseline mid-Settling). Crank-authority gated already.
        require!(
            ctx.accounts.market.status == MarketStatus::OnBase,
            CrossbarError::WrongStatus
        );
        ctx.accounts.market.status = MarketStatus::Delegated;
        // Audit M3: stamp the delegation slot as the force-undelegate baseline.
        ctx.accounts.market.delegated_at_slot = Clock::get()?.slot;
        Ok(())
    }

    /// PER (Private Ephemeral Rollup): make the market's clearing state private.
    ///
    /// Binds a MagicBlock `permission` (live program
    /// `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`) to the confidential
    /// clearing accounts — `BatchBook` (resting order sizes) and `BatchResult`
    /// (per-order fills) — listing the crank authority as the sole member with
    /// full read access. Once these are delegated to a TEE validator and read via
    /// the TEE RPC, only that member can decrypt the resting book, so a large
    /// resting order no longer leaks a size signal across windows.
    ///
    /// MUST run BEFORE `delegate_market` (the permission CPI requires the
    /// permissioned account to sign, which only works while this program still
    /// owns the PDA). `Market` config and the public `OraclePrice` reference are
    /// intentionally left public. N1 is untouched: this changes *who can read*
    /// the book, not the determinism of `run_batch`. See
    /// `docs/integrations/PRIVATE_PAYMENTS.md` and `docs/N1_INVESTIGATION.md`.
    pub fn make_private(ctx: Context<MakePrivate>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.permission_program.key(),
            permission::PERMISSION_PROGRAM_ID,
            CrossbarError::InvalidPermissionProgram
        );
        // Audit L1: only the market operator may set up permissions.
        require_keys_eq!(
            ctx.accounts.payer.key(),
            ctx.accounts.market.crank_authority,
            CrossbarError::NotCrankAuthority
        );
        let market_key = ctx.accounts.market.key();
        let payer = ctx.accounts.payer.key();
        let sys = ctx.accounts.system_program.key();
        let members = [(permission::FLAGS_ALL, ctx.accounts.market.crank_authority)];

        // BatchBook: the resting order slab (signs with its PDA seeds).
        invoke_signed(
            &permission::create_permission_ix(
                ctx.accounts.book.key(),
                ctx.accounts.book_permission.key(),
                payer,
                sys,
                &members,
            ),
            &[
                ctx.accounts.book.to_account_info(),
                ctx.accounts.book_permission.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[BOOK_SEED, market_key.as_ref(), &[ctx.bumps.book]]],
        )?;

        // BatchResult: the per-order fills readout.
        invoke_signed(
            &permission::create_permission_ix(
                ctx.accounts.result.key(),
                ctx.accounts.result_permission.key(),
                payer,
                sys,
                &members,
            ),
            &[
                ctx.accounts.result.to_account_info(),
                ctx.accounts.result_permission.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[RESULT_SEED, market_key.as_ref(), &[ctx.bumps.result]]],
        )?;
        Ok(())
    }

    /// PER: bind a permission to one trader's `OpenOrders` (their reserved
    /// ledger) so their per-order amounts are TEE-confidential too, with the
    /// crank authority as the reading member. Run before `delegate_open_orders`.
    pub fn make_open_orders_private(
        ctx: Context<MakeOpenOrdersPrivate>,
        owner: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.permission_program.key(),
            permission::PERMISSION_PROGRAM_ID,
            CrossbarError::InvalidPermissionProgram
        );
        require_keys_eq!(
            ctx.accounts.payer.key(),
            ctx.accounts.market.crank_authority,
            CrossbarError::NotCrankAuthority
        );
        let market_key = ctx.accounts.market.key();
        let members = [(permission::FLAGS_ALL, ctx.accounts.market.crank_authority)];
        invoke_signed(
            &permission::create_permission_ix(
                ctx.accounts.open_orders.key(),
                ctx.accounts.open_orders_permission.key(),
                ctx.accounts.payer.key(),
                ctx.accounts.system_program.key(),
                &members,
            ),
            &[
                ctx.accounts.open_orders.to_account_info(),
                ctx.accounts.open_orders_permission.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[
                OPEN_ORDERS_SEED,
                market_key.as_ref(),
                owner.as_ref(),
                &[ctx.bumps.open_orders],
            ]],
        )?;
        Ok(())
    }

    /// Register the batch crank: schedule `run_batch` to fire every
    /// `tick_interval_ms` inside the ER (`TECHNICALDESIGN.md` section 5). Modeled on the
    /// verified `crank-counter` ScheduleTask CPI.
    pub fn schedule_batch(ctx: Context<ScheduleBatch>, args: ScheduleBatchArgs) -> Result<()> {
        // Audit C3: only the crank authority may register the crank, and only on
        // a delegated market. (Account substitution for the scheduled run_batch
        // is independently rejected by run_batch's market-binding, audit H3.)
        market_guard(
            &ctx.accounts.market,
            &ctx.accounts.authority.key(),
            MarketStatus::Delegated,
        )?;
        let run_batch_ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.market.key(), false),
                AccountMeta::new(ctx.accounts.batch_book.key(), false),
                AccountMeta::new(ctx.accounts.batch_result.key(), false),
                AccountMeta::new_readonly(ctx.accounts.oracle_price.key(), false),
            ],
            data: anchor_lang::InstructionData::data(&crate::instruction::RunBatch {}),
        };

        let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
            task_id: args.task_id,
            execution_interval_millis: args.execution_interval_millis,
            iterations: args.iterations,
            instructions: vec![run_batch_ix],
        }))
        .map_err(|e| {
            msg!("schedule_batch: serialize failed {:?}", e);
            ProgramError::InvalidArgument
        })?;

        let schedule_ix = Instruction::new_with_bytes(
            MAGIC_PROGRAM_ID,
            &ix_data,
            vec![
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new(ctx.accounts.market.key(), false),
                AccountMeta::new(ctx.accounts.batch_book.key(), false),
                AccountMeta::new(ctx.accounts.batch_result.key(), false),
            ],
        );

        invoke_signed(
            &schedule_ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.market.to_account_info(),
                ctx.accounts.batch_book.to_account_info(),
                ctx.accounts.batch_result.to_account_info(),
            ],
            &[],
        )?;
        Ok(())
    }

    /// F3: submit an order. Appends to the forming window and mirrors into the
    /// trader's `OpenOrders`.
    ///
    /// ESCROW (M1, `INTEGRATIONS.md` section 5): the max spend must be escrowed
    /// into the matching `Vault` via `ephemeral-rollups-spl` before the order
    /// is accepted. That CPI is wired against the vendored
    /// `ephemeral-rollups-spl` API in M1; this handler currently records the
    /// order and reserves the claimable accounting slot. It does NOT yet move
    /// tokens, and must not be treated as custody-safe until escrow lands.
    pub fn submit_order(
        ctx: Context<SubmitOrder>,
        side: u8,
        price_limit: u64,
        quantity: u64,
        flow: u8,
    ) -> Result<()> {
        require!(side == SIDE_BUY || side == SIDE_SELL, CrossbarError::OrderNotFound);
        require!(flow == FLOW_MAKER || flow == FLOW_TAKER, CrossbarError::OrderNotFound);
        require!(quantity > 0, CrossbarError::OrderNotFound);

        let market = &mut ctx.accounts.market;
        // Audit R2-Low (S-1): never inject orders into a market that is tearing
        // down. (OnBase is allowed for the L1-direct demo; Delegated for the ER.)
        require!(market.status != MarketStatus::Settling, CrossbarError::WrongStatus);
        let order_id = market.next_order_id;
        market.next_order_id = market.next_order_id.checked_add(1).ok_or(CrossbarError::Overflow)?;
        let window = market.current_window;

        let order = SlabOrder {
            order_id,
            owner: ctx.accounts.owner.key(),
            price_limit,
            quantity,
            remaining: quantity,
            window,
            side,
            flow,
            _pad: [0; 6],
        };

        {
            let mut book = ctx.accounts.batch_book.load_mut()?;
            require_keys_eq!(book.market, market.key(), CrossbarError::MarketMismatch);
            book.push(order).map_err(error_from)?;
        }

        // OpenOrders is created + initialized at `deposit` (and is delegated when
        // submitting inside the ER), so it always exists here.
        let oo = &mut ctx.accounts.open_orders;
        require_keys_eq!(oo.owner, ctx.accounts.owner.key(), CrossbarError::OrderNotFound);
        // Lock the max spend from the trader's deposited balance (escrow).
        // Requires a prior `deposit`; fails with InsufficientFunds otherwise.
        let (base_esc, quote_esc) = state::open_orders::order_escrow(side, price_limit, quantity);
        oo.reserve(base_esc, quote_esc).map_err(error_from)?;
        oo.add_order(order_id).map_err(error_from)?;

        msg!("submit_order id={} side={} px={} qty={} window={}", order_id, side, price_limit, quantity, window);
        Ok(())
    }

    /// F4: cancel, only while the order's window is still forming. Releases the
    /// reserved escrow back to claimable once escrow is wired (M1).
    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
        let market = &ctx.accounts.market;
        let mut book = ctx.accounts.batch_book.load_mut()?;
        let n = book.n_orders as usize;
        let mut found = None;
        for i in 0..n {
            if book.orders[i].order_id == order_id {
                // Only the forming window may be cancelled (`WindowClosed`).
                require!(book.orders[i].window == market.current_window, CrossbarError::WindowClosed);
                require_keys_eq!(book.orders[i].owner, ctx.accounts.owner.key(), CrossbarError::OrderNotFound);
                found = Some(i);
                break;
            }
        }
        let i = found.ok_or(CrossbarError::OrderNotFound)?;
        // Capture escrow before removing (cancel is pre-clear, so remaining ==
        // quantity), then release it back to claimable.
        let (esc_base, esc_quote) = state::open_orders::order_escrow(
            book.orders[i].side,
            book.orders[i].price_limit,
            book.orders[i].quantity,
        );
        // Compact the slab: swap-remove keeps it dense for the clearing pass.
        let last = n - 1;
        book.orders[i] = book.orders[last];
        book.orders[last] = SlabOrder::default();
        book.n_orders -= 1;
        drop(book);

        let oo = &mut ctx.accounts.open_orders;
        oo.unreserve(esc_base, esc_quote);
        oo.remove_order(order_id);
        msg!("cancel_order id={}", order_id);
        Ok(())
    }

    /// Escrow deposit (L1): fund the trader's claimable balance with real SPL
    /// tokens before delegation (`INTEGRATIONS.md` 5). `is_base` selects the
    /// base or quote vault/mint.
    pub fn deposit(ctx: Context<EscrowTransfer>, amount: u64, is_base: bool) -> Result<()> {
        escrow::deposit(ctx, amount, is_base)
    }

    /// Escrow withdraw (L1): return claimable balance to the trader. Settled
    /// fills become claimable in `settle`, then are withdrawn here.
    pub fn withdraw(ctx: Context<EscrowTransfer>, amount: u64, is_base: bool) -> Result<()> {
        escrow::withdraw(ctx, amount, is_base)
    }

    /// Push the latest Pyth Lazer reference price into `OraclePrice` (F8,
    /// `TECHNICALDESIGN.md` section 7). Called by the oracle keeper / Lazer receiver.
    /// `run_batch` reads this to bound `p*` and to detect a stale feed. Stamps
    /// the current slot for the staleness check.
    pub fn update_reference_price(ctx: Context<UpdateReferencePrice>, price: u64) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle_price;
        // Audit L3: never push 0 (would silently disable the band), and bound a
        // single update's deviation so even a compromised keeper cannot make a
        // discontinuous price jump in one write. A 50ms Lazer feed never moves
        // 50% between updates; a large legitimate move after a gap is pushed in
        // steps. This is defense-in-depth on top of the keeper-authority gate.
        require!(price > 0, CrossbarError::OracleDeviation);
        const MAX_REF_DEVIATION_BPS: u128 = 5_000; // 50%
        if oracle.price > 0 {
            let (prev, new) = (oracle.price as u128, price as u128);
            let diff = if new > prev { new - prev } else { prev - new };
            require!(
                diff.saturating_mul(10_000) <= MAX_REF_DEVIATION_BPS.saturating_mul(prev),
                CrossbarError::OracleDeviation
            );
        }
        oracle.price = price;
        oracle.last_update_slot = Clock::get()?.slot;
        Ok(())
    }

    /// F5/F6/F7: the heartbeat. Crank-only. Clears the current window at one
    /// uniform `p*` via the pure matcher, writes `BatchResult`, then opens the
    /// next window.
    ///
    /// Determinism (N1): reads no clock or slot; the matcher is a pure function
    /// of the order multiset and the selection rule. The oracle band and VRF
    /// tie-break (M3) plug in here: the band gates accept/reject of `p*`, and
    /// `ClearingRule::ReferenceClamped(p_ref)` replaces the default rule once
    /// the Lazer read lands. Until then the default `MidpointFloor` is used.
    ///
    /// CRANK AUTHORITY (`TECHNICALDESIGN.md` section 5): the only legitimate caller is
    /// the registered crank schedule. The signer model of the scheduled task is
    /// being reconciled against `/magicblock` cranks.md; the authority binding
    /// (`Market.crank_authority`) is enforced once that is confirmed. Today the
    /// guard is the lifecycle status check below.
    pub fn run_batch(ctx: Context<RunBatch>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Delegated, CrossbarError::WrongStatus);

        let window = market.current_window;
        let mut book = ctx.accounts.batch_book.load_mut()?;
        let mut result = ctx.accounts.batch_result.load_mut()?;
        // Audit H3: bind the clearing accounts to THIS market so a (type-valid)
        // book/result/oracle from another market cannot be substituted into the
        // clear. `run_batch` is crank-fired (no user signer), so binding — not a
        // signer gate — is the correct control here.
        let market_key = market.key();
        require_keys_eq!(book.market, market_key, CrossbarError::MarketMismatch);
        require_keys_eq!(result.market, market_key, CrossbarError::MarketMismatch);
        require_keys_eq!(
            ctx.accounts.oracle_price.market,
            market_key,
            CrossbarError::MarketMismatch
        );
        result.reset(market_key, window);

        // Randomized clearing-time gate (MATH.md 8.1, arXiv 2405.09764). Count
        // this crank tick; if the window has not reached its (VRF-randomized)
        // close target, keep accumulating orders and do NOT clear this tick.
        // This is window-FORMATION (it reads an instruction-counter, never a
        // clock/slot/arrival order), so the matcher stays pure on the realized
        // batch set and the order-fairness theorem (N1) is preserved.
        market.window_ticks_elapsed = market.window_ticks_elapsed.saturating_add(1);
        if crossbar_clearing::window::randomization_enabled(market.window_min_ticks, market.window_max_ticks)
            && !crossbar_clearing::window::should_close(market.window_ticks_elapsed, market.window_target_ticks)
        {
            result.status = state::result::BATCH_FORMING;
            drop(book);
            drop(result);
            msg!(
                "run_batch window={} FORMING (tick {}/{})",
                window, market.window_ticks_elapsed, market.window_target_ticks
            );
            return Ok(());
        }

        // Oracle band gate (F8, TECHNICALDESIGN.md section 7). The band is enabled only
        // once a non-zero reference price has been pushed and band_delta_bps>0,
        // so a market can run before the oracle is wired (e.g. the demo).
        let oracle = &ctx.accounts.oracle_price;
        let band_enabled = market.band_delta_bps > 0 && oracle.price > 0;

        // Step 1: skip the tick on a stale feed rather than clear on bad data.
        if band_enabled && market.oracle_max_age_slots > 0 {
            let age = Clock::get()?.slot.saturating_sub(oracle.last_update_slot);
            if age > market.oracle_max_age_slots as u64 {
                result.status = state::result::BATCH_SKIPPED_STALE_ORACLE;
                drop(book);
                drop(result);
                // Leave orders resting for the next tick (TECHNICALDESIGN.md 4.5 step 4);
                // do not advance the window.
                msg!("run_batch window={} SKIPPED stale oracle (age {})", window, age);
                return Ok(());
            }
        }

        // Production price rule: the canonical call-auction determination
        // (Nasdaq/Xetra: max volume -> min imbalance -> market pressure ->
        // reference price), with the Pyth Lazer mid as the reference when set
        // (MATH.md section 9). It yields the SAME matched volume and per-order
        // fills as the verified matcher (certified parity), only a fairer,
        // always-IR printed p*. The band below is still a separate accept/reject
        // gate (MATH.md section 7).
        let reference = if oracle.price > 0 { Some(oracle.price) } else { None };
        // CFMM backstop pool (MATH.md 8.3, arXiv 2210.04929): if funded, add the
        // constant-product pool's synthetic maker ladder so a thin book still
        // clears against passive liquidity. Band = spot +/- cfmm_band_bps.
        let pool = if market.cfmm_base > 0 && market.cfmm_quote > 0 {
            let p = crossbar_clearing::Cfmm {
                base: market.cfmm_base as u128,
                quote: market.cfmm_quote as u128,
            };
            let spot = p.spot();
            let half = ((spot as u128) * market.cfmm_band_bps as u128 / 10_000) as u64;
            let lo = spot.saturating_sub(half).max(1);
            let hi = spot.saturating_add(half).max(lo + 1);
            Some((p, lo, hi, market.cfmm_levels.max(1) as u32))
        } else {
            None
        };
        let live = book.live().to_vec();
        let (p_star, volume, pool_net) =
            clearing_bridge::clear_window_into(&live, reference, pool, &mut result);

        // Step 2: reject a cleared price outside the band.
        if band_enabled && volume > 0 {
            let b = crossbar_clearing::band::reference_band(oracle.price, market.band_delta_bps);
            if !b.contains(p_star) {
                result.reset(market.key(), window);
                result.status = state::result::BATCH_REJECTED_OUT_OF_BAND;
                drop(book);
                drop(result);
                // Leave orders for the next tick; do not advance the window.
                msg!("run_batch window={} REJECTED p*={} out of band", window, p_star);
                return Ok(());
            }
        }
        msg!("run_batch window={} p*={} volume={}", window, p_star, volume);

        // CFMM reserve update (MATH.md 8.3): move the pool's net fill at p*.
        // k never decreases (the pool trades at p*, at least as good as its
        // curve), so this is individually rational.
        if (market.cfmm_base > 0) && (pool_net.base_bought > 0 || pool_net.base_sold > 0) {
            let p = p_star as u128;
            let scale = crossbar_clearing::PRICE_SCALE as u128;
            let quote_in = pool_net.base_sold.saturating_mul(p) / scale;
            let quote_out = pool_net.base_bought.saturating_mul(p) / scale;
            market.cfmm_base =
                (market.cfmm_base as u128 + pool_net.base_bought - pool_net.base_sold) as u64;
            market.cfmm_quote =
                (market.cfmm_quote as u128 + quote_in - quote_out) as u64;
            msg!("cfmm reserves -> base={} quote={}", market.cfmm_base, market.cfmm_quote);
        }

        // M4: credit OpenOrders claimable balances from the fills before
        // settlement. That needs each filled owner's OpenOrders in
        // remaining_accounts; wired with settle().

        // Open the next forming window. Cleared orders are removed; partials
        // remaining-quantity carry-forward policy is decided in M2 hardening.
        for i in 0..book.n_orders as usize {
            book.orders[i] = SlabOrder::default();
        }
        book.n_orders = 0;
        book.window = window + 1;
        drop(book);
        drop(result);
        market.current_window = window + 1;
        // Open the next window: reset the tick counter and the close target to
        // the deterministic fallback (max). A subsequent `consume_window_vrf`
        // re-randomizes the target into the band before this window closes.
        market.window_ticks_elapsed = 0;
        market.window_target_ticks = market.window_max_ticks.max(1);
        Ok(())
    }

    /// F6 (randomized clearing time, `MATH.md` section 8.1): request VRF to set
    /// the forming window's close target unpredictably within
    /// `[window_min_ticks, window_max_ticks]`. Like the marginal tie-break, the
    /// blast radius is bounded: if VRF does not return, the deterministic
    /// fallback (`window_max_ticks`) closes the window. Reuses `ephemeral-vrf`.
    pub fn request_window_vrf(ctx: Context<RequestWindowVrf>, client_seed: u8) -> Result<()> {
        // Audit R2-Low: only the crank authority schedules randomness, so an
        // outsider cannot race/re-roll the window-close target with a chosen seed.
        require_keys_eq!(
            ctx.accounts.market.crank_authority,
            ctx.accounts.payer.key(),
            CrossbarError::NotCrankAuthority
        );
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::ConsumeWindowVrf::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.market.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// VRF callback: set the forming window's close target to a value drawn
    /// uniformly from `[window_min_ticks, window_max_ticks]`. Only the window
    /// boundary moves; the matcher and `p*` are untouched (N1 preserved).
    pub fn consume_window_vrf(
        ctx: Context<ConsumeWindowVrf>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let r = u64::from_le_bytes(randomness[..8].try_into().unwrap());
        market.window_target_ticks =
            crossbar_clearing::window::next_target(r, market.window_min_ticks, market.window_max_ticks);
        msg!("VRF set window close target = {} ticks", market.window_target_ticks);
        Ok(())
    }

    /// F9: checkpoint canonical state to L1 every `commit_every_ticks`. Stamps
    /// the commit slot so `force_undelegate` can measure the stall timeout.
    pub fn commit(ctx: Context<CommitAccounts>) -> Result<()> {
        // Audit H1: only the crank authority advances the commit checkpoint, so
        // an attacker cannot spam `commit` to defer the force-undelegate hatch.
        require_keys_eq!(
            ctx.accounts.market.crank_authority,
            ctx.accounts.authority.key(),
            CrossbarError::NotCrankAuthority
        );
        require!(
            ctx.accounts.market.status == MarketStatus::Delegated,
            CrossbarError::WrongStatus
        );
        ctx.accounts.market.last_commit_slot = Clock::get()?.slot;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[
            ctx.accounts.batch_book.to_account_info(),
            ctx.accounts.batch_result.to_account_info(),
        ])
        .build_and_invoke()?;
        Ok(())
    }

    /// F10: commit and undelegate, returning canonical state to L1. Sets status
    /// `Settling`. Per-trader token reconciliation happens in `settle`.
    pub fn undelegate_market(ctx: Context<CommitAccounts>) -> Result<()> {
        // Audit C2: only the crank authority may tear down a live auction.
        require_keys_eq!(
            ctx.accounts.market.crank_authority,
            ctx.accounts.authority.key(),
            CrossbarError::NotCrankAuthority
        );
        require!(
            ctx.accounts.market.status == MarketStatus::Delegated,
            CrossbarError::WrongStatus
        );
        ctx.accounts.market.status = MarketStatus::Settling;
        // Force-serialize the mutated Market before the magic CPI reads it
        // (mirrors the verified anchor-counter `increment_and_undelegate`).
        ctx.accounts.market.exit(&crate::ID)?;
        // Undelegate the full delegated set so all of it is readable on base
        // again for settlement (C6).
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[
            ctx.accounts.market.to_account_info(),
            ctx.accounts.batch_book.to_account_info(),
            ctx.accounts.batch_result.to_account_info(),
            ctx.accounts.oracle_price.to_account_info(),
        ])
        .build_and_invoke()?;
        Ok(())
    }

    /// Commit + undelegate one trader's OpenOrders back to base so `settle` can
    /// read it on L1 (ER -> base).
    pub fn undelegate_open_orders(ctx: Context<CommitOpenOrders>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.open_orders.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// F10 settlement (L1): reconcile ONE trader's ledger against the committed
    /// `BatchResult`. Applies their fills at `p*` (buys gain base and spend
    /// quote, sells give base and gain quote) and refunds the unspent escrow,
    /// moving everything from `reserved` back to `claimable`. The trader then
    /// pulls real tokens out with `withdraw`. Integer-only (`REQUIREMENTS.md`
    /// C5); callable once per trader after `undelegate_market`.
    pub fn settle(ctx: Context<SettleTrader>) -> Result<()> {
        settle_inner(&ctx.accounts.batch_result, &mut ctx.accounts.open_orders)
    }

    /// Flip the market back to `OnBase` once trader settlement is done
    /// (crank-authority gated).
    pub fn finalize_settlement(ctx: Context<Settle>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.crank_authority,
            ctx.accounts.authority.key(),
            CrossbarError::NotCrankAuthority
        );
        ctx.accounts.market.status = MarketStatus::OnBase;
        Ok(())
    }

    /// F6 (VRF tie-break, `MATH.md` section 4, `PLAN.md` T3.4): request
    /// randomness from `ephemeral-vrf` to assign the indivisible marginal
    /// remainder. VRF touches ONLY this remainder (a few base units), never
    /// `p*` and never a non-marginal fill: its blast radius is deliberately
    /// tiny because the library is unaudited. If VRF does not return in time,
    /// the deterministic fallback already written by `run_batch` (lowest order
    /// id) stands. No-op when there is no marginal remainder.
    pub fn request_marginal_vrf(ctx: Context<RequestMarginalVrf>, client_seed: u8) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.market.crank_authority,
            ctx.accounts.payer.key(),
            CrossbarError::NotCrankAuthority
        );
        {
            let result = ctx.accounts.batch_result.load()?;
            require_keys_eq!(result.market, ctx.accounts.market.key(), CrossbarError::MarketMismatch);
            if result.marginal_remainder == 0 || result.n_marginal_tied == 0 {
                return Ok(()); // nothing to randomize; fallback stands
            }
        }
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::ConsumeMarginalVrf::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.batch_result.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// VRF callback: assign the marginal remainder to a tied order chosen by the
    /// verifiable randomness. Only `vrf_winner` (the remainder recipient) moves;
    /// `p*`, matched volume, and all non-marginal fills are untouched.
    pub fn consume_marginal_vrf(
        ctx: Context<ConsumeMarginalVrf>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let mut result = ctx.accounts.batch_result.load_mut()?;
        let n = result.n_marginal_tied as usize;
        if n > 0 {
            let idx = ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 0, (n - 1) as u8);
            result.vrf_winner = result.marginal_tied[idx as usize % n];
            msg!("VRF assigned marginal remainder to order {}", result.vrf_winner);
        }
        Ok(())
    }

    /// F11: L1 escape hatch. After the stall timeout from the last commit
    /// (`REQUIREMENTS.md` F-timeout), anyone may force the undelegation so
    /// escrow is never stuck. The timeout is measured against `last_commit_slot`
    /// on the base layer (gating, not matching, so N1 is unaffected). Before the
    /// first commit, or when the timeout is disabled, the hatch is always open
    /// (funds are still safe in L1 escrow).
    pub fn force_undelegate(ctx: Context<CommitAccounts>) -> Result<()> {
        // Permissionless escape hatch (does NOT check crank_authority), but the
        // stall must be real. Audit M3: baseline = the later of the last commit
        // and the delegation slot, so a freshly-delegated (never-committed)
        // market cannot be force-undelegated instantly.
        let market = &ctx.accounts.market;
        require!(
            market.status == MarketStatus::Delegated,
            CrossbarError::WrongStatus
        );
        if market.force_undelegate_timeout_slots > 0 {
            let baseline = market.last_commit_slot.max(market.delegated_at_slot);
            let age = Clock::get()?.slot.saturating_sub(baseline);
            require!(
                age >= market.force_undelegate_timeout_slots as u64,
                CrossbarError::WrongStatus
            );
        }
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[
            ctx.accounts.market.to_account_info(),
            ctx.accounts.batch_book.to_account_info(),
            ctx.accounts.batch_result.to_account_info(),
            ctx.accounts.oracle_price.to_account_info(),
        ])
        .build_and_invoke()?;
        Ok(())
    }
}

/// Map the matcher/state crate's plain error into an Anchor error.
fn error_from(e: CrossbarError) -> Error {
    e.into()
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitMarket<'info> {
    #[account(
        init,
        payer = payer,
        space = Market::SPACE,
        seeds = [MARKET_SEED, base_mint.key().as_ref(), quote_mint.key().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = payer,
        space = BatchBook::SPACE,
        seeds = [BOOK_SEED, market.key().as_ref()],
        bump
    )]
    pub batch_book: AccountLoader<'info, BatchBook>,
    #[account(
        init,
        payer = payer,
        space = BatchResult::SPACE,
        seeds = [RESULT_SEED, market.key().as_ref()],
        bump
    )]
    pub batch_result: AccountLoader<'info, BatchResult>,
    pub base_mint: Account<'info, Mint>,
    pub quote_mint: Account<'info, Mint>,
    /// Base custody vault, a PDA token account owned by the `Market` PDA.
    #[account(
        init,
        payer = payer,
        seeds = [BASE_VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = market
    )]
    pub base_vault: Account<'info, TokenAccount>,
    /// Quote custody vault.
    #[account(
        init,
        payer = payer,
        seeds = [QUOTE_VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = market
    )]
    pub quote_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        space = state::oracle::OraclePrice::SPACE,
        seeds = [ORACLE_SEED, market.key().as_ref()],
        bump
    )]
    pub oracle_price: Account<'info, state::oracle::OraclePrice>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateMarket<'info> {
    pub payer: Signer<'info>,
    /// Crank authority — must equal `market.crank_authority` (audit H2).
    pub authority: Signer<'info>,
    /// CHECK: base mint, used only for the Market PDA seed derivation.
    pub base_mint: UncheckedAccount<'info>,
    /// CHECK: quote mint, used only for the Market PDA seed derivation.
    pub quote_mint: UncheckedAccount<'info>,
    /// CHECK: Market PDA (delegated).
    #[account(mut, del)]
    pub market: UncheckedAccount<'info>,
    /// CHECK: BatchBook PDA (delegated).
    #[account(mut, del)]
    pub book: UncheckedAccount<'info>,
    /// CHECK: BatchResult PDA (delegated).
    #[account(mut, del)]
    pub result: UncheckedAccount<'info>,
    /// CHECK: OraclePrice PDA (delegated).
    #[account(mut, del)]
    pub oracle: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateOpenOrders<'info> {
    pub payer: Signer<'info>,
    /// Crank authority — must equal `market.crank_authority` (audit H2).
    pub authority: Signer<'info>,
    /// CHECK: Market PDA, used for the OpenOrders seed derivation.
    pub market: UncheckedAccount<'info>,
    /// CHECK: the trader's OpenOrders PDA (delegated).
    #[account(mut, del)]
    pub open_orders: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MakePrivate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market: Account<'info, Market>,
    /// CHECK: BatchBook PDA; read-only signer for the permission CPI (seeds+bump).
    #[account(seeds = [BOOK_SEED, market.key().as_ref()], bump)]
    pub book: UncheckedAccount<'info>,
    /// CHECK: BatchResult PDA; read-only signer for the permission CPI (seeds+bump).
    #[account(seeds = [RESULT_SEED, market.key().as_ref()], bump)]
    pub result: UncheckedAccount<'info>,
    /// CHECK: permission PDA (`["permission:", book]`), created by the permission program.
    #[account(mut)]
    pub book_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA (`["permission:", result]`), created by the permission program.
    #[account(mut)]
    pub result_permission: UncheckedAccount<'info>,
    /// CHECK: the MagicBlock permission program (address-checked in the handler).
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct MakeOpenOrdersPrivate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market: Account<'info, Market>,
    /// CHECK: OpenOrders PDA; read-only signer for the permission CPI (seeds+bump).
    #[account(seeds = [OPEN_ORDERS_SEED, market.key().as_ref(), owner.as_ref()], bump)]
    pub open_orders: UncheckedAccount<'info>,
    /// CHECK: permission PDA (`["permission:", open_orders]`), created by the permission program.
    #[account(mut)]
    pub open_orders_permission: UncheckedAccount<'info>,
    /// CHECK: the MagicBlock permission program (address-checked in the handler).
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateStatus<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// Checked against `market.crank_authority` in the handler.
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ScheduleBatch<'info> {
    /// CHECK: the Magic program; address-checked (audit C3).
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Crank authority — must equal `market.crank_authority` (audit C3).
    pub authority: Signer<'info>,
    /// CHECK: passed to CPI; UncheckedAccount avoids stale re-serialization.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    /// CHECK: passed to CPI.
    #[account(mut)]
    pub batch_book: UncheckedAccount<'info>,
    /// CHECK: passed to CPI.
    #[account(mut)]
    pub batch_result: UncheckedAccount<'info>,
    /// CHECK: passed to CPI (read-only reference price).
    pub oracle_price: UncheckedAccount<'info>,
    /// CHECK: this program id, used for CPI.
    pub program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SubmitOrder<'info> {
    #[account(mut, seeds = [MARKET_SEED, market.base_mint.as_ref(), market.quote_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [BOOK_SEED, market.key().as_ref()], bump)]
    pub batch_book: AccountLoader<'info, BatchBook>,
    // OpenOrders already exists (created at `deposit`) and is delegated when
    // submitting inside the ER. No init here, and `owner` stays read-only, so
    // the transaction has NO writable non-delegated account (an ER requirement).
    #[account(
        mut,
        seeds = [OPEN_ORDERS_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump = open_orders.bump
    )]
    pub open_orders: Account<'info, OpenOrders>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(seeds = [MARKET_SEED, market.base_mint.as_ref(), market.quote_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [BOOK_SEED, market.key().as_ref()], bump)]
    pub batch_book: AccountLoader<'info, BatchBook>,
    #[account(
        mut,
        seeds = [OPEN_ORDERS_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump = open_orders.bump
    )]
    pub open_orders: Account<'info, OpenOrders>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RunBatch<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub batch_book: AccountLoader<'info, BatchBook>,
    #[account(mut)]
    pub batch_result: AccountLoader<'info, BatchResult>,
    /// Reference price for the band gate. Read-only here; part of the delegated
    /// set so the read is local to the ER.
    pub oracle_price: Account<'info, state::oracle::OraclePrice>,
}

#[derive(Accounts)]
pub struct UpdateReferencePrice<'info> {
    #[account(
        mut,
        seeds = [ORACLE_SEED, oracle_price.market.as_ref()],
        bump = oracle_price.bump,
        has_one = authority
    )]
    pub oracle_price: Account<'info, state::oracle::OraclePrice>,
    pub authority: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Crank authority. `commit`/`undelegate_market` require this to equal
    /// `market.crank_authority` (audit C2/H1); `force_undelegate` ignores it
    /// (permissionless escape hatch) but still needs a signer present.
    pub authority: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub batch_book: AccountLoader<'info, BatchBook>,
    #[account(mut)]
    pub batch_result: AccountLoader<'info, BatchResult>,
    #[account(mut)]
    pub oracle_price: Account<'info, state::oracle::OraclePrice>,
}

/// Commit/undelegate context for one trader's OpenOrders (ER -> base).
#[commit]
#[derive(Accounts)]
pub struct CommitOpenOrders<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub open_orders: Account<'info, OpenOrders>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// Checked against `market.crank_authority` in the handler.
    pub authority: Signer<'info>,
}

/// Per-trader settlement (L1). Reconciles the trader's `OpenOrders` against the
/// committed `BatchResult` at `p*`.
#[derive(Accounts)]
pub struct SettleTrader<'info> {
    #[account(seeds = [MARKET_SEED, market.base_mint.as_ref(), market.quote_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(constraint = batch_result.load()?.market == market.key() @ CrossbarError::MarketMismatch)]
    pub batch_result: AccountLoader<'info, BatchResult>,
    #[account(
        mut,
        seeds = [OPEN_ORDERS_SEED, market.key().as_ref(), open_orders.owner.as_ref()],
        bump = open_orders.bump
    )]
    pub open_orders: Account<'info, OpenOrders>,
}

/// Request randomness for the marginal tie-break. `#[vrf]` injects the VRF
/// program accounts and the `invoke_signed_vrf` helper.
#[vrf]
#[derive(Accounts)]
pub struct RequestMarginalVrf<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Market for the crank-authority gate + result binding (audit R2-Low).
    #[account(seeds = [MARKET_SEED, market.base_mint.as_ref(), market.quote_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub batch_result: AccountLoader<'info, BatchResult>,
    /// CHECK: the VRF oracle queue.
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ConsumeMarginalVrf<'info> {
    /// Enforces the callback is invoked by the VRF program via CPI.
    // VRF callback auth: the PINNED ephemeral-vrf-sdk 0.3.1 fulfills with the
    // GLOBAL program identity (it has no scoped-identity mode — verified in the
    // resolved crate's consts.rs), so the global `VRF_PROGRAM_IDENTITY` is the
    // correct signer to require here. (A newer SDK adds a per-program scoped
    // identity + `#[vrf_callback]`; if this dep is ever bumped, switch BOTH the
    // request mode and this check to the scoped identity together.)
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub batch_result: AccountLoader<'info, BatchResult>,
}

/// Request randomness for the window close target (randomized clearing time).
#[vrf]
#[derive(Accounts)]
pub struct RequestWindowVrf<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: the VRF oracle queue.
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ConsumeWindowVrf<'info> {
    /// Enforces the callback is invoked by the VRF program via CPI.
    // VRF callback auth: the PINNED ephemeral-vrf-sdk 0.3.1 fulfills with the
    // GLOBAL program identity (it has no scoped-identity mode — verified in the
    // resolved crate's consts.rs), so the global `VRF_PROGRAM_IDENTITY` is the
    // correct signer to require here. (A newer SDK adds a per-program scoped
    // identity + `#[vrf_callback]`; if this dep is ever bumped, switch BOTH the
    // request mode and this check to the scoped identity together.)
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

/// Escrow deposit/withdraw context (L1). The `vault` is validated against
/// `market.base_vault`/`quote_vault` in the handler so one context serves both
/// base and quote moves.
#[derive(Accounts)]
pub struct EscrowTransfer<'info> {
    #[account(seeds = [MARKET_SEED, market.base_mint.as_ref(), market.quote_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_token_account.owner == owner.key() @ CrossbarError::MarketMismatch,
        // Audit R2-Low (D-1): make the source/dest mint binding explicit (the SPL
        // transfer also enforces it, but state it so the invariant is self-evident).
        constraint = user_token_account.mint == vault.mint @ CrossbarError::MarketMismatch
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        space = OpenOrders::SPACE,
        seeds = [OPEN_ORDERS_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub open_orders: Account<'info, OpenOrders>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
