'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

function slug(v){
 return String(v||'shorts').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'shorts';
}

function makeSrt(text,duration){
 const words=String(text||'').split(/\\s+/).filter(Boolean),groups=[];
 for(let i=0;i<words.length;i+=7)groups.push(words.slice(i,i+7).join(' '));
 const total=Math.max(1,groups.length),weight=groups.map(x=>Math.max(1,x.length)),sum=weight.reduce((a,b)=>a+b,0);
 let elapsed=0;
 const stamp=value=>{const ms=Math.max(0,Math.round(value*1000)),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),sec=Math.floor(ms%60000/1000),mill=ms%1000;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')+','+String(mill).padStart(3,'0');};
 return groups.map((line,index)=>{const start=elapsed;elapsed+=duration*weight[index]/sum;return (index+1)+'\\n'+stamp(start)+' --> '+stamp(elapsed)+'\\n'+line;}).join('\\n\\n')+'\\n';
}

function html(plan,lang,audio){
 const scenes=lang==='en'?plan.scenesEn:plan.scenesTr;
 const script=lang==='en'?plan.scriptEn:plan.scriptTr;
 const caption=lang==='en'?plan.captionEn:plan.captionTr;
 const payload=JSON.stringify({
  topic:plan.topic,
  script,
  scenes:Array.isArray(scenes)&&scenes.length?scenes:[script],
  caption:caption||plan.topic,
  lang,
  duration:Number(plan.durationSeconds)||35,
  audio
 }).replace(/</g,'\\u003c');
 const js=[
 'const D='+payload+',c=document.querySelector("canvas"),x=c.getContext("2d"),W=c.width,H=c.height;',
 'const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',
 'function wrap(s,n){const words=String(s||"").split(/\\s+/),out=[];let line="";for(const word of words){const next=line?line+" "+word:word;if(next.length>n&&line){out.push(line);line=word;}else line=next;}if(line)out.push(line);return out.slice(0,3);}',
 'function roundRect(ctx,x0,y0,w,h,r){ctx.beginPath();ctx.roundRect(x0,y0,w,h,r);}',
 'function background(t,i){const palettes=[["#152d4b","#527b91","#f4b56b"],["#183d45","#5c9b8b","#f4d18b"],["#29264d","#8065a4","#f4a66d"],["#1d3548","#47758a","#9bc7d1"],["#382c3c","#8b5f67","#e8b27c"]],p=palettes[i%palettes.length];const sky=x.createLinearGradient(0,0,0,H);sky.addColorStop(0,p[0]);sky.addColorStop(.68,p[1]);sky.addColorStop(1,"#101827");x.fillStyle=sky;x.fillRect(0,0,W,H);',
 'const sunX=405+Math.sin(t*.08+i)*18,sunY=190+Math.cos(t*.05+i)*8;x.fillStyle=p[2];x.globalAlpha=.75;x.beginPath();x.arc(sunX,sunY,58,0,Math.PI*2);x.fill();x.globalAlpha=1;',
 'for(let layer=0;layer<3;layer++){const base=520+layer*85,shift=(t*(8+layer*10)+i*73)%(W+160);for(let j=-1;j<5;j++){const bx=j*150-shift+layer*36,bh=100+((j*37+i*29+layer*19)%150+150)%150;x.fillStyle=["#14263b","#1b3042","#263849"][layer];x.fillRect(bx,base-bh,105,bh);x.fillStyle="rgba(255,221,153,.38)";for(let wy=base-bh+20;wy<base-15;wy+=28)for(let wx=bx+15;wx<bx+95;wx+=27)x.fillRect(wx,wy,9,12);}}',
 'x.fillStyle="#182433";x.beginPath();x.moveTo(0,690);x.lineTo(W,660);x.lineTo(W,H);x.lineTo(0,H);x.fill();x.fillStyle="rgba(255,255,255,.13)";for(let k=0;k<6;k++){const yy=720+k*52;x.fillRect(0,yy,W,2);}x.fillStyle="rgba(255,219,143,.55)";for(let k=0;k<5;k++){const yy=745+k*48;x.fillRect(250,yy,40,5);}}',
 'function drawStickman(t,i){const bob=Math.sin(t*5+i)*6,walk=Math.sin(t*7+i)*22,cx=270+Math.sin(t*.7+i*.6)*24,cy=560+bob;x.save();x.translate(cx,cy);x.lineCap="round";x.lineJoin="round";x.lineWidth=13;x.strokeStyle="#101827";x.fillStyle="#f1c7a5";x.shadowColor="rgba(0,0,0,.28)";x.shadowBlur=12;',
 'x.beginPath();x.arc(0,-125,34,0,Math.PI*2);x.fill();x.stroke();x.shadowBlur=0;x.fillStyle="#101827";x.beginPath();x.arc(-11,-131,4,0,Math.PI*2);x.arc(11,-131,4,0,Math.PI*2);x.fill();x.strokeStyle="#101827";x.lineWidth=5;x.beginPath();x.arc(0,-117,10,.15,Math.PI-.15);x.stroke();',
 'x.lineWidth=15;x.strokeStyle=i%3===0?"#e7edf4":i%3===1?"#e2a35d":"#7cb7c8";x.beginPath();x.moveTo(0,-88);x.lineTo(0,12);x.stroke();x.strokeStyle="#101827";x.lineWidth=12;x.beginPath();x.moveTo(0,-62);x.lineTo(-42,-24+walk*.18);x.moveTo(0,-62);x.lineTo(42,-24-walk*.18);x.moveTo(0,12);x.lineTo(-27+walk,92);x.moveTo(0,12);x.lineTo(27-walk,92);x.stroke();x.restore();}',
 'function sceneText(i,t){const raw=D.scenes[i]||D.script;const lines=wrap(raw,30);x.fillStyle="rgba(5,12,24,.72)";roundRect(x,22,105,W-44,140,20);x.fill();x.fillStyle="#8eeaff";x.font="bold 17px Arial";x.fillText("SAHNE "+String(i+1).padStart(2,"0")+" / "+String(D.scenes.length).padStart(2,"0"),42,137);x.fillStyle="#fff";x.font="bold 25px Arial";lines.forEach((line,j)=>x.fillText(line,42,179+j*31));}',
 'function subtitle(t){const words=String(D.script||"").split(/\\s+/).filter(Boolean);const count=Math.max(1,Math.ceil(words.length/Math.max(1,D.duration/2.8)));const index=clamp(Math.floor(t/Math.max(.1,D.duration/Math.max(1,count))),0,Math.max(0,count-1));const chunk=Math.ceil(words.length/Math.max(1,count));const line=words.slice(index*chunk,(index+1)*chunk).join(" ");x.fillStyle="rgba(0,0,0,.78)";roundRect(x,760,22,W-44,112,18);x.fill();x.fillStyle="#fff";x.font="bold 25px Arial";wrap(line,31).forEach((v,j)=>x.fillText(v,42,805+j*32));}',
 'function draw(t){const total=Math.max(.1,D.duration),i=Math.min(D.scenes.length-1,Math.floor(t/total*D.scenes.length));background(t,i);x.fillStyle="rgba(4,10,20,.62)";roundRect(x,18,18,W-36,55,16);x.fill();x.fillStyle="#fff";x.font="bold 20px Arial";x.fillText("AURA  •  SHORTS",34,53);drawStickman(t,i);sceneText(i,t);subtitle(t);x.fillStyle="rgba(255,255,255,.2)";x.fillRect(0,H-8,W,8);x.fillStyle="#46d9f5";x.fillRect(0,H-8,W*clamp(t/total,0,1),8);if(t>total-2.2){x.fillStyle="rgba(5,12,24,.84)";roundRect(x,420,34,W-68,120,22);x.fill();x.fillStyle="#fff";x.font="bold 28px Arial";wrap(D.caption||D.topic,25).forEach((v,j)=>x.fillText(v,55,470+j*38));}}',
 'window.__auraRender=async()=>{const raw=atob(D.audio),u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);const ac=new AudioContext();await ac.resume();const buf=await ac.decodeAudioData(u.buffer.slice(0));const duration=Math.min(90,Math.max(D.duration,buf.duration+.35));const video=c.captureStream(30),dest=ac.createMediaStreamDestination(),src=ac.createBufferSource();src.buffer=buf;src.connect(dest);const stream=new MediaStream([...video.getVideoTracks(),...dest.stream.getAudioTracks()]);const mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"].find(z=>MediaRecorder.isTypeSupported(z));if(!mime)throw Error("WebM kodlayıcısı bulunamadı");const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4500000,audioBitsPerSecond:160000}),chunks=[];const done=new Promise((resolve,reject)=>{rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};rec.onerror=()=>reject(Error("Video kayıt hatası"));rec.onstop=async()=>{try{const blob=new Blob(chunks,{type:mime}),bytes=new Uint8Array(await blob.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));resolve({base64:btoa(binary),durationSeconds:duration,mimeType:mime})}catch(e){reject(e)}}});let start=0,stopped=false;const stop=()=>{if(stopped)return;stopped=true;if(rec.state!=="inactive")rec.stop()};const tick=now=>{if(!start)start=now;const elapsed=(now-start)/1000;draw(Math.min(elapsed,duration));if(elapsed<duration&&!stopped)requestAnimationFrame(tick);else stop()};rec.start(250);src.start();requestAnimationFrame(tick);const safety=setTimeout(stop,(duration+3)*1000);try{const result=await done;clearTimeout(safety);stream.getTracks().forEach(track=>track.stop());await ac.close();return result}catch(error){clearTimeout(safety);stream.getTracks().forEach(track=>track.stop());await ac.close();throw error}}'
 ].join('\n');
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:540px;height:960px;overflow:hidden;background:#101827}canvas{display:block;width:540px;height:960px}</style></head><body><canvas width="540" height="960"></canvas><script>'+js+'</script></body></html>';
}

