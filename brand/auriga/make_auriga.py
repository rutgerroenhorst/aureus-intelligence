"""AURIGA: the mark (an A without its crossbar, a coin where the bar would be), three packagings and four colour trios, three colours each (black or green, warm white, one accent).
Run: python3 brand/auriga/make_auriga.py   (macOS qlmanage renders the PNGs; the SVGs stand on their own, the wordmark is live text in Futura Bold)"""
import pathlib, subprocess
from html import escape

OUT = pathlib.Path(__file__).parent
W = H = 1600
FONT = "Futura, Avenir Next, Helvetica Neue, Arial, sans-serif"

# a palette = background, the white, the accent: three colours and nothing else (greys are the white at lower opacity)
PALETTES = {
    "giallo": dict(name="Nero · Bianco · Giallo oro", bg="#0b0b0c", fg="#f3f0e8", acc="#f2b600", ink="#0b0b0c", note="geel-goud: ligt dicht bij 'midden' (amber) en lijkt op Binance"),
    "blu": dict(name="Nero · Bianco · Blu corsa", bg="#0b0b0c", fg="#f3f0e8", acc="#2f5bff", ink="#f3f0e8", note="racingblauw (Adidas, Bugatti): botst met niets; veel crypto-apps zijn wel blauw"),
    "argento": dict(name="Nero · Bianco · Argento", bg="#0b0b0c", fg="#f3f0e8", acc="#aeb4bd", ink="#0b0b0c", note="zwart, wit en zilver (Mercedes): botst met niets, maar minder fel"),
    "navy": dict(name="Blu notte · Bianco · Oro", bg="#0b1f4a", fg="#f3f0e8", acc="#d9b24a", ink="#0b1f4a", note="marineblauw met goud: prestige; goud ligt wel dicht bij 'midden'"),
}

def T(x, y, s, size, fill, weight=700, ls=0, anchor="start", opacity=1.0, font=FONT):
    return f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" letter-spacing="{ls}" fill="{fill}" text-anchor="{anchor}" opacity="{opacity}">{escape(s)}</text>'

def rect(x, y, w, h, r, fill, stroke=None, sw=1.5, op=1.0):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{st} opacity="{op}"/>'

def mark(cx, cy, s, leg, coin, bg, k=0.18):
    """the leaning A: the lean is applied to the points, so the coin stays a true circle; a ring in the background colour keeps the coin clear of the legs"""
    pts = [(-90, 80), (0, -86), (90, 80), (58, 80), (0, -30), (-58, 80)]
    P = [(x + k * (80 - y), y) for x, y in pts]
    d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in P) + "Z"
    c = (2.5 + k * (80 - 47), 47)
    return (f'<g transform="translate({cx} {cy}) scale({s})"><path d="{d}" fill="{leg}" stroke="{leg}" stroke-width="3" stroke-linejoin="round"/>'
            f'<circle cx="{c[0]:.1f}" cy="{c[1]}" r="23" fill="{coin}"/></g>')

def shield(cx, cy, s, p):
    d = "M-100 -112 H100 V22 C100 84 52 120 0 144 C-52 120 -100 84 -100 22 Z"
    return (f'<g transform="translate({cx} {cy}) scale({s})"><path d="{d}" fill="{p["bg"]}" stroke="{p["acc"]}" stroke-width="9" stroke-linejoin="round"/>'
            f'<path d="M-84 -96 H84 V20 C84 74 44 106 0 126 C-44 106 -84 74 -84 20 Z" fill="none" stroke="{p["fg"]}" stroke-width="2" opacity=".35"/></g>') + mark(cx, cy + 6 * s, 0.50 * s, p["fg"], p["acc"], p["bg"])

def roundel(cx, cy, s, p):
    return (f'<g transform="translate({cx} {cy}) scale({s})"><circle r="130" fill="{p["bg"]}" stroke="{p["fg"]}" stroke-width="12"/><circle r="112" fill="none" stroke="{p["acc"]}" stroke-width="3"/></g>') + mark(cx, cy + 4 * s, 0.58 * s, p["fg"], p["acc"], p["bg"])

def icon(x, y, size, p):
    return rect(x, y, size, size, size * 0.225, p["bg"], p["fg"], 1.2, 1) .replace('stroke="' + p["fg"] + '"', 'stroke="' + p["fg"] + '" stroke-opacity=".18"') + mark(x + size / 2, y + size / 2 + size * 0.0, size / 300.0 * 1.05, p["fg"], p["acc"], p["bg"])

def lockup(x, y, size, p, descriptor=True):
    # x,y = left edge and vertical centre of the mark; the wordmark is Futura Bold, wide
    o = mark(x + size * 0.55, y, size / 215.0, p["fg"], p["acc"], p["bg"])
    o += T(x + size * 1.22, y + size * 0.19, "AURIGA", size * 0.50, p["fg"], 700, size * 0.07)
    if descriptor:
        o += T(x + size * 1.25, y + size * 0.48, "EARLY-COIN INTELLIGENCE", size * 0.088, p["fg"], 500, size * 0.03, opacity=0.55)
    return o

