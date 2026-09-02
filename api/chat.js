export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'AURA AI API', method: 'POST', version: '4.0' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-20) : [];
    if (!message) return res.status(400).json({ error: 'Mesaj boş.' });

    // Yerel matematik: basit işlemler için internet/API gerekmez.
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

    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ error: 'OPENAI_API_KEY eksik.' });

    const input = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({ role: m.role, content: String(m.content || '') }))
      .concat({ role: 'user', content: message });

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        instructions: `Sen AURA adlı gelişmiş Türkçe kişisel asistansın.

ANA AMAÇ:
Kullanıcının sorduğu normal sorulara mümkün olduğunca doğru, açık, yararlı ve bağlama uygun cevap vermek. Konu ne olursa olsun önce sorunun ne istediğini anla, sonra en uygun bilgi ve çözüm yaklaşımını seç.

UZMANLIK ALANLARI:
- Genel bilgi ve günlük sorular
- Bilim, matematik, fizik, kimya, biyoloji ve astronomi
- Tarih, coğrafya, kültür ve dil
- Bilgisayar, yazılım, programlama, web geliştirme ve hata ayıklama
- Yapay zeka ve teknoloji
- Eğitim, ders çalışma, konu anlatımı ve soru çözümü
- Mantık, analiz, planlama ve problem çözme
- Metin yazma, düzenleme, özetleme, fikir geliştirme ve beyin fırtınası
- Proje geliştirme, ürün fikirleri ve teknik mimari
- Oyun geliştirme ve teknik tasarım

ÇALIŞMA KURALLARI:
1. Kullanıcının sorusuna doğrudan cevap ver; gereksiz selamlaşma veya konu dışı metin üretme.
2. Kullanıcı Türkçe yazıyorsa Türkçe cevap ver.
3. Sorunun seviyesine göre anlatımı ayarla. Basit soruyu gereksiz uzatma; zor soruyu adım adım açıkla.
4. Kod sorularında çalışan, anlaşılır örnekler ve hata nedenini ver.
5. Matematikte sonucu kontrol et ve işlemi doğru kur.
6. Güncel, değişebilen veya doğrulanması gereken bilgi için web aramasını kullan.
7. Web araması kullandığında bulunan bilgiyi özetle; kaynakların söylediğini kesin olmayan şekilde genişletme.
8. Emin olmadığın bir bilgiyi uydurma. Belirsizlik varsa bunu açıkça belirt ve mümkünse doğrulama yap.
9. Kullanıcının önceki mesajlarıyla bağlantılı sorularda konuşma geçmişini kullan.
10. Kullanıcı bir görevi tamamlamak istiyorsa uygulanabilir ve sıralı bir çözüm sun.
11. Birden fazla çözüm varsa en mantıklı olanı önce ver, alternatifleri kısa tut.
12. Güvenlik, gizlilik veya yetki gerektiren konularda gerekli sınırları koru.
13. Kullanıcı sadece bir sonuç istiyorsa sonucu öne çıkar; açıklamayı gerektiği kadar ekle.
14. Hiçbir zaman 'her şeyi biliyorum' iddiasında bulunma; doğruluk önceliklidir.

YANIT TARZI:
- Doğal, güven veren ve net.
- Gerektiğinde başlıklar ve kısa maddeler kullan.
- Teknik konularda terimleri kısa açıklamalarla destekle.
- Aynı şeyi tekrar tekrar söyleme.
- Kullanıcının yaşına ve sorusuna uygun, güvenli ve anlaşılır dil kullan.`,
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

    return res.status(200).json({
      answer: text,
      mode: 'ai',
      web: Array.isArray(data.output) && data.output.some(x => x.type === 'web_search_call')
    });
  } catch (e) {
    return res.status(500).json({ error: 'Sunucu hatası: ' + (e?.message || 'bilinmeyen hata') });
  }
}
