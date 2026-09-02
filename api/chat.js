export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'AURA AI API', method: 'POST', version: '5.1' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-24) : [];
    if (!message) return res.status(400).json({ error: 'Mesaj boş.' });

    const q = message.toLocaleLowerCase('tr-TR').replace(/,/g, '.').replace(/[?？!！]/g, '').trim();
    const normalized = q.replace(/kaçtır|nedir|kaç$/i, '').replace(/hesapla$/i, '').trim();
    const math = normalized.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*([+\-*/x×÷])\s*(-?(?:\d+(?:\.\d+)?|\.\d+))$/i);
    if (math) {
      const a = Number(math[1]);
      const b = Number(math[3]);
      const op = math[2].toLowerCase();
      let result;
      if (op === '+') result = a + b;
      else if (op === '-') result = a - b;
      else if (op === '*' || op === 'x' || op === '×') result = a * b;
      else if (op === '/' || op === '÷') result = b === 0 ? null : a / b;
      if (result === null) return res.status(200).json({ answer: 'Sıfıra bölme yapılamaz.', mode: 'local-math' });
      if (Number.isFinite(result)) return res.status(200).json({ answer: `Sonuç: ${result}`, mode: 'local-math' });
    }

    const wordMath = q.match(/^(-?\d+(?:\.\d+)?)\s+ile\s+(-?\d+(?:\.\d+)?)\s+(topla|çıkar|çıkart|çarp|böl)$/i);
    if (wordMath) {
      const a = Number(wordMath[1]);
      const b = Number(wordMath[2]);
      const action = wordMath[3].toLocaleLowerCase('tr-TR');
      if (action === 'topla') return res.status(200).json({ answer: `Sonuç: ${a + b}`, mode: 'local-math' });
      if (action === 'çıkar' || action === 'çıkart') return res.status(200).json({ answer: `Sonuç: ${a - b}`, mode: 'local-math' });
      if (action === 'çarp') return res.status(200).json({ answer: `Sonuç: ${a * b}`, mode: 'local-math' });
      if (action === 'böl') return res.status(200).json({ answer: b === 0 ? 'Sıfıra bölme yapılamaz.' : `Sonuç: ${a / b}`, mode: 'local-math' });
    }

    if (/^(saat kaç|şu an saat kaç)$/.test(q)) {
      return res.status(200).json({ answer: `Saat şu anda ${new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}.`, mode: 'local' });
    }
    if (/^(bugün hangi gün|bugün günlerden ne|tarih ne|bugünün tarihi)$/.test(q)) {
      return res.status(200).json({ answer: `Bugün ${new Date().toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}.`, mode: 'local' });
    }

    // Sık kullanılan basit konuşmalar API çağrısını gerektirmez.
    if (/^(merhaba|selam|selamlar|hey|sa|mrb)$/.test(q)) {
      return res.status(200).json({ answer: 'Merhaba! AURA çevrimiçi. Sana nasıl yardımcı olabilirim?', mode: 'local-chat' });
    }
    if (/^(nasılsın|naber|nasıl gidiyor|iyi misin)$/.test(q)) {
      return res.status(200).json({ answer: 'İyiyim kanka, AURA hazır. Ne hakkında konuşalım?', mode: 'local-chat' });
    }
    if (/^(teşekkürler|teşekkür ederim|sağ ol|sağol)$/.test(q)) {
      return res.status(200).json({ answer: 'Rica ederim! AURA burada.', mode: 'local-chat' });
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ error: 'OPENAI_API_KEY eksik.' });

    const cleanHistory = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 12000) }));

    const input = cleanHistory.concat({ role: 'user', content: message });

    const instructions = `Sen AURA adlı gelişmiş, Türkçe konuşan kişisel yapay zeka asistanısın.
Kullanıcının niyetini doğru anlayıp mümkün olan en yararlı cevabı üret. Konu ne olursa olsun uygun uzmanlık yaklaşımını kendin seç.

Uzmanlık: genel bilgi, bilim, matematik, fizik, kimya, biyoloji, astronomi, tarih, coğrafya, kültür, dil, eğitim, programlama, yazılım, web geliştirme, yapay zeka, teknoloji, mantık, analiz, planlama, karşılaştırma, metin düzenleme, özetleme, proje geliştirme, oyun geliştirme ve teknik mimari.

Kurallar:
- Kullanıcının sorusuna doğrudan cevap ver.
- Basit soruları kısa, zor soruları gerektiğinde adım adım açıkla.
- Önceki konuşma bağlamını kullan.
- Güncel veya değişken bilgiler için web aramasını kullan.
- Web sonucuna dayanıyorsan kaynağa sadık kal.
- Bilmediğin şeyi uydurma; belirsizliği açıkça belirt.
- Kod verirken güvenli ve anlaşılır örnekler kullan.
- Matematiksel sonuçları kontrol et.
- Görevlerde uygulanabilir adımlar sun.
- Gereksiz tekrar ve dolgu cümlelerinden kaçın.
- Türkçe konuş.
- Güvenlik, gizlilik ve yetki sınırlarını koru.`;

    const r = await fetch('https://api.openai.com/v1/responses', {
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

    const raw = await r.text();
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: `OpenAI JSON döndürmedi (HTTP ${r.status}).` });
    }

    if (!r.ok) {
      return res.status(r.status).json({
        error: data?.error?.message || `OpenAI isteği başarısız (HTTP ${r.status}).`
      });
    }

    const text = data.output_text ||
      (data.output || [])
        .flatMap(x => x.content || [])
        .map(x => x.text || '')
        .join('') ||
      'Cevap alınamadı.';

    const usedWeb = Array.isArray(data.output) && data.output.some(x => x.type === 'web_search_call');
    return res.status(200).json({ answer: text, mode: 'ai', web: usedWeb });
  } catch (e) {
    return res.status(500).json({ error: 'Sunucu hatası: ' + (e?.message || 'bilinmeyen hata') });
  }
}
