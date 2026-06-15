# Project CrossBar UI Kit

Design system for the `web/` SPA. Light theme, workstation-dense trading UI with a cinematic marketing hero.

## Logo

| Asset | Path | Use |
| --- | --- | --- |
| Mark (512px) | `public/crossbar-logo-mark.png` | Nav, favicon, app icon |
| Social preview (1200×630) | `public/meta.png` | Open Graph / Twitter link cards |
| Wordmark | Instrument Serif "CrossBar®" in nav | Primary brand lockup |

The mark is a geometric crossbar switch: perpendicular bars with a single purple accent stroke (#7A3FB5), black on white, flat vector.

## Typography

| Role | Font | CSS |
| --- | --- | --- |
| Display / logo / headlines | Instrument Serif | `font-display` |
| Body / tables / nav | Inter | `font-sans` (default) |
| Monospace numbers | Inter tabular | `font-mono` on stats |

Loaded via Google Fonts in `src/index.css`.

## Color tokens

| Token | Hex | Use |
| --- | --- | --- |
| `--background` | `#FFFFFF` | Page background |
| `--foreground` | `#000000` | Headlines, primary buttons |
| `--muted-foreground` | `#6F6F6F` | Descriptions, inactive nav |
| `--primary` | `#000000` | CTA buttons |
| `--primary-foreground` | `#FFFFFF` | Button text |
| `--accent` | `#7A3FB5` | ER / delegation badges only |
| `--success` | `#2EA043` | Cleared batch, parity |
| `--destructive` | `#DC2626` | RejectedOutOfBand, stale oracle |

Purple accent is reserved for Ephemeral Rollup state. Do not use it for generic decoration.

## Surfaces

| Class / pattern | Definition |
| --- | --- |
| `glass-card` | `bg-white/70 backdrop-blur-md border border-black/5` |
| Dashboard cards | shadcn `Card` with default border |
| Hero gradient | `bg-gradient-to-b from-background via-transparent to-background` over video |

## Motion

| Class | Effect |
| --- | --- |
| `animate-fade-rise` | Hero headline entrance (0.8s) |
| `animate-fade-rise-delay` | Description (+0.2s) |
| `animate-fade-rise-delay-2` | CTA (+0.4s) |
| Hero video | Manual fade loop via `HeroVideo.tsx` (rAF opacity) |
| Button hover | `hover:scale-[1.03]` on primary CTAs |

## shadcn components

Installed under `src/components/ui/`:

`button`, `card`, `badge`, `input`, `label`, `select`, `table`, `tabs`, `dialog`, `alert`, `progress`, `separator`, `tooltip`, `scroll-area`, `sonner`, `sheet`, `sidebar`, `navigation-menu`, `breadcrumb`, `switch`, `form`

Charts use **Recharts** directly in dashboard panels (not shadcn chart wrapper).

## Status badges

| State | Color |
| --- | --- |
| `OnBase` | default / muted |
| `Delegated` | accent purple |
| `Settling` | amber outline |
| Batch `Cleared` | success green |
| Batch `RejectedOutOfBand` | destructive red |
| Flash MOCK | amber alert banner |
| Flash LIVE read | blue info banner |

## Copy rules

- No em dashes in user-facing text.
- Label substrate honestly: **Devnet live**, **Mainnet read-only**, **offline samples**.
- L1 settlement uses the two-step keeper path (live on devnet). Do not claim Magic Actions atomic settle-on-undelegate.

## Favicon

Add to `index.html`:

```html
<link rel="icon" href="/crossbar-logo-mark.png" />
```
