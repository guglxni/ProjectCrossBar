//! Project CrossBar clearing engine: the pure uniform-price frequent-batch-auction matcher.
//!
//! This crate is the determinism and MEV core of Project CrossBar (`MATH.md`
//! sections 2, 4, 5; `SKILL.md` invariants 1-4). It has zero dependencies and
//! no Solana types so the exact same functions are:
//!   * unit-tested off-chain and lined up against the verified oracle
//!     (`vendor/dsam`, `MATH.md` section 6), and
//!   * called unchanged from `run_batch` inside the Ephemeral Rollup.
//!
//! The five invariants this code is responsible for upholding:
//!   1. Single price per batch. Every matched order trades at one `p*`.
//!   2. Determinism. Output is a pure function of the order multiset and the
//!      selection rule. We sort by price (and `order_id` to break ties), never
//!      by arrival time, and never read a clock or slot.
//!   3. VRF only at the margin. This crate exposes the marginal remainder as
//!      data; it never consumes randomness itself. The caller assigns the
//!      remainder (VRF in the ER, deterministic fallback here in tests).
//!   4. Integer fixed-point only. No `f32`/`f64` anywhere. Pro-rata uses
//!      `u128` intermediate multiply then integer divide.
//!
//! See `MATH.md` for the formalization and `SKILL.md` "Core pattern: clearing
//! one batch" for the step list this mirrors.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod band;
pub mod cfmm;
pub mod curves;
pub mod clear;
pub mod prorata;
pub mod window;

pub use cfmm::Cfmm;

use alloc::vec::Vec;

/// Fixed-point scale for prices: quote units per base unit at 6 decimals of
/// price precision (`TECHNICALDESIGN.md` section 2, `AGENTS.md`). The oracle fixtures
/// must use the same scale or the parity test throws false mismatches.
pub const PRICE_SCALE: u64 = 1_000_000;

/// A price in quote units per base unit, fixed-point at [`PRICE_SCALE`].
pub type Price = u64;
/// A quantity in base-mint atomic units.
pub type Qty = u64;
/// Stable per-order identifier. Used as the deterministic tie-break key.
pub type OrderId = u64;

/// Order side. Encoded as `u8` on-chain for zero-copy (`REQUIREMENTS.md` C4);
/// this off-chain mirror keeps it a real enum for clarity.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Side {
    Buy,
    Sell,
}

/// Dual-flow tag (`MATH.md` section 3). Carried through clearing so M3 can
/// aggregate maker and taker interest independently while still crossing the
/// whole batch at a single `p*`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Flow {
    Maker,
    Taker,
}

/// One order in a batch. `(side, price_limit, quantity, order_id)` per
/// `MATH.md` section 0, plus the dual-flow tag.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Order {
    pub order_id: OrderId,
    pub side: Side,
    pub flow: Flow,
    /// Worst price the order accepts: a max for a buy, a min for a sell.
    pub price_limit: Price,
    /// Total size in base atomic units.
    pub quantity: Qty,
}

impl Order {
    pub fn buy(order_id: OrderId, price_limit: Price, quantity: Qty) -> Self {
        Order { order_id, side: Side::Buy, flow: Flow::Taker, price_limit, quantity }
    }
    pub fn sell(order_id: OrderId, price_limit: Price, quantity: Qty) -> Self {
        Order { order_id, side: Side::Sell, flow: Flow::Taker, price_limit, quantity }
    }
    pub fn with_flow(mut self, flow: Flow) -> Self {
        self.flow = flow;
        self
    }
}

/// Per-order fill: how much of `order_id` traded this batch. Every filled
/// order trades at the batch `p*` (invariant 1), so the price is not repeated
/// per fill.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Fill {
    pub order_id: OrderId,
    pub filled: Qty,
}

/// The rule for picking the single trade price inside the clearing interval
/// `[ps_marg, pb_marg]` (the marginal seller price .. marginal buyer price).
///
/// PARITY (verified against the oracle source, `MATH.md` section 5): when the
/// marginal buyer and seller prices differ (a spread at the crossing), any
/// price in the closed interval is fair, uniform, and individually rational,
/// but the *exact* value must match `vendor/dsam`'s rule or the differential
/// test (T2.7) flags a false mismatch.
///
/// Reading `vendor/dsam/mUM.v:131`, the verified uniform price is
/// `uniform_price B A := bp (bid_of (last (UM_aux B A 0 0) m0))`, i.e. the bid
/// price of the LAST matched fill in the greedy uniform matching. With bids
/// sorted by decreasing price, that last fill is the lowest-priced matched bid,
/// which is exactly the marginal buyer price `pb` (the upper bound of `[ps,
/// pb]`). So the parity-correct default is [`ClearingRule::UpperBound`].
/// (To be re-confirmed by executing the extracted OCaml `UM` once OCaml/Coq
/// are available; the rule is centralized here so reconciliation is one line.)
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClearingRule {
    /// Lowest IR price in the interval (favours buyers).
    LowerBound,
    /// Highest IR price in the interval (favours sellers).
    UpperBound,
    /// `(ps_marg + pb_marg) / 2`, integer floor. Neutral default.
    MidpointFloor,
    /// Clamp a reference price (e.g. Pyth Lazer mid) into the interval. The
    /// oracle band in `run_batch` is a separate accept/reject gate; this rule
    /// is only about price *selection* when a reference is available.
    ReferenceClamped(Price),
    /// Canonical call-auction price determination (the Nasdaq opening/closing
    /// cross and Deutsche Boerse Xetra rule; see `clear::auction_clearing_price`
    /// and `MATH.md` section 9). Among the volume-maximizing prices in
    /// `[ps, pb]`: minimize the order imbalance, then break ties by market
    /// pressure, then by closeness to the reference price (the Pyth Lazer mid,
    /// `Some(p_ref)` when available). Always individually rational (the result
    /// stays inside `[ps, pb]`), and it does not change matched volume or
    /// per-order fills, so the verified-matcher parity still holds.
    Auction(Option<Price>),
}

