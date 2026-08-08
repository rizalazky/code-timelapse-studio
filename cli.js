#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { recordTimelapse } = require("./src/record");
const { makeTimelapse } = require("./src/postprocess");

function parseArgs(argv) {
  const out = {
    file: null,
    orientation: "both",
    speed: 2,
    charsPerTick: 3,
    delayMs: 12,
    previewSeconds: 3,  // NEW: how long the finished preview holds before the clip ends
    holdMs: null,        // optional override in ms; if unset, derived from previewSeconds
    outDir: path.join(__dirname, "output"),
    minSecondsVertical: 15,
    minSecondsHorizontal: 15,
    typingSound: true,
    typingSoundVolume: 0.5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--file") out.file = next();
    else if (a === "--orientation") out.orientation = next();
    else if (a === "--speed") out.speed = Number(next());
    else if (a === "--chars-per-tick") out.charsPerTick = Number(next());
    else if (a === "--delay-ms") out.delayMs = Number(next());
    else if (a === "--preview-seconds") out.previewSeconds = Number(next());
    else if (a === "--hold-ms") out.holdMs = Number(next()); // kept for backward compat
    else if (a === "--out-dir") out.outDir = next();
    else if (a === "--min-seconds-vertical") out.minSecondsVertical = Number(next());
    else if (a === "--min-seconds-horizontal") out.minSecondsHorizontal = Number(next());
    else if (a === "--no-typing-sound") out.typingSound = false;
    else if (a === "--typing-sound-volume") out.typingSoundVolume = Number(next());
  }
  if (out.holdMs == null) out.holdMs = out.previewSeconds * 1000;
  return out;
}

/**
 * Given the base typing settings, returns a (possibly slowed-down) delayMs
 * so the final (post-speed-up) clip is at least `minSeconds` long. Only
 * kicks in when the code is short enough that normal pace would fall short.
 */
function delayForMinDuration({ codeLength, charsPerTick, holdMs, speed, minSeconds, baseDelayMs }) {
  if (!minSeconds || minSeconds <= 0) return baseDelayMs;
  const ticks = Math.max(1, codeLength / charsPerTick);
  const requiredRawMs = minSeconds * speed * 1000 - holdMs;
  const requiredDelayMs = requiredRawMs / ticks;
  return Math.max(baseDelayMs, Math.ceil(requiredDelayMs));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.file) {
    console.error(
      "Usage: node cli.js --file yourcode.html [--orientation vertical|horizontal|both] [--speed 4] [--preview-seconds 3] [--no-typing-sound] [--typing-sound-volume 0.5]"
    );
    process.exit(1);
  }

  const code = fs.readFileSync(opts.file, "utf8");
  const orientations =
    opts.orientation === "both" ? ["vertical", "horizontal"] : [opts.orientation];

  fs.mkdirSync(opts.outDir, { recursive: true });

  for (const orientation of orientations) {
    const minSeconds =
      orientation === "vertical" ? opts.minSecondsVertical : opts.minSecondsHorizontal;
    const effectiveDelayMs = delayForMinDuration({
      codeLength: code.length,
      charsPerTick: opts.charsPerTick,
      holdMs: opts.holdMs,
      speed: opts.speed,
      minSeconds,
      baseDelayMs: opts.delayMs,
    });
    if (effectiveDelayMs !== opts.delayMs) {
      console.log(
        `\n(${orientation}) code is short — slowing typing to ${effectiveDelayMs}ms/tick so the final clip hits ~${minSeconds}s)`
      );
    }

    console.log(`[1/2] Recording (${orientation})...`);
    const { videoPath: rawPath, ticks } = await recordTimelapse({
      code,
      orientation,
      outDir: opts.outDir,
      charsPerTick: opts.charsPerTick,
      delayMs: effectiveDelayMs,
      holdMs: opts.holdMs,
    });

    console.log(
      `[2/2] Rendering timelapse (${orientation}, ${opts.speed}x${
        opts.typingSound ? ", with keyboard sound" : ""
      })...`
    );
    const finalPath = path.join(
      opts.outDir,
      `timelapse-${path.basename(opts.file, path.extname(opts.file))}-${orientation}.mp4`
    );
    makeTimelapse({
      rawPath,
      outPath: finalPath,
      orientation,
      speed: opts.speed,
      ticks,
      typingSound: opts.typingSound,
      typingSoundVolume: opts.typingSoundVolume,
      holdMs: opts.holdMs, // NEW
    });
    console.log(`✅ Done: ${finalPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
