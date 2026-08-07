const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Setup direktori untuk menyimpan file upload sementara
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Setup direktori output
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// Konfigurasi Multer untuk upload file
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Beri nama unik agar tidak bentrok jika ada banyak request
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

// Serve folder 'public' sebagai static web (UI HTML kita)
app.use(express.static('public'));
app.use(express.json());

// Endpoint untuk menerima form dari UI
// Endpoint untuk menerima form dari UI
app.post('/api/generate-timelapse', upload.single('htmlFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'File HTML tidak ditemukan' });
    }

    const inputHtmlPath = req.file.path;
    
    // Ambil data dari FormData
    const { orientation, speed, noTypingSound, typingSoundVolume } = req.body;
    
    // 1. Base command (wajib ada --file)
    let command = `node cli.js --file "${inputHtmlPath}"`;

    // 2. Tambahkan opsional parameter jika ada isinya
    if (orientation && orientation !== 'both') {
        command += ` --orientation ${orientation}`;
    }
    
    if (speed) {
        command += ` --speed ${speed}`;
    }

    // 3. Logika untuk audio
    // Jika checkbox noTypingSound dicentang, nilainya akan dikirim sebagai "true"
    if (noTypingSound === 'true') {
        command += ` --no-typing-sound`;
    } else if (typingSoundVolume) {
        // Hanya tambahkan volume jika no-typing-sound TIDAK dicentang
        command += ` --typing-sound-volume ${typingSoundVolume}`;
    }

    console.log(`\n[INFO] Menjalankan perintah:`);
    console.log(`> ${command}\n`);

    // Jalankan cli.js
    exec(command, (error, stdout, stderr) => {
        // Hapus file HTML yang diupload (opsional, agar folder uploads tidak penuh)
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

// Jalankan server
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Web UI berjalan di: http://localhost:${PORT}`);
    console.log(`=========================================`);
});