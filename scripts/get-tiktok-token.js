// scripts/get-tiktok-token.js
const http = require("http");
const url = require("url");
require("dotenv").config();

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const PORT = 3100;
const REDIRECT_URI = `https://t9jrjcw7-3100.asse.devtunnels.ms/callback`;

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error("❌ Harap set TIKTOK_CLIENT_KEY dan TIKTOK_CLIENT_SECRET di file .env Anda!");
  process.exit(1);
}

const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${CLIENT_KEY}&scope=user.info.basic,video.publish&response_type=code&redirect_uri=${encodeURIComponent(
  REDIRECT_URI
)}&state=code_timelapse_studio`;

const server = http.createServer(async (req, res) => {
  const reqUrl = url.parse(req.url, true);

  if (reqUrl.pathname === "/callback") {
    const code = reqUrl.query.code;

    if (!code) {
      res.end("Gagal mendapatkan code dari TikTok.");
      return;
    }

    try {
      // Exchange code untuk token
      const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: CLIENT_KEY,
          client_secret: CLIENT_SECRET,
          code: code,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI,
        }),
      });

      const data = await tokenRes.json();

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Berhasil!</h1><p>Silakan cek terminal Anda untuk melihat token.</p>");

      console.log("\n================ TIKTOK TOKENS ================");
      console.log("TIKTOK_ACCESS_TOKEN=", data.access_token);
      console.log("TIKTOK_REFRESH_TOKEN=", data.refresh_token);
      console.log("================================================\n");
      console.log("Salin TIKTOK_ACCESS_TOKEN di atas ke file .env Anda.");

      server.close();
    } catch (err) {
      res.end(`Error: ${err.message}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n1. Buka URL ini di browser untuk izinkan aplikasi:\n${authUrl}\n`);
  console.log(`2. Menunggu callback di ${REDIRECT_URI}...`);
});