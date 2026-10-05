#!/usr/bin/env python3
"""Generate codec and benchmark inputs. Requires Pillow (development only)."""
from pathlib import Path
import math
from PIL import Image, ImageDraw, features

root = Path(__file__).resolve().parent.parent / '.build' / 'test-images'
root.mkdir(parents=True, exist_ok=True)
small = Image.new('RGB', (128, 128), (190, 210, 175))
draw = ImageDraw.Draw(small)
draw.rectangle((0, 0, 63, 63), fill=(220, 40, 30))
draw.rectangle((64, 0, 127, 63), fill=(30, 80, 230))
small.save(root / 'jpeg.jpg', quality=95)
if not features.check('jpg_2000'):
    raise RuntimeError('Pillow needs JPEG2000 support for the OpenJPEG integration test.')
small.save(root / 'jpeg2000.jp2')

# Large scan-like pages with photographs, charts, and text; JPEG rather than
# random Flate data represents the image-heavy PDFs people normally read.
scan = Image.new('RGB', (1800, 2400), (250, 248, 242))
pixels = bytearray(1800 * 1000 * 3)
for y in range(1000):
    for x in range(1800):
        at = (y * 1800 + x) * 3
        wave = math.sin(x / 30) * math.cos(y / 35)
        pixels[at:at + 3] = bytes((int(110 + wave * 45 + y / 12) % 256,
                                   int(100 + math.sin(x / 140 + y / 40) * 65) % 256,
                                   int(140 + math.cos(y / 110) * 60) % 256))
photo = Image.frombytes('RGB', (1800, 1000), bytes(pixels))
scan.paste(photo, (0, 140))
draw = ImageDraw.Draw(scan)
draw.text((80, 50), 'FOLIO / IMAGE-HEAVY PERFORMANCE FIXTURE', fill=(40, 60, 40), stroke_width=1)
for row in range(32):
    y = 1240 + row * 30
    draw.line((80, y, 800 - row % 4 * 100, y), fill=(110, 120, 110), width=3)
    draw.line((960, y, 1700 - row % 3 * 120, y), fill=(110, 120, 110), width=3)
scan.save(root / 'scan.jpg', quality=93)
print('Generated JPEG, JPEG2000 and 1800×2400 scan fixtures:', root)
