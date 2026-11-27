const axios = require('axios');
const {
  GEMINI_API_KEYS,
  GEMINI_MODEL,
  GROQ_API_KEY,
  GROQ_MODEL,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  getUserPersona,
  setUserPersona,
} = require('../config');
const { isGroupOrBotAdmin } = require('./group');

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

const PERSONA_PRESETS = {
  lay: 'Bạn là đứa bạn thân lầy lội, hay cà khịa hài hước nhưng vẫn có tâm, trả lời tiếng Việt ngắn gọn 2-4 câu.',
  nghiemtuc: 'Bạn là trợ lý chuyên nghiệp, lịch sự, trả lời ngắn gọn, chính xác bằng tiếng Việt tối đa 3-4 câu.',
  ngotngao: 'Bạn là người bạn dễ thương, nói chuyện nhẹ nhàng, ấm áp và hay dùng emoji, tối đa 3-4 câu tiếng Việt.',
  wibu: 'Bạn là otaku/wibu chính hiệu, nói chuyện thân thiện pha chút văn phong anime đáng yêu, trả lời tiếng Việt 2-4 câu.',
};

async function callModelAPI(userText, history = [], systemPrompt = DEFAULT_SYSTEM_PROMPT, senderName = '') {
  const apiKey = (process.env.MODEL_API_KEY || '').trim();
  if (!apiKey) {
    return 'Mình đang bận một chút, bạn nhắn lại giúp mình nhé.';
  }

  const formattedHistory = (history || []).slice(-10).map(m => {
    if (m.role && m.content) return { role: m.role, content: m.content };
    return { role: 'user', content: `${m.senderName || 'User'}: ${m.body || ''}` };
  });

  const basePrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const fullSystemPrompt = senderName
    ? `${basePrompt}\nNgười đang nhắn với bạn tên là "${senderName}". Hãy xưng hô tự nhiên theo tên của họ.`
    : basePrompt;

  try {
    const res = await axios.post(
      'https://api.meta.ai/v1/chat/completions',
      {
        model: 'muse-spark-1.3',
        messages: [
          { role: 'system', content: fullSystemPrompt },
          ...formattedHistory,
          { role: 'user', content: senderName ? `${senderName}: ${userText}` : userText },
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

async function handlePersona(api, event, args) {
  const input = args.join(' ').trim();
  const replySender = event.messageReply?.senderID;
  let targetID = event.senderID;

  if (replySender && replySender !== event.senderID) {
    if (!(await isGroupOrBotAdmin(api, event))) {
      return api.sendMessage('⛔ Chỉ Quản trị viên mới được đổi tính cách AI cho người khác!', event.threadID, event.messageID);
    }
    targetID = replySender;
  }

  if (!input) {
    const current = getUserPersona(targetID);
    return api.sendMessage(
      `🎭 **Tính cách AI hiện tại:**\n"${current}"\n\n💡 **Đổi tính cách:**\n• /persona <mô tả tính cách bất kỳ>\n• Preset nhanh: /persona lay | nghiemtuc | ngotngao | wibu\n• Khôi phục mặc định: /persona reset`,
      event.threadID,
      event.messageID
    );
  }

  const lower = input.toLowerCase();
  if (lower === 'reset' || lower === 'default') {
    setUserPersona(targetID, null);
    return api.sendMessage('🔄 Đã khôi phục tính cách AI về mặc định.', event.threadID, event.messageID);
  }

  const chosen = PERSONA_PRESETS[lower] || input;
  setUserPersona(targetID, chosen);
  return api.sendMessage(`✅ Đã cập nhật tính cách AI:\n"${chosen}"`, event.threadID, event.messageID);
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

module.exports = { callModelAPI, handlePersona, handleAI, handleSummary };
