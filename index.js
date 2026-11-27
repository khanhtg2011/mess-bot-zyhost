const fs = require('fs');
const path = require('path');
const fca = require('ws3-fca');
const login = typeof fca === 'function' ? fca : (fca.login || fca.default);
const OTPAuth = require('otpauth');
const { PREFIX, AUTO_DOWNLOAD, FB_EMAIL, FB_PASSWORD, FB_2FA_SECRET, ALLOWED_THREAD_IDS, getThreadConfig, getUserPersona } = require('./src/config');
const { sweepOldTempFiles } = require('./src/utils/tempCleaner');

const { callModelAPI, handlePersona, handleAI, handleSummary } = require('./src/commands/ai');
const { handleDownload, handleTTS } = require('./src/commands/media');
const { handleTagAll, handleSplitTeam, handleChoose, handleToggleSetting, handleAutoReply } = require('./src/commands/group');
const { handleReminder, handleServerStatus, handleHelp } = require('./src/commands/utility');
const { handleWordChain, handleTaiXiu, handleCoins } = require('./src/commands/games');

const APPSTATE_PATH = path.join(__dirname, 'appstate.json');
const MAX_HISTORY = 150;
const messageHistory = new Map(); // threadID -> [{ senderName, body }]
const spamTracker = new Map();    // threadID:senderID -> [timestamps]
const userNameCache = new Map();  // userID -> name

// Periodic temp cleanup every 5 minutes (protects Zyhost 1GB disk)
sweepOldTempFiles();
setInterval(() => sweepOldTempFiles(), 5 * 60 * 1000);

process.on('unhandledRejection', err => console.error('[UnhandledRejection]', err));
process.on('uncaughtException', err => console.error('[UncaughtException]', err));

async function getSenderName(api, userID) {
  if (userNameCache.has(userID)) return userNameCache.get(userID);
  try {
    const info = await api.getUserInfo(userID);
    const name = info?.[userID]?.name || 'Thành viên';
    userNameCache.set(userID, name);
    return name;
  } catch {
    return 'Thành viên';
  }
}

function recordHistory(threadID, senderName, body) {
  if (!body || body.startsWith(PREFIX)) return;
  if (!messageHistory.has(threadID)) messageHistory.set(threadID, []);
  const arr = messageHistory.get(threadID);
  arr.push({ senderName, body: body.slice(0, 300) });
  if (arr.length > MAX_HISTORY) arr.shift();
}

function checkSpam(api, event) {
  const cfg = getThreadConfig(event.threadID);
  if (!cfg.antispam) return false;
  const key = `${event.threadID}:${event.senderID}`;
  const now = Date.now();
  const times = (spamTracker.get(key) || []).filter(t => now - t < 4000);
  times.push(now);
  spamTracker.set(key, times);

  if (times.length >= 5) {
    if (times.length === 5 || times.length % 4 === 0) {
      api.sendMessage('⚠️ Cảnh báo: Vui lòng không spam tin nhắn liên tục!', event.threadID, event.messageID);
    }
    return true;
  }
  return false;
}

function generate2FACode(secret) {
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.generate();
}

