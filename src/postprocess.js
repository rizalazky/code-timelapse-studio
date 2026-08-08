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
  holdMs = 3000, // raw-timeline duration of the finished-code pause (see FADE_WAIT_MS below)
}) {
  // Matches studio.html: 300ms black-fade wait happens right before the
  // holdMs zoom/reveal window starts, and both are recorded on the RAW
  // timeline. Together they're the "tail" we must NOT speed up.
  const FADE_WAIT_MS = 300;

  const size = FINAL_SIZE[orientation] || FINAL_SIZE.horizontal;
  const rawDurationSeconds = getDurationSeconds(rawPath);

  const tailRawMs = holdMs + FADE_WAIT_MS;
  const tailRawSeconds = Math.min(rawDurationSeconds, tailRawMs / 1000);
  const splitAtSeconds = Math.max(0, rawDurationSeconds - tailRawSeconds);

  const mainFinalMs = (splitAtSeconds * 1000) / speed;
  const tailFinalMs = tailRawSeconds * 1000; // NOT divided by speed — this is the fix

  // Two segments, concatenated: the typing portion gets the timelapse
  // speed-up; the finished-result pause is kept at real speed so it's
  // actually visible on screen instead of being crushed by the same
  // multiplier as the typing (previously: the whole raw clip, hold
  // included, was sped up together — a `--speed 4` hold of 3s became a
  // barely-visible 0.75s).
  const videoFilter =
    `[0:v]trim=start=0:end=${splitAtSeconds},setpts=(PTS-STARTPTS)/${speed}[vmain];` +
    `[0:v]trim=start=${splitAtSeconds},setpts=PTS-STARTPTS[vtail];` +
    `[vmain][vtail]concat=n=2:v=1:a=0[vcat];` +
    `[vcat]scale=${size.width}:${size.height}:flags=lanczos[vout]`;

  if (!typingSound || ticks.length === 0) {
    const args = [
      "-y",
      "-i", rawPath,
      "-filter_complex", videoFilter,
      "-map", "[vout]",
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

  // Ticks before the split get scaled by `speed` like before; any tick
  // that happens to land in the tail (shouldn't normally happen, typing
  // is done by then) maps 1:1 past the sped-up main segment's final length.
  const splitRawMs = splitAtSeconds * 1000;
  const finalTickTimestampsMs = ticks.map((t) =>
    t <= splitRawMs ? t / speed : mainFinalMs + (t - splitRawMs)
  );
  const finalDurationMs = mainFinalMs + tailFinalMs;

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
    "-filter_complex", videoFilter,
    "-map", "[vout]",
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
