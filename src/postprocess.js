const fs = require("fs");
const { spawnSync } = require("child_process");
const { buildTypingSoundTrack, writeMonoWav } = require("./soundgen");

const FINAL_SIZE = {
  vertical: { width: 1080, height: 1920 },
  horizontal: { width: 1920, height: 1080 },
};

function getDurationSeconds(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  if (result.status !== 0) {
    throw new Error("ffprobe failed — is ffmpeg (with ffprobe) installed and on your PATH?");
  }
  const seconds = parseFloat(result.stdout.toString().trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Could not read a valid duration for ${filePath}`);
  }
  return seconds;
}

/**
 * Speeds up rawPath by `speed`x and scales it to the final resolution
 * for its orientation, writing an .mp4 to outPath. If `ticks` (millisecond
 * offsets from record.js, one per typing keystroke, on the RAW/pre-speed-up
 * timeline) are supplied and `typingSound` isn't disabled, a synthesized
 * mechanical-keyboard click track is generated.
 *
 * Important: the click track is synthesized directly on the FINAL
 * (post-speed-up) timeline — each tick timestamp is divided by `speed` and
 * a sharp click is placed right there — rather than built at raw speed and
 * then time-stretched with ffmpeg's `atempo`. `atempo` is a phase-vocoder
 * meant for continuous audio (speech/music); applied to short percussive
 * clicks it smears/warps them into a warbly, "off" sound. Synthesizing
 * directly on the target timeline keeps every click sharp, and it's also
 * cheaper (no extra audio filter pass).
 */
function makeTimelapse({
  rawPath,
  outPath,
  orientation,
  speed = 4,
  ticks = [],
  typingSound = true,
  typingSoundVolume = 0.5,
}) {
  const size = FINAL_SIZE[orientation] || FINAL_SIZE.horizontal;
  const videoFilter = `setpts=PTS/${speed},scale=${size.width}:${size.height}:flags=lanczos`;

  if (!typingSound || ticks.length === 0) {
    const args = [
      "-y",
      "-i", rawPath,
      "-filter:v", videoFilter,
      "-r", "30",
      "-pix_fmt", "yuv420p",
      "-an",
      outPath,
    ];
    const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error("ffmpeg failed — is ffmpeg installed and on your PATH?");
    }
    return outPath;
  }

  const rawDurationSeconds = getDurationSeconds(rawPath);
  const finalDurationMs = (rawDurationSeconds * 1000) / speed;
  const finalTickTimestampsMs = ticks.map((t) => t / speed);

  const clickTrack = buildTypingSoundTrack({
    durationMs: finalDurationMs,
    tickTimestampsMs: finalTickTimestampsMs,
    volume: typingSoundVolume,
  });
  const clicksPath = rawPath.replace(/\.webm$/i, "-clicks.wav");
  writeMonoWav(clickTrack, clicksPath);

  const args = [
    "-y",
    "-i", rawPath,
    "-i", clicksPath,
    "-filter:v", videoFilter,
    "-map", "0:v",
    "-map", "1:a",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    outPath,
  ];

  let result;
  try {
    result = spawnSync("ffmpeg", args, { stdio: "inherit" });
  } finally {
    try { fs.unlinkSync(clicksPath); } catch (e) { /* best-effort cleanup */ }
  }

  if (result.status !== 0) {
    throw new Error("ffmpeg failed — is ffmpeg installed and on your PATH?");
  }
  return outPath;
}

module.exports = { makeTimelapse, FINAL_SIZE };