function performLogin(callback) {
  let credentials = null;
  if (fs.existsSync(APPSTATE_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(APPSTATE_PATH, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log('🍪 Đang đăng nhập bằng file cookie appstate.json...');
        credentials = { appState: parsed };
      }
    } catch (err) {
      console.warn('⚠️ File appstate.json lỗi định dạng:', err.message);
    }
  }

  if (!credentials) {
    if (!FB_EMAIL || !FB_PASSWORD) {
      console.error('❌ Thiếu appstate.json và cũng chưa cấu hình FB_EMAIL / FB_PASSWORD trong .env!');
      process.exit(1);
    }
    console.log(`🔑 Đang đăng nhập bằng Email/Mật khẩu (${FB_EMAIL})...`);
    credentials = { email: FB_EMAIL, password: FB_PASSWORD };
  }

  login(credentials, (err, api) => {
    if (err) {
      if (err.error === 'login-approval' && typeof err.continue === 'function') {
        if (!FB_2FA_SECRET) {
          console.error('❌ Tài khoản bật 2FA nhưng chưa điền FB_2FA_SECRET trong .env!');
          process.exit(1);
        }
        try {
          const code = generate2FACode(FB_2FA_SECRET);
          console.log('🔐 Đã tự động tạo mã 2FA 6 số, đang xác thực...');
          return err.continue(code);
        } catch (totpErr) {
          console.error('❌ FB_2FA_SECRET không hợp lệ:', totpErr.message);
          process.exit(1);
        }
      }

      // If appstate failed/expired and credentials are available, fallback once to email/pass
      if (credentials.appState && FB_EMAIL && FB_PASSWORD) {
        console.warn('⚠️ Cookie appstate.json hết hạn/lỗi, đang thử đăng nhập lại bằng Email/Pass + 2FA...');
        return login({ email: FB_EMAIL, password: FB_PASSWORD }, (err2, api2) => {
          if (err2?.error === 'login-approval' && typeof err2.continue === 'function' && FB_2FA_SECRET) {
            return err2.continue(generate2FACode(FB_2FA_SECRET));
          }
          return callback(err2, api2);
        });
      }

      return callback(err, null);
    }
    return callback(null, api);
  });
}

console.log('🚀 Đang khởi động Messenger Bot trên Zyhost...');

let isReconnecting = false;
let stopListener = null;

function isLogoutError(err) {
  const msg = String(err?.error || err?.message || err || '').toLowerCase();
  return msg.includes('not logged in') || msg.includes('unauthorized');
}

function scheduleReconnect(reason) {
  if (isReconnecting) return;
  isReconnecting = true;
  console.warn(`⚠️ Phát hiện mất phiên (${reason}). Tự động đăng nhập lại sau 30 giây...`);
  if (typeof stopListener === 'function') {
    try { stopListener(); } catch {}
    stopListener = null;
  }
  setTimeout(() => {
    isReconnecting = false;
    startBot();
  }, 30000);
}

