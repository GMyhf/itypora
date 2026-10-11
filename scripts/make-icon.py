"""生成应用图标：build/icon.png (1024) 与 build/icon.icns。依赖 Pillow：python3 scripts/make-icon.py"""
from PIL import Image, ImageDraw, ImageFilter
import os

S = 4                      # 超采样倍数，保证边缘平滑
N = 1024 * S
out = os.path.join(os.path.dirname(__file__), '..', 'build')

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# macOS 图标主体 824px，四周留透明边距
body = 824 * S
off = (N - body) // 2
radius = int(body * 0.2237)

# 渐变底（左上 靛蓝 -> 右下 蓝）
grad = Image.new('RGB', (body, body))
px = grad.load()
c1, c2 = (99, 102, 241), (14, 165, 233)
for y in range(body):
    for x in range(body):
        px[x, y] = lerp(c1, c2, (x + y) / (2 * body))

mask = Image.new('L', (body, body), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, body - 1, body - 1), radius, fill=255)

img = Image.new('RGBA', (N, N), (0, 0, 0, 0))

# 柔和投影
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
sm = Image.new('L', (N, N), 0)
sm.paste(mask, (off, off + 10 * S))
shadow.putalpha(sm.point(lambda v: int(v * 0.35)))
img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14 * S)))

img.paste(grad, (off, off), mask)

# 白色 “#” + 光标：Markdown 与“边写边渲染”的意象
d = ImageDraw.Draw(img)
w = 64 * S
white = (255, 255, 255, 255)
cx, cy = N // 2 - 48 * S, N // 2
gap, half = 92 * S, 190 * S

def line(p, q, width, color=white):
    d.line([p, q], fill=color, width=width)
    r = width // 2
    for x, y in (p, q):
        d.ellipse((x - r, y - r, x + r, y + r), fill=color)

for dx in (-gap // 2, gap // 2):                       # 两条竖线（略向右倾斜）
    line((cx + dx + 28 * S, cy - half), (cx + dx - 28 * S, cy + half), w)
for dy in (-gap // 2 - 6 * S, gap // 2 + 6 * S):       # 两条横线
    line((cx - half + 20 * S, cy + dy), (cx + half - 20 * S, cy + dy), w)

# 光标条
bx = cx + half + 62 * S
d.rounded_rectangle((bx, cy - half, bx + 46 * S, cy + half), 23 * S, fill=(255, 255, 255, 215))

img = img.resize((1024, 1024), Image.LANCZOS)
os.makedirs(out, exist_ok=True)
img.save(os.path.join(out, 'icon.png'))
img.save(os.path.join(out, 'icon.icns'), sizes=[(s, s) for s in (16, 32, 64, 128, 256, 512, 1024)])
print('ok')
