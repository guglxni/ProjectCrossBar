# Diagrams

Curated [draw.io](https://www.drawio.com/) sources for the figures embedded in the root `README.md`. The `.drawio` files are the editable source of truth; the `.png` files are 2× rasters generated from them for crisp GitHub rendering.

| Source | Rendered | Shows |
| --- | --- | --- |
| `architecture.drawio` | `architecture.png` | Two-plane model: Solana L1 custody/settlement ↔ MagicBlock ER execution |
| `lifecycle.drawio` | `lifecycle.png` | End-to-end market lifecycle (L1 → ER → L1), verified on devnet |
| `clearing.drawio` | `clearing.png` | `run_batch` internals: window gate → curves → uniform `p*` → fills |
| `flash-integration.drawio` | `flash-integration.png` | Flash Trade composition: CrossBar spot + Flash perp on one MagicBlock ER (see [`../integrations/FLASH_TRADE.md`](../integrations/FLASH_TRADE.md)) |
| `per-privacy.drawio` | `per-privacy.png` | Private Ephemeral Rollup: public vs TEE-private clearing state (see [`../integrations/PRIVATE_PAYMENTS.md`](../integrations/PRIVATE_PAYMENTS.md)) |
| `flash-features.drawio` | `flash-features.png` | Comprehensive Flash integration: surfaces → integration layer → build-on-Flash features (see [`../integrations/FLASH_TRADE_FEATURES.md`](../integrations/FLASH_TRADE_FEATURES.md)) |

## Re-render

PNGs are generated from the `.drawio` sources with the draw.io desktop CLI at 2× scale:

```bash
for d in architecture lifecycle clearing flash-integration per-privacy flash-features; do
  drawio -x -f png -s 2 --no-sandbox -o "$d.png" "$d.drawio"
done
```

Edit the `.drawio` files in the draw.io desktop app (or [app.diagrams.net](https://app.diagrams.net)) and re-run the command above to refresh the PNGs.

> PNG is used rather than SVG because draw.io's headless export rasterizes HTML (`html=1`) text labels into embedded bitmaps inside the SVG anyway — a direct 2× PNG is smaller and renders identically.
