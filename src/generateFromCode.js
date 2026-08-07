const fs = require("fs");
const path = require("path");
const { recordTimelapse } = require("./record");
const { makeTimelapse } = require("./postprocess");

/**
 * Same recordTimelapse -> makeTimelapse pipeline cli.js drives, but callable
 * directly with an in-memory `code` string. Used by the spreadsheet flow,
 * where the HTML comes from a CSV cell rather than an uploaded .html file.
 *
 * Returns e.g. { vertical: "/abs/path/timelapse-12-vertical.mp4" } (one key
 * per requested orientation).
 */
async function generateFromCode({
  code,
  orientation = "vertical", // "vertical" | "horizontal" | "both"
  outDir,
  baseName = "video",
  speed = 4,
  charsPerTick = 3,
  delayMs = 12,
  holdMs = 1500,
  minSecondsVertical = 15,
  minSecondsHorizontal = 0,
  typingSound = true,
  typingSoundVolume = 0.5,
}) {
  if (!code || !code.trim()) {
    throw new Error("Kode HTML kosong — tidak ada yang bisa direkam");
  }

  const orientations = orientation === "both" ? ["vertical", "horizontal"] : [orientation];
  fs.mkdirSync(outDir, { recursive: true });

  const results = {};
  for (const o of orientations) {
    const minSeconds = o === "vertical" ? minSecondsVertical : minSecondsHorizontal;

    // Same short-code duration floor cli.js applies, ported here so a tiny
    // snippet doesn't produce a throwaway 2-second clip.
    let effectiveDelayMs = delayMs;
    if (minSeconds && minSeconds > 0) {
      const ticksNeeded = Math.max(1, code.length / charsPerTick);
      const requiredRawMs = minSeconds * speed * 1000 - holdMs;
      effectiveDelayMs = Math.max(delayMs, Math.ceil(requiredRawMs / ticksNeeded));
    }

    const { videoPath: rawPath, ticks } = await recordTimelapse({
      code,
      orientation: o,
      outDir,
      charsPerTick,
      delayMs: effectiveDelayMs,
      holdMs,
    });

    const finalPath = path.join(outDir, `${baseName}-${o}.mp4`);
    makeTimelapse({
      rawPath,
      outPath: finalPath,
      orientation: o,
      speed,
      ticks,
      typingSound,
      typingSoundVolume,
    });
    results[o] = finalPath;
  }
  return results;
}

module.exports = { generateFromCode };
