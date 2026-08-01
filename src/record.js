const path = require("path");
const http = require("http");
const fs = require("fs");
const { chromium } = require("playwright");

// width/height are the *recorded* size — kept modest for speed/reliability,
// then upscaled to a crisp final resolution during ffmpeg post-processing.
const ORIENTATIONS = {
  vertical: { width: 720, height: 1280 },
  horizontal: { width: 1280, height: 720 },
};

function serveStudio(dir, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let filePath = req.url.split("?")[0];
      if (filePath === "/") filePath = "/studio.html";
      const full = path.join(dir, filePath);
      fs.readFile(full, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const ext = path.extname(full);
        const type = ext === ".html" ? "text/html" : "text/plain";
        res.writeHead(200, { "Content-Type": type });
        res.end(data);
      });
    });
    server.listen(port, () => resolve(server));
  });
}

/**
 * Records a typing + live-preview session for `code` and writes the raw
 * video into `outDir`. Returns the path to the recorded file.
 */
async function recordTimelapse({
  code,
  orientation = "horizontal",
  outDir,
  charsPerTick = 3,
  delayMs = 12,
  holdMs = 3000,
  port = 5175,
}) {
  const dims = ORIENTATIONS[orientation] || ORIENTATIONS.horizontal;
  fs.mkdirSync(outDir, { recursive: true });

  const server = await serveStudio(path.join(__dirname), port);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: dims,
    recordVideo: { dir: outDir, size: dims },
  });
  const page = await context.newPage();

  await page.goto(`http://localhost:${port}/studio.html?orientation=${orientation}`);
  await page.waitForFunction(() => typeof window.typeCode === "function");

  await page.evaluate(
    ({ code, opts }) => window.typeCode(code, opts),
    { code, opts: { charsPerTick, delayMs, holdMs } }
  );

  const video = page.video();
  await context.close(); // flushes the video file to disk
  await browser.close();
  server.close();

  const videoPath = await video.path();

  // Give it a predictable name.
  const finalPath = path.join(outDir, `raw-${orientation}.webm`);
  fs.renameSync(videoPath, finalPath);
  return finalPath;
}

module.exports = { recordTimelapse, ORIENTATIONS };
