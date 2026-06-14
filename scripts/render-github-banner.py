#!/usr/bin/env python3
"""Render GitHub social preview / README banner (1280×640)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
LOGO_PATH = ROOT / "logo.png"
OUT_PATH = ROOT / "docs" / "github-banner.png"

W, H = 1280, 640
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
PURPLE = (122, 63, 181)
GRAY = (111, 111, 111)
LIGHT = (245, 245, 245)
GRID = (235, 235, 235)


def load_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_crossbar_grid(draw: ImageDraw.ImageDraw) -> None:
    step = 64
    for x in range(0, W, step):
        draw.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(0, H, step):
        draw.line([(0, y), (W, y)], fill=GRID, width=1)

    # Accent cross at far right (faded brand motif)
    cx, cy = W - 180, H // 2
    arm = 120
    stroke = 14
    fade = (248, 244, 252)
    draw.rectangle(
        [cx - stroke // 2, cy - arm, cx + stroke // 2, cy + arm],
        fill=fade,
    )
    draw.rectangle(
        [cx - arm, cy - stroke // 2, cx + arm, cy - stroke // 2 + stroke],
        fill=BLACK,
    )
    draw.rectangle(
        [cx - arm, cy - stroke // 2, cx - arm + stroke, cy + stroke // 2],
        fill=BLACK,
    )
    draw.rectangle(
        [cx + arm - stroke, cy - stroke // 2, cx + arm, cy + stroke // 2],
        fill=PURPLE,
    )


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    img = Image.new("RGB", (W, H), WHITE)
    draw = ImageDraw.Draw(img)
    draw_crossbar_grid(draw)

    # Left panel wash
    draw.rectangle([0, 0, 520, H], fill=LIGHT)

    logo = Image.open(LOGO_PATH).convert("RGBA")
    logo_size = 300
    logo = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    logo_x = 110
    logo_y = (H - logo_size) // 2
    img.paste(logo, (logo_x, logo_y), logo)

    # Purple rule between logo and copy
    draw.rectangle([500, 120, 506, H - 120], fill=PURPLE)

    serif = load_font(
        [
            "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
            "/Library/Fonts/Georgia.ttf",
        ],
        72,
    )
    serif_sm = load_font(
        [
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
            "/Library/Fonts/Georgia.ttf",
        ],
        36,
    )
    sans = load_font(
        [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ],
        22,
    )
    sans_bold = load_font(
        [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ],
        18,
    )

    text_x = 540
    draw.text((text_x, 175), "Project CrossBar", font=serif, fill=BLACK)
    draw.text(
        (text_x, 265),
        "Beyond the slot, one price for every window",
        font=serif_sm,
        fill=GRAY,
    )
    draw.text(
        (text_x, 340),
        "Frequent batch auction DEX on Solana",
        font=sans,
        fill=BLACK,
    )
    draw.text(
        (text_x, 378),
        "Uniform-price clearing inside a MagicBlock Ephemeral Rollup",
        font=sans,
        fill=GRAY,
    )

    # Pill badges
    pills = [
        ("Devnet live", PURPLE),
        ("4006/4006 parity", (46, 160, 67)),
        ("Gasless via Kora", BLACK),
    ]
    px = text_x
    py = 450
    for label, color in pills:
        bbox = draw.textbbox((0, 0), label, font=sans_bold)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pad_x, pad_y = 14, 8
        draw.rounded_rectangle(
            [px, py, px + tw + pad_x * 2, py + th + pad_y * 2],
            radius=6,
            fill=color,
        )
        draw.text((px + pad_x, py + pad_y - 1), label, font=sans_bold, fill=WHITE)
        px += tw + pad_x * 2 + 16

    draw.text(
        (text_x, H - 72),
        "projectcrossbar.vercel.app",
        font=sans_bold,
        fill=PURPLE,
    )

    img.save(OUT_PATH, "PNG", optimize=True)
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
