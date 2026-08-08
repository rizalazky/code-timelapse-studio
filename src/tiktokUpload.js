const fs = require("fs");
const path = require("path");
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

async function getCreatorInfo(accessToken) {
  const res = await tiktokFetch("/post/publish/creator_info/query/", accessToken, {});
  return res.data;
}

function checkDuration(filePath, maxDurationSec) {
  if (!maxDurationSec) return;
  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  if (probe.status !== 0) return;
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
  const { TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN } = process.env;

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
    const tokenData = data.data || data;

    if (tokenData.access_token) {
      console.log("✅ TikTok access token berhasil diperbarui.");
      
      // Update di memori
      process.env.TIKTOK_ACCESS_TOKEN = tokenData.access_token;
      process.env.TIKTOK_REFRESH_TOKEN = tokenData.refresh_token;

      // Update permanen di file .env
      const envPath = path.join(__dirname, "..", ".env");
      if (fs.existsSync(envPath)) {
          let envFile = fs.readFileSync(envPath, "utf-8");
          envFile = envFile.replace(/TIKTOK_ACCESS_TOKEN=.*/, `TIKTOK_ACCESS_TOKEN=${tokenData.access_token}`);
          envFile = envFile.replace(/TIKTOK_REFRESH_TOKEN=.*/, `TIKTOK_REFRESH_TOKEN=${tokenData.refresh_token}`);
          fs.writeFileSync(envPath, envFile);
      }

      return tokenData.access_token;
    } else {
      console.error("❌ Gagal memperbarui TikTok access token:", data);
    }
  } catch (err) {
    console.error("❌ Gagal memperbarui TikTok access token:", err);
  }
  return null;
}

/**
 * Logika inti untuk upload (mendukung mode DIRECT dan INBOX)
 */
async function executeUpload(filePath, caption, privacyLevel, accessToken, mode) {
  const videoSize = fs.statSync(filePath).size;
  const isInbox = mode === "INBOX";

  let effectivePrivacyLevel = privacyLevel;
  let creator = null;

  // Jika DIRECT post, kita butuh cek creator info dan durasi
  if (!isInbox) {
      creator = await getCreatorInfo(accessToken);
      console.log(`[tiktok] Creator info: ${JSON.stringify(creator)}`);
      
      checkDuration(filePath, creator.max_video_post_duration_sec);

      const availableLevels = creator.privacy_level_options || ["SELF_ONLY"];
      effectivePrivacyLevel = availableLevels.includes(privacyLevel)
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
  }

  console.log(`[tiktok] Mengunggah ${filePath} (${videoSize} bytes) menggunakan mode ${mode}...`);

  // 1. Tentukan Endpoint & Payload berdasarkan mode
  const endpoint = isInbox 
    ? "/post/publish/inbox/video/init/" 
    : "/post/publish/video/init/";

  const requestBody = {
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: videoSize,
      total_chunk_count: 1,
    },
  };

  // post_info HANYA dikirim jika mode DIRECT
  if (!isInbox) {
    requestBody.post_info = {
      title: caption,
      privacy_level: "SELF_ONLY", // Set SELF_ONLY sampai lolos audit
      disable_duet: true, 
      disable_comment: true,
      disable_stitch: true,
    };
  }

  const init = await tiktokFetch(endpoint, accessToken, requestBody);
  const { publish_id, upload_url } = init.data;

  // 2. Upload file (PUT)
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

  // 3. Polling Status
  console.log("[tiktok] Memproses video di server TikTok...");
  let status = "PROCESSING_UPLOAD";
  for (let attempt = 0; attempt < 15 && status.includes("PROCESSING"); attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const check = await tiktokFetch("/post/publish/status/fetch/", accessToken, { publish_id });
    status = check.data.status;
    if (status === "FAILED") {
      throw new Error(`TikTok publish gagal: ${check.data.fail_reason || "unknown"}`);
    }
  }

  return {
    publishId: publish_id,
    status,
    mode,
    creatorUsername: creator ? creator.creator_username : "TBA (Inbox Mode)",
    privacyLevel: isInbox ? "SET_VIA_APP" : effectivePrivacyLevel,
  };
}

/**
 * Fungsi utama (Wrapper dengan logika auto-refresh dan pilihan mode)
 */
async function uploadToTikTok({ filePath, caption = "", privacyLevel = "SELF_ONLY", mode = "INBOX" }) {
  let { TIKTOK_ACCESS_TOKEN, TIKTOK_REFRESH_TOKEN } = process.env;

  if (!TIKTOK_ACCESS_TOKEN && !TIKTOK_REFRESH_TOKEN) {
    throw new Error("Token kosong bro. Lo wajib login via browser (jalankan script auth) minimal sekali!");
  }

  try {
    return await executeUpload(filePath, caption, privacyLevel, TIKTOK_ACCESS_TOKEN, mode);
  } catch (error) {
    const errorString = error.message.toLowerCase();
    const isAuthError = errorString.includes("unauthorized") || errorString.includes("token") || errorString.includes("access_token");

    if (isAuthError) {
      console.log("[tiktok] Token expired. Mencoba refresh token...");
      const newAccessToken = await refreshToken();
      if (!newAccessToken) {
          throw new Error("Refresh token gagal, silakan login ulang via browser.");
      }
      return await executeUpload(filePath, caption, privacyLevel, newAccessToken, mode);
    } else {
      throw new Error(`Error: ${error.message}`);
    }
  }
}

module.exports = { uploadToTikTok, getCreatorInfo };