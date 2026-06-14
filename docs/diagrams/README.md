# Diagrams

Curated [draw.io](https://www.drawio.com/) sources for figures embedded across the repository. The `.drawio` files are the editable source of truth; `.png` files are 2× rasters for crisp GitHub rendering.

## Architecture & lifecycle

| Source | Rendered | Used in | Shows |
| --- | --- | --- | --- |
| `architecture.drawio` | `architecture.png` | `README.md` | Two-plane model: Solana L1 ↔ MagicBlock ER |
| `lifecycle.drawio` | `lifecycle.png` | `README.md` | End-to-end market lifecycle (L1 → ER → L1) |
| `account-model.drawio` | `account-model.png` | `TECHNICALDESIGN.md` | PDA layout and instruction planes |
| `settlement.drawio` | `settlement.png` | `MATH.md`, `TECHNICALDESIGN.md`, integrations | ER clear → undelegate → L1 settle keeper |

## Clearing & math

| Source | Rendered | Used in | Shows |
| --- | --- | --- | --- |
| `clearing.drawio` | `clearing.png` | `README.md`, `MATH.md` | `run_batch` pipeline (N1, oracle band, parity) |
| `math-curves.drawio` | `math-curves.png` | `MATH.md` | Demand/supply step curves and uniform $p^*$ |
| `dual-flow.drawio` | `dual-flow.png` | `MATH.md` | DFBA: maker/taker flows → single $p^*$ |
| `oracle-parity.drawio` | `oracle-parity.png` | `MATH.md`, `tests/parity/README.md` | Engine vs Coq-extracted UM (4006/4006) |

## Integrations

| Source | Rendered | Used in | Shows |
| --- | --- | --- | --- |
| `flash-integration.drawio` | `flash-integration.png` | `docs/integrations/FLASH_TRADE.md` | CrossBar spot + Flash perp on one ER |
| `per-privacy.drawio` | `per-privacy.png` | `docs/integrations/PRIVATE_PAYMENTS.md` | Public vs TEE-private clearing state |
| `flash-features.drawio` | `flash-features.png` | `clients/flash/README.md` | Flash client surfaces and composition |

## Re-render all PNGs

Requires the draw.io desktop CLI (`brew install --cask drawio`):

```bash
./scripts/render-diagrams.sh
```

Or manually from this directory:

```bash
for d in *.drawio; do
  base="${d%.drawio}"
  drawio -x -f png -s 2 --no-sandbox -o "${base}.png" "$d"
done
```

Edit `.drawio` files in the draw.io desktop app or [app.diagrams.net](https://app.diagrams.net), then re-run the script.

> PNG is used rather than SVG because draw.io's headless export rasterizes HTML (`html=1`) text labels into embedded bitmaps inside SVG — a direct 2× PNG is smaller and renders identically on GitHub.
