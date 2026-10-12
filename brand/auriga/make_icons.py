"""AURIGA app icons: a black tile, the A in warm white, the coin in blu corsa. Writes what the web app serves from apps/web/public/icons:
icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png and auriga.svg (the browser-tab icon).

Run: python3 brand/auriga/make_icons.py     (macOS qlmanage renders the PNGs; the SVG stands on its own)

The mark is the same geometry as apps/web/components/AurigaLogo.tsx and make_auriga.py. Every icon is a full-bleed tile with no transparency:
the phone and the launcher round the corners themselves. The maskable icon keeps the mark inside the middle 80% (the safe zone) as the platforms require.
"""
import pathlib, subprocess, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "apps/web/public/icons"
BG, FG, ACC = "#0b0b0c", "#f3f0e8", "#2f5bff"
LEAN = 0.18
PTS = [(-90, 80), (0, -86), (90, 80), (58, 80), (0, -30), (-58, 80)]
SCALE = 1.5          # mark units -> px on the 512 canvas: the mark is 54% of the tile wide, 187 px from the centre at its corners (the safe zone is 205)


def mark(cx, cy, s):
    d = "M" + " L".join(f"{x + LEAN * (80 - y):.1f} {y}" for x, y in PTS) + "Z"
    coin = (2.5 + LEAN * (80 - 47), 47)
    # the mark's own centre is 3 units above its origin: shift so the shape, not the origin, sits in the middle
    return (f'<g transform="translate({cx} {cy + 3 * s}) scale({s})"><path d="{d}" fill="{FG}" stroke="{FG}" stroke-width="3" stroke-linejoin="round"/>'
            f'<circle cx="{coin[0]:.1f}" cy="{coin[1]}" r="23" fill="{ACC}"/></g>')


def svg(size, rx=0):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}">'
            f'<rect width="512" height="512" rx="{rx}" fill="{BG}"/>{mark(256, 256, SCALE)}</svg>')


OUT.mkdir(parents=True, exist_ok=True)
(OUT / "auriga.svg").write_text(svg(512, rx=115))
with tempfile.TemporaryDirectory() as tmp:
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("icon-maskable-512.png", 512), ("apple-touch-icon.png", 180)]:
        src = pathlib.Path(tmp) / (name + ".svg")
        src.write_text(svg(size))
        subprocess.run(["qlmanage", "-t", "-s", str(size), "-o", tmp, str(src)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        (pathlib.Path(tmp) / (name + ".svg.png")).replace(OUT / name)
        print(name, size, "px", (OUT / name).stat().st_size, "bytes")
