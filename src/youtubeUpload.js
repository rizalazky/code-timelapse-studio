const fs = require("fs");
const { google } = require("googleapis");

/**
 * Uploads a local video file to YouTube via the Data API v3 (videos.insert
 * with a media body — the googleapis client handles the resumable-upload
 * protocol under the hood).
 *
 * Needs OAuth2 credentials for a channel you've already authorized once.
 * See SETUP-UPLOAD.md / scripts/get-youtube-refresh-token.js to obtain
 * YOUTUBE_REFRESH_TOKEN interactively — after that it's non-interactive.
 */
async function uploadToYouTube({
  filePath,
  title,
  description = "",
  tags = [],
  privacyStatus = "public", // "public" | "unlisted" | "private"
  categoryId = "22", // People & Blogs — change if a different category fits better
}) {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    throw new Error(
      "YouTube belum dikonfigurasi. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, dan " +
        "YOUTUBE_REFRESH_TOKEN di .env — lihat SETUP-UPLOAD.md."
    );
  }

  const oauth2Client = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description, tags, categoryId },
      status: { privacyStatus, selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(filePath) },
  });

  const videoId = res.data.id;
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
}

module.exports = { uploadToYouTube };
