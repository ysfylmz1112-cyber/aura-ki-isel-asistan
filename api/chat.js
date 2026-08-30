export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY eksik. Vercel Environment Variables ayarını kontrol et.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    if (!message) return res.status(400).json({ error: 'Mesaj boş.' });
    const input = history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })).concat([{ role: 'user', content: message }]);
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', instructions: 'Sen AURA adında Türkçe konuşan, kısa ama faydalı cevaplar veren kişisel asistansın. Kullanıcıya dostça ve anlaşılır konuş.', input })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'AI servisi hata verdi.' });
    const text = data.output_text || data.output?.flatMap(x => x.content || []).map(x => x.text || '').join('') || 'Cevap alınamadı.';
    return res.status(200).json({ answer: text });
  } catch (e) {
    return res.status(500).json({ error: 'Sunucu hatası: ' + (e?.message || 'bilinmeyen hata') });
  }
}
