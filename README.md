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
   Each typing "tick" is also reported back to Node (`src/record.js`) with
   its timestamp.
3. Playwright's built-in video recorder captures the whole session
   (video only — Playwright's recorder doesn't capture audio).
4. `ffmpeg` speeds the recording up (default 4x) and scales it to a crisp
   final resolution — that's the timelapse effect. If typing sound is
   enabled (the default), `src/soundgen.js` synthesizes a mechanical-keyboard
   click for every reported tick — no external sound file needed — into a
   WAV track, which `src/postprocess.js` speeds up in lockstep with the
   video (via `atempo`) and mixes into the final `.mp4`.

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
horizontal (1920x1080) version in `output/`, each with a synced mechanical
keyboard click sound.

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
| `--no-typing-sound` | *(sound on by default)* | Disable the mechanical-keyboard click sound |
| `--typing-sound-volume` | `0.5` | Click volume, `0`–`1` |

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

Example — silent output (no keyboard sound):

```bash
node cli.js --file examples/progress-loader.html --no-typing-sound
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

## Typing sound

`src/soundgen.js` synthesizes a short mechanical-keyswitch "click" per
keystroke tick entirely in code (a filtered noise burst layered with a
fast-decaying tone, randomized slightly per click so it doesn't sound
robotic) — no bundled audio asset or network access required. Very rapid
raw ticks are throttled (default: no closer than 45ms apart) so the result
sounds like individual keystrokes rather than a buzz. The click track is
generated at the raw (pre-speed-up) video's duration and sample-accurate
tick timestamps, then sped up with ffmpeg's `atempo` filter using the same
factor as `--speed`, so clicks stay in sync with the visible typing after
the timelapse speed-up.

Tune it with `--typing-sound-volume` (0–1) or turn it off with
`--no-typing-sound`.

## Notes / things you can tune later

- **Typing realism**: right now it's a steady character stream. You could
  swap in variable-speed typing (pause after `{`, `;`, newlines) for a more
  human feel — small change in `src/studio.html`'s `typeCode()`.
- **Background music / captions**: layer another `ffmpeg` input into the
  `-filter_complex` in `makeTimelapse()` (e.g. `amix` the click track with
  a music file).
- **Cursor highlight/zoom**: could be done with a CSS effect on the
  simulated cursor combined with a slow CSS `transform: scale()` pulse.
