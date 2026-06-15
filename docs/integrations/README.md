# Integrations

Design notes for composing Project CrossBar with adjacent Solana / MagicBlock
protocols. Documents here are **integration plans grounded in verified sources**
(vendored reference repos and public protocol docs) — not all are fully shipped.

## Flash Trade first

The headline integration is **[Flash Trade V2](FLASH_TRADE.md)**: CrossBar clears
**spot** at one uniform p* inside a MagicBlock Ephemeral Rollup; Flash runs
**perpetual futures** on the same substrate (~30–50 ms ER confirms, Pyth Lazer
oracle). Clear on CrossBar, hedge delta on Flash in one session.

MagicBlock hackathons include a **Flash Boost**: projects that integrate
[Flash Trade](https://flash.trade/) can receive a **50% bonus** on eligible prize
payouts ([hackathon.magicblock.app](https://hackathon.magicblock.app/)). CrossBar
ships Tiers 0–2 (REST client, dashboard live marks, `tests/hedge-demo.ts`) for that
stack.

| Doc | What it covers | Status |
| --- | --- | --- |
| [FLASH_TRADE.md](FLASH_TRADE.md) | Spot batch auction + Flash perps on the **same MagicBlock rollup** — shared substrate, Pyth Lazer, spot/perp hedging, dashboard live market | **Tiers 0–2 implemented** (`clients/flash/`, `tests/hedge-demo.ts`); Tier 3 roadmap |
| [PRIVATE_PAYMENTS.md](PRIVATE_PAYMENTS.md) | Upgrading CrossBar's Ephemeral Rollup to a **Private** ER (PER): TEE-confidential order sizes + confidential escrow via the permission program CrossBar already depends on. | **Base permissions implemented** (`make_private`, `tests/private-demo.ts`); TEE/ephemeral step roadmap |

## The common thread

CrossBar runs *inside* a MagicBlock Ephemeral Rollup and settles to Solana L1.
Both integrations exploit that:

- **Flash Trade V2 also runs on a MagicBlock ER** → co-locatable spot clearing +
  perp hedging with shared execution latency and oracle. This is the primary
  hackathon-facing composition.
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
- [`web/src/lib/flash-prices.ts`](../../web/src/lib/flash-prices.ts) — dashboard marquee (Flash GET /prices)
- [`programs/crossbar/src/permission.rs`](../../programs/crossbar/src/permission.rs) — PER permission CPIs

In-app: [projectcrossbar.vercel.app/docs#flash-trade](https://projectcrossbar.vercel.app/docs#flash-trade)
