const assert = require('assert');
const fs = require('fs');
const path = require('path');
const OTPAuth = require('otpauth');

const { getThreadConfig, getUserCoins, addUserCoins } = require('../src/config');
const { TEMP_DIR, safeUnlink } = require('../src/utils/tempCleaner');
const { handleKick, handleTagAll, handleSplitTeam, handleChoose, handleToggleSetting, handleAutoReply } = require('../src/commands/group');
const { handleHelp, handleServerStatus } = require('../src/commands/utility');
const { handleWordChain, handleTaiXiu, handleCoins } = require('../src/commands/games');

function makeMockApi({ adminIds = ['admin_1'], botId = 'bot_0' } = {}) {
  const sent = [];
  const kicked = [];
  return {
    sent,
    kicked,
    getCurrentUserID: () => botId,
    getThreadInfo: async () => ({
      adminIDs: adminIds.map(id => ({ id })),
      participantIDs: ['admin_1', 'user_2', 'user_3', botId],
    }),
    sendMessage: (msg, threadID, cbOrMsgId) => {
      sent.push(typeof msg === 'string' ? msg : msg.body || '[attachment]');
      if (typeof cbOrMsgId === 'function') cbOrMsgId(null);
    },
    removeUserFromGroup: (uid, tid, cb) => {
      kicked.push(uid);
      if (cb) cb(null);
    },
  };
}

async function runTests() {
  console.log('=== RUNNING MESS-BOT-ZYHOST SMOKE TESTS ===');

  // 1. TOTP 2FA Generation
  const totp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32('JBSWY3DPEHPK3PXP') });
  const code = totp.generate();
  assert.match(code, /^\d{6}$/, '2FA TOTP should be 6 digits');
  console.log('[PASS] 2FA TOTP generation:', code);

  // 2. Admin-only permission enforcement
  const api = makeMockApi({ adminIds: ['admin_1'] });
  const nonAdminEvt = { threadID: 't1', messageID: 'm1', senderID: 'user_2', mentions: { user_3: '@u3' } };
  const adminEvt = { threadID: 't1', messageID: 'm2', senderID: 'admin_1', mentions: { user_3: '@u3' } };

  await handleKick(api, nonAdminEvt);
  assert(api.sent.at(-1).includes('⛔'), 'Non-admin /kick must be blocked');
  assert.strictEqual(api.kicked.length, 0);

  await handleTagAll(api, nonAdminEvt, ['hi']);
  assert(api.sent.at(-1).includes('⛔'), 'Non-admin /all must be blocked');

  await handleToggleSetting(api, nonAdminEvt, 'antispam', ['on']);
  assert(api.sent.at(-1).includes('⛔'), 'Non-admin /antispam must be blocked');

  await handleAutoReply(api, nonAdminEvt, ['add', 'hi', '|', 'hello']);
  assert(api.sent.at(-1).includes('⛔'), 'Non-admin /autoreply add must be blocked');

  await handleKick(api, adminEvt);
  assert.strictEqual(api.kicked[0], 'user_3', 'Group admin /kick must succeed');
  console.log('[PASS] Admin-only permissions (/kick, /all, /antispam, /autoreply)');

  // 3. Group utilities
  handleSplitTeam(api, nonAdminEvt, ['An,', 'Binh,', 'Chi,', 'Dung']);
  assert(api.sent.at(-1).includes('Team 1') && api.sent.at(-1).includes('Team 2'));
  handleChoose(api, nonAdminEvt, ['Pho,', 'Bun']);
  assert(api.sent.at(-1).includes('Bot chọn:'));
  console.log('[PASS] /chiateam & /chon');

  // 4. Games (/noitu, /tx, /diem)
  handleWordChain(api, nonAdminEvt, ['start']);
  assert(api.sent.at(-1).includes('NỐI TỪ BẮT ĐẦU'));
  handleTaiXiu(api, nonAdminEvt, ['tai', '100']);
  assert(api.sent.at(-1).includes('KẾT QUẢ:'));
  handleCoins(api, nonAdminEvt);
  assert(api.sent.at(-1).includes('Số dư của bạn:'));
  console.log('[PASS] Games (/noitu, /tx, /diem)');

  // 5. TempCleaner
  const tmpFile = path.join(TEMP_DIR, 'smoke_test.tmp');
  fs.writeFileSync(tmpFile, 'hello');
  safeUnlink(tmpFile);
  assert(!fs.existsSync(tmpFile), 'safeUnlink must delete temp file');
  console.log('[PASS] TempCleaner safeUnlink');

  // 6. Help & Server status
  handleHelp(api, nonAdminEvt);
  assert(api.sent.at(-1).includes('/kick'));
  await handleServerStatus(api, nonAdminEvt);
  assert(api.sent.at(-1).includes('TRẠNG THÁI HỆ THỐNG'));
  console.log('[PASS] /help & /sv');

  console.log('\nALL SMOKE TESTS PASSED!');
}

runTests().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
