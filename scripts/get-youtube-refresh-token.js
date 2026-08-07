// One-time helper: obtains a YouTube OAuth refresh token to put in .env.
//
// 1. In Google Cloud Console: create OAuth 2.0 credentials of type
//    "Web application", add http://localhost:8991/oauth2callback as an
//    authorized redirect URI, and enable the YouTube Data API v3.
// 2. Put YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET in your .env.
// 3. Run: node scripts/get-youtube-refresh-token.js
// 4. Open the printed URL, sign in with the CHANNEL's Google account,
//    approve access. The script prints a refresh token — copy it into
//    YOUTUBE_REFRESH_TOKEN in .env. You only need to do this once.

require('dotenv').config();
const http = require('http');
const { google } = require('googleapis');

const PORT = 8991;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set YOUTUBE_CLIENT_ID dan YOUTUBE_CLIENT_SECRET dulu (di .env).');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token even if you've authorized before
  scope: ['https://www.googleapis.com/auth/youtube.upload'],
});

console.log('\nBuka URL ini di browser, login dengan akun channel yang mau dipakai:\n');
console.log(authUrl, '\n');

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.end();
    return;
  }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  res.end('Berhasil! Kamu boleh menutup tab ini dan kembali ke terminal.');
  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\nTempel baris berikut ke file .env kamu:\n');
    console.log('YOUTUBE_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
  } catch (err) {
    console.error('Gagal menukar code jadi token:', err.message);
  }
  process.exit(0);
});

server.listen(PORT);
