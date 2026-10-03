"""Pixel-art icon for Agent of Empires: an Imperial-age stone fortress at dusk, 32x32 master
upscaled with nearest-neighbour.

A crenellated central keep flies the Claude-orange flag and carries the team banner over its
gate; two round towers with orange witch-hat roofs and lit windows flank it, joined by
recessed curtain walls, under a navy-to-purple starry sky. The silhouette is three spires so
it still reads as "castle" at 32px in the dock, on light and dark panels alike.

Writes the Tauri icons (window + tray) and the hicolor launcher sizes:
    python3 scripts/gen-icon.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TAURI_ICONS = ROOT / "src-tauri" / "icons"
LAUNCHER_ICONS = ROOT / "icons"
SIZE = 32

PALETTE = {
    ".": None,
    "o": (27, 29, 43),  # outline
    "N": (17, 20, 46),  # sky, deep navy
    "n": (29, 30, 72),  # sky, navy
    "v": (50, 37, 96),  # sky, indigo
    "V": (78, 45, 114),  # sky, purple
    "m": (110, 56, 124),  # sky, dusk violet at the horizon
    "*": (232, 228, 255),  # star
    "L": (228, 224, 222),  # stone highlight
    "w": (196, 190, 194),  # stone
    "W": (146, 139, 152),  # stone shade
    "k": (98, 92, 114),  # stone deep shade
    "r": (217, 119, 87),  # roof, flag, banner: claude orange
    "R": (168, 80, 58),  # orange shade
    "l": (242, 166, 132),  # orange light
    "f": (247, 205, 96),  # gold: finials, banner emblem
    "y": (255, 214, 102),  # lit window
    "d": (40, 24, 22),  # gate
    "p": (110, 70, 44),  # gate timber, banner rod
    "g": (44, 84, 58),  # grass
    "G": (64, 114, 70),  # grass light
    "D": (28, 50, 40),  # shadow on the grass
    "P": (124, 100, 92),  # path
}

# fmt: off
ART = [
    "..oooooooooooooooooooooooooooo..",
    ".oNNNNNNNNNNNNNfNNNNNNNNNNNNNNo.",
    "oNNN*NNNNNNNNNNWlrrrNNNNNN*NNNNo",
    "oNNNNNNNNN*NNNNWlrrrrNNNNNNNNNNo",
    "oNNNNfNNNNNNNNNWRRRNNNNNNNfNNNNo",
    "oNNNNoNNNNNoooNooNoooNNNNNoNNNNo",
    "oNNNoroNNNNoLwowwowWoNNNNoroNNNo",
    "oNnNoroNnNnoLwwwwwwWoNnNnoronNno",
    "onnolrRonnnokkkkkkkkonnnolrRo*no",
    "onnolrRonnnoLppppppWonnnolrRonno",
    "onolrrRRonnoLwlrrRwWonnolrrRRono",
    "onolrrrRonnoLwlrrRwWonnolrrrRono",
    "ollrrrrRRonoLwlffRwWovolrrrrRRRo",
    "oooooooooovoLwlffRwWovoooooooooo",
    "ovokkkkkovvoLwlrrRwWovvokkkkkovo",
    "ovoLwwWkovvoLwlrrRwWovvoLwwWkovo",
    "ovoLwoWkovvoLwlwwRwWovvoLwoWkovo",
    "ovoLoyokooooLwwwwwwWooooLoyokoVo",
    "oVoLoyokoWkoLwoooowWoWkoLoyokoVo",
    "oVoLoookoWWoLoddddoWoWWoLoookoVo",
    "oVoLwwWkoWWoLodppdoWoWWoLwwWkoVo",
    "oVoLwwWkoWWoLopddpoWoWWoLwwWkoVo",
    "omoLwwWkoWWoLopddpoWoWWoLwwWkoVo",
    "omoLwwWkoWWoLopddpoWoWWoLwwWkomo",
    "omoLwwWkoWWoLopddpoWoWWoLwwWkomo",
    "omoLwwWkoWWoLopddpoWoWWoLwwWkomo",
    "ogDDDDDDDDDDDPPPPPPDDDDDDDDDDDgo",
    "oggggggggggggPPPPPPggggggggggggo",
    "ogGggggGggggGPPPPPPgggGggggGgggo",
    "ogggGggggGgggPPPPPPGggggGggggGgo",
    ".oggggggggggPPPPPPPPggggggggggo.",
    "..oooooooooooooooooooooooooooo..",
]
# fmt: on


def render() -> Image.Image:
    assert len(ART) == SIZE and all(len(row) == SIZE for row in ART), "art must be 32x32"
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pixels = image.load()
    for y, row in enumerate(ART):
        for x, key in enumerate(row):
            color = PALETTE[key]
            if color:
                pixels[x, y] = (*color, 255)
    return image


def main() -> None:
    master = render()
    TAURI_ICONS.mkdir(parents=True, exist_ok=True)
    master.save(TAURI_ICONS / "32x32.png")
    master.resize((128, 128), Image.NEAREST).save(TAURI_ICONS / "128x128.png")
    master.resize((512, 512), Image.NEAREST).save(TAURI_ICONS / "icon.png")
    for size in (32, 64, 128, 256, 512):
        target = LAUNCHER_ICONS / f"{size}x{size}" / "agent-of-empires.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        master.resize((size, size), Image.NEAREST).save(target)
    print(f"icons written to {TAURI_ICONS} and {LAUNCHER_ICONS}")


if __name__ == "__main__":
    main()
