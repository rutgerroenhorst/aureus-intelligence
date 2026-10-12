"""AURIGA app icons: a black tile, the A in warm white, the coin in blu corsa. Writes what the web app serves from apps/web/public/icons:
icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png and auriga.svg (the browser-tab icon).

Run: python3 brand/auriga/make_icons.py     (macOS qlmanage renders the PNGs; the SVG stands on its own)

The mark is the same geometry as apps/web/components/AurigaLogo.tsx and make_auriga.py. Every icon is a full-bleed tile with no transparency:
the phone and the launcher round the corners themselves. The maskable icon keeps the mark inside the middle 80% (the safe zone) as the platforms require.
"""
import pathlib, struct, subprocess, tempfile, zlib

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


def edge_pixels(path):
    """RGB of the four corners and the four edge midpoints of an 8-bit PNG. macOS QuickLook draws a small SVG smaller than the canvas and leaves the rest white
    (the first version of the 192 and 180 px icons came out that way), so every icon is checked: the whole edge must be the tile colour."""
    data = pathlib.Path(path).read_bytes()
    pos, idat, ihdr = 8, b"", None
    while pos < len(data):
        n, = struct.unpack(">I", data[pos:pos + 4]); kind = data[pos + 4:pos + 8]
        if kind == b"IHDR": ihdr = struct.unpack(">IIBBBBB", data[pos + 8:pos + 8 + n])
        elif kind == b"IDAT": idat += data[pos + 8:pos + 8 + n]
        pos += 12 + n
    w, h, depth, ctype, _, _, interlace = ihdr
    assert depth == 8 and ctype in (2, 6) and interlace == 0, "unexpected PNG kind"
    ch = 4 if ctype == 6 else 3
    raw, stride, prev, rows = zlib.decompress(idat), w * ch, bytearray(w * ch), []
    for y in range(h):
        kind_f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if kind_f == 1: line[x] = (line[x] + a) & 255
            elif kind_f == 2: line[x] = (line[x] + b) & 255
            elif kind_f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif kind_f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa >= pb and pa >= pc else (b if pb >= pc else c))) & 255
        rows.append(line); prev = line
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    return [tuple(rows[y][x * ch:x * ch + 3]) for x, y in pts]


TILE = tuple(int(BG[i:i + 2], 16) for i in (1, 3, 5))


def is_tile(px):
    """the tile colour, give or take the resampler: white or transparent is the failure this check exists for"""
    return max(abs(a - b) for a, b in zip(px, TILE)) <= 12
SIZES = [("icon-192.png", 192), ("icon-512.png", 512), ("icon-maskable-512.png", 512), ("apple-touch-icon.png", 180)]

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "auriga.svg").write_text(svg(512, rx=115))
with tempfile.TemporaryDirectory() as tmp:
    # render once, large (QuickLook is only reliable at large sizes), then let sips scale it down to every size
    src = pathlib.Path(tmp) / "mark.svg"
    src.write_text(svg(1024))
    subprocess.run(["qlmanage", "-t", "-s", "1024", "-o", tmp, str(src)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    master = pathlib.Path(tmp) / "mark.svg.png"
    assert all(is_tile(px) for px in edge_pixels(master)), f"the 1024 px render does not fill the canvas: {edge_pixels(master)}"
    for name, size in SIZES:
        subprocess.run(["sips", "-z", str(size), str(size), str(master), "--out", str(OUT / name)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        bad = [px for px in edge_pixels(OUT / name) if not is_tile(px)]
        assert not bad, f"{name}: edge pixels are not the tile colour: {bad[:3]}"
        print(name, size, "px", (OUT / name).stat().st_size, "bytes, edge checked")
