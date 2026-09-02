export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'AURA AI API', method: 'POST', version: '6.0' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', method: req.method });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-24) : [];

    if (!message) return res.status(400).json({ error: 'Mesaj boş.' });

    // Keep common lightweight messages local to the function.
    const q = message.toLocaleLowerCase('tr-TR').trim();
    if (/^(merhaba|selam|selamlar|hey|sa|mrb)$/.test(q)) {
      return res.status(200).json({ answer: 'Merhaba! AURA çevrimiçi. Sana nasıl yardımcı olabilirim?', mode: 'local-chat' });
    }
    if (/^(nasılsın|naber|nasıl gidiyor|iyi misin)$/.test(q)) {
      return res.status(200).json({ answer: 'İyiyim kanka, AURA hazır. Ne hakkında konuşalım?', mode: 'local-chat' });
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ error: 'OPENAI_API_KEY eksik.' });

    const cleanHistory = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 12000) }));

    const instructions = `Sen AURA adlı gelişmiş, Türkçe konuşan kişisel yapay zeka asistanısın.
Kullanıcının sorusunu doğru anlayıp doğrudan ve yararlı cevap ver.
Genel bilgi, bilim, matematik, tarih, teknoloji, yapay zeka, programlama, web geliştirme, oyun geliştirme, analiz, planlama ve proje geliştirme konularında yardımcı ol.
Güncel veya değişken bilgiler gerektiğinde web aramasını kullan.
Bilmediğin şeyi uydurma; belirsizliği belirt. Türkçe konuş. Gereksiz tekrar yapma.`;

    const input = cleanHistory.concat({ role: 'user', content: message });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-5.6-sol',
        reasoning: { effort: 'high' },
        instructions,
        input,
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto'
      })
    });

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: `OpenAI JSON döndürmedi (HTTP ${response.status}).` });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || `OpenAI isteği başarısız (HTTP ${response.status}).`
      });
    }

    const answer = data.output_text ||
      (data.output || [])
        .flatMap(item => item.content || [])
        .map(item => item.text || '')
        .join('') ||
      'Cevap alınamadı.';

    return res.status(200).json({ answer, mode: 'ai' });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası: ' + (error?.message || 'bilinmeyen hata') });
  }
}
