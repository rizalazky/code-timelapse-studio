# Code Timelapse Studio

Turn a self-contained HTML/CSS/JS file into a "typing the code while the live
preview updates" timelapse video — the same style as coding shorts on
YouTube/TikTok. Runs headless, no screen recorder or OS automation needed.

## How it works

1. A tiny local page (`src/studio.html`) shows a code panel and a live
   preview `<iframe>` side by side (or stacked, for vertical video).
2. Playwright launches headless Chromium, opens that page, and "types" your
   code into the panel character by character — updating the preview
   `srcdoc` as it goes, so it renders live just like a real coding session.
3. Playwright's built-in video recorder captures the whole session.
4. `ffmpeg` speeds the recording up (default 4x) and scales it to a crisp
   final resolution — that's the timelapse effect.

## Setup

```bash
cd code-timelapse-studio
npm install
npx playwright install chromium
```

You also need `ffmpeg` installed and on your PATH:
- macOS: `brew install ffmpeg`
- Ubuntu/Debian: `sudo apt install ffmpeg`
- Windows: https://ffmpeg.org/download.html

## Usage

```bash
node cli.js --file examples/progress-loader.html
```

This produces both a vertical (1080x1920, for Shorts/Reels/TikTok) and a
horizontal (1920x1080) version in `output/`.

### Options

| Flag | Default | Meaning |
|---|---|---|
| `--file` | (required) | Path to a self-contained `.html` file (inline `<style>`/`<script>` is fine) |
| `--orientation` | `both` | `vertical`, `horizontal`, or `both` |
| `--speed` | `4` | Timelapse speed multiplier applied in post |
| `--chars-per-tick` | `3` | How many characters get "typed" per animation tick |
| `--delay-ms` | `12` | Delay between ticks (lower = faster raw typing) |
| `--hold-ms` | `1500` | Pause on the finished result before the recording ends |
| `--out-dir` | `output/` | Where to write files |
| `--min-seconds-vertical` | `15` | If the code is short, typing auto-slows so the **vertical** clip is at least this long |
| `--min-seconds-horizontal` | `0` (off) | Same idea for **horizontal** — off by default, since horizontal is meant for normal-pace, longer-form code |

Horizontal runs at your normal typing pace by default (good for longer code
you want to walk through in full). Vertical automatically slows the typing
just enough to guarantee a ≥15s clip, even if the code itself is short —
so you never get a throwaway 2-second Short. Raise/lower the floor with
`--min-seconds-vertical`, or set `--min-seconds-horizontal` if you want the
same floor applied there too.

Example — a punchier, faster clip:

```bash
node cli.js --file examples/progress-loader.html --orientation vertical --speed 8 --delay-ms 8
```

## Using your own code

Just point `--file` at any single `.html` file that contains everything
inline (CSS in `<style>`, JS in `<script>`). That's exactly the format the
live-preview iframe expects, and it's what the source video's format is
built around.

If you want to feed it separate `.html` / `.css` / `.js` files, the
easiest path is to inline them into one file before running the tool
(a two-line Node/bash script can do this — happy to add a `--merge` flag
that does it automatically if useful).

## Notes / things you can tune later

- **Typing realism**: right now it's a steady character stream. You could
  swap in variable-speed typing (pause after `{`, `;`, newlines) for a more
  human feel — small change in `src/studio.html`'s `typeCode()`.
- **Background music / captions**: add another `ffmpeg` pass after
  `makeTimelapse()` (e.g. `-i music.mp3 -shortest`).
- **Cursor highlight/zoom**: could be done with a CSS effect on the
  simulated cursor combined with a slow CSS `transform: scale()` pulse.
