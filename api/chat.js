export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    if (!message) return res.status(400).json({ error: 'Mesaj boş.' });

    // Temel hesaplamaları API kredisi olmadan da güvenli biçimde cevapla.
    const q = message.toLocaleLowerCase('tr-TR').replace(/,/g, '.').trim();
    const arithmetic = q.match(/^(?:hesapla\s*)?(-?\d+(?:\.\d+)?)\s*([+\-*/x×÷])\s*(-?\d+(?:\.\d+)?)\s*(?:kaç|nedir|kaçtır)?\s*[?]?$|^(-?\d+(?:\.\d+)?)\s*(?:ile)\s*(-?\d+(?:\.\d+)?)\s*(topla|çıkar|çarp|böl)\s*[?]?$/i);
    if (arithmetic) {
      let a, b, op;
      if (arithmetic[1] !== undefined) { a=Number(arithmetic[1]); op=arithmetic[2]; b=Number(arithmetic[3]); }
      else { a=Number(arithmetic[4]); b=Number(arithmetic[5]); op=arithmetic[6]==='topla'?'+':arithmetic[6]==='çıkar'?'-':arithmetic[6]==='çarp'?'*':'/'; }
      let result;
      if (op === '+') result=a+b;
      else if (op === '-') result=a-b;
      else if (op === '*' || op === 'x' || op === '×') result=a*b;
      else if (op === '/') result=b===0?null:a/b;
      if (result === null) return res.status(200).json({answer:'Sıfıra bölme yapılamaz.'});
      if (Number.isFinite(result)) return res.status(200).json({answer:`Sonuç: ${result}`});
    }

    if (/^(saat kaç|şu an saat kaç|saat kaç\?)$/.test(q)) {
      return res.status(200).json({ answer: `Saat şu anda ${new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}.` });
    }
    if (/^(bugün hangi gün|bugün günlerden ne|tarih ne|bugünün tarihi)[?]?$/.test(q)) {
      return res.status(200).json({ answer: `Bugün ${new Date().toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}.` });
    }

    if (!process.env.OPENAI_API_KEY) return res.status(503).json({error:'OPENAI_API_KEY eksik. Yerel AURA özellikleri çalışıyor.'});
    const input=history.map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content||'')})).concat([{role:'user',content:message}]);
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:'gpt-4o-mini',instructions:'Sen AURA adında Türkçe konuşan, dostça, doğru ve faydalı cevaplar veren kişisel asistansın. Matematik sorularını dikkatlice çöz.',input})});
    const data=await r.json();
    if(!r.ok)return res.status(r.status).json({error:data?.error?.message||'AI servisi hata verdi.'});
    const text=data.output_text||data.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join('')||'Cevap alınamadı.';
    return res.status(200).json({answer:text});
  } catch(e) { return res.status(500).json({error:'Sunucu hatası: '+(e?.message||'bilinmeyen hata')}); }
}
