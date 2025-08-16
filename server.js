// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
app.use(express.json());

// CORS: cho phép domain GitHub Pages của bạn (hoặc '*')
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['POST','GET','OPTIONS']
}));

// DB (SQLite file)
const DB_PATH = process.env.DB_PATH || './visitors.db';
const db = new sqlite3.Database(DB_PATH);

// Tạo table nếu chưa có
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS visitors (
    ip TEXT PRIMARY KEY,
    first_seen TEXT,
    emailed INTEGER -- 0/1
  )`);
});

// Helper: lấy IP thực từ request (x-forwarded-for nếu qua proxy)
function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.connection.remoteAddress;
  // nếu có danh sách x-forwarded-for, lấy phần đầu (client thật)
  if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
  // chuyển '::ffff:1.2.3.4' -> '1.2.3.4'
  if (ip && ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  return ip;
}

// Nodemailer transport: cấu hình qua .env
function createTransporter() {
  // Nếu cung cấp SMTP_HOST & SMTP_PORT etc -> dùng custom transport
  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true', // true nếu 465
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  // Nếu dùng Gmail (app password) hoặc nodemailer default
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

const transporter = createTransporter();

// Endpoint: client gọi để "báo visitor" (POST /report)
app.post('/report', async (req, res) => {
  try {
    const ip = getClientIp(req) || 'unknown';
    const now = new Date().toISOString();

    // Kiểm tra DB: đã có IP chưa?
    db.get('SELECT ip, emailed FROM visitors WHERE ip = ?', [ip], (err, row) => {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ ok: false, error: 'db_error' });
      }

      if (row) {
        // Đã gửi trước đó
        return res.json({ ok: true, sent: false, reason: 'already_sent' });
      }

      // Chưa có -> gửi email
      const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: process.env.EMAIL_TO,
        subject: process.env.EMAIL_SUBJECT || `Visitor to your site — IP ${ip}`,
        text: `Có người truy cập website của bạn.\nIP: ${ip}\nThời gian: ${now}\nUser-Agent: ${req.get('User-Agent') || 'unknown'}`
      };

      transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
          console.error('Send mail error:', err);
          return res.status(500).json({ ok: false, error: 'mail_failed' });
        }

        // Ghi vào DB
        db.run('INSERT INTO visitors (ip, first_seen, emailed) VALUES (?, ?, ?)', [ip, now, 1], (dbErr) => {
          if (dbErr) {
            console.error('DB insert error:', dbErr);
            // mặc dù gửi mail thành công, nhưng DB lỗi — vẫn trả ok
            return res.json({ ok: true, sent: true, note: 'mail_sent_db_failed' });
          }
          return res.json({ ok: true, sent: true });
        });
      });
    });

  } catch (e) {
    console.error('Unexpected error:', e);
    res.status(500).json({ ok: false, error: 'unexpected' });
  }
});

// (Optional) health endpoint
app.get('/health', (req, res) => res.json({ ok: true }));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