impl Default for ClearingRule {
    fn default() -> Self {
        // Matches vendor/dsam's `uniform_price` (mUM.v:131): the marginal
        // buyer's bid price. See the ClearingRule docs above.
        ClearingRule::UpperBound
    }
}

/// Why a batch did not clear, or that it did.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ClearOutcome {
    /// The book crossed. `clearing_price` is `p*`; `matched_volume` is the
    /// base volume traded on each side; `fills` lists every order that traded
    /// a positive quantity. `marginal_remainder` is the indivisible base-unit
    /// remainder left by integer pro-rata at each side's marginal price,
    /// already assigned deterministically (lowest `order_id` first) but
    /// reported so the caller can re-assign it by VRF if desired (invariant 3).
    Cleared {
        clearing_price: Price,
        matched_volume: Qty,
        fills: Vec<Fill>,
        marginal: MarginalReport,
    },
    /// No price crosses the book this tick. Not an error (`TECHNICALDESIGN.md` `err.rs`,
    /// `EmptyCross`): `run_batch` writes an empty `Cleared` `BatchResult`.
    Empty,
}

/// Diagnostic record of the marginal level on each side, where the only
/// legitimate per-order ambiguity lives (`MATH.md` section 6.1). The parity
/// test asserts on `p*` and total matched volume here, not on the exact
/// remainder assignment.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct MarginalReport {
    /// Marginal buyer limit price (lowest buy price that trades).
    pub buy_marginal_price: Price,
    /// Marginal seller limit price (highest sell price that trades).
    pub sell_marginal_price: Price,
    /// Order ids tied at the buy margin that shared a pro-rata remainder.
    pub buy_tied: Vec<OrderId>,
    /// Order ids tied at the sell margin that shared a pro-rata remainder.
    pub sell_tied: Vec<OrderId>,
    /// Indivisible base units left over after flooring, per side. Bounded to a
    /// few units; this is the VRF/fallback blast radius.
    pub buy_remainder: Qty,
    pub sell_remainder: Qty,
}

/// Clear one batch at a single uniform price.
///
/// This is the top-level entry point used by both the off-chain tests and
/// `run_batch`. It is a pure function of `orders` and `rule`: shuffling
/// `orders` must not change the output (determinism, `REQUIREMENTS.md` N1).
///
/// `remainder_order` decides the deterministic order in which the indivisible
/// marginal remainder is handed out. Pass [`prorata::lowest_order_id_first`]
/// for the canonical fallback (`MATH.md` section 4); the ER passes a
/// VRF-derived permutation. Either way the remainder is bounded to a few base
/// units, so the choice never affects `p*` or any non-marginal fill.
pub fn clear_batch(orders: &[Order], rule: ClearingRule) -> ClearOutcome {
    clear::clear_batch_with(orders, rule, prorata::lowest_order_id_first)
}

/// Dual-flow clearing (`MATH.md` section 3): identical `p*` and matched volume
/// to [`clear_batch`], but at the marginal price maker flow fills before taker
/// flow (maker protection). Reduces to [`clear_batch`] for a single-flow book.
pub fn clear_batch_dual_flow(orders: &[Order], rule: ClearingRule) -> ClearOutcome {
    clear::clear_batch_dual_flow_with(orders, rule, prorata::lowest_order_id_first)
}

/// Production clearing using the canonical call-auction price rule
/// ([`ClearingRule::Auction`]) with an optional reference price (the Pyth Lazer
/// mid). Matched volume and per-order fills are identical to [`clear_batch`];
/// only the printed `p*` differs (and is always individually rational).
pub fn clear_batch_auction(orders: &[Order], reference: Option<Price>) -> ClearOutcome {
    clear::clear_batch_with(orders, ClearingRule::Auction(reference), prorata::lowest_order_id_first)
}

/// CFMM-augmented clear (`MATH.md` section 8.3, arXiv 2210.04929). Discretizes a
/// constant-product `pool` into synthetic maker orders across the band
/// `[lo, hi]` (`n_levels` per side) and clears them together with the book at a
/// single uniform `p*` using the auction rule. The matcher is unchanged, so the
/// pool's filled orders carry the same single-price + IR guarantees; with an
/// empty pool this is exactly [`clear_batch_auction`] (parity preserved). The
/// caller reads the pool's net fill from the fills whose id is a
/// [`Cfmm::is_cfmm_order`] and updates the reserves.
pub fn clear_batch_with_cfmm(
    orders: &[Order],
    reference: Option<Price>,
    pool: Cfmm,
    lo: Price,
    hi: Price,
    n_levels: u32,
) -> ClearOutcome {
    let mut combined: alloc::vec::Vec<Order> = orders.to_vec();
    combined.extend(pool.ladder(lo, hi, n_levels));
    clear::clear_batch_with(&combined, ClearingRule::Auction(reference), prorata::lowest_order_id_first)
}
