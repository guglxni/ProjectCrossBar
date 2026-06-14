# Integrations

Design notes for composing Project CrossBar with adjacent Solana / MagicBlock
protocols. Documents here are **integration plans grounded in verified sources**
(vendored reference repos and public protocol docs) — not all are fully shipped.

| Doc | What it covers | Status |
| --- | --- | --- |
| [FLASH_TRADE.md](FLASH_TRADE.md) | Composing CrossBar (spot batch auction) with Flash Trade V2 (perps) on the **same MagicBlock rollup** — shared substrate, shared Pyth Lazer reference, spot/perp hedging. | **Tiers 0–2 implemented** (`clients/flash/`, `tests/hedge-demo.ts`); Tier 3 roadmap |
| [PRIVATE_PAYMENTS.md](PRIVATE_PAYMENTS.md) | Upgrading CrossBar's Ephemeral Rollup to a **Private** ER (PER): TEE-confidential order sizes + confidential escrow via the permission program CrossBar already depends on. | **Base permissions implemented** (`make_private`, `tests/private-demo.ts`); TEE/ephemeral step roadmap |

## The common thread

CrossBar runs *inside* a MagicBlock Ephemeral Rollup and settles to Solana L1.
Both integrations exploit that:

- **Flash Trade V2 also runs on a MagicBlock ER** → co-locatable spot clearing +
  perp hedging with shared execution latency and oracle.
- **Private Payments / PER is the same ER + a permission layer** → shield resting
  order sizes and escrow amounts inside a TEE on top of batching that removes
  time-priority MEV.

Neither requires forking another protocol; both compose at the layer CrossBar
already operates in.

## Settlement lifecycle

Clearing happens inside the ER; token reconciliation happens on L1 after
undelegation (`undelegate_open_orders` → `settle` per trader). See
[`settlement.png`](../diagrams/settlement.png). The full path is automated in
[`tests/crank-demo.ts`](../../tests/crank-demo.ts).

## Supporting code in this repo

- [`clients/flash/`](../../clients/flash/) — typed Flash Trade REST client and demos
- [`programs/crossbar/src/permission.rs`](../../programs/crossbar/src/permission.rs) — PER permission CPIs
