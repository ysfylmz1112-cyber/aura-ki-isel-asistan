'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const DEFAULT_PROFILE={version:1,channelUrl:"https://www.youtube.com/@Yusuf-b5z7w",exampleUrls:["https://youtube.com/shorts/3ARMrJk3fn4","https://youtube.com/shorts/_ZMU2QlQl-s","https://youtube.com/shorts/PyoilDHC5ac","https://youtube.com/shorts/lAUZuP6xz0Q","https://youtube.com/shorts/WoXQL7v0Q1A","https://youtube.com/shorts/6oQh0_znmi0","https://youtube.com/shorts/QcaCUgevi88"],analysisStatus:'links_saved_content_not_yet_analyzed',analysisNote:'Bağlantılar kaydedildi. Video görüntüsü, sesi, başlığı ve performans verileri henüz doğrulanmadı.',cadence:{frequency:'daily',firstLanguage:'tr',secondLanguage:'en',secondOffsetHours:4,publishTimeLocal:null},updatedAt:null};
function clean(v,max=4000){return String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ').trim().slice(0,max);}
function splitScenes(text){
 const parts=String(text||'').split(/(?<=[.!?])\s+|\n+/).map(x=>clean(x,700)).filter(Boolean);
 if(parts.length<=1)return parts;
 const count=Math.min(16,Math.max(6,Math.ceil(parts.length/2))),size=Math.ceil(parts.length/count),out=[];
 for(let i=0;i<parts.length;i+=size)out.push(parts.slice(i,i+size).join(' '));
 return out.slice(0,16);
}
function safeUrl(v){try{const u=new URL(clean(v,500));return ['https:','http:'].includes(u.protocol)&&/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)?u.toString():null;}catch{return null;}}
module.exports=function createYoutubeStudio({getUserDataPath}={}){
 if(typeof getUserDataPath!=='function')throw new Error('YouTube Studio için kullanıcı veri klasörü gerekli.');
 const file=()=>path.join(getUserDataPath(),'aura-youtube-studio.json');
 async function read(){try{const x=JSON.parse(await fs.readFile(file(),'utf8'));return{version:1,profile:x?.profile||{...DEFAULT_PROFILE},plans:Array.isArray(x?.plans)?x.plans.slice(-200):[]};}catch{return{version:1,profile:{...DEFAULT_PROFILE},plans:[]};}}
 async function write(x){const p=file();await fs.mkdir(path.dirname(p),{recursive:true});const tmp=p+'.tmp';await fs.writeFile(tmp,JSON.stringify(x,null,2),'utf8');await fs.rename(tmp,p);}
 async function getProfile(){const x=await read();if(!x.profile.updatedAt){x.profile.updatedAt=new Date().toISOString();await write(x);}return{ok:true,profile:x.profile,planCount:x.plans.length};}
 async function saveProfile(a={}){const x=await read();const channelUrl=safeUrl(a.channelUrl||x.profile.channelUrl);if(!channelUrl)throw Error('Geçerli bir YouTube kanal bağlantısı gerekli.');const urls=Array.isArray(a.exampleUrls)?a.exampleUrls:x.profile.exampleUrls;const exampleUrls=[...new Set(urls.map(safeUrl).filter(Boolean))].slice(0,30);const time=clean(a.publishTimeLocal||x.profile.cadence?.publishTimeLocal||'',10)||null;if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Yayın saati HH:MM biçiminde olmalı.');x.profile={...x.profile,channelUrl,exampleUrls,channelNotes:clean(a.channelNotes||x.profile.channelNotes||'',3000),cadence:{frequency:'daily',firstLanguage:'tr',secondLanguage:'en',secondOffsetHours:4,publishTimeLocal:time},analysisStatus:'links_saved_content_not_yet_analyzed',analysisNote:'Bağlantılar kaynak listesinde. Video içerikleri ayrıca incelenmeden analiz edilmiş sayılmaz.',updatedAt:new Date().toISOString()};await write(x);return{ok:true,profile:x.profile,message:'Kanal profili kaydedildi; videolar henüz analiz edilmedi.'};}
 async function createPlan(a={}){const topic=clean(a.topic,240),scriptTr=clean(a.scriptTr,5000),scriptEn=clean(a.scriptEn,5000);if(!topic||!scriptTr||!scriptEn)throw Error('Konu, Türkçe senaryo ve İngilizce uyarlama gerekli.');const x=await read();const arr=(v,max)=>Array.isArray(v)?v.slice(0,max).map(z=>clean(z,700)):[];const plan={id:crypto.randomUUID(),topic,hookTr:clean(a.hookTr,300),hookEn:clean(a.hookEn,300),scriptTr,scriptEn,scenesTr:arr(a.scenesTr,16).length?arr(a.scenesTr,16):splitScenes(scriptTr),scenesEn:arr(a.scenesEn,16).length?arr(a.scenesEn,16):splitScenes(scriptEn),captionTr:clean(a.captionTr,1200),captionEn:clean(a.captionEn,1200),hashtagsTr:arr(a.hashtagsTr,12),hashtagsEn:arr(a.hashtagsEn,12),durationSeconds:Math.max(10,Math.min(90,Math.round(Number(a.durationSeconds)||35))),cadence:{first:'tr',second:'en',offsetHours:4,frequency:'daily'},status:'draft_awaiting_review',publishingEnabled:false,createdAt:new Date().toISOString()};x.plans.push(plan);x.plans=x.plans.slice(-200);await write(x);return{ok:true,plan,message:'İki dilli Shorts taslağı kaydedildi. Video render edilmedi ve YouTube’a yüklenmedi.'};}
 async function listPlans(a={}){const x=await read();const limit=Math.max(1,Math.min(50,Math.round(Number(a.limit)||10)));return{ok:true,profile:x.profile,plans:x.plans.slice(-limit).reverse(),total:x.plans.length};}
 return{getProfile,saveProfile,createPlan,listPlans};
};
