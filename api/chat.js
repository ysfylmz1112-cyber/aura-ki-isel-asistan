export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    if (!message) return res.status(400).json({ error: 'Mesaj boş.' });

    // AURA'nın temel araçları API kredisi olmasa bile çalışır.
    const q = message.toLocaleLowerCase('tr-TR');
    const arithmetic = q.replace(/,/g, '.').match(/^(?:hesapla\s*)?(-?\d+(?:\.\d+)?)\s*([+\-*/x×])\s*(-?\d+(?:\.\d+)?)\s*[?]?$|^(-?\d+(?:\.\d+)?)\s*([+\-*/x×])\s*(-?\d+(?:\.\d+)?)\s*kaç\s*[?]?$/i);
    if (arithmetic) {
      const a = Number(arithmetic[1] ?? arithmetic[4]);
      const op = arithmetic[2] ?? arithmetic[5];
      const b = Number(arithmetic[3] ?? arithmetic[6]);
      let result;
      if (op === '+') result = a + b;
      else if (op === '-') result = a - b;
      else if (op === '*' || op === 'x' || op === '×') result = a * b;
      else if (op === '/') result = b === 0 ? null : a / b;
      if (result !== null && result !== undefined && Number.isFinite(result)) {
        return res.status(200).json({ answer: `Sonuç: ${result}` });
      }
      if (op === '/') return res.status(200).json({ answer: 'Sıfıra bölme yapılamaz.' });
    }

    if (/^(saat kaç|şu an saat kaç|saat kaç\?)$/.test(q)) {
      return res.status(200).json({ answer: `Saat şu anda ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}.` });
    }
    if (/^(bugün hangi gün|bugün günlerden ne|tarih ne|bugünün tarihi)[?]?$/.test(q)) {
      return res.status(200).json({ answer: `Bugün ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.` });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OPENAI_API_KEY eksik. Yerel AURA özellikleri çalışıyor.' });
    }

    const input = history
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
      .concat([{ role: 'user', content: message }]);

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        instructions: 'Sen AURA adında Türkçe konuşan, dostça, doğru ve faydalı cevaplar veren kişisel asistansın. Matematik sorularında işlemi dikkatlice hesapla. Kullanıcının önceki mesajlarını konuşma bağlamı olarak kullan. Gereksiz yere çok uzatma.',
        input
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'AI servisi hata verdi.' });
    const text = data.output_text || data.output?.flatMap(x => x.content || []).map(x => x.text || '').join('') || 'Cevap alınamadı.';
    return res.status(200).json({ answer: text });
  } catch (e) {
    return res.status(500).json({ error: 'Sunucu hatası: ' + (e?.message || 'bilinmeyen hata') });
  }
}
