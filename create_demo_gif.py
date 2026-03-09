#!/usr/bin/env python3
"""Create an animated GIF demonstrating ask-llm-cli shell integration mode."""

from PIL import Image, ImageDraw, ImageFont
import os

# Terminal dimensions
WIDTH = 700
HEIGHT = 220
BG = (30, 33, 39)
TEXT = (171, 178, 191)
PROMPT_COL = (97, 175, 239)   # blue
CMD_COL = (152, 195, 121)     # green
SPIN_COL = (229, 192, 123)    # yellow
DIM = (85, 90, 100)
TITLE_BG = (40, 44, 52)
BTN_RED = (255, 95, 86)
BTN_YEL = (255, 189, 46)
BTN_GRN = (39, 201, 63)
CURSOR_COL = (200, 205, 215)
WARN_COL = (224, 108, 117)    # red for the warning hint

FONT_PATH = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
FONT_SIZE = 15
LINE_H = 22
PAD_X = 18
PAD_Y = 14
TITLE_H = 28

font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
font_bold = ImageFont.truetype(FONT_BOLD, FONT_SIZE)

# Measure a single character width (monospace)
CHAR_W = font.getbbox("M")[2] - font.getbbox("M")[0]


def text_px_width(text, f=None):
    if f is None:
        f = font
    return f.getlength(text)


def draw_frame(lines, cursor_x_px=None, cursor_y=None, cursor_on=True):
    """
    lines: list of rows; each row is a list of (text, color[, bold]) tuples.
    cursor_x_px: horizontal pixel offset from PAD_X for cursor.
    cursor_y: row index.
    """
    img = Image.new('RGB', (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    # Title bar
    draw.rectangle([0, 0, WIDTH, TITLE_H], fill=TITLE_BG)
    for i, c in enumerate([BTN_RED, BTN_YEL, BTN_GRN]):
        bx = 14 + i * 20
        by = TITLE_H // 2
        draw.ellipse([bx-5, by-5, bx+5, by+5], fill=c)
    title = "zsh"
    tw = font.getbbox(title)[2]
    draw.text(((WIDTH - tw) // 2, (TITLE_H - FONT_SIZE) // 2 + 1),
              title, fill=(140, 145, 155), font=font)

    # Render text lines
    for row, segs in enumerate(lines):
        x = PAD_X
        y = TITLE_H + PAD_Y + row * LINE_H
        for seg in segs:
            text = seg[0]
            color = seg[1]
            f = font_bold if len(seg) > 2 and seg[2] else font
            draw.text((x, y), text, fill=color, font=f)
            x += text_px_width(text, f)

    # Cursor block
    if cursor_x_px is not None and cursor_y is not None and cursor_on:
        cx = PAD_X + cursor_x_px
        cy = TITLE_H + PAD_Y + cursor_y * LINE_H
        draw.rectangle([cx, cy + 1, cx + CHAR_W - 1, cy + LINE_H - 2], fill=CURSOR_COL)

    return img


def frames_pause(lines, n=8, blink=True, cx_px=None, cy=None):
    result = []
    for i in range(n):
        on = (i % 8 < 4) if blink else False
        result.append(draw_frame(lines, cx_px, cy, on))
    return result


def frames_type(base_lines, prompt_segs, typing_text, row, color=TEXT):
    """Animate typing one character at a time."""
    result = []
    for i in range(len(typing_text) + 1):
        partial = typing_text[:i]
        lines = [list(r) for r in base_lines]
        lines[row] = prompt_segs + ([(partial, color)] if partial else [])
        cx_px = sum(text_px_width(t, font_bold if len(s) > 2 and s[2] else font)
                    for s in prompt_segs for t in [s[0]])
        cx_px += text_px_width(partial)
        result.append(draw_frame(lines, cx_px, row, True))
    return result


# ─── Scenes ──────────────────────────────────────────────────────────────────
ROWS = 7

def blank():
    return [[] for _ in range(ROWS)]

PROMPT = [("% ", PROMPT_COL, True)]   # zsh prompt  (bold blue)
TYPING = "ask find large files"
CMD    = "find . -size +100M -type f"

frames = []
durations = []

def add(fs, ms_each):
    frames.extend(fs)
    durations.extend([ms_each] * len(fs))


# 1. Initial blinking cursor
s = blank()
s[0] = PROMPT
cx_px = text_px_width("% ", font_bold)
add(frames_pause(s, n=14, blink=True, cx_px=cx_px, cy=0), 100)

# 2. Type command
s = blank()
add(frames_type(s, PROMPT, TYPING, row=0), 90)

# 3. Hold after typing
s = blank()
s[0] = PROMPT + [(TYPING, TEXT)]
cx_px = text_px_width("% ", font_bold) + text_px_width(TYPING)
add(frames_pause(s, n=8, blink=True, cx_px=cx_px, cy=0), 100)

# 4. Enter → spinner
s = blank()
s[0] = PROMPT + [(TYPING, DIM)]
s[1] = [("Asking LLM...", SPIN_COL)]
add(frames_pause(s, n=20, blink=False), 100)

# 5. Shell integration: command appears on the prompt line
#    print -z "$cmd" — the command is placed ready to edit/run
s = blank()
s[0] = PROMPT + [(TYPING, DIM)]
s[2] = [("# command placed on prompt line by shell integration", DIM)]
s[3] = PROMPT + [(CMD, CMD_COL)]
cx_px = text_px_width("% ", font_bold) + text_px_width(CMD)
add(frames_pause(s, n=32, blink=True, cx_px=cx_px, cy=3), 100)

# 6. User runs the command (Enter)
s = blank()
s[0] = PROMPT + [(TYPING, DIM)]
s[2] = []
s[3] = PROMPT + [(CMD, DIM)]
s[4] = [("./reports/q1-2024.pdf  (2.1G)", TEXT)]
s[5] = [("./backups/archive-2023.tar.gz  (1.7G)", TEXT)]
add(frames_pause(s, n=22, blink=False), 100)

# 7. New prompt
s = blank()
s[0] = PROMPT + [(TYPING, DIM)]
s[3] = PROMPT + [(CMD, DIM)]
s[4] = [("./reports/q1-2024.pdf  (2.1G)", TEXT)]
s[5] = [("./backups/archive-2023.tar.gz  (1.7G)", TEXT)]
s[6] = PROMPT
cx_px = text_px_width("% ", font_bold)
add(frames_pause(s, n=18, blink=True, cx_px=cx_px, cy=6), 110)

# ─── Save ────────────────────────────────────────────────────────────────────
assert len(frames) == len(durations)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shell-integration-demo.gif")

frames[0].save(
    OUT,
    save_all=True,
    append_images=frames[1:],
    optimize=False,
    duration=durations,
    loop=0,
)

total_s = sum(durations) / 1000
print(f"Saved {len(frames)}-frame GIF ({total_s:.1f}s) -> {OUT}")
