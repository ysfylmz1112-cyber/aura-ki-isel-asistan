export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method not allowed'});
  const expected=process.env.NEXORA_SYNC_SECRET;
  if(expected && req.headers.authorization!==`Bearer ${expected}`) return res.status(401).json({ok:false,error:'Unauthorized'});
  const {items=[]}=req.body||{};
  if(!Array.isArray(items)) return res.status(400).json({ok:false,error:'items array gerekli'});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) return res.status(503).json({ok:false,error:'Aura Supabase bağlantısı ayarlanmamış'});
  const rows=items.slice(0,100).map(x=>({source:'NEXORA',content:typeof x==='string'?x:JSON.stringify(x),created_at:new Date().toISOString()}));
  if(rows.length){
    const r=await fetch(`${url}/rest/v1/aura_memory`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(rows)});
    if(!r.ok) return res.status(502).json({ok:false,error:'Aura hafızasına yazılamadı'});
  }
  return res.status(200).json({ok:true,received:rows.length});
}
