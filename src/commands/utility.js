const axios = require('axios');
const { HAVEN_URL, PREFIX } = require('../config');

function parseDurationMs(str) {
  const m = /^(\d+)(s|m|h)$/i.exec((str || '').trim());
  if (!m) return null;
  const val = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === 's') return val * 1000;
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 3600 * 1000;
  return null;
}

function handleReminder(api, event, args) {
  const ms = parseDurationMs(args[0]);
  const note = args.slice(1).join(' ').trim();
  if (!ms || !note || ms > 24 * 3600 * 1000) {
    return api.sendMessage(`💡 Dùng: ${PREFIX}nhac <10s|5m|1h> <nội dung> (tối đa 24h)`, event.threadID, event.messageID);
  }

  api.sendMessage(`⏰ Đã đặt nhắc hẹn sau **${args[0]}**: "${note}"`, event.threadID, event.messageID);
  setTimeout(() => {
    api.sendMessage(
      {
        body: `🔔 **NHẮC HẸN:** ${note}`,
        mentions: [{ id: event.senderID, tag: '🔔', fromIndex: 0 }],
      },
      event.threadID
    );
  }, ms);
}

async function handleServerStatus(api, event) {
  const t0 = Date.now();
  let havenStatus = '🔴 Offline';
  try {
    const res = await axios.get(HAVEN_URL, { timeout: 6000, validateStatus: () => true });
    const ping = Date.now() - t0;
    havenStatus = `🟢 Online (${res.status} - ${ping}ms)`;
  } catch (err) {
    havenStatus = `🔴 Lỗi kết nối (${err.code || err.message})`;
  }

  const memMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  const upMins = Math.floor(process.uptime() / 60);

  return api.sendMessage(
    `📊 **TRẠNG THÁI HỆ THỐNG**\n• **Haven (${HAVEN_URL}):** ${havenStatus}\n• **Bot Zyhost RAM:** ${memMb} MB / 512 MB\n• **Uptime:** ${upMins} phút`,
    event.threadID,
    event.messageID
  );
}

function handleHelp(api, event) {
  const p = PREFIX;
  const msg = `🤖 **DANH SÁCH LỆNH BOT MESSENGER**
━━━━━━━━━━━━━━━━━━
🎬 **Media & AI:**
• ${p}tai <link> : Tải video TikTok/Reels/Shorts không logo
• ${p}tts <chữ> : Chuyển văn bản thành voice
• ${p}ai <câu hỏi> : Hỏi AI (hoặc reply ảnh để đọc/dịch)
• ${p}persona <tính cách> : Đổi tính cách AI riêng cho bạn (lay/nghiemtuc/ngotngao/wibu/reset)
• ${p}tomtat : Tóm tắt tin nhắn gần nhất

🛡️ **Quản trị nhóm (Chỉ QTV):**
• ${p}kick / ${p}ban : Kick thành viên (reply hoặc @tag)
• ${p}all [tin] : Tag tất cả thành viên
• ${p}welcome on/off : Bật/tắt chào mừng
• ${p}antispam on/off : Bật/tắt chống spam
• ${p}autoreply add/del/list : Cài trả lời tự động
• ${p}chiateam <tên1, tên2...> | ${p}chon <a, b, c>

🎮 **Tiện ích & Game:**
• ${p}nhac <10m> <nội dung> : Hẹn giờ nhắc
• ${p}sv : Kiểm tra trạng thái Haven & Bot
• ${p}noitu [từ] : Chơi nối từ tiếng Việt
• ${p}tx <tai|xiu> <tiền> | ${p}diem : Tài xỉu vui`;

  return api.sendMessage(msg, event.threadID, event.messageID);
}

module.exports = { handleReminder, handleServerStatus, handleHelp };
