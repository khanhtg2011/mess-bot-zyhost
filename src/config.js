const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultData = {
  threads: {},   // threadID -> { welcome: true, antispam: false, autoreply: { keyword: reply } }
  scores: {},    // userID -> { coins: 1000, name: '' }
};

function loadData() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...defaultData, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (err) {
    console.error('[Config] Failed to read settings.json:', err.message);
  }
  return JSON.parse(JSON.stringify(defaultData));
}

let store = loadData();

function saveData() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[Config] Failed to save settings.json:', err.message);
  }
}

function getThreadConfig(threadID) {
  if (!store.threads[threadID]) {
    store.threads[threadID] = { welcome: true, antispam: false, autoreply: {} };
    saveData();
  }
  return store.threads[threadID];
}

function getUserCoins(userID) {
  if (!store.scores[userID]) {
    store.scores[userID] = { coins: 1000 };
    saveData();
  }
  return store.scores[userID].coins;
}

function addUserCoins(userID, delta) {
  if (!store.scores[userID]) store.scores[userID] = { coins: 1000 };
  store.scores[userID].coins = Math.max(0, store.scores[userID].coins + delta);
  saveData();
  return store.scores[userID].coins;
}

const geminiKeysRaw = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
const GEMINI_API_KEYS = geminiKeysRaw
  .split(',')
  .map(s => s.trim())
  .filter(k => k && !k.includes('your_gemini'));

module.exports = {
  PREFIX: process.env.PREFIX || '/',
  FB_EMAIL: (process.env.FB_EMAIL || '').trim(),
  FB_PASSWORD: process.env.FB_PASSWORD || '',
  FB_2FA_SECRET: (process.env.FB_2FA_SECRET || '').replace(/\s+/g, '').trim(),
  GEMINI_API_KEYS,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  GROQ_API_KEY: (process.env.GROQ_API_KEY || '').trim(),
  GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  OPENAI_API_KEY: (process.env.OPENAI_API_KEY || '').trim(),
  OPENAI_BASE_URL: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  AUTO_DOWNLOAD: (process.env.AUTO_DOWNLOAD || 'true').toLowerCase() === 'true',
  HAVEN_URL: process.env.HAVEN_URL || 'https://haven.khanhs.io.vn',
  ADMIN_UIDS: (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean),
  getThreadConfig,
  saveData,
  getUserCoins,
  addUserCoins,
};
