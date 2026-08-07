# Setup: generate dari spreadsheet + upload ke YouTube/TikTok

## 1. File & folder baru

```
src/spreadsheet.js         # baca/tulis CSV (parser tahan koma/quote di dalam sel)
src/generateFromCode.js    # generate video dari string kode (bukan file upload)
src/youtubeUpload.js       # upload ke YouTube (Data API v3)
src/tiktokUpload.js        # upload ke TikTok (Content Posting API)
public/spreadsheet.html    # halaman baru: /spreadsheet.html
scripts/get-youtube-refresh-token.js
data/animations.csv        # contoh format — GANTI dengan export spreadsheet kamu
.env.example
```

`server.js` sudah di-update: route lama (`/api/generate-timelapse`) tetap ada,
ditambah 3 route baru (`/api/spreadsheet/next`, `/generate`, `/upload`), dan
`/output` di-serve statis supaya video bisa langsung diputar/di-preview di
browser.

## 2. Install dependency baru

```bash
npm install googleapis dotenv
```

(`fetch` dipakai untuk TikTok — sudah built-in di Node 18+, dan repo ini
sudah mensyaratkan Node ≥20 lewat playwright, jadi aman.)

## 3. Siapkan spreadsheet-nya

Export spreadsheet kamu (Google Sheets: File → Download → CSV) dan simpan
sebagai `data/animations.csv`, dengan header persis:

```
No,Nama Animasi,Caption,Tags,"Kode HTML (full, siap dipakai)",STATUS
```

Baris dengan `STATUS` kosong ATAU bukan `done` dianggap belum selesai.
`/api/spreadsheet/next` selalu mengambil baris pertama yang belum selesai
(top-down), sesuai yang diminta. Path bisa diganti lewat `SPREADSHEET_PATH`
di `.env` kalau nggak mau di `data/animations.csv`.

## 4. Kredensial YouTube

1. Buka [Google Cloud Console](https://console.cloud.google.com/), buat
   project, lalu **aktifkan "YouTube Data API v3"**.
2. Buat OAuth 2.0 credentials tipe **Web application**, tambahkan redirect
   URI `http://localhost:8991/oauth2callback`.
3. Salin `.env.example` jadi `.env`, isi `YOUTUBE_CLIENT_ID` dan
   `YOUTUBE_CLIENT_SECRET`.
4. Jalankan sekali: `node scripts/get-youtube-refresh-token.js` — buka URL
   yang muncul, login dengan akun channel yang mau dipakai, lalu tempel
   `YOUTUBE_REFRESH_TOKEN` yang dicetak ke `.env`. Cukup sekali, tokennya
   nggak expired kecuali kamu revoke akses.
5. Selama app kamu belum lolos verifikasi Google (butuh proses review),
   channel lain di luar daftar test user OAuth consent screen kamu nggak
   akan bisa dipakai — tapi channel kamu sendiri bisa langsung dipakai
   sebagai test user.

Kuota default 10.000 unit/hari, upload video makan ~1.600 unit → sekitar
6 upload/hari kalau nggak minta kuota tambahan.

## 5. Kredensial TikTok

1. Daftar app di [developers.tiktok.com](https://developers.tiktok.com/),
   aktifkan produk **Content Posting API**.
2. Dapatkan access token (lewat OAuth flow TikTok) dengan scope
   `video.publish` untuk akun target, isi `TIKTOK_ACCESS_TOKEN` di `.env`.
3. **Penting**: sampai app kamu lolos audit TikTok, semua post otomatis
   jadi private (`SELF_ONLY`) — ini pembatasan dari TikTok sendiri, bukan
   bug di kode ini. Setelah lolos audit, kamu bisa pilih privacy level lain
   dari UI-nya.

## 6. Jalankan

```bash
node server.js
```

Buka `http://localhost:3000/spreadsheet.html` — halaman ini otomatis
mengambil baris berikutnya yang belum "done", tombol **Generate Video**
merender via pipeline yang sama dengan flow upload manual, lalu setelah
videonya siap muncul tombol **Upload ke YouTube** / **Upload ke TikTok**.
Begitu upload sukses, baris terkait langsung ditandai `done` di
`data/animations.csv` (atau path lain sesuai `SPREADSHEET_PATH`).
