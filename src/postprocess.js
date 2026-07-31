const { spawnSync } = require("child_process");

const FINAL_SIZE = {
  vertical: { width: 1080, height: 1920 },
  horizontal: { width: 1920, height: 1080 },
};

/**
 * Speeds up rawPath by `speed`x and scales it to the final resolution
 * for its orientation, writing an .mp4 to outPath.
 */
function makeTimelapse({ rawPath, outPath, orientation, speed = 4 }) {
  const size = FINAL_SIZE[orientation] || FINAL_SIZE.horizontal;
  const args = [
    "-y",
    "-i", rawPath,
    "-filter:v", `setpts=PTS/${speed},scale=${size.width}:${size.height}:flags=lanczos`,
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

module.exports = { makeTimelapse, FINAL_SIZE };
