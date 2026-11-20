'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const renderShorts=require('../desktop/shorts-renderer.cjs');

test('renders Turkish and English narrated 9:16 WebM drafts locally',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aura-shorts-test-'));
 const calls=[];
 try{
  const result=await renderShorts({id:'test-plan-12345678',topic:'Otobüste mahsur kaldım',scriptTr:'Türkçe kısa hikâye.',scriptEn:'A short English story.',scenesTr:['Otobüse bindim','Şoför kayboldu'],scenesEn:['I got on the bus','The driver vanished'],captionTr:'Sonunda ne oldu?',captionEn:'What happened next?',durationSeconds:10},{
   desktopRoot:()=>root,isAllowedPath:()=>true,confirmAction:async()=>true,
   renderSpeech:async(text,lang)=>({base64:'UklGRiQAAABXQVZF',voiceName:lang==='tr'?'Turkish test':'English test'}),
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
