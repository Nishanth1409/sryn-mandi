from pathlib import Path

import numpy as np
from PIL import Image

src = Path(r"D:\Projects\business\Home Business\arecanut-market\public\Dark theme.png")
out_dir = Path(r"D:\Projects\business\Home Business\arecanut-market\public")

im = Image.open(src).convert("RGBA")
arr = np.array(im)
r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]

black = (r < 18) & (g < 18) & (b < 18) & (a > 0)
white = (r > 235) & (g > 235) & (b > 235) & (a > 200)

mask = (~black) & (a > 8)
ys, xs = np.where(mask)
pad = 40
y0, y1 = max(0, int(ys.min()) - pad), min(arr.shape[0], int(ys.max()) + pad)
x0, x1 = max(0, int(xs.min()) - pad), min(arr.shape[1], int(xs.max()) + pad)
print("bbox", x0, y0, x1, y1, "size", x1 - x0, y1 - y0)

dark = arr[y0:y1, x0:x1].copy()
db = black[y0:y1, x0:x1]
dark[db, 3] = 0

light = dark.copy()
lw = white[y0:y1, x0:x1]
light[lw, 0] = 15
light[lw, 1] = 31
light[lw, 2] = 23

rr, gg, bb = light[:, :, 0], light[:, :, 1], light[:, :, 2]
grayish = (rr > 180) & (gg > 180) & (bb > 180) & (~lw) & (light[:, :, 3] > 40)
light[grayish, 0] = 15
light[grayish, 1] = 31
light[grayish, 2] = 23


def fit(img: Image.Image, max_w: int = 900) -> Image.Image:
    w, h = img.size
    if w <= max_w:
        return img
    nh = int(h * max_w / w)
    return img.resize((max_w, nh), Image.Resampling.LANCZOS)


dark_web = fit(Image.fromarray(dark, "RGBA"))
light_web = fit(Image.fromarray(light.astype(np.uint8), "RGBA"))

dark_path = out_dir / "logo-dark.png"
light_path = out_dir / "logo-light.png"
dark_web.save(dark_path, optimize=True)
light_web.save(light_path, optimize=True)
print("saved", dark_path.name, dark_web.size, dark_path.stat().st_size)
print("saved", light_path.name, light_web.size, light_path.stat().st_size)
