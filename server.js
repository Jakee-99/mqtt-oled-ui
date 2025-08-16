// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(express.json());

// CORS: chỉ cho origin GitHub Pages của bạn
const allowed = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: allowed }));

function getClientIp(req){
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.connection.remoteAddress;
  if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip && ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  return ip;
}

async function sendMailWithMailgun(ip, userAgent){
  const domain = process.env.MG_DOMAIN;
  const apiKey = process.env.MG_API_KEY;
  if (!domain || !apiKey) throw new Error('Mailgun config missing');

  const url = `https://api.mailgun.net/v3/${domain}/messages`;
  const params = new URLSearchParams();
  params.append('from', process.env.EMAIL_FROM);
  params.append('to', process.env.EMAIL_TO);
  params.append('subject', `Visitor to site — IP ${ip}`);
  params.append('text', `Có người truy cập website của bạn.\nIP: ${ip}\nUser-Agent: ${userAgent}\nTime: ${new Date().toISOString()}`);

  const resp = await axios.post(url, params.toString(), {
    auth: { username: 'api', password: apiKey },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000
  });
  return resp.data;
}

app.post('/report', async (req, res) => {
  try {
    const ip = getClientIp(req) || 'unknown';
    const ua = req.get('User-Agent') || req.body.userAgent || 'unknown';

    // Optional: tránh gửi lại cho cùng 1 IP (basic in-memory cache) 
    // (lưu ý: redeploy sẽ reset cache; nếu cần vĩnh viễn, dùng DB)
    if (!app._sentIps) app._sentIps = new Set();
    if (app._sentIps.has(ip)) {
      return res.json({ ok: true, sent: false, reason: 'already_sent' });
    }

    await sendMailWithMailgun(ip, ua);
    app._sentIps.add(ip);
    return res.json({ ok: true, sent: true });
  } catch (err) {
    console.error('Send mail error:', err && (err.response?.data || err.message || err));
    // Nếu err.response.data có chi tiết (Mailgun trả lỗi), in ra logs, trả message ngắn
    return res.status(500).json({ ok: false, error: 'mail_failed', detail: err.response?.data || err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
