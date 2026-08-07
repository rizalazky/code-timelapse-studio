const fs = require("fs");

const TIKTOK_API = "https://open.tiktokapis.com/v2";

async function tiktokFetch(pathName, accessToken, body) {
  const res = await fetch(`${TIKTOK_API}${pathName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || (json.error && json.error.code && json.error.code !== "ok")) {
    throw new Error(`TikTok API error at ${pathName}: ${JSON.stringify(json.error || json)}`);
  }
  return json;
}

/**
 * Direct-posts a local video to TikTok via the Content Posting API
 * (source: FILE_UPLOAD). Requires TIKTOK_ACCESS_TOKEN with the
 * video.publish scope for the target creator — see SETUP-UPLOAD.md.
 *
 * Note: until your TikTok developer app passes audit, every post lands as
 * private ("SELF_ONLY") no matter what privacyLevel you request — that's a
 * TikTok platform restriction, not a bug here.
 */
async function uploadToTikTok({ filePath, caption = "", privacyLevel = "SELF_ONLY" }) {
  const { TIKTOK_ACCESS_TOKEN } = process.env;
  if (!TIKTOK_ACCESS_TOKEN) {
    throw new Error("TikTok belum dikonfigurasi. Set TIKTOK_ACCESS_TOKEN di .env — lihat SETUP-UPLOAD.md.");
  }

  const videoSize = fs.statSync(filePath).size;

  const init = await tiktokFetch("/post/publish/video/init/", TIKTOK_ACCESS_TOKEN, {
    post_info: {
      title: caption,
      privacy_level: privacyLevel,
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: videoSize, // whole file in one chunk; fine for short timelapse clips
      total_chunk_count: 1,
    },
  });

  const { publish_id, upload_url } = init.data;

  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
    },
    body: fs.readFileSync(filePath),
  });
  if (!putRes.ok) {
    throw new Error(`Gagal upload byte video ke TikTok (status ${putRes.status})`);
  }

  // Publishing is async — poll status/fetch until it's out of the
  // PROCESSING states so the caller knows whether it actually landed.
  let status = "PROCESSING_UPLOAD";
  for (let attempt = 0; attempt < 15 && status.includes("PROCESSING"); attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const check = await tiktokFetch("/post/publish/status/fetch/", TIKTOK_ACCESS_TOKEN, { publish_id });
    status = check.data.status;
    if (status === "FAILED") {
      throw new Error(`TikTok publish gagal: ${check.data.fail_reason || "unknown"}`);
    }
  }

  return { publishId: publish_id, status };
}

module.exports = { uploadToTikTok };