module.exports=async function renderShorts(plan,options={}){
 const {desktopRoot,isAllowedPath,confirmAction,renderVideo,renderSpeech}=options;
 if(!plan||!plan.scriptTr||!plan.scriptEn)throw Error('Türkçe ve İngilizce senaryo gerekli.');
 if(![desktopRoot,isAllowedPath,confirmAction,renderVideo,renderSpeech].every(v=>typeof v==='function'))throw Error('Video/ses altyapısı hazır değil.');
 const duration=Number(plan.durationSeconds)||35;
 if(duration<10||duration>90)throw Error('Video süresi 10–90 saniye arasında olmalı.');
 const dir=path.resolve(desktopRoot(),'AURA-YouTube','Shorts',new Date().toISOString().slice(0,10)+'-'+slug(plan.topic)+'-'+String(plan.id||'draft').slice(0,8));
 if(!isAllowedPath(dir))throw Error('Çıktı klasörü izinli değil.');
 if(!await confirmAction('AURA — Shorts video oluşturma','AURA Türkçe ve İngilizce, sahne geçişli, altyazılı, seslendirmeli iki dikey video oluşturacak.\n\n'+dir+'\n\nYalnızca bilgisayara kaydedilecek; YouTube’a yüklenmeyecek.'))throw Error('Video oluşturma iptal edildi.');
 await fs.mkdir(dir,{recursive:true});const outputs=[];
 for(const lang of ['tr','en']){
  const text=String(lang==='tr'?plan.scriptTr:plan.scriptEn).slice(0,1000),speech=await renderSpeech(text,lang);
  if(!speech?.base64||speech.base64.length<100)throw Error(lang+' seslendirme üretilemedi.');
  const result=await renderVideo(html(plan,lang,speech.base64),{width:540,height:960,durationSeconds:duration,maxDurationSeconds:90});
  const bytes=Buffer.isBuffer(result)?result:Buffer.from(result?.base64||'','base64');
  if(bytes.length<1500||bytes.subarray(0,4).toString('hex')!=='1a45dfa3')throw Error(lang+' WebM doğrulaması başarısız.');
  const name=lang==='tr'?'shorts-turkce.webm':'shorts-english.webm',target=path.join(dir,name);
  await fs.writeFile(target,bytes,{flag:'wx'});await fs.writeFile(path.join(dir,lang==='tr'?'seslendirme-turkce.txt':'voiceover-english.txt'),text,{flag:'wx'});\n  await fs.writeFile(path.join(dir,lang==='tr'?'altyazi-turkce.srt':'subtitles-english.srt'),makeSrt(text,result?.durationSeconds||duration),'utf8');
  outputs.push({language:lang,path:target,bytes:bytes.length,hasAudio:true,voice:speech.voiceName||'Windows varsayılan sesi',durationSeconds:result?.durationSeconds||duration});
 }
 const manifest={topic:plan.topic,createdAt:new Date().toISOString(),format:'WebM 540x960 (9:16)',character:'consistent 2D stickman',visuals:'procedural parallax city backgrounds, animated character, scene cards and timed subtitles',outputs,publishingEnabled:false};
 await fs.writeFile(path.join(dir,'video-bilgisi.json'),JSON.stringify(manifest,null,2));
 return {ok:true,folder:dir,outputs,manifest,message:'Türkçe ve İngilizce seslendirmeli, altyazılı Shorts videoları oluşturuldu. YouTube’a yüklenmedi.'};
};
