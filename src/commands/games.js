const { getUserCoins, addUserCoins } = require('../config');

const wordChainGames = new Map(); // threadID -> { lastWord, used: Set }

const STARTER_WORDS = [
  'học hành', 'hạnh phúc', 'vui vẻ', 'máy tính', 'thành công',
  'bạn bè', 'yêu thương', 'cuộc sống', 'tự do', 'kỷ niệm',
];

function handleWordChain(api, event, args) {
  const input = args.join(' ').trim().toLowerCase();
  let game = wordChainGames.get(event.threadID);

  if (!input || input === 'start' || input === 'moi') {
    const startWord = STARTER_WORDS[Math.floor(Math.random() * STARTER_WORDS.length)];
    game = { lastWord: startWord, used: new Set([startWord]), streak: 0 };
    wordChainGames.set(event.threadID, game);
    return api.sendMessage(`🔤 **NỐI TỪ BẮT ĐẦU!**\nTừ mở đầu: **"${startWord}"**\nGõ \`/noitu <2 tiếng>\` để nối tiếp!`, event.threadID, event.messageID);
  }

  if (input === 'stop') {
    wordChainGames.delete(event.threadID);
    return api.sendMessage('🛑 Đã dừng ván nối từ.', event.threadID, event.messageID);
  }

  if (!game) {
    return api.sendMessage('💡 Chưa có ván nối từ nào. Gõ `/noitu start` để bắt đầu!', event.threadID, event.messageID);
  }

  const parts = input.split(/\s+/);
  if (parts.length !== 2) {
    return api.sendMessage('❌ Vui lòng nhập đúng **2 tiếng** (ví dụ: `/noitu hạnh phúc`).', event.threadID, event.messageID);
  }

  const expectedFirst = game.lastWord.split(/\s+/).pop();
  if (parts[0] !== expectedFirst) {
    return api.sendMessage(`❌ Sai rồi! Từ phải bắt đầu bằng **"${expectedFirst}"**.`, event.threadID, event.messageID);
  }

  if (game.used.has(input)) {
    return api.sendMessage(`⚠️ Từ **"${input}"** đã được dùng rồi!`, event.threadID, event.messageID);
  }

  game.used.add(input);
  game.lastWord = input;
  game.streak += 1;
  const nextTail = parts[1];
  const bonus = addUserCoins(event.senderID, 50);

  return api.sendMessage(
    `✅ Chuẩn! (+50 xu | Tổng: ${bonus} xu | Chuỗi: ${game.streak})\n👉 Từ tiếp theo bắt đầu bằng: **"${nextTail}"**`,
    event.threadID,
    event.messageID
  );
}

function handleTaiXiu(api, event, args) {
  const choice = (args[0] || '').toLowerCase();
  const rawBet = (args[1] || '').toLowerCase();
  const coins = getUserCoins(event.senderID);

  if (!['tai', 'tài', 'xiu', 'xỉu'].includes(choice)) {
    return api.sendMessage(`🎲 Dùng: /tx <tai|xiu> <tiền|all>\n💰 Số dư hiện tại: **${coins} xu**`, event.threadID, event.messageID);
  }

  const bet = rawBet === 'all' ? coins : parseInt(rawBet, 10);
  if (!bet || bet <= 0 || bet > coins) {
    return api.sendMessage(`❌ Tiền cược không hợp lệ! Bạn đang có **${coins} xu**.`, event.threadID, event.messageID);
  }

  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const d3 = Math.floor(Math.random() * 6) + 1;
  const sum = d1 + d2 + d3;
  const result = sum >= 11 ? 'tai' : 'xiu';
  const userPick = choice.startsWith('t') ? 'tai' : 'xiu';
  const won = userPick === result;

  const newBalance = addUserCoins(event.senderID, won ? bet : -bet);
  const icon = won ? '🎉 THẮNG' : '💀 THUA';

  return api.sendMessage(
    `🎲 **KẾT QUẢ:** [ ${d1} ] [ ${d2} ] [ ${d3} ] ➔ **${sum} (${result === 'tai' ? 'TÀI' : 'XỈU'})**\n${icon} **${bet} xu** | Số dư: **${newBalance} xu**`,
    event.threadID,
    event.messageID
  );
}

function handleCoins(api, event) {
  const coins = getUserCoins(event.senderID);
  return api.sendMessage(`💰 Số dư của bạn: **${coins} xu**`, event.threadID, event.messageID);
}

module.exports = { handleWordChain, handleTaiXiu, handleCoins };
