const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { readSheet, findNextPending, markDone } = require('./src/spreadsheet');
const { generateFromCode } = require('./src/generateFromCode');
const { uploadToYouTube } = require('./src/youtubeUpload');
const { uploadToTikTok } = require('./src/tiktokUpload');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup direktori untuk menyimpan file upload sementara
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Setup direktori output
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// Lokasi spreadsheet (CSV) untuk fitur baru — ganti via env SPREADSHEET_PATH
// kalau lokasinya beda.
const SPREADSHEET_PATH = process.env.SPREADSHEET_PATH || path.join(__dirname, 'data', 'animations.csv');
const CODE_COLUMN = 'Kode HTML (full, siap dipakai)';

// Konfigurasi Multer untuk upload file
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

// Serve folder 'public' sebagai static web (UI HTML kita)
app.use(express.static('public'));
// Biar video hasil generate bisa di-<video> / didownload langsung dari browser
app.use('/output', express.static(outputDir));
app.use(express.json());

// =====================================================================
// FLOW LAMA: upload file .html manual lewat form
// =====================================================================
app.post('/api/generate-timelapse', upload.single('htmlFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'File HTML tidak ditemukan' });
    }

    const inputHtmlPath = req.file.path;
    const { orientation, speed, previewSeconds, noTypingSound, typingSoundVolume } = req.body;

    let command = `node cli.js --file "${inputHtmlPath}"`;
    if (orientation && orientation !== 'both') command += ` --orientation ${orientation}`;
    if (speed) command += ` --speed ${speed}`;
    if (previewSeconds) command += ` --preview-seconds ${previewSeconds}`;
    if (noTypingSound === 'true') {
      command += ` --no-typing-sound`;
    } else if (typingSoundVolume) {
      command += ` --typing-sound-volume ${typingSoundVolume}`;
    }

    console.log(`\n[INFO] Menjalankan perintah:`);
    console.log(`> ${command}\n`);

    exec(command, (error, stdout, stderr) => {
        if (fs.existsSync(inputHtmlPath)) fs.unlinkSync(inputHtmlPath);

        if (error) {
            console.error(`[ERROR] Eksekusi gagal:`, stderr);
            return res.status(500).json({
                success: false,
                error: stderr || 'Terjadi kesalahan saat mengeksekusi script CLI'
            });
        }

        console.log(`[SUCCESS] Output dari CLI:`);
        console.log(stdout);

        res.json({
            success: true,
            message: 'Render selesai dieksekusi oleh sistem',
        });
    });
});

// =====================================================================
// FLOW BARU: generate dari spreadsheet + upload ke YouTube/TikTok
// =====================================================================

// Baris berikutnya yang STATUS-nya belum "done" (kosong dihitung belum
// selesai juga). Tidak mengirim kolom kode HTML — cukup buat preview.
app.get('/api/spreadsheet/next', (req, res) => {
  try {
    if (!fs.existsSync(SPREADSHEET_PATH)) {
      return res.status(404).json({ error: `Spreadsheet tidak ditemukan di ${SPREADSHEET_PATH}` });
    }
    const { records } = readSheet(SPREADSHEET_PATH);
    const next = findNextPending(records);
    if (!next) return res.json({ done: true });

    res.json({
      done: false,
      no: next.No,
      name: next['Nama Animasi'],
      caption: next.Caption,
      tags: next.Tags,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate video (vertical/horizontal/both) dari kode HTML baris `no`.
app.post('/api/spreadsheet/generate', async (req, res) => {
  try {
    const {
      no,
      orientation = 'vertical',
      speed = 4,
      previewSeconds = 3,
      typingSound = true,
      typingSoundVolume = 0.5,
    } = req.body;

    if (!no) return res.status(400).json({ error: 'no wajib diisi' });

    const { records } = readSheet(SPREADSHEET_PATH);
    const record = records.find((r) => String(r.No) === String(no));
    if (!record) return res.status(404).json({ error: `Baris No=${no} tidak ditemukan` });

    const code = record[CODE_COLUMN];
    if (!code || !code.trim()) {
      return res.status(400).json({ error: 'Kolom kode HTML kosong untuk baris ini' });
    }

    const rowOutDir = path.join(outputDir, 'spreadsheet', String(no));
    const results = await generateFromCode({
      code,
      orientation,
      outDir: rowOutDir,
      baseName: `timelapse-${no}`,
      speed: Number(speed),
      previewSeconds: Number(previewSeconds),
      typingSound: typingSound !== false,
      typingSoundVolume: Number(typingSoundVolume),
    });

    const videos = {};
    for (const [o, filePath] of Object.entries(results)) {
      videos[o] = '/output/' + path.relative(outputDir, filePath).split(path.sep).join('/');
    }

    res.json({
      success: true,
      no: record.No,
      name: record['Nama Animasi'],
      caption: record.Caption,
      tags: record.Tags,
      videos,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Upload video yang sudah di-generate ke YouTube atau TikTok, lalu tandai
// baris spreadsheet terkait sebagai "done".
app.post('/api/spreadsheet/upload', async (req, res) => {
  try {
    const { no, platform, videoUrl, title, description, tags, privacy } = req.body;
    if (!no || !platform || !videoUrl) {
      return res.status(400).json({ error: 'no, platform, dan videoUrl wajib diisi' });
    }

    // videoUrl contoh: "/output/spreadsheet/12/timelapse-12-vertical.mp4"
    const relative = videoUrl.replace(/^\/output\//, '');
    const filePath = path.join(outputDir, relative);
    if (!filePath.startsWith(outputDir)) {
      return res.status(400).json({ error: 'videoUrl tidak valid' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File video tidak ditemukan — generate ulang dulu' });
    }

    let result;
    if (platform === 'youtube') {
      result = await uploadToYouTube({
        filePath,
        title: title || `Video ${no}`,
        description: description || '',
        tags: (tags || '').split(/[,#]/).map((t) => t.trim()).filter(Boolean),
        privacyStatus: privacy || 'public',
      });
    } else if (platform === 'tiktok') {
      result = await uploadToTikTok({
        filePath,
        caption: description || title || '',
        privacyLevel: privacy || 'SELF_ONLY',
      });
    } else {
      return res.status(400).json({ error: `platform tidak dikenal: ${platform}` });
    }

    // Hanya tandai selesai SETELAH upload benar-benar berhasil.
    markDone(SPREADSHEET_PATH, no);

    res.json({ success: true, platform, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 Web UI berjalan di: http://localhost:${PORT}`);
  console.log(`📄 Spreadsheet flow di: http://localhost:${PORT}/spreadsheet.html`);
  console.log(`📄 Spreadsheet path: ${SPREADSHEET_PATH}`);
  console.log(`=========================================`);
});
