"""Draws the app icons (a message bubble to oneself, with a reminder dot)
into public/icons, and public/favicon.svg.

Run from the repo root: python3 scripts/make-icons.py  (needs Pillow).
Drawn at 1024px and scaled down, which is what gives smooth edges.
"""
from PIL import Image, ImageDraw

TEAL = (13, 148, 136, 255)
DEEP = (15, 118, 110, 255)
WHITE = (255, 255, 255, 255)
ORANGE = (234, 88, 12, 255)
BIG = 1024


def glyph(d, cx, cy, size, ink=DEEP, bubble=WHITE, dot=ORANGE):
    """The bubble, centred on (cx, cy), `size` wide."""
    w, h = size, size * 0.78
    x0, y0 = cx - w / 2, cy - h / 2
    r = h * 0.32
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=r, fill=bubble)
    # The tail, bottom left: a message to oneself.
    d.polygon([(x0 + w * 0.18, y0 + h - 2), (x0 + w * 0.08, y0 + h + h * 0.26), (x0 + w * 0.42, y0 + h - 2)], fill=bubble)
    # Two lines of writing.
    lw = h * 0.11
    for i, frac in enumerate((0.62, 0.42)):
        ly = y0 + h * (0.36 + i * 0.28)
        d.rounded_rectangle([x0 + w * 0.16, ly - lw / 2, x0 + w * (0.16 + frac), ly + lw / 2], radius=lw / 2, fill=ink)
    # The reminder.
    rr = h * 0.17
    dx, dy = x0 + w - rr * 0.6, y0 + rr * 0.6
    if dot:
        d.ellipse([dx - rr - 14, dy - rr - 14, dx + rr + 14, dy + rr + 14], fill=TEAL)
        d.ellipse([dx - rr, dy - rr, dx + rr, dy + rr], fill=dot)


def icon(scale, rounded):
    im = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, BIG - 1, BIG - 1], radius=BIG * 0.22, fill=TEAL)
    else:
        d.rectangle([0, 0, BIG, BIG], fill=TEAL)
    glyph(d, BIG / 2, BIG / 2 - BIG * 0.03, BIG * scale)
    return im


def badge():
    """Android's status-bar icon: a white shape on nothing, read as a mask."""
    im = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    glyph(d, BIG / 2, BIG / 2 - BIG * 0.04, BIG * 0.8, ink=(0, 0, 0, 0), dot=None)
    return im


def save(im, size, path):
    im.resize((size, size), Image.LANCZOS).save(path, optimize=True)


rounded = icon(0.6, True)
full = icon(0.6, False)
maskable = icon(0.5, False)  # inside the 80% safe circle
save(rounded, 192, "public/icons/icon-192.png")
save(rounded, 512, "public/icons/icon-512.png")
save(maskable, 512, "public/icons/maskable-512.png")
save(full, 180, "public/icons/apple-touch-icon.png")
save(badge(), 96, "public/icons/badge-96.png")

with open("public/favicon.svg", "w") as f:
    f.write(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="14" fill="#0d9488"/>'
        '<rect x="13" y="17" width="38" height="29" rx="9.5" fill="#fff"/>'
        '<path d="M20 45l-4 10 13-10z" fill="#fff"/>'
        '<rect x="19" y="25.5" width="23" height="3.4" rx="1.7" fill="#0f766e"/>'
        '<rect x="19" y="33.5" width="16" height="3.4" rx="1.7" fill="#0f766e"/>'
        '<circle cx="48.5" cy="19.5" r="7.5" fill="#0d9488"/><circle cx="48.5" cy="19.5" r="5.2" fill="#ea580c"/>'
        "</svg>"
    )
print("icons written")
