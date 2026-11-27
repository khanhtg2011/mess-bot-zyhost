const axios = require('axios');
const {
  GEMINI_API_KEYS,
  GEMINI_MODEL,
  GROQ_API_KEY,
  GROQ_MODEL,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
} = require('../config');

let geminiIdx = 0;

async function callGeminiWithKey(key, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const res = await axios.post(
    url,
    {
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
    },
    { timeout: 30000 }
  );
  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini không trả về nội dung.');
  return text.trim();
}

async function callOpenAICompatible(baseUrl, apiKey, model, textPrompt) {
  const res = await axios.post(
    `${baseUrl}/chat/completions`,
    {
      model,
      messages: [{ role: 'user', content: textPrompt }],
      max_tokens: 1024,
      temperature: 0.7,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );
  const text = res.data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('API không trả về nội dung.');
  return text.trim();
}

const META_SYSTEM_PROMPT = 'Bạn là trợ lý Messenger, trả lời ngắn gọn bằng tiếng Việt, thân thiện, tối đa 3-4 câu.';

async function callModelAPI(userText, history = []) {
  const apiKey = (process.env.MODEL_API_KEY || '').trim();
  if (!apiKey) {
    return 'Mình đang bận một chút, bạn nhắn lại giúp mình nhé.';
  }

  const formattedHistory = (history || []).slice(-10).map(m => {
    if (m.role && m.content) return { role: m.role, content: m.content };
    return { role: 'user', content: `${m.senderName || 'User'}: ${m.body || ''}` };
  });

  try {
    const res = await axios.post(
      'https://api.meta.ai/v1/chat/completions',
      {
        model: 'muse-spark-1.3',
        messages: [
          { role: 'system', content: META_SYSTEM_PROMPT },
          ...formattedHistory,
          { role: 'user', content: userText },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    const reply = res.data?.choices?.[0]?.message?.content;
    return reply ? reply.trim() : 'Mình đang bận một chút, bạn nhắn lại giúp mình nhé.';
  } catch (err) {
    console.error('[callModelAPI Error]', err.response?.data || err.message);
    return 'Mình đang bận một chút, bạn nhắn lại giúp mình nhé.';
  }
}

async function callAI(parts, hasImage = false) {
  const errors = [];

  // 1. Try all Gemini keys (round-robin + automatic failover)
  if (GEMINI_API_KEYS.length > 0) {
    for (let i = 0; i < GEMINI_API_KEYS.length; i++) {
      const idx = (geminiIdx + i) % GEMINI_API_KEYS.length;
      const key = GEMINI_API_KEYS[idx];
      try {
        const result = await callGeminiWithKey(key, parts);
        geminiIdx = (idx + 1) % GEMINI_API_KEYS.length;
        return result;
      } catch (err) {
        errors.push(`Gemini#${idx + 1}: ${err.response?.data?.error?.message || err.message}`);
      }
    }
  }

  // Fallback text-only providers
  const textPrompt = parts.find(p => p.text)?.text || '';
  if (!hasImage && textPrompt) {
    if (GROQ_API_KEY) {
      try {
        return await callOpenAICompatible('https://api.groq.com/openai/v1', GROQ_API_KEY, GROQ_MODEL, textPrompt);
      } catch (err) {
        errors.push(`Groq: ${err.response?.data?.error?.message || err.message}`);
      }
    }
    if (OPENAI_API_KEY) {
      try {
        return await callOpenAICompatible(OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL, textPrompt);
      } catch (err) {
        errors.push(`OpenAI/OR: ${err.response?.data?.error?.message || err.message}`);
      }
    }
  }

  if (errors.length === 0) {
    throw new Error('Chưa cấu hình API Key nào (GEMINI_API_KEYS, GROQ_API_KEY hoặc OPENAI_API_KEY) trong .env!');
  }
  throw new Error(errors.join(' | '));
}

async function handleAI(api, event, args) {
  const prompt = args.join(' ').trim();
  const replyAttachments = event.messageReply?.attachments || [];
  const imgAtt = replyAttachments.find(a => a.type === 'photo' || a.type === 'animated_image');

  if (!prompt && !imgAtt) {
    return api.sendMessage('💡 Dùng: /ai <câu hỏi> (hoặc reply vào ảnh kèm /ai <yêu cầu>)', event.threadID, event.messageID);
  }

  try {
    const parts = [];
    if (imgAtt && imgAtt.url) {
      const imgRes = await axios.get(imgAtt.url, { responseType: 'arraybuffer', timeout: 15000 });
      parts.push({
        inline_data: {
          mime_type: imgRes.headers['content-type'] || 'image/jpeg',
          data: Buffer.from(imgRes.data).toString('base64'),
        },
      });
    }
    parts.push({
      text: prompt || 'Hãy mô tả chi tiết hoặc dịch nội dung trong bức ảnh này sang tiếng Việt.',
    });

    const answer = await callAI(parts, Boolean(imgAtt));
    return api.sendMessage(`🤖 ${answer}`, event.threadID, event.messageID);
  } catch (err) {
    return api.sendMessage(`❌ Lỗi AI: ${err.message}`, event.threadID, event.messageID);
  }
}

async function handleSummary(api, event, messageHistory) {
  const history = messageHistory.get(event.threadID) || [];
  if (history.length < 5) {
    return api.sendMessage('📭 Chưa đủ tin nhắn gần đây để tóm tắt (cần ít nhất 5 tin).', event.threadID, event.messageID);
  }

  const lines = history.map(m => `${m.senderName}: ${m.body}`).join('\n');
  try {
    const summary = await callAI([
      {
        text: `Hãy tóm tắt ngắn gọn, súc tích bằng tiếng Việt các ý chính / drama / chủ đề đang bàn luận trong đoạn chat nhóm sau (gạch đầu dòng rõ ràng, tối đa 6 dòng):\n\n${lines}`,
      },
    ]);
    return api.sendMessage(`📝 **Tóm tắt ${history.length} tin nhắn gần nhất:**\n\n${summary}`, event.threadID, event.messageID);
  } catch (err) {
    return api.sendMessage(`❌ Lỗi tóm tắt: ${err.message}`, event.threadID, event.messageID);
  }
}

module.exports = { callModelAPI, handleAI, handleSummary };
