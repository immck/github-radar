import math
from PIL import Image, ImageDraw

BG = (79, 70, 229, 255)      # indigo
FG = (255, 255, 255, 255)


def draw_icon(size: int) -> Image.Image:
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # rounded square
    radius = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)

    # concentric radar rings
    cx = cy = s / 2
    stroke = max(2, int(s * 0.035))
    for factor in (0.16, 0.28, 0.40):
        r = s * factor
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=FG, width=stroke)

    # sweep line (45°)
    length = s * 0.40
    d.line(
        [cx, cy, cx + length * math.cos(math.radians(-45)), cy + length * math.sin(math.radians(-45))],
        fill=FG,
        width=stroke,
    )

    # center dot
    r = max(2, int(s * 0.045))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=FG)

    return img.resize((size, size), Image.LANCZOS)


for size in (16, 32, 48, 128):
    draw_icon(size).save(f"icons/{size}.png")
    print(f"icons/{size}.png")