def sheet_logo():
    p = PALETTES["giallo"]
    light = dict(bg="#f3f0e8", fg="#0b0b0c", acc="#f2b600")
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="{p["bg"]}"/>']
    o.append(T(80, 84, "AURIGA", 22, p["fg"], 600, 8, opacity=0.5)); o.append(T(W - 80, 84, "the charioteer: power under control", 22, p["fg"], 400, 0.5, "end", 0.5))
    o.append(lockup(100, 330, 300, p))
    # packagings
    for i, (label, fn) in enumerate([("los symbool", None), ("schild", shield), ("rondel", roundel)]):
        x = 80 + i * 500
        o.append(rect(x, 640, 460, 470, 28, p["bg"], p["fg"], 1.5).replace('stroke="' + p["fg"] + '"', 'stroke="' + p["fg"] + '" stroke-opacity=".2"'))
        cx = x + 230
        if fn is None:
            o.append(mark(cx, 870, 1.55, p["fg"], p["acc"], p["bg"]))
        elif fn is shield:
            o.append(shield(cx, 824, 1.3, p)); o.append(T(cx, 1070, "AURIGA", 40, p["fg"], 700, 7, "middle"))
        else:
            o.append(roundel(cx, 868, 1.35, p))
        o.append(T(x + 30, 1095, label, 22, p["fg"], 500, 1.5, opacity=0.55))
    # app icons and the light version
    for k, (sz, dx) in enumerate([(210, 0), (140, 250), (96, 420), (64, 540), (40, 640), (28, 720)]):
        o.append(icon(80 + dx, 1180 + (210 - sz) // 2, sz, p))
    o.append(T(80, 1432, "app icon at 210 / 140 / 96 / 64 / 40 / 28 px", 20, p["fg"], 400, 0.5, opacity=0.5))
    o.append(rect(900, 1150, 620, 300, 28, light["bg"]))
    o.append(lockup(935, 1290, 138, dict(bg=light["bg"], fg=light["fg"], acc=light["acc"]), descriptor=False))
    o.append(T(930, 1430, "on light: the same mark, black legs", 20, light["fg"], 400, 0.5, opacity=0.6))
    o.append("</svg>")
    return "\n".join(o)

def tile(key, x, y, w, h):
    p = PALETTES[key]
    o = [rect(x, y, w, h, 34, p["bg"], p["fg"], 1.5).replace('stroke="' + p["fg"] + '"', 'stroke="' + p["fg"] + '" stroke-opacity=".22"')]
    o.append(T(x + 40, y + 62, p["name"].upper(), 19, p["fg"], 600, 4, opacity=0.6))
    o.append(lockup(x + 40, y + 190, 150, p, descriptor=False))
    for i, (col, nm) in enumerate([(p["bg"], "sfondo"), (p["fg"], "bianco"), (p["acc"], "accento")]):
        cx = x + 40 + i * 170
        o.append(rect(cx, y + 300, 140, 70, 18, col, p["fg"], 1.2).replace('stroke="' + p["fg"] + '"', 'stroke="' + p["fg"] + '" stroke-opacity=".3"'))
        o.append(T(cx + 70, y + 392, nm, 15, p["fg"], 500, 1, "middle", 0.6)); o.append(T(cx + 70, y + 411, col, 14, p["fg"], 400, 0.5, "middle", 0.45))
    o.append(rect(x + 40, y + 440, 190, 60, 30, p["acc"])); o.append(T(x + 135, y + 478, "Enter", 24, p["ink"], 700, 1, "middle"))
    o.append(rect(x + 250, y + 440, 170, 60, 30, "none", p["acc"], 2)); o.append(T(x + 335, y + 478, "Check", 24, p["acc"], 700, 1, "middle"))
    o.append(T(x + 450, y + 468, "+23%", 34, "#34c759", 700, 0, "start")); o.append(T(x + 560, y + 468, "−41%", 34, "#ff453a", 700, 0, "start"))
    o.append(T(x + 40, y + 548, "ZO BOTST HET MET DE SITE", 14, p["fg"], 600, 3, opacity=0.5))
    for i, (col, nm) in enumerate([("#34c759", "winst"), ("#ff9f0a", "midden"), ("#ff453a", "verlies"), (p["acc"], "merk")]):
        cx = x + 60 + i * 150
        o.append(f'<circle cx="{cx}" cy="{y + 590}" r="20" fill="{col}"/>'); o.append(T(cx + 32, y + 596, nm, 17, p["fg"], 500, 0.5, "start", 0.7))
    o.append(T(x + 40, y + h - 26, p["note"], 16, p["fg"], 400, 0.3, "start", 0.55))
    return "".join(o)

def sheet_colors():
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="#161616"/>']
    o.append(T(80, 84, "KLEUREN: DRIE PER PALET", 22, "#f3f0e8", 600, 6, opacity=0.6)); o.append(T(W - 80, 84, "geen rood, oranje of groen: die zijn winst, midden en verlies", 22, "#f3f0e8", 400, 0.5, "end", 0.6))
    for i, key in enumerate(["giallo", "blu", "argento", "navy"]):
        o.append(tile(key, 60 + (i % 2) * 760, 130 + (i // 2) * 740, 720, 700))
    o.append("</svg>")
    return "\n".join(o)

for name, svg in [("auriga-1-logo", sheet_logo()), ("auriga-2-colors", sheet_colors())]:
    p = OUT / f"{name}.svg"
    p.write_text(svg)
    subprocess.run(["qlmanage", "-t", "-s", "1600", "-o", str(OUT), str(p)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    (OUT / f"{name}.svg.png").replace(OUT / f"{name}.png")
    print(name, p.stat().st_size // 1024, "KB")