function startBot() {
  performLogin((err, api) => {
    if (err || !api) {
      const errMsg = String(err?.error || err?.message || err || '');
      console.error('❌ Đăng nhập thất bại (hết hạn cookie hoặc bị checkpoint):', err);
      if (/wrong password|checkpoint/i.test(errMsg)) {
        console.error('🛑 Dừng tự động thử lại để tránh khóa tài khoản. Hãy kiểm tra lại FB_PASSWORD (bọc trong dấu "..." nếu có ký tự #) hoặc dùng file appstate.json!');
        process.exit(1);
      }
      if (FB_EMAIL && FB_PASSWORD) {
        return scheduleReconnect('login_failed');
      }
      process.exit(1);
    }

    try {
      fs.writeFileSync(APPSTATE_PATH, JSON.stringify(api.getAppState(), null, 2), 'utf8');
      console.log('💾 Đã lưu/cập nhật cookie mới vào appstate.json.');
    } catch (saveErr) {
      console.warn('⚠️ Không thể lưu appstate.json:', saveErr.message);
    }

    api.setOptions({
      listenEvents: true,
      selfListen: false,
      forceLogin: false,
      logLevel: 'silent',
    });

    const botID = api.getCurrentUserID();
    console.log(`✅ Bot đã online! UID: ${botID} | Prefix: "${PREFIX}"`);

    stopListener = api.listenMqtt(async (listenErr, event) => {
      if (listenErr) {
        if (isLogoutError(listenErr)) {
          return scheduleReconnect(listenErr.error || listenErr.message || 'logout');
        }
        return;
      }
      if (!event) return;

    try {
      // Only process events/messages from allowed thread IDs
      if (ALLOWED_THREAD_IDS.length > 0 && !ALLOWED_THREAD_IDS.includes(String(event.threadID))) {
        return;
      }

      // 1. Welcome / Goodbye events
      if (event.type === 'event') {
        const cfg = getThreadConfig(event.threadID);
        if (!cfg.welcome) return;

        if (event.logMessageType === 'log:subscribe') {
          const added = event.logMessageData?.addedParticipants || [];
          const names = added.map(p => p.fullName).filter(Boolean).join(', ');
          if (names) {
            api.sendMessage(`👋 Chào mừng **${names}** đã tham gia nhóm! Gõ \`${PREFIX}help\` để xem các lệnh của bot nhé.`, event.threadID);
          }
        } else if (event.logMessageType === 'log:unsubscribe') {
          const leftId = event.logMessageData?.leftParticipantFbId;
          if (leftId && leftId !== botID) {
            const name = await getSenderName(api, leftId);
            api.sendMessage(`👋 Tạm biệt **${name}** đã rời khỏi nhóm.`, event.threadID);
          }
        }
        return;
      }

      if (event.type !== 'message' && event.type !== 'message_reply') return;
      if (!event.body || event.senderID === botID) return;

      const body = event.body.trim();
      const senderName = await getSenderName(api, event.senderID);

      // Anti-spam check
      if (checkSpam(api, event)) return;

      // Save for /tomtat
      recordHistory(event.threadID, senderName, body);

      // 2. Command routing
      if (body.startsWith(PREFIX)) {
        const parts = body.slice(PREFIX.length).trim().split(/\s+/);
        const cmd = (parts[0] || '').toLowerCase();
        const args = parts.slice(1);

        switch (cmd) {
          case 'help':
          case 'menu':
            return handleHelp(api, event);
          case 'ai':
          case 'ask':
            return handleAI(api, event, args);
          case 'persona':
          case 'tinhcach':
            return handlePersona(api, event, args);
          case 'tomtat':
          case 'summary':
            return handleSummary(api, event, messageHistory);
          case 'tai':
          case 'dl':
            return handleDownload(api, event, args[0]);
          case 'tts':
          case 'noi':
            return handleTTS(api, event, args);
          case 'all':
          case 'everyone':
            return handleTagAll(api, event, args);
          case 'chiateam':
            return handleSplitTeam(api, event, args);
          case 'chon':
            return handleChoose(api, event, args);
          case 'welcome':
            return handleToggleSetting(api, event, 'welcome', args);
          case 'antispam':
            return handleToggleSetting(api, event, 'antispam', args);
          case 'autoreply':
            return handleAutoReply(api, event, args);
          case 'nhac':
            return handleReminder(api, event, args);
          case 'sv':
          case 'haven':
          case 'status':
            return handleServerStatus(api, event);
          case 'noitu':
            return handleWordChain(api, event, args);
          case 'tx':
          case 'taixiu':
            return handleTaiXiu(api, event, args);
          case 'diem':
          case 'xu':
            return handleCoins(api, event);
          default:
            return;
        }
      }

      // 3. Auto-detect TikTok / Reels / Shorts / SoundCloud links
      if (AUTO_DOWNLOAD) {
        const linkMatch = body.match(/https?:\/\/(?:vt\.tiktok\.com|vm\.tiktok\.com|www\.tiktok\.com|tiktok\.com|v\.douyin\.com|(?:www\.|m\.)?instagram\.com\/reels?|youtube\.com\/shorts|(?:www\.|m\.)?facebook\.com\/(?:reel|share\/r)|fb\.watch|(?:on\.)?soundcloud\.com)\S+/i);
        if (linkMatch) {
          return handleDownload(api, event, linkMatch[0]);
        }
      }

      // 4. Auto-reply keywords
      const cfg = getThreadConfig(event.threadID);
      const lowerBody = body.toLowerCase();
      for (const [kw, reply] of Object.entries(cfg.autoreply || {})) {
        if (lowerBody === kw || lowerBody.includes(kw)) {
          api.sendMessage(reply, event.threadID, event.messageID);
          return;
        }
      }

      // 5. Meta Model API auto-reply with per-user customizable system prompt & user name
      if (process.env.MODEL_API_KEY && process.env.MODEL_API_KEY.trim()) {
        const persona = getUserPersona(event.senderID);
        const replyText = await callModelAPI(body, messageHistory.get(event.threadID) || [], persona, senderName);
        api.sendMessage(replyText, event.threadID, event.messageID);
      }
    } catch (e) {
      console.error('[Listener Error]', e.message);
    }
    });
  });
}

startBot();
