export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    if (!message) return res.status(400).json({ error: 'Mesaj boş.' });

    // AURA yerel hesaplayıcı: API kredisi gerektirmez.
    const q = message.toLocaleLowerCase('tr-TR').replace(/,/g, '.').replace(/[?？!！]/g, '').trim();
    const normalized = q
      .replace(/kaçtır|nedir|kaç$/i, '')
      .replace(/hesapla$/i, '')
      .trim();
    const math = normalized.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*([+\-*/x×÷])\s*(-?(?:\d+(?:\.\d+)?|\.\d+))$/i);
    if (math) {
      const a = Number(math[1]);
      const b = Number(math[3]);
      const op = math[2];
      let result;
      if (op === '+') result = a + b;
      else if (op === '-') result = a - b;
      else if (op === '*' || op.toLowerCase() === 'x' || op === '×') result = a * b;
      else if (op === '/') result = b === 0 ? null : a / b;
      else if (op === '÷') result = b === 0 ? null : a / b;
      if (result === null) return res.status(200).json({ answer: 'Sıfıra bölme yapılamaz.' });
      if (Number.isFinite(result)) return res.status(200).json({ answer: `Sonuç: ${result}` });
    }

    const wordMath = q.match(/^(-?\d+(?:\.\d+)?)\s+(?:ile)\s+(-?\d+(?:\.\d+)?)\s+(topla|çıkar|çıkart|çarp|böl)$/i);
    if (wordMath) {
      const a = Number(wordMath[1]);
      const b = Number(wordMath[2]);
      const action = wordMath[3].toLocaleLowerCase('tr-TR');
      if (action === 'topla') return res.status(200).json({ answer: `Sonuç: ${a + b}` });
      if (action === 'çıkar' || action === 'çıkart') return res.status(200).json({ answer: `Sonuç: ${a - b}` });
      if (action === 'çarp') return res.status(200).json({ answer: `Sonuç: ${a * b}` });
      if (action === 'böl') return res.status(200).json({ answer: b === 0 ? 'Sıfıra bölme yapılamaz.' : `Sonuç: ${a / b}` });
    }

    if (/^(saat kaç|şu an saat kaç)$/.test(q)) {
      return res.status(200).json({ answer: `Saat şu anda ${new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}.` });
    }
    if (/^(bugün hangi gün|bugün günlerden ne|tarih ne|bugünün tarihi)$/.test(q)) {
      return res.status(200).json({ answer: `Bugün ${new Date().toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}.` });
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ error: 'OPENAI_API_KEY eksik.' });

    const input = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({ role: m.role, content: String(m.content || '') }))
      .concat({ role: 'user', content: message });

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        instructions: 'Sen AURA adında Türkçe konuşan kişisel asistansın. Kısa, doğru ve faydalı cevap ver. Matematik işlemlerini dikkatlice hesapla.',
        input
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'AI servisi hata verdi.' });
    const text = data.output_text || (data.output || []).flatMap(x => x.content || []).map(x => x.text || '').join('') || 'Cevap alınamadı.';
    return res.status(200).json({ answer: text });
  } catch (e) {
    return res.status(500).json({ error: 'Sunucu hatası: ' + (e?.message || 'bilinmeyen hata') });
  }
}
