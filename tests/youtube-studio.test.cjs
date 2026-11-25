'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const renderShorts=require('../desktop/shorts-renderer.cjs');
const createYoutubeStudio=require('../desktop/youtube-studio.cjs');

test('renders Turkish and English narrated 9:16 WebM drafts locally',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aura-shorts-test-'));
 const calls=[];
 try{
  const result=await renderShorts({id:'test-plan-12345678',topic:'Otobüste mahsur kaldım',scriptTr:'Türkçe kısa hikâye.',scriptEn:'A short English story.',scenesTr:['Otobüse bindim','Şoför kayboldu'],scenesEn:['I got on the bus','The driver vanished'],captionTr:'Sonunda ne oldu?',captionEn:'What happened next?',durationSeconds:10},{
   desktopRoot:()=>root,isAllowedPath:()=>true,confirmAction:async()=>true,
   renderSpeech:async(text,lang)=>({base64:'UklGRiQAAABXQVZF'.repeat(12),voiceName:lang==='tr'?'Turkish test':'English test'}),
   renderVideo:async(html,opts)=>{calls.push({html,opts});assert.match(html,/canvas/);assert.match(html,/__auraRender/);return Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(2000)]);}
  });
  assert.equal(result.ok,true);
  assert.equal(result.outputs.length,2);
  assert.equal(result.outputs[0].language,'tr');
  assert.equal(result.outputs[1].language,'en');
  assert.equal(result.outputs.every(x=>x.hasAudio),true);
  assert.equal(calls.length,2);
  assert.equal(calls[0].opts.width,540);
  assert.equal(calls[0].opts.height,960);
  assert.ok((await fs.stat(result.outputs[0].path)).size>1500);
  assert.ok((await fs.stat(result.outputs[1].path)).size>1500);
  const trSrt=await fs.readFile(path.join(result.folder,'altyazi-turkce.srt'),'utf8');
  const enSrt=await fs.readFile(path.join(result.folder,'subtitles-english.srt'),'utf8');
  assert.match(trSrt,/00:00:00,000 -->/);
  assert.match(trSrt,/Türkçe kısa hikâye/);
  assert.match(enSrt,/A short English story/);
  assert.match(calls[0].html,/SAHNE/);
  assert.match(calls[0].html,/SCENE/);
  assert.match(calls[0].html,/remaining=Math\.max\(0,Math\.ceil\(total-t\)\)/);
  assert.match(calls[0].html,/captureStream\(30\)/);
  const manifest=JSON.parse(await fs.readFile(path.join(result.folder,'video-bilgisi.json'),'utf8'));
  assert.equal(manifest.publishingEnabled,false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('does not create files when user declines video generation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aura-shorts-cancel-'));
 try{
  await assert.rejects(()=>renderShorts({id:'cancel',topic:'Test',scriptTr:'TR',scriptEn:'EN',durationSeconds:10},{
   desktopRoot:()=>root,isAllowedPath:()=>true,confirmAction:async()=>false,
   renderSpeech:async()=>({base64:'UklGRiQAAABXQVZF'}),renderVideo:async()=>Buffer.alloc(3000)
  }),/iptal edildi/);
  assert.deepEqual(await fs.readdir(root),[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('creates a scene breakdown when a Shorts plan omits scene arrays',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aura-studio-test-'));
 try{
  const studio=createYoutubeStudio({getUserDataPath:()=>root});
  const result=await studio.createPlan({
   topic:'Kayıp otobüs',
   scriptTr:'Otobüse bindim. Şoför ortada yoktu. Kapılar kapandı. Telefonum çaldı. Herkes bana baktı. Sonunda anladım.',
   scriptEn:'I got on the bus. The driver was missing. The doors closed. My phone rang. Everyone looked at me. Then I understood.',
   durationSeconds:30
  });
  assert.ok(result.plan.scenesTr.length>=3);
  assert.ok(result.plan.scenesEn.length>=3);
  assert.equal(result.plan.publishingEnabled,false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('rejects blank bilingual scripts before asking for permission',async()=>{
 let asked=false;
 await assert.rejects(()=>renderShorts({topic:'Test',scriptTr:'   ',scriptEn:'English',durationSeconds:10},{
  desktopRoot:()=>'/tmp/aura-test',isAllowedPath:()=>true,confirmAction:async()=>{asked=true;return true;},
  renderSpeech:async()=>({base64:'UklGRiQAAABXQVZF'.repeat(12)}),renderVideo:async()=>Buffer.alloc(3000)
 }),/boş olamaz/);
 assert.equal(asked,false);
});

test('removes only its newly-created output folder after a render failure',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aura-shorts-cleanup-'));
 const id='cleanup-12345678',folder=path.join(root,'AURA-YouTube','Shorts',new Date().toISOString().slice(0,10)+'-test-topic-'+id.slice(0,8));
 try{
  await assert.rejects(()=>renderShorts({id,topic:'Test topic',scriptTr:'Türkçe metin',scriptEn:'English text',durationSeconds:10},{
   desktopRoot:()=>root,isAllowedPath:()=>true,confirmAction:async()=>true,
   renderSpeech:async(text,lang)=>{if(lang==='en')throw Error('test speech failure');return{base64:'UklGRiQAAABXQVZF'.repeat(12)};},
   renderVideo:async()=>Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(2000)])
  }),/test speech failure/);
  await assert.rejects(()=>fs.access(folder));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('does not overwrite an existing Shorts output folder',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aura-shorts-existing-'));
 const id='existing-123456',folder=path.join(root,'AURA-YouTube','Shorts',new Date().toISOString().slice(0,10)+'-test-topic-'+id.slice(0,8));
 try{
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'keep.txt'),'keep me');
  await assert.rejects(()=>renderShorts({id,topic:'Test topic',scriptTr:'Türkçe metin',scriptEn:'English text',durationSeconds:10},{
   desktopRoot:()=>root,isAllowedPath:()=>true,confirmAction:async()=>true,
   renderSpeech:async()=>({base64:'UklGRiQAAABXQVZF'.repeat(12)}),renderVideo:async()=>Buffer.alloc(3000)
  }),/EEXIST/);
  assert.equal(await fs.readFile(path.join(folder,'keep.txt'),'utf8'),'keep me');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
