const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execFile } = require('child_process');
const googleTTS = require('google-tts-api');
const { TEMP_DIR, safeUnlink } = require('../utils/tempCleaner');

const MAX_MESSENGER_BYTES = 24 * 1024 * 1024; // 24MB limit

function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-y', '-i', inputPath, '-vcodec', 'libx264', '-crf', '28', '-preset', 'veryfast', '-acodec', 'aac', '-b:a', '96k', outputPath],
      { timeout: 60000 },
      err => (err ? reject(err) : resolve(outputPath))
    );
  });
}

async function resolveMediaUrl(url) {
  const isSoundCloud = /soundcloud\.com|on\.soundcloud\.com/i.test(url);

  // 1. TikTok / Douyin via TikWM
  if (/tiktok\.com|douyin\.com/i.test(url)) {
    const res = await axios.post('https://www.tikwm.com/api/', { url, hd: 1 }, { timeout: 15000 });
    const data = res.data?.data;
    if (data?.play) {
      return {
        mediaUrl: data.play.startsWith('http') ? data.play : `https://www.tikwm.com${data.play}`,
        title: data.title || 'TikTok Video',
        isAudio: false,
      };
    }
  }

  // 2. Fallback Cobalt API for Reels / Shorts / IG / SoundCloud
  const payload = isSoundCloud
    ? { url, downloadMode: 'audio', audioFormat: 'mp3' }
    : { url, videoQuality: '720' };

  const cb = await axios.post('https://api.cobalt.tools/', payload, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  if (cb.data?.url) {
    return {
      mediaUrl: cb.data.url,
      title: isSoundCloud ? 'SoundCloud Audio' : 'Video',
      isAudio: isSoundCloud,
    };
  }
  throw new Error('Không lấy được link tải trực tiếp.');
}

async function handleDownload(api, event, rawUrl) {
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
    return api.sendMessage('💡 Dùng: /tai <link TikTok / Reels / SoundCloud>', event.threadID, event.messageID);
  }

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  let rawFile = '';
  let compFile = '';

  try {
    const { mediaUrl, title, isAudio } = await resolveMediaUrl(rawUrl);
    const ext = isAudio ? 'mp3' : 'mp4';
    rawFile = path.join(TEMP_DIR, `media_${stamp}.${ext}`);
    compFile = path.join(TEMP_DIR, `media_${stamp}_cmp.mp4`);
    let fileToSend = rawFile;

    const resp = await axios.get(mediaUrl, { responseType: 'stream', timeout: 30000 });
    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(rawFile);
      resp.data.pipe(w);
      w.on('finish', resolve);
      w.on('error', reject);
    });

    const stat = fs.statSync(rawFile);
    if (!isAudio && stat.size > MAX_MESSENGER_BYTES) {
      await compressVideo(rawFile, compFile);
      safeUnlink(rawFile);
      fileToSend = compFile;
    }

    await new Promise((resolve, reject) => {
      api.sendMessage(
        {
          body: `${isAudio ? '🎵' : '🎬'} ${title.slice(0, 120)}`,
          attachment: fs.createReadStream(fileToSend),
        },
        event.threadID,
        err => (err ? reject(err) : resolve()),
        event.messageID
      );
    });
  } catch (err) {
    api.sendMessage(`❌ Không tải được media: ${err.message}`, event.threadID, event.messageID);
  } finally {
    safeUnlink(rawFile);
    safeUnlink(compFile);
  }
}

async function handleTTS(api, event, args) {
  const text = args.join(' ').trim();
  if (!text) {
    return api.sendMessage('💡 Dùng: /tts <nội dung cần đọc>', event.threadID, event.messageID);
  }

  const audioFile = path.join(TEMP_DIR, `tts_${Date.now()}.mp3`);
  try {
    const url = googleTTS.getAudioUrl(text.slice(0, 200), { lang: 'vi', slow: false });
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    fs.writeFileSync(audioFile, Buffer.from(res.data));

    await new Promise((resolve, reject) => {
      api.sendMessage(
        { attachment: fs.createReadStream(audioFile) },
        event.threadID,
        err => (err ? reject(err) : resolve()),
        event.messageID
      );
    });
  } catch (err) {
    api.sendMessage(`❌ Lỗi TTS: ${err.message}`, event.threadID, event.messageID);
  } finally {
    safeUnlink(audioFile);
  }
}

module.exports = { handleDownload, handleTTS };
