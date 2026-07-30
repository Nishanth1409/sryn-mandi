"""Build the web logos used by the header from the two artwork files.

`Dark theme.png` carries the light silhouette for dark backgrounds and
`light theme.png` the dark silhouette for light backgrounds. Both already ship
with a transparent background, so this only trims the empty margin and scales
them down for the web. Both are cropped to the same box so the mark does not
shift when the theme is switched.
"""

from pathlib import Path

import numpy as np
from PIL import Image

PUBLIC = Path(__file__).resolve().parent.parent / "public"
SOURCES = {"logo-dark.png": "Dark theme.png", "logo-light.png": "light theme.png"}
ALPHA_FLOOR = 8
PAD = 24
MAX_WIDTH = 900


def content_box(arr: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(arr[:, :, 3] > ALPHA_FLOOR)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


images = {out: Image.open(PUBLIC / src).convert("RGBA") for out, src in SOURCES.items()}
arrays = {out: np.array(im) for out, im in images.items()}

boxes = [content_box(arr) for arr in arrays.values()]
height, width = next(iter(arrays.values())).shape[:2]
x0 = max(0, min(b[0] for b in boxes) - PAD)
y0 = max(0, min(b[1] for b in boxes) - PAD)
x1 = min(width, max(b[2] for b in boxes) + PAD)
y1 = min(height, max(b[3] for b in boxes) + PAD)
print("shared crop", (x0, y0, x1, y1), "size", x1 - x0, y1 - y0)

for out_name, im in images.items():
    cropped = im.crop((x0, y0, x1, y1))
    w, h = cropped.size
    if w > MAX_WIDTH:
        cropped = cropped.resize((MAX_WIDTH, int(h * MAX_WIDTH / w)), Image.Resampling.LANCZOS)
    target = PUBLIC / out_name
    cropped.save(target, optimize=True)
    print("saved", out_name, cropped.size, target.stat().st_size)
