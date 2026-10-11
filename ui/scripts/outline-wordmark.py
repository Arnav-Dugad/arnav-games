"""Outlines the Arnav Games wordmark to SVG paths, so brand files never depend on a font.

Typeface: Geist Variable (SIL OFL 1.1, bundled via @fontsource-variable/geist).
"ARNAV" at wght 600, "GAMES" at wght 360, caps tracked +0.26em, the font's own GPOS kerning
(applied by HarfBuzz) plus the optical pair corrections in PAIR_KERN below.

Requires: Python 3.10+, `pip install fonttools brotli uharfbuzz`, and `npm ci` in ui/.
Usage (from the repo root): python ui/scripts/outline-wordmark.py
Writes assets/brand/arnav-games-wordmark.svg (and -light.svg for light backgrounds).
"""

import io
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "ui/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"

TRACKING = 0.26  # em, between letters (not after the last one)
WORD_GAP = 0.30  # em, the space between the words (replaces the space glyph and its tracking)
# Optical corrections in font units (1000 upm), applied after kerning and tracking.
# Tracked caps open up wide gaps around diagonals and rounds; these close them.
PAIR_KERN = {
    ("A", "R"): -6,
    ("R", "N"): 4,
    ("N", "A"): -12,
    ("A", "V"): -38,
    ("G", "A"): -14,
    ("A", "M"): -8,
    ("M", "E"): 4,
    ("E", "S"): -6,
}
WORDS = [("ARNAV", 600), ("GAMES", 360)]
INK_DARK_BG = "#F2EFFA"
INK_LIGHT_BG = "#14121C"


def main() -> None:
    font = TTFont(str(FONT))
    upm = font["head"].unitsPerEm
    cap = font["OS/2"].sCapHeight
    # HarfBuzz reads sfnt, not WOFF2: hand it the decompressed font.
    sfnt = io.BytesIO()
    font.flavor = None
    font.save(sfnt)
    font = TTFont(io.BytesIO(sfnt.getvalue()))
    blob = hb.Blob(sfnt.getvalue())
    face = hb.Face(blob)

    words_svg = []
    pen_x = 0.0
    min_x = None
    max_x = 0.0
    y_min, y_max = 0.0, float(cap)
    for wi, (word, weight) in enumerate(WORDS):
        hb_font = hb.Font(face)
        hb_font.set_variations({"wght": weight})
        buf = hb.Buffer()
        buf.add_str(word)
        buf.guess_segment_properties()
        hb.shape(hb_font, buf, {"kern": True, "liga": False})
        glyph_set = font.getGlyphSet(location={"wght": weight})
        order = font.getGlyphOrder()
        paths = []
        for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
            name = order[info.codepoint]
            ch = word[i]
            svg_pen = SVGPathPen(glyph_set, ntos=lambda v: f"{round(v, 2):g}")
            # Flip y so the baseline sits at y = cap height and the cap line at y = 0.
            tpen = TransformPen(svg_pen, (1, 0, 0, -1, pen_x + pos.x_offset, cap))
            glyph_set[name].draw(tpen)
            paths.append(svg_pen.getCommands())
            bounds = glyph_bounds(glyph_set, name)
            if min_x is None:
                min_x = pen_x + bounds[0]
            max_x = max(max_x, pen_x + bounds[2])
            y_min, y_max = min(y_min, bounds[1]), max(y_max, bounds[3])
            pen_x += pos.x_advance
            if i < len(word) - 1:
                pen_x += TRACKING * upm + PAIR_KERN.get((ch, word[i + 1]), 0)
        words_svg.append((word, weight, " ".join(paths)))
        if wi < len(WORDS) - 1:
            pen_x += WORD_GAP * upm + TRACKING * upm

    width = max_x - min_x
    # The viewBox keeps the cap line at y = 0 and the baseline at y = cap, and includes the
    # overshoot of the round letters (G, S) above and below.
    top, height = cap - y_max, y_max - y_min
    for ink, suffix in ((INK_DARK_BG, ""), (INK_LIGHT_BG, "-light")):
        body = "\n".join(
            f'  <path data-word="{w.lower()}" data-wght="{wg}" fill="{ink}" d="{d}"/>' for w, wg, d in words_svg
        )
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{fmt(min_x)} {fmt(top)} {fmt(width)} {fmt(height)}" '
            f'width="{fmt(width / 10)}" height="{fmt(height / 10)}" data-cap-height="{cap}" role="img" aria-label="Arnav Games">\n'
            f"  <title>Arnav Games</title>\n{body}\n</svg>\n"
        )
        out = ROOT / f"assets/brand/arnav-games-wordmark{suffix}.svg"
        out.write_text(svg, encoding="utf-8")
        print("Wrote", out.relative_to(ROOT), f"({fmt(width)} x {cap} units, cap height {cap}/{upm})")


def glyph_bounds(glyph_set, name):
    from fontTools.pens.boundsPen import BoundsPen

    bp = BoundsPen(glyph_set)
    glyph_set[name].draw(bp)
    return bp.bounds or (0, 0, 0, 0)


def fmt(v: float) -> str:
    return f"{round(v, 2):g}"


if __name__ == "__main__":
    main()
