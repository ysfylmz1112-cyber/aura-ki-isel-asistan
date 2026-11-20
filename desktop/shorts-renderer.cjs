'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
function slug(v){return String(v||'shorts').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'shorts';}
function html(plan,lang,audio){
 const payload=JSON.stringify({topic:plan.topic,script:lang==='en'?plan.scriptEn:plan.scriptTr,scenes:lang==='en'?plan.scenesEn:plan.scenesTr,caption:lang==='en'?plan.captionEn:plan.captionTr,lang,duration:plan.durationSeconds,audio}).replace(/</g,'\\u003c');
 const js=[
 'const D='+payload+',c=document.querySelector("canvas"),x=c.getContext("2d"),W=c.width,H=c.height;',
 'function wrap(s,n=24){const a=[];let l="";for(const w of String(s||"").split(/\\s+/)){const q=l?l+" "+w:w;if(q.length>n&&l){a.push(l);l=w}else l=q;if(a.length===3)break}if(l&&a.length<3)a.push(l);return a}',
 'function draw(t){const sc=D.scenes.length?D.scenes:[D.script],i=Math.min(sc.length-1,Math.floor(t/(D.duration/sc.length))),g=x.createLinearGradient(0,0,W,H);g.addColorStop(0,["#17263f","#273d50","#21423e","#3c2949"][i%4]);g.addColorStop(1,"#111827");x.fillStyle=g;x.fillRect(0,0,W,H);x.fillStyle="#d8f4ff";x.font="bold 20px Arial";x.fillText("AURA SHORTS",30,48);x.fillStyle="#fff";x.font="bold 25px Arial";wrap(sc[i]).forEach((v,j)=>x.fillText(v,30,130+j*34));const bob=Math.sin(t*5)*7,step=Math.sin(t*7)*20,cx=W/2,cy=H*.57+bob;x.save();x.translate(cx,cy);x.lineCap="round";x.lineWidth=12;x.strokeStyle="#101827";x.fillStyle="#f2c7a5";x.beginPath();x.arc(0,-115,33,0,7);x.fill();x.stroke();x.fillStyle="#101827";x.beginPath();x.arc(-10,-120,4,0,7);x.arc(10,-120,4,0,7);x.fill();x.beginPath();x.moveTo(0,-80);x.lineTo(0,5);x.moveTo(0,-55);x.lineTo(-45,-28+step*.2);x.moveTo(0,-55);x.lineTo(45,-35-step*.2);x.moveTo(0,5);x.lineTo(-28+step,85);x.moveTo(0,5);x.lineTo(28-step,85);x.stroke();x.restore();x.fillStyle="rgba(3,9,20,.85)";x.beginPath();x.roundRect(20,H-205,W-40,145,18);x.fill();x.fillStyle="#fff";x.font="bold 27px Arial";wrap(D.caption||D.topic,25).forEach((v,j)=>x.fillText(v,40,H-145+j*36));x.fillStyle="#42d9f5";x.fillRect(0,H-8,W*Math.min(1,t/D.duration),8)}',
 'window.__auraRender=async()=>{const raw=atob(D.audio),u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);const ac=new AudioContext();await ac.resume();const buf=await ac.decodeAudioData(u.buffer),duration=Math.min(90,Math.max(D.duration,buf.duration+.5)),v=c.captureStream(24),dest=ac.createMediaStreamDestination(),src=ac.createBufferSource();src.buffer=buf;src.connect(dest);const stream=new MediaStream([...v.getVideoTracks(),...dest.stream.getAudioTracks()]),mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"].find(z=>MediaRecorder.isTypeSupported(z));if(!mime)throw Error("WebM kodlayıcısı bulunamadı");const rec=new MediaRecorder(stream,{mimeType:mime}),chunks=[];const done=new Promise((resolve,reject)=>{rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);rec.onerror=()=>reject(Error("Kayıt hatası"));rec.onstop=async()=>{const b=new Blob(chunks,{type:mime}),a=new Uint8Array(await b.arrayBuffer());let z="";for(let i=0;i<a.length;i+=32768)z+=String.fromCharCode(...a.subarray(i,i+32768));resolve({base64:btoa(z),durationSeconds:duration})}});let start=0;const tick=n=>{if(!start)start=n;const t=(n-start)/1000;draw(Math.min(t,duration));if(t<duration)requestAnimationFrame(tick);else setTimeout(()=>rec.state!=="inactive"&&rec.stop(),200)};rec.start(250);src.start();requestAnimationFrame(tick);setTimeout(()=>rec.state!=="inactive"&&rec.stop(),(duration+1)*1000);const r=await done;stream.getTracks().forEach(t=>t.stop());await ac.close();return r}'
 ].join('\\n');
 return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#101827}canvas{width:540px;height:960px}</style></head><body><canvas width="540" height="960"></canvas><script>'+js+'</script></body></html>';
}
module.exports=async function renderShorts(plan,options={}){
 const {desktopRoot,isAllowedPath,confirmAction,renderVideo,renderSpeech}=options;
 if(!plan||!plan.scriptTr||!plan.scriptEn)throw Error('Türkçe ve İngilizce senaryo gerekli.');
 if(![desktopRoot,isAllowedPath,confirmAction,renderVideo,renderSpeech].every(v=>typeof v==='function'))throw Error('Video/ses altyapısı hazır değil.');
 const dir=path.resolve(desktopRoot(),'AURA-YouTube','Shorts',new Date().toISOString().slice(0,10)+'-'+slug(plan.topic)+'-'+String(plan.id||'draft').slice(0,8));
 if(!isAllowedPath(dir))throw Error('Çıktı klasörü izinli değil.');
 if(!await confirmAction('AURA — Shorts video oluşturma','AURA Türkçe ve İngilizce stickman animasyonlu, seslendirmeli iki dikey video oluşturacak.\\n\\n'+dir+'\\n\\nYalnızca bilgisayara kaydedilecek; YouTube’a yüklenmeyecek.'))throw Error('Video oluşturma iptal edildi.');
 await fs.mkdir(dir,{recursive:true});const outputs=[];
 for(const lang of ['tr','en']){
  const text=String(lang==='tr'?plan.scriptTr:plan.scriptEn).slice(0,1000),speech=await renderSpeech(text,lang);
  if(!speech?.base64||speech.base64.length<100)throw Error(lang+' seslendirme üretilemedi.');
  const result=await renderVideo(html(plan,lang,speech.base64),{width:540,height:960,durationSeconds:plan.durationSeconds,maxDurationSeconds:90});
  const bytes=Buffer.isBuffer(result)?result:Buffer.from(result?.base64||'','base64');
  if(bytes.length<1500||bytes.subarray(0,4).toString('hex')!=='1a45dfa3')throw Error(lang+' WebM doğrulaması başarısız.');
  const name=lang==='tr'?'shorts-turkce.webm':'shorts-english.webm',target=path.join(dir,name);
  await fs.writeFile(target,bytes,{flag:'wx'});await fs.writeFile(path.join(dir,lang==='tr'?'seslendirme-turkce.txt':'voiceover-english.txt'),text,{flag:'wx'});
  outputs.push({language:lang,path:target,bytes:bytes.length,hasAudio:true,voice:speech.voiceName||'Windows varsayılan sesi',durationSeconds:result?.durationSeconds||plan.durationSeconds});
 }
 const manifest={topic:plan.topic,createdAt:new Date().toISOString(),format:'WebM 540x960 (9:16)',character:'2D stickman',outputs,publishingEnabled:false};
 await fs.writeFile(path.join(dir,'video-bilgisi.json'),JSON.stringify(manifest,null,2));
 return {ok:true,folder:dir,outputs,manifest,message:'İki seslendirmeli Shorts videosu oluşturuldu. YouTube’a yüklenmedi.'};
};
