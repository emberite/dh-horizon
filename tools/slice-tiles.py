#!/usr/bin/env python3
"""
Dev tool (not loaded by the module): cuts the Fantasy Hex Tiles sprite sheet by The Clover Patch
(https://cuddlyclover.itch.io/fantasy-hex-tiles, CC BY 4.0) into one PNG per tile, scaled up 4x
with nearest-neighbour so the pixel art stays crisp, plus a gray "shadowblighted" version of every
terrain tile and a sepia "uncharted" tile for the player-facing map.

    python3 -I tools/slice-tiles.py ~/Downloads/fantasyhextiles_v3.png assets/tiles

Each tile is 32x48: the hex face is 32x28 (top edge at y=18), with 2px of ground below it and the
space above for tall features (trees, peaks, towers).
"""
import sys
from pathlib import Path
from PIL import Image, ImageEnhance, ImageOps

SCALE = 4
W, H = 32, 48

# key: (column, row) on the v3 sheet
TILES = {
    'grass': (0, 0), 'grass-trees': (1, 0), 'forest': (2, 0), 'hills': (3, 0),
    'pine-hills': (4, 0), 'mountain': (5, 0), 'shallows': (6, 0), 'ocean': (7, 0),
    'town': (0, 1), 'town-walled': (1, 1), 'castle': (2, 1), 'fields': (3, 1),
    'swamp-forest': (4, 1), 'marsh': (5, 1), 'steppe': (6, 1), 'thicket': (7, 1),
    'snow': (0, 2), 'snow-pines': (1, 2), 'snow-forest': (2, 2), 'snow-hills': (3, 2),
    'snow-mountain': (4, 2), 'ice': (5, 2), 'snow-town': (6, 2), 'snow-castle': (7, 2),
    'desert': (0, 3), 'canyon': (1, 3), 'dunes': (2, 3), 'mesa': (3, 3),
    'oasis': (4, 3), 'crystal': (5, 3), 'desert-town': (6, 3), 'temple': (7, 3),
    'jungle': (0, 4), 'port-left': (4, 4), 'port-right': (5, 4), 'lighthouse': (6, 4),
    'ruin': (7, 4), 'cemetery': (0, 5),
}
CAVES = {'cave': (1, 4), 'snow-cave': (2, 4), 'desert-cave': (3, 4)}
# Underground hexes: a cave mouth over a matching ground tile.
COMPOSITES = {'cave-hills': ('hills', 'cave'), 'cave-snow': ('snow-hills', 'snow-cave'), 'cave-desert': ('canyon', 'desert-cave')}
SETTLEMENTS = {'town', 'town-walled', 'castle', 'snow-town', 'snow-castle', 'desert-town', 'temple', 'port-left', 'port-right', 'lighthouse'}


def cut(sheet, col, row):
    return sheet.crop((col * W, row * H, (col + 1) * W, (row + 1) * H))


def big(tile):
    return tile.resize((W * SCALE, H * SCALE), Image.NEAREST)


def blight(tile):
    """Drained of color: grayscale, a little darker, alpha kept."""
    alpha = tile.getchannel('A')
    gray = ImageOps.grayscale(tile.convert('RGB'))
    gray = ImageEnhance.Contrast(gray).enhance(0.85)
    gray = ImageEnhance.Brightness(gray).enhance(0.8).convert('RGBA')
    gray.putalpha(alpha)
    return gray


def sepia(tile):
    alpha = tile.getchannel('A')
    gray = ImageOps.grayscale(tile.convert('RGB'))
    toned = ImageOps.colorize(gray, black='#6b5338', white='#efe2c2', mid='#c9b38a').convert('RGBA')
    toned.putalpha(alpha)
    return toned


def main(src, out):
    sheet = Image.open(src).convert('RGBA')
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    tiles = {k: cut(sheet, *pos) for k, pos in TILES.items()}
    caves = {k: cut(sheet, *pos) for k, pos in CAVES.items()}
    for key, (base, over) in COMPOSITES.items():
        t = tiles[base].copy()
        t.alpha_composite(caves[over])
        tiles[key] = t
    for key, tile in tiles.items():
        big(tile).save(out / f'{key}.png', optimize=True)
        if key not in SETTLEMENTS:
            big(blight(tile)).save(out / f'{key}-blight.png', optimize=True)
    big(sepia(tiles['steppe'])).save(out / 'uncharted.png', optimize=True)
    print(f'{len(list(out.glob("*.png")))} tiles in {out}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
