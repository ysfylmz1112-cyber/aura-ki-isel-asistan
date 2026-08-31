export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  const expected = process.env.NEXORA_SYNC_SECRET;
  if (expected && req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  // Aura'nın mevcut hafıza sistemini bozmadan gelen NEXORA kayıtlarını standart bir olay olarak kabul eder.
  return res.status(200).json({
    ok:true,
    source: body.source || 'NEXORA',
    type: body.type || 'knowledge.sync',
    received: items.length,
    receivedAt: new Date().toISOString()
  });
}
