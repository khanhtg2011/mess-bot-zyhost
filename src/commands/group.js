const { ADMIN_UIDS, getThreadConfig, saveData } = require('../config');

async function isGroupOrBotAdmin(api, event) {
  if (ADMIN_UIDS.includes(String(event.senderID))) return true;
  try {
    const info = await api.getThreadInfo(event.threadID);
    const admins = info?.adminIDs || [];
    return admins.some(a => String(a.id || a) === String(event.senderID));
  } catch {
    return false;
  }
}

async function handleTagAll(api, event, args) {
  if (!(await isGroupOrBotAdmin(api, event))) {
    return api.sendMessage('⛔ Chỉ Quản trị viên nhóm hoặc Admin bot mới được dùng lệnh /all!', event.threadID, event.messageID);
  }
  try {
    const info = await api.getThreadInfo(event.threadID);
    const botID = api.getCurrentUserID();
    const listUserID = (info.participantIDs || []).filter(id => id !== botID && id !== event.senderID);
    const body = args.length > 0 ? args.join(' ') : '📢 Thông báo tới toàn bộ thành viên!';

    const mentions = listUserID.map(id => ({ id, tag: body, fromIndex: 0 }));
    return api.sendMessage({ body, mentions }, event.threadID, event.messageID);
  } catch (err) {
    return api.sendMessage(`❌ Lỗi tag all: ${err.message}`, event.threadID, event.messageID);
  }
}

function handleSplitTeam(api, event, args) {
  const input = args.join(' ').trim();
  const names = input.split(/[,|\n]+/).map(s => s.trim()).filter(Boolean);
  if (names.length < 2) {
    return api.sendMessage('💡 Dùng: /chiateam <tên1, tên2, tên3, tên4...>', event.threadID, event.messageID);
  }
  const shuffled = [...names].sort(() => Math.random() - 0.5);
  const mid = Math.ceil(shuffled.length / 2);
  const teamA = shuffled.slice(0, mid);
  const teamB = shuffled.slice(mid);

  return api.sendMessage(
    `⚔️ **CHIA TEAM NGẪU NHIÊN**\n\n🔵 **Team 1:** ${teamA.join(', ')}\n🔴 **Team 2:** ${teamB.join(', ')}`,
    event.threadID,
    event.messageID
  );
}

function handleChoose(api, event, args) {
  const input = args.join(' ').trim();
  const choices = input.split(/[,|\n]+/).map(s => s.trim()).filter(Boolean);
  if (choices.length < 2) {
    return api.sendMessage('💡 Dùng: /chon <lựa chọn 1, lựa chọn 2, ...>', event.threadID, event.messageID);
  }
  const pick = choices[Math.floor(Math.random() * choices.length)];
  return api.sendMessage(`🎯 Bot chọn: **${pick}**`, event.threadID, event.messageID);
}

async function handleToggleSetting(api, event, key, args) {
  if (!(await isGroupOrBotAdmin(api, event))) {
    return api.sendMessage(`⛔ Chỉ Quản trị viên nhóm hoặc Admin bot mới được chỉnh /${key}!`, event.threadID, event.messageID);
  }
  const cfg = getThreadConfig(event.threadID);
  const mode = (args[0] || '').toLowerCase();
  if (mode !== 'on' && mode !== 'off') {
    return api.sendMessage(`⚙️ Trạng thái ${key}: **${cfg[key] ? 'BẬT' : 'TẮT'}**\nDùng: /${key} on | off`, event.threadID, event.messageID);
  }
  cfg[key] = mode === 'on';
  saveData();
  return api.sendMessage(`✅ Đã **${cfg[key] ? 'BẬT' : 'TẮT'}** tính năng ${key} cho nhóm này.`, event.threadID, event.messageID);
}

async function handleAutoReply(api, event, args) {
  const cfg = getThreadConfig(event.threadID);
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'add' || sub === 'del') {
    if (!(await isGroupOrBotAdmin(api, event))) {
      return api.sendMessage('⛔ Chỉ Quản trị viên nhóm hoặc Admin bot mới được thêm/xóa auto-reply!', event.threadID, event.messageID);
    }
  }

  if (sub === 'list') {
    const keys = Object.keys(cfg.autoreply || {});
    if (keys.length === 0) return api.sendMessage('📭 Nhóm chưa cài auto-reply nào.', event.threadID, event.messageID);
    const list = keys.map((k, i) => `${i + 1}. "${k}" ➔ ${cfg.autoreply[k]}`).join('\n');
    return api.sendMessage(`📋 **Danh sách Auto-Reply:**\n${list}`, event.threadID, event.messageID);
  }

  if (sub === 'del' && args[1]) {
    const key = args.slice(1).join(' ').toLowerCase();
    delete cfg.autoreply[key];
    saveData();
    return api.sendMessage(`🗑️ Đã xóa từ khóa "${key}".`, event.threadID, event.messageID);
  }

  if (sub === 'add') {
    const rest = args.slice(1).join(' ');
    const parts = rest.split('|');
    if (parts.length < 2) {
      return api.sendMessage('💡 Dùng: /autoreply add <từ khóa> | <câu trả lời>', event.threadID, event.messageID);
    }
    const key = parts[0].trim().toLowerCase();
    const val = parts.slice(1).join('|').trim();
    cfg.autoreply[key] = val;
    saveData();
    return api.sendMessage(`✅ Đã thêm auto-reply: "${key}" ➔ "${val}"`, event.threadID, event.messageID);
  }

  return api.sendMessage('💡 Dùng:\n• /autoreply add <từ khóa> | <nội dung>\n• /autoreply del <từ khóa>\n• /autoreply list', event.threadID, event.messageID);
}

module.exports = { isGroupOrBotAdmin, handleTagAll, handleSplitTeam, handleChoose, handleToggleSetting, handleAutoReply };
