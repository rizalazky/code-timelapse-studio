const fs = require("fs");
const { spawnSync } = require("child_process");

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
 * Fetches the authorized creator's current posting constraints. Per
 * TikTok's Direct Post docs / Content Sharing Guidelines this must be
 * queried before every post — the available privacy levels and
 * duet/comment/stitch settings are per-creator (and can change), so a
 * hardcoded assumption can silently conflict with the account's real
 * state.
 */
async function getCreatorInfo(accessToken) {
  const res = await tiktokFetch("/post/publish/creator_info/query/", accessToken, {});
  return res.data;
}

/**
 * Best-effort video duration check via ffprobe, run against the
 * creator's max_video_post_duration_sec so an over-limit video fails
 * fast instead of only after a full upload + publish attempt. Never
 * blocks the upload if ffprobe itself is unavailable/fails — this is a
 * fast-fail convenience, not a hard validation layer.
 */
function checkDuration(filePath, maxDurationSec) {
  if (!maxDurationSec) return;
  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  if (probe.status !== 0) return; // ffprobe missing/failed — skip, not fatal
  const durationSec = parseFloat(probe.stdout.toString().trim());
  if (!Number.isFinite(durationSec)) return;
  if (durationSec > maxDurationSec) {
    throw new Error(
      `Video berdurasi ${durationSec.toFixed(1)}s, melebihi batas ${maxDurationSec}s ` +
        `yang diizinkan untuk akun creator ini.`
    );
  }
}

const refreshToken = async () => {
  try {
        const refreshRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: TIKTOK_CLIENT_KEY,
            client_secret: TIKTOK_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: TIKTOK_REFRESH_TOKEN,
          }),
        });
        const data = await refreshRes.json();
        if (data.access_token) {
          console.log("✅ TikTok access token berhasil diperbarui.");
          console.log("TIKTOK_ACCESS_TOKEN=", data.access_token);
          console.log("TIKTOK_REFRESH_TOKEN=", data.refresh_token);
          return data.access_token;
        } else {
          console.error("❌ Gagal memperbarui TikTok access token:", data);
        }
      } catch (err) {
        console.error("❌ Gagal memperbarui TikTok access token:", err);
      }
      return null;
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
  let { TIKTOK_ACCESS_TOKEN, TIKTOK_REFRESH_TOKEN } = process.env;

  if (!TIKTOK_ACCESS_TOKEN && !TIKTOK_REFRESH_TOKEN) {
    throw new Error("Token kosong bro. Lo wajib login via browser (jalankan script auth) minimal sekali!");
  }

  const videoSize = fs.statSync(filePath).size;

  // const getAccessTokenFromreq = await getAccessToken();
  // Required before every Direct Post: pull the creator's *current*
  // constraints rather than trusting our own defaults.
  const creator = await getCreatorInfo(TIKTOK_ACCESS_TOKEN);
  console.log(`[tiktok] Creator info: ${JSON.stringify(creator)}`);

  checkDuration(filePath, creator.max_video_post_duration_sec);

  // Only use privacyLevel if it's actually one of this creator's real
  // options right now; otherwise fall back to the safest available one.
  const availableLevels = creator.privacy_level_options || ["SELF_ONLY"];
  const effectivePrivacyLevel = availableLevels.includes(privacyLevel)
    ? privacyLevel
    : availableLevels.includes("SELF_ONLY")
    ? "SELF_ONLY"
    : availableLevels[0];
  if (effectivePrivacyLevel !== privacyLevel) {
    console.warn(
      `[tiktok] privacyLevel "${privacyLevel}" tidak ada di opsi creator ini ` +
        `(tersedia: ${availableLevels.join(", ")}) — pakai "${effectivePrivacyLevel}".`
    );
  }

  console.log(`[tiktok] Uploading ${filePath} (${videoSize} bytes) with caption "${caption}" and privacy level "${effectivePrivacyLevel}"...`);

  const init = await tiktokFetch("/post/publish/video/init/", TIKTOK_ACCESS_TOKEN, {
    post_info: {
      title: caption,
      // privacy_level: effectivePrivacyLevel,
      privacy_level: "SELF_ONLY", // until audit passes, TikTok ignores this and forces SELF_ONLY
      // Mirror what the creator already has disabled account-side instead
      // of hardcoding false — sending disable_duet:false etc. when TikTok
      // already disabled it for this creator is exactly the mismatch
      // creator_info exists to prevent.
      // disable_duet: !!creator.duet_disabled,
      // disable_comment: !!creator.comment_disabled,
      // disable_stitch: !!creator.stitch_disabled,
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

  return {
    publishId: publish_id,
    status,
    creatorUsername: creator.creator_username,
    privacyLevel: effectivePrivacyLevel,
  };
}

module.exports = { uploadToTikTok, getCreatorInfo };