const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '..', '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('[TempCleaner] Could not delete:', filePath, err.message);
  }
}

function sweepOldTempFiles(maxAgeMs = 5 * 60 * 1000) {
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(TEMP_DIR)) {
      if (file === '.gitkeep') continue;
      const fp = path.join(TEMP_DIR, file);
      const st = fs.statSync(fp);
      if (st.isFile() && now - st.mtimeMs > maxAgeMs) {
        safeUnlink(fp);
      }
    }
  } catch (err) {
    console.warn('[TempCleaner] Sweep error:', err.message);
  }
}

module.exports = { TEMP_DIR, safeUnlink, sweepOldTempFiles };
