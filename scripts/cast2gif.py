"""Render an asciinema v2 .cast file to an animated GIF (pyte + Pillow).

usage: python scripts/cast2gif.py docs/demo.cast docs/demo.gif
"""
import json
import sys

import pyte
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
SIZE, PAD = 14, 12
BG, FG = (30, 30, 36), (220, 220, 220)
COLORS = {"green": (110, 200, 110), "red": (230, 100, 100), "yellow": (230, 200, 90),
          "blue": (110, 160, 240), "cyan": (100, 200, 210), "magenta": (200, 130, 220), "white": (240, 240, 240)}
MAX_PAUSE, END_HOLD = 1.6, 4.0


def render(screen, font, bold, cw, ch, cursor=True):
    img = Image.new("RGB", (screen.columns * cw + 2 * PAD, screen.lines * ch + 2 * PAD), BG)
    d = ImageDraw.Draw(img)
    for y in range(screen.lines):
        row = screen.buffer[y]
        for x in range(screen.columns):
            c = row[x]
            if c.data == " ":
                continue
            color = COLORS.get(c.fg, FG)
            d.text((PAD + x * cw, PAD + y * ch), c.data, font=bold if c.bold else font, fill=color)
    if cursor:
        cx, cy = screen.cursor.x, screen.cursor.y
        d.rectangle([PAD + cx * cw, PAD + cy * ch + 2, PAD + cx * cw + cw - 1, PAD + (cy + 1) * ch - 1], fill=(180, 180, 180))
    return img


def main(src, dst):
    lines = open(src, encoding="utf-8").read().splitlines()
    header = json.loads(lines[0])
    events = [json.loads(l) for l in lines[1:] if l.strip()]
    screen = pyte.Screen(header["width"], header["height"])
    stream = pyte.Stream(screen)
    font, bold = ImageFont.truetype(FONT, SIZE), ImageFont.truetype(BOLD, SIZE)
    cw = round(font.getlength("M"))
    ch = SIZE + 5
    frames, durations = [], []
    for i, (t, kind, data) in enumerate(events):
        if kind != "o":
            continue
        stream.feed(data)
        nxt = events[i + 1][0] if i + 1 < len(events) else t + END_HOLD
        dur = min(max(nxt - t, 0.02), MAX_PAUSE) if i + 1 < len(events) else END_HOLD
        frames.append(render(screen, font, bold, cw, ch).convert("P", palette=Image.ADAPTIVE, colors=16))
        durations.append(int(dur * 1000))
    frames[0].save(dst, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
    print(f"{dst}: {len(frames)} frames, {sum(durations) / 1000:.1f}s")


if __name__ == "__main__":
    main(*sys.argv[1:3])
