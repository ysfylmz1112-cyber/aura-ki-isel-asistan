const { app, BrowserWindow, dialog, ipcMain, shell, session, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { search } = require('duck-duck-scrape');
const QRCode = require('qrcode');
const openclaw = require('./openclaw.cjs');

const PROD_URL = 'https://aura-ki-isel-asistan.vercel.app/';
const ALLOWED_REMOTE_ORIGIN = 'https://aura-ki-isel-asistan.vercel.app';
const DEV_INDEX = path.join(__dirname,'..','index.html');
const PACKAGED_INDEX = path.join(__dirname,'renderer','index.html');
const LOCAL_INDEX = app.isPackaged ? PACKAGED_INDEX : DEV_INDEX;
const PERMISSIONS_FILE = path.join(app.getPath('userData'), 'aura-permissions.json');
let extraRoots = [];
let activeSpeechProcess = null;
let localServer = null;
let localServerPort = null;
let remoteServer = null;
let remoteServerPort = null;
let remoteControlToken = null;
let phoneState = { version:1, updatedAt:null, items:[] };
const REMOTE_FILE = path.join(app.getPath('userData'), 'aura-remote.json');

function normalizePath(value) { return path.resolve(String(value || '')); }

const backgroundTasks = new Map();

function appendCapped(current, chunk, maxLength = 24000) {
  const value = String(current || '') + String(chunk || '');
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

function lowerProcessPriority(pid, priority = 'BelowNormal') {
  if (process.platform !== 'win32' || !Number.isInteger(Number(pid))) return;
  const id = Number(pid);
  const safePriority = ['Idle','BelowNormal','Normal'].includes(priority) ? priority : 'BelowNormal';
  const command = "$p=Get-Process -Id " + id + " -ErrorAction SilentlyContinue; if($p){try{$p.PriorityClass='" + safePriority + "'}catch{}}";
  execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command', command], {
    windowsHide:true,
    maxBuffer:512*1024
  }, () => {});
}

function runBackgroundProcess(executable, args = [], options = {}) {
  const priority = ['Idle','BelowNormal','Normal'].includes(options.priority) ? options.priority : 'BelowNormal';
  const taskId = 'bg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
  const startedAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const child = spawn(executable, Array.isArray(args) ? args.map(x => String(x)) : [], {
      windowsHide:true,
      stdio:['ignore','pipe','pipe']
    });

    const task = {
      id:taskId,
      pid:child.pid || null,
      process:String(path.basename(executable || 'background-process')),
      priority,
      startedAt,
      state:'running'
    };
    backgroundTasks.set(taskId, task);

    let stdout = '';
    let stderr = '';

    child.once('spawn', () => {
      task.pid = child.pid || null;
      lowerProcessPriority(child.pid, priority);
    });

    child.stdout?.on('data', data => { stdout = appendCapped(stdout, data); });
    child.stderr?.on('data', data => { stderr = appendCapped(stderr, data); });

    child.once('error', error => {
      task.state='failed';
      task.error=String(error?.message || error);
      backgroundTasks.delete(taskId);
      reject(Object.assign(error, { auraResult: { ok:false, taskId, pid:task.pid, process:task.process, priority, stdout, stderr } }));
    });

    child.once('close', code => {
      const exitCode = Number.isFinite(Number(code)) ? Number(code) : 0;
      const result = {
        ok:exitCode===0,
        taskId,
        pid:task.pid,
        process:task.process,
        priority,
        startedAt,
        finishedAt:new Date().toISOString(),
        exitCode,
        stdout,
        stderr
      };
      backgroundTasks.delete(taskId);
      if (exitCode !== 0) {
        task.state='failed';
        reject(Object.assign(new Error(stderr || stdout || (task.process + ' arka plan işlemi ' + exitCode + ' koduyla sonlandı.')), { auraResult:result }));
        return;
      }
      resolve(result);
    });
  });
}

function getBackgroundTaskStatus() {
  return {
    active:true,
    count:backgroundTasks.size,
    tasks:[...backgroundTasks.values()].map(x=>({...x}))
  };
}
function allowedRoots() {
  const home = os.homedir();
  return [
    home,
    path.join(home,'Desktop'),
    path.join(home,'Documents'),
    path.join(home,'Downloads'),
    path.join(home,'OneDrive'),
    path.join(home,'Pictures'),
    path.join(home,'Videos'),
    path.join(home,'Music'),
    ...extraRoots
  ].map(normalizePath);
}

async function loadExtraRoots() {
  try {
    const raw = await fsp.readFile(PERMISSIONS_FILE, 'utf8');
    const data = JSON.parse(raw);
    extraRoots = Array.isArray(data?.roots) ? data.roots.map(normalizePath).filter(Boolean).slice(0,30) : [];
  } catch {
    extraRoots = [];
  }
}

async function saveExtraRoots() {
  await fsp.mkdir(path.dirname(PERMISSIONS_FILE), { recursive: true });
  await fsp.writeFile(PERMISSIONS_FILE, JSON.stringify({ roots: extraRoots }, null, 2), 'utf8');
}


const USAGE_FILE = path.join(app.getPath('userData'), 'aura-usage.json');
const PROFILE_FILE = path.join(app.getPath('userData'), 'aura-device-profile.json');
const MEMORY_FILE = path.join(app.getPath('userData'), 'aura-memory.json');
const CONVERSATION_FILE = path.join(app.getPath('userData'), 'aura-conversations.json');
const REMINDERS_FILE = path.join(app.getPath('userData'), 'aura-reminders.json');
const ROUTINES_FILE = path.join(app.getPath('userData'), 'aura-routines.json');
let usageState = { launches: [], counts: {}, lastLaunch: null };
let memoryState = { version:1, items:[] };
let conversationState = { version:1, items:[] };
let reminderState = { version:1, items:[] };
let routineState = { version:1, items:[] };
const reminderTimers = new Map();
const routineTimers = new Map();
let memoryWritePromise = Promise.resolve();
let conversationWritePromise = Promise.resolve();
let hardwareSnapshot = null;
let environmentProfile = null;
let environmentScanPromise = null;
let scanControl = { active:false, cancelled:false, mode:'quick', step:'idle', progress:0, startedAt:null };

async function loadUsageState() {
  try {
    const raw = await fsp.readFile(USAGE_FILE, 'utf8');
    const data = JSON.parse(raw);
    usageState = {
      launches: Array.isArray(data?.launches) ? data.launches.slice(-100) : [],
      counts: data?.counts && typeof data.counts === 'object' ? data.counts : {},
      lastLaunch: data?.lastLaunch || null
    };
  } catch {
    usageState = { launches: [], counts: {}, lastLaunch: null };
  }
}

async function loadConversationState() {
  try{
    const raw=await fsp.readFile(CONVERSATION_FILE,'utf8');
    const data=JSON.parse(raw);
    conversationState={
      version:1,
      items:Array.isArray(data?.items)
        ? data.items.filter(x=>x && typeof x.user==='string' && typeof x.assistant==='string').slice(-1200)
        : []
    };
  }catch{
    conversationState={version:1,items:[]};
  }
}

async function saveConversationState(){
  conversationWritePromise=conversationWritePromise.then(async()=>{
    await fsp.mkdir(path.dirname(CONVERSATION_FILE),{recursive:true});
    await fsp.writeFile(CONVERSATION_FILE,JSON.stringify(conversationState,null,2),'utf8');
  }).catch(()=>{});
  return conversationWritePromise;
}

async function loadReminderState(){
  try{
    const raw=await fsp.readFile(REMINDERS_FILE,'utf8');
    const data=JSON.parse(raw);
    reminderState={
      version:1,
      items:Array.isArray(data?.items)
        ? data.items.filter(x=>x&&typeof x.id==='string'&&typeof x.text==='string'&&Number.isFinite(Number(x.dueAt))).slice(-300)
        : []
    };
  }catch{
    reminderState={version:1,items:[]};
  }
  for(const item of reminderState.items){
    if(item.status==='active') scheduleReminder(item);
  }
}

async function loadRoutineState(){
  try{
    const raw=await fsp.readFile(ROUTINES_FILE,'utf8');
    const data=JSON.parse(raw);
    routineState={
      version:1,
      items:Array.isArray(data?.items)
        ? data.items.filter(x=>x&&typeof x.id==='string'&&typeof x.text==='string'&&typeof x.repeat==='string'&&Number.isFinite(Number(x.nextAt))).slice(-200)
        : []
    };
  }catch{
    routineState={version:1,items:[]};
  }
  for(const item of routineState.items){
    if(item.status==='active') scheduleRoutine(item);
  }
}

async function saveRoutineState(){
  await fsp.mkdir(path.dirname(ROUTINES_FILE),{recursive:true});
  await fsp.writeFile(ROUTINES_FILE,JSON.stringify(routineState,null,2),'utf8');
}

function clearRoutineTimer(id){
  const timer=routineTimers.get(id);
  if(timer){clearTimeout(timer);routineTimers.delete(id);}
}

function nextRoutineTime(item, from=Date.now()){
  const d=new Date(Number(from));
  if(item.repeat==='interval'){
    return d.getTime()+Math.max(60000,Number(item.intervalMs)||3600000);
  }
  if(item.repeat==='weekly'){
    d.setDate(d.getDate()+7);
    return d.getTime();
  }
  d.setDate(d.getDate()+1);
  return d.getTime();
}

function scheduleRoutine(item){
  if(!item||item.status!=='active') return;
  clearRoutineTimer(item.id);
  const fire=async()=>{
    const current=routineState.items.find(x=>x.id===item.id);
    if(!current||current.status!=='active') return;
    const now=Date.now();
    if(Number(current.nextAt)>now){
      const timer=setTimeout(fire,Math.min(Number(current.nextAt)-now,2147480000));
      routineTimers.set(current.id,timer);
      return;
    }
    try{
      showAuraNotification(current.title||'AURA Rutin',current.text).catch?.(()=>{});
    }finally{
      current.lastRunAt=new Date().toISOString();
      current.nextAt=nextRoutineTime(current,Math.max(now,Number(current.nextAt)));
      current.runCount=Number(current.runCount||0)+1;
      routineTimers.delete(current.id);
      await saveRoutineState();
      scheduleRoutine(current);
    }
  };
  const delay=Math.max(0,Number(item.nextAt)-Date.now());
  const timer=setTimeout(fire,Math.min(delay,2147480000));
  routineTimers.set(item.id,timer);
}

async function createRoutine({text,title,nextAt,repeat='daily',intervalMs=0}={}){
  const value=String(text||'').trim();
  const when=Number(nextAt);
  const rep=String(repeat||'daily').toLowerCase();
  if(!value) throw new Error('Rutin metni boş.');
  if(!Number.isFinite(when)||when<=Date.now()) throw new Error('Rutin başlangıç zamanı gelecek bir zaman olmalı.');
  if(!['daily','weekly','interval'].includes(rep)) throw new Error('Rutin tekrarı daily, weekly veya interval olmalı.');
  if(rep==='interval' && Number(intervalMs)<60000) throw new Error('Interval rutin en az 1 dakika olmalı.');
  const item={
    id:'routine_'+Date.now().toString(36)+'_'+crypto.randomBytes(4).toString('hex'),
    title:String(title||'AURA Rutin').slice(0,120),
    text:value.slice(0,1000),
    repeat:rep,
    intervalMs:rep==='interval'?Number(intervalMs):0,
    nextAt:when,
    createdAt:new Date().toISOString(),
    lastRunAt:null,
    runCount:0,
    status:'active'
  };
  routineState.items.unshift(item);
  routineState.items=routineState.items.slice(0,200);
  scheduleRoutine(item);
  await saveRoutineState();
  return {ok:true,item,items:listRoutines().items};
}

function listRoutines(){
  return {
    count:routineState.items.filter(x=>x.status==='active').length,
    items:routineState.items.slice().sort((a,b)=>Number(a.nextAt)-Number(b.nextAt)).slice(0,100)
  };
}

async function cancelRoutine(query){
  const q=String(query||'').trim();
  if(!q) throw new Error('İptal edilecek rutini belirt.');
  const n=normalizedSearchText(q);
  const active=routineState.items.filter(x=>x.status==='active');
  const matches=active.map(x=>({...x,score:memorySearchScore(n,normalizedSearchText(x.text+' '+x.title))}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  if(!matches.length) return {ok:true,removed:0,message:'Eşleşen aktif rutin bulunamadı.'};
  const target=routineState.items.find(x=>x.id===matches[0].id);
  if(target){
    target.status='cancelled';
    target.cancelledAt=new Date().toISOString();
    clearRoutineTimer(target.id);
  }
  await saveRoutineState();
  return {ok:true,removed:1,routine:target};
}

async function dailyBriefing(){
  const h=await getHardwareMetrics();
  const reminders=listReminders().items.filter(x=>x.status==='active').slice(0,5);
  const routines=listRoutines().items.filter(x=>x.status==='active').slice(0,5);
  return {
    ok:true,
    generatedAt:new Date().toISOString(),
    user:os.userInfo().username,
    hardware:h,
    reminders,
    routines,
    message:'AURA günlük durum özeti hazır.'
  };
}

async function saveReminderState(){
  await fsp.mkdir(path.dirname(REMINDERS_FILE),{recursive:true});
  await fsp.writeFile(REMINDERS_FILE,JSON.stringify(reminderState,null,2),'utf8');
}

function clearReminderTimer(id){
  const timer=reminderTimers.get(id);
  if(timer){ clearTimeout(timer); reminderTimers.delete(id); }
}

function scheduleReminder(item){
  if(!item||item.status!=='active') return;
  clearReminderTimer(item.id);
  const fire=()=>{
    const current=reminderState.items.find(x=>x.id===item.id);
    if(!current||current.status!=='active') return;
    const delay=Math.max(0,Number(current.dueAt)-Date.now());
    if(delay>0){
      const timer=setTimeout(fire,Math.min(delay,2147480000));
      reminderTimers.set(current.id,timer);
      return;
    }
    current.status='done';
    current.completedAt=new Date().toISOString();
    reminderTimers.delete(current.id);
    showAuraNotification(current.title||'AURA Hatırlatıcı',current.text).catch?.(()=>{});
    saveReminderState().catch(()=>{});
  };
  const delay=Math.max(0,Number(item.dueAt)-Date.now());
  const timer=setTimeout(fire,Math.min(delay,2147480000));
  reminderTimers.set(item.id,timer);
}

async function createReminder({text,title,dueAt}={}){
  const value=String(text||'').trim();
  const when=Number(dueAt);
  if(!value) throw new Error('Hatırlatıcı metni boş.');
  if(!Number.isFinite(when)||when<=Date.now()) throw new Error('Hatırlatıcı zamanı geçerli bir gelecek zamanı olmalı.');
  if(when-Date.now()>365*86400000) throw new Error('Hatırlatıcı en fazla 1 yıl ileriye kurulabilir.');
  const item={
    id:'rem_'+Date.now().toString(36)+'_'+crypto.randomBytes(4).toString('hex'),
    title:String(title||'AURA Hatırlatıcı').slice(0,120),
    text:value.slice(0,1000),
    dueAt:when,
    createdAt:new Date().toISOString(),
    status:'active'
  };
  reminderState.items.unshift(item);
  reminderState.items=reminderState.items.slice(0,300);
  scheduleReminder(item);
  await saveReminderState();
  return {ok:true,item,items:listReminders().items};
}

function listReminders(){
  const now=Date.now();
  const items=reminderState.items
    .slice()
    .sort((a,b)=>Number(a.dueAt)-Number(b.dueAt));
  return {
    count:items.filter(x=>x.status==='active').length,
    items:items.slice(0,100).map(x=>({...x,dueInMs:Math.max(0,Number(x.dueAt)-now)}))
  };
}

async function cancelReminder(query){
  const q=String(query||'').trim();
  if(!q) throw new Error('İptal edilecek hatırlatıcıyı belirt.');
  const n=normalizedSearchText(q);
  const active=reminderState.items.filter(x=>x.status==='active');
  const matches=active
    .map(x=>({...x,score:memorySearchScore(n,normalizedSearchText(x.text+' '+x.title))}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score);
  if(!matches.length) return {ok:true,removed:0,message:'Eşleşen aktif hatırlatıcı bulunamadı.'};
  const target=matches[0];
  const original=reminderState.items.find(x=>x.id===target.id);
  if(original){
    original.status='cancelled';
    original.cancelledAt=new Date().toISOString();
    clearReminderTimer(original.id);
  }
  await saveReminderState();
  return {ok:true,removed:1,reminder:original};
}


function conversationTimeWindow(query){
  const q=String(query||'').toLocaleLowerCase('tr-TR').trim();
  const now=new Date();
  let start=null,end=null,label='Tüm kayıtlı geçmiş';
  const localMidnight=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x;};
  if(/geçen hafta|gecen hafta/.test(q)){
    const day=(now.getDay()+6)%7;
    const thisMonday=localMidnight(new Date(now.getTime()-day*86400000));
    start=new Date(thisMonday.getTime()-7*86400000);
    end=thisMonday; label='Geçen hafta';
  }else if(/bu hafta/.test(q)){
    const day=(now.getDay()+6)%7;
    start=localMidnight(new Date(now.getTime()-day*86400000));
    end=new Date(); label='Bu hafta';
  }else if(/dün|dun/.test(q)){
    start=localMidnight(new Date(now.getTime()-86400000));
    end=localMidnight(now); label='Dün';
  }else if(/bugün|bugun/.test(q)){
    start=localMidnight(now);
    end=new Date(); label='Bugün';
  }else{
    const m=q.match(/son\s+(\d+)\s+gün/);
    if(m){
      const days=Math.max(1,Math.min(90,Number(m[1])||1));
      start=new Date(Date.now()-days*86400000); end=new Date(); label='Son '+days+' gün';
    }
  }
  return {start:start?.toISOString()||null,end:end?.toISOString()||null,label};
}

function searchConversationScore(query,item){
  const q=normalizedSearchText(query)
    .replace(/gecen hafta|geçen hafta|dun|dün|bugun|bugün|bu hafta|son \d+ gun|son \d+ gün/g,' ')
    .trim();
  const t=normalizedSearchText(String(item?.user||'')+' '+String(item?.assistant||''));
  if(!q) return 1;
  const base=memorySearchScore(q,t);
  const at=Date.parse(item?.at||'');
  const ageDays=Number.isFinite(at)?Math.max(0,(Date.now()-at)/86400000):9999;
  const recency=Math.max(0,30-Math.min(30,ageDays))*1.4;
  return base+recency;
}

function searchConversations(query,maxResults=18){
  const q=String(query||'').trim();
  const window=conversationTimeWindow(q);
  const items=conversationState.items.filter(item=>{
    const t=Date.parse(item?.at||'');
    if(!Number.isFinite(t)) return false;
    if(window.start && t<Date.parse(window.start)) return false;
    if(window.end && t>=Date.parse(window.end)) return false;
    return true;
  }).map(item=>({...item,score:searchConversationScore(q,item)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score || String(b.at).localeCompare(String(a.at)))
    .slice(0,Math.max(1,Math.min(50,Number(maxResults)||18)));
  return {query:q,count:items.length,timeWindow:window,items};
}

async function logConversation(user,assistant,mode='chat'){
  const u=String(user||'').trim();
  const a=String(assistant||'').trim();
  if(!u||!a) return {ok:false,logged:false};
  conversationState.items.push({
    id:'turn_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),
    at:new Date().toISOString(),
    user:u.slice(0,2200),
    assistant:a.slice(0,5000),
    mode:String(mode||'chat')
  });
  conversationState.items=conversationState.items.slice(-1200);
  await saveConversationState();
  return {ok:true,logged:true,count:conversationState.items.length};
}

async function loadMemoryState(){
  try {
    const raw=await fsp.readFile(MEMORY_FILE,'utf8');
    const data=JSON.parse(raw);
    memoryState={
      version:1,
      items:Array.isArray(data?.items)
        ? data.items.filter(x=>x && typeof x.text==='string').slice(-200)
        : []
    };
  } catch {
    memoryState={version:1,items:[]};
  }
}

function memorySearchScore(query,text){
  const q=normalizedSearchText(query);
  const t=normalizedSearchText(text);
  if(!q||!t) return 0;
  if(t===q) return 1500;
  if(t.includes(q)) return 1100;
  const qTokens=[...new Set(q.split(' ').filter(Boolean))];
  const tTokens=new Set(t.split(' ').filter(Boolean));
  let matched=0;
  let score=0;
  for(const token of qTokens){
    if(tTokens.has(token)){ matched++; score+=180; }
    else if(token.length>=4 && t.includes(token)) score+=75;
  }
  if(!matched) return score;
  const coverage=matched/qTokens.length;
  score+=coverage*420;
  if(qTokens.length>1 && matched===qTokens.length) score+=260;
  return score;
}

async function saveMemoryState(){
  memoryWritePromise=memoryWritePromise.then(async()=>{
    await fsp.mkdir(path.dirname(MEMORY_FILE),{recursive:true});
    await fsp.writeFile(MEMORY_FILE,JSON.stringify(memoryState,null,2),'utf8');
  }).catch(()=>{});
  return memoryWritePromise;
}

async function remember(text,tags=[]){
  const value=String(text||'').trim();
  if(!value) throw new Error('Hafızaya kaydedilecek bilgi boş.');
  if(value.length>1200) throw new Error('Hafıza kaydı 1200 karakteri aşamaz.');
  const normalized=normalizedSearchText(value);
  const existing=memoryState.items.find(x=>normalizedSearchText(x.text)===normalized);
  if(existing){
    existing.updatedAt=new Date().toISOString();
    existing.hits=Number(existing.hits||0)+1;
    if(Array.isArray(tags)&&tags.length) existing.tags=[...new Set([...existing.tags,...tags.map(String)])].slice(0,12);
  }else{
    memoryState.items.push({
      id:'mem_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),
      text:value,
      tags:Array.isArray(tags)?tags.map(String).filter(Boolean).slice(0,12):[],
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      hits:1
    });
  }
  memoryState.items=memoryState.items.slice(-200);
  await saveMemoryState();
  return {ok:true,count:memoryState.items.length,remembered:value};
}

function searchMemory(query,maxResults=12){
  const q=String(query||'').trim();
  const now=Date.now();
  const items=memoryState.items
    .map(x=>{
      const base=memorySearchScore(q,x.text+' '+(x.tags||[]).join(' '));
      const updated=Date.parse(x.updatedAt||x.createdAt||'');
      const ageDays=Number.isFinite(updated)?Math.max(0,(now-updated)/86400000):999;
      const recency=Math.max(0,90-Math.min(90,ageDays))*0.9;
      const hits=Math.min(40,Number(x.hits||0))*2;
      return {...x,score:base+recency+hits};
    })
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0,Math.max(1,Math.min(30,Number(maxResults)||12)));
  return {query:q,count:items.length,items};
}

function listMemory(){
  return {
    count:memoryState.items.length,
    items:memoryState.items.slice().reverse().slice(0,50)
  };
}

async function forgetMemory(query){
  const q=String(query||'').trim();
  if(!q) throw new Error('Silinecek hafıza belirtilmedi.');
  const normalized=normalizedSearchText(q);
  const before=memoryState.items.length;
  const exact=memoryState.items.filter(x=>normalizedSearchText(x.text)===normalized);
  if(exact.length){
    memoryState.items=memoryState.items.filter(x=>normalizedSearchText(x.text)!==normalized);
  }else{
    const matches=searchMemory(q,20).items;
    if(!matches.length) return {ok:true,removed:0,message:'Eşleşen hafıza bulunamadı.'};
    const ids=new Set(matches.slice(0,10).map(x=>x.id));
    memoryState.items=memoryState.items.filter(x=>!ids.has(x.id));
  }
  await saveMemoryState();
  return {ok:true,removed:before-memoryState.items.length,remaining:memoryState.items.length};
}

async function clearMemory(){
  const ok=await confirmAction('AURA — Hafızayı temizleme onayı','AURA kayıtlı kalıcı hafızadaki tüm maddeleri silecek.\n\nDevam edilsin mi?');  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  const removed=memoryState.items.length;
  memoryState.items=[];
  await saveMemoryState();
  return {ok:true,removed};
}

async function saveUsageState() {
  await fsp.mkdir(path.dirname(USAGE_FILE), { recursive: true });
  await fsp.writeFile(USAGE_FILE, JSON.stringify(usageState, null, 2), 'utf8');
}

async function recordLaunch(name, type, target) {
  const key = String(name || target || '').trim();
  if (!key) return;
  usageState.counts[key] = Number(usageState.counts[key] || 0) + 1;
  usageState.lastLaunch = { name:key, type:String(type || 'app'), target:String(target || ''), at:new Date().toISOString() };
  usageState.launches = [...usageState.launches, usageState.lastLaunch].slice(-100);
  await saveUsageState().catch(() => {});
}

function normalizedSearchText(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const APP_ALIASES = {
  'vs code':'Visual Studio Code',
  'vscode':'Visual Studio Code',
  'visual studio code':'Visual Studio Code',
  'chrome':'Google Chrome',
  'google chrome':'Google Chrome',
  'edge':'Microsoft Edge',
  'microsoft edge':'Microsoft Edge',
  'discord':'Discord',
  'spotify':'Spotify',
  'steam':'Steam',
  'unity':'Unity Hub',
  'unity hub':'Unity Hub',
  'obs':'OBS Studio',
  'obs studio':'OBS Studio',
  'epic':'Epic Games Launcher',
  'epic games':'Epic Games Launcher',
  'riot':'Riot Client',
  'riot client':'Riot Client',
  'minecraft':'Minecraft Launcher',
  'minecraft launcher':'Minecraft Launcher',
  'tlauncher':'TLauncher',
  'powershell':'PowerShell',
  'terminal':'Windows Terminal',
  'dosya gezgini':'File Explorer',
  'explorer':'File Explorer',
  'hesap makinesi':'Calculator',
  'notepad':'Notepad'
};

function expandedAppQueries(value) {
  const original = String(value || '').trim();
  const normalized = normalizedSearchText(original);
  const queries = [original, normalized];
  const alias = APP_ALIASES[normalized];
  if (alias) queries.push(alias);
  return [...new Set(queries.map(normalizedSearchText).filter(Boolean))];
}

function candidateScore(query, candidate) {
  const q = normalizedSearchText(query);
  const c = normalizedSearchText(candidate);
  if (!q || !c) return 0;
  if (c === q) return 1000;
  if (c.includes(q)) return 850 - Math.min(200, c.length - q.length);
  const qt = q.split(' ').filter(Boolean);
  const ct = c.split(' ').filter(Boolean);
  let score = 0;
  for (const token of qt) {
    if (ct.includes(token)) score += 180;
    else if (c.includes(token)) score += 90;
  }
  return score - Math.max(0, c.length - q.length);
}

async function discoverShortcutApps(options = {}) {
  const deep = options.deep !== false;
  const dirs = [
    path.join(os.homedir(),'AppData','Roaming','Microsoft','Windows','Start Menu','Programs'),
    path.join(os.homedir(),'Desktop')
  ]
  const matches = [];

  async function walk(dir, depth=0) {
    if(depth>5 || matches.length>=500) return;
    let entries=[];
    try { entries=await fsp.readdir(dir,{withFileTypes:true}); } catch { return; }
    for(const entry of entries){
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){
        if(!['node_modules','AppData'].includes(entry.name)) await walk(full,depth+1);
        continue;
      }
      const lower=entry.name.toLowerCase();
      if(!(lower.endsWith('.lnk')||lower.endsWith('.exe'))) continue;
      matches.push({
        name:entry.name.replace(/\.(lnk|exe)$/i,''),
        path:full,
        kind:lower.endsWith('.lnk')?'shortcut':'exe'
      });
      if(matches.length>=500) return;
    }
  }

  if (deep) {
    for(const dir of dirs) await walk(dir);
  }

  // Windows StartApps: güvenilir uygulama kataloğu.
  const startApps=await new Promise(resolve=>{
    const command="[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress)))";
    execFile(
      'powershell.exe',
      ['-NoProfile','-NonInteractive','-Command',command],
      {windowsHide:true,maxBuffer:4*1024*1024},
      (error,stdout)=>{        if(error) return resolve([]);
        try{
          const encoded=String(stdout||'').trim();
          const value=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
          const list=Array.isArray(value)?value:[value];
          resolve(list.filter(x=>x?.Name && x?.AppID).map(x=>({
            name:String(x.Name),
            appId:String(x.AppID),
            path:'shell:AppsFolder\\'+String(x.AppID),
            kind:'start-app'
          })));
        }catch{ resolve([]); }
      }
    );
  });

  const unique=[];
  const seen=new Set();
  for(const item of [...startApps,...matches]){
    const key=normalizedSearchText(item.name);
    if(!key||seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}


const SYSTEM_APP_NAMES = [
  '7-zip help','about java','application verifier','adım kaydedicisi',
  'access','başlarken','calculator','computer management','control panel',
  'credential manager','event viewer','file explorer','internet options',
  'memory diagnostic','notepad','odbc','powershell','registry editor',
  'resource monitor','services','settings','task scheduler','terminal',
  'windows defender','windows security','windows terminal','wordpad'
];

function isSystemUtility(name) {
  const n=normalizedSearchText(name);
  return SYSTEM_APP_NAMES.some(x=>n===normalizedSearchText(x));
}

async function discoverCurrentUserInstalledApps() {
  const key='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
  return new Promise(resolve=>{
    const command="[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((reg query '"+key+"' /s /reg:64 2>$null | Out-String)))";
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,maxBuffer:4*1024*1024},(error,stdout)=>{
      if(error) return resolve([]);
      try{
        const raw=Buffer.from(String(stdout||'').trim(),'base64').toString('utf8');
        const entries=[];
        let currentKey='';
        for(const line of raw.split(/\r?\n/)){
          if(/^HKEY/i.test(line)){ currentKey=line.trim(); continue; }
          const m=line.match(/^\s*DisplayName\s+REG_SZ\s+(.+)$/i);
          if(m?.[1]&&currentKey) entries.push({name:m[1].trim(),path:currentKey,kind:'user-install'});
        }
        resolve(entries);
      }catch{resolve([]);}
    });
  });
}

function findSteamRootCandidates() {
  return [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    path.join(os.homedir(),'AppData','Local','Steam'),
    path.join(os.homedir(),'AppData','Roaming','Steam')
  ];
}

async function discoverSteamRegistryRoots() {
  const roots = [];
  const queries = [
    ['HKCU\\Software\\Valve\\Steam','SteamPath'],
    ['HKCU\\Software\\Valve\\Steam','InstallPath'],
    ['HKLM\\Software\\WOW6432Node\\Valve\\Steam','InstallPath'],
    ['HKLM\\Software\\Valve\\Steam','InstallPath']
  ];

  for(const [key,valueName] of queries){
    const result = await new Promise(resolve=>{
      execFile(
        'reg.exe',
        ['query',key,'/v',valueName],
        {windowsHide:true,maxBuffer:1024*1024},
        (error,stdout)=>{
          if(error) return resolve('');
          resolve(String(stdout||''));
        }
      );
    });
    const m=result.match(new RegExp(valueName+'\\s+REG_SZ\\s+(.+)', 'i'));
    if(m?.[1]) roots.push(m[1].trim());
  }

  return [...new Set(roots.map(normalizePath).filter(p=>fs.existsSync(p)))];
}

function findSteamExecutable() {
  for (const root of findSteamRootCandidates()) {
    const exe = path.join(root,'steam.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

async function steamLibraryPaths() {
  const baseRoots=[...findSteamRootCandidates(), ...(await discoverSteamRegistryRoots())];
  const libraries = [];
  const exe = findSteamExecutable();
  if (exe) libraries.push(path.dirname(exe));

  for (const root of [...baseRoots,...libraries]) {
    const cfg = path.join(root,'steamapps','libraryfolders.vdf');
    try {
      const text = await fsp.readFile(cfg,'utf8');
      const re=/"path"\s+"([^"]+)"/gi;
      let m;
      while ((m=re.exec(text))) {
        libraries.push(m[1].replace(/\\\\/g,'\\'));
      }
    } catch {}
  }

  return [...new Set(libraries.map(normalizePath).filter(Boolean))];
}

const GAME_NAME_HINTS = [
  'minecraft','fortnite','valorant','league of legends',
  'counter strike','cs2','apex legends','albion online','terraria',
  'stardew valley','gta','grand theft auto','red dead redemption',
  'cyberpunk 2077','the witcher','assassin',
  'far cry','watch dogs','need for speed','fifa','ea sports',
  'efootball','football manager','nba 2k','wwe','ark survival',
  'rust','valheim','hades','elden ring','dark souls','sekiro',
  'doom','quake','overwatch','destiny','warframe','palworld',
  'among us','roblox','rocket league','fall guys','pubg',
  'supermarket simulator'
];

const NON_GAME_ENTRIES = [
  'steamworks common redistributables',
  'steam linux runtime',
  'steam linux runtime soldier',
  'steam linux runtime sniper',
  'steam runtime',
  'steamvr',
  'proton',
  'epic games launcher',
  'riot client',
  'riot vanguard',
  'directx runtime',
  'vulkan runtime',
  'microsoft visual c++',
  'visual c++',
  'ue prerequisites',
  'minecraft launcher',
  'tlauncher',
  'başlarken',
  'baslarken'
];

function isClearlyNonGame(name){
  const n=normalizedSearchText(name);
  return NON_GAME_ENTRIES.some(x=>n===normalizedSearchText(x));
}
function looksLikeGame(name){
  const n=normalizedSearchText(name);
  if(!n || isClearlyNonGame(name)) return false;
  return GAME_NAME_HINTS.some(x=>{
    const h=normalizedSearchText(x);
    return n===h || n.includes(h);
  });
}
async function discoverSteamGames() {
  const roots = await steamLibraryPaths();
  const games = [];
  const seen = new Set();

  for(const root of roots){
    const dir=path.join(root,'steamapps');
    let entries=[];
    try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch{continue;}

    for(const e of entries){
      if(!e.isFile() || !/^appmanifest_\d+\.acf$/i.test(e.name)) continue;
      try{
        const text=await fsp.readFile(path.join(dir,e.name),'utf8');
        const id=(text.match(/"appid"\s+"(\d+)"/i)||[])[1];
        const name=(text.match(/"name"\s+"([^"]+)"/i)||[])[1];
        if(id&&name && !isClearlyNonGame(name)){
          const key=id;
          if(!seen.has(key)){
            seen.add(key);
            games.push({name,appid:id,library:root,source:'steam'});
          }
        }
      }catch{}
      if(games.length>=500) break;
    }
    if(games.length>=500) break;
  }

  // Steam bulunamazsa bile, Windows StartApps içindeki bilinen oyun adlarını
  // oyun olarak işaretleyerek sıfır göstermeyi engelle.
  if(games.length===0){
    const apps=await discoverShortcutApps().catch(()=>[]);
    for(const app of apps){
      if(looksLikeGame(app.name)){
        const key=normalizedSearchText(app.name);
        if(!seen.has(key)){
          seen.add(key);
          games.push({name:app.name,path:app.path,source:'windows-app'});
        }
      }
    }
  }

  return games;
}
async function launchSteamGame(game) {
  const steamExe = findSteamExecutable();
  if (!steamExe) throw new Error('Steam bulunamadı.');
  const ok=await confirmAction('AURA — Oyun açma izni','AURA şu Steam oyununu açacak:\n\n'+game.name);
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  execFile(steamExe,['-applaunch',String(game.appid)],{windowsHide:false});
  await recordLaunch(game.name,'steam-game',game.appid);
  return {ok:true,app:game.name,type:'steam-game',appid:game.appid};
}

async function findAndLaunchGameOrApp(appName) {
  const target=String(appName||'').trim();
  if(!target || target.length>100) throw new Error('Uygulama/oyun adı geçersiz.');

  // Yaygın isim/küçük yazım hataları için doğrudan Windows StartApps eşleşmesi.
  const directAliases={whatsapp:'WhatsApp',whatsap:'WhatsApp',chrome:'Google Chrome',edge:'Microsoft Edge',discord:'Discord'};
  const aliasName=directAliases[normalizedSearchText(target)];
  if(aliasName){
    const ps="$items=@(Get-StartApps | Where-Object { $_.Name -like '*"+aliasName.replace(/'/g,"''")+"*' } | Select-Object -First 1 Name,AppID); if($items.Count){$items|ConvertTo-Json -Compress}else{'null'}";
    const raw=await new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,maxBuffer:1024*1024},(e,so)=>resolve(e?'':String(so||''))));
    try{
      const item=JSON.parse(raw||'null');
      if(item?.AppID) return launchStartApp({name:String(item.Name||aliasName),appId:String(item.AppID)});
    }catch{}
  }

  let profile=environmentProfile;
  const fresh=profile?.scannedAt && (Date.now()-new Date(profile.scannedAt).getTime()<30*1000);
  if(!fresh){
    profile=await scanEnvironment();
  }

  const queries=expandedAppQueries(target);
  const games=Array.isArray(profile?.games)?profile.games:[];
  const apps=Array.isArray(profile?.apps)?profile.apps:[];
  const gameCandidates=games
    .map(g=>({...g,score:Math.max(...queries.map(q=>candidateScore(q,g.name)))}))
    .filter(x=>x.score>=120)
    .sort((a,b)=>b.score-a.score);

  if(gameCandidates.length && gameCandidates[0].score>=950){
    const game=gameCandidates[0];
    if(game.appid) return launchSteamGame(game);
    const ok=await confirmAction('AURA — Oyun açma izni','AURA şu oyunu açacak:\n\n'+game.name);
    if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
    const err=await shell.openPath(game.path);
    if(err) throw new Error(err);
    await recordLaunch(game.name,'game',game.path);
    return {ok:true,app:game.name,type:'game',path:game.path};
  }

  const appCandidates=apps
    .map(a=>({...a,score:Math.max(...queries.map(q=>candidateScore(q,a.name)))}))
    .filter(x=>x.score>=100)
    .sort((a,b)=>b.score-a.score);

  if(!appCandidates.length && gameCandidates.length){
    const game=gameCandidates[0];
    if(game.appid) return launchSteamGame(game);
  }
  if(!appCandidates.length) throw new Error('Uygulama veya oyun bulunamadı: '+target);

  const chosen=appCandidates[0];

  if(chosen.kind==='start-app' && chosen.appId){
    const result=await launchStartApp(chosen);
    return {...result,matches:appCandidates.slice(0,10)};
  }

  const ok=await confirmAction(
    'AURA — Uygulama/oyun açma izni',
    'AURA bunu açacak:\n\n'+chosen.name+'\n'+chosen.path+
    (appCandidates.length>1 ? '\n\nEn yakın eşleşmeler: '+appCandidates.slice(0,5).map(x=>x.name).join(', ') : '')
  );
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  const err=await shell.openPath(chosen.path);
  if(err) throw new Error(err);
  await recordLaunch(chosen.name,'app',chosen.path);
  return {ok:true,app:chosen.name,path:chosen.path,matches:appCandidates.slice(0,10)};
}

async function directorySummary(root) {
  root=normalizePath(root);
  if(!fs.existsSync(root)) return {path:root,exists:false};
  let entries=[];
  try { entries=await fsp.readdir(root,{withFileTypes:true}); } catch { return {path:root,exists:false}; }
  const folders=entries.filter(e=>e.isDirectory()).length;
  const files=entries.length-folders;
  return {
    path:root,exists:true,folders,files,total:entries.length,
    items:entries.slice(0,120).map(e=>({name:e.name,type:e.isDirectory()?'directory':'file'}))
  };
}

async function recentWindowsItems() {
  const dir=path.join(os.homedir(),'AppData','Roaming','Microsoft','Windows','Recent');
  let entries=[];
  try { entries=await fsp.readdir(dir,{withFileTypes:true}); } catch { return []; }
  return entries.filter(e=>e.isFile()).slice(0,80).map(e=>e.name.replace(/\.lnk$/i,''));
}

async function currentProcesses() {
  return new Promise(resolve=>{
    const command="[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $sid=(Get-Process -Id $PID).SessionId; $p=@(Get-Process | Where-Object { $_.SessionId -eq $sid } | Select-Object ProcessName,Id); [PSCustomObject]@{count=$p.Count;items=$p | Select-Object -First 120} | ConvertTo-Json -Compress";
    execFile(
      'powershell.exe',
      ['-NoProfile','-NonInteractive','-Command',command],
      {windowsHide:true,maxBuffer:3*1024*1024},
      (error,stdout)=>{
        if(error) return resolve({count:0,items:[]});
        try{
          const value=JSON.parse(String(stdout||'{}'));
          const list=Array.isArray(value?.items)?value.items:(value?.items?[value.items]:[]);
          resolve({
            count:Number(value?.count||list.length),
            items:list.filter(x=>x?.ProcessName).map(x=>({
              name:String(x.ProcessName)+'.exe',
              pid:Number(x.Id)||0
            }))
          });
        }catch{
          resolve({count:0,items:[]});
        }
      }
    );
  });
}

async function getRunningApps(){
  const processes=await currentProcesses();
  const systemNames=new Set([
    'aura.exe','electron.exe','system','system idle process','registry.exe','smss.exe','csrss.exe',
    'wininit.exe','services.exe','lsass.exe','svchost.exe','winlogon.exe','dwm.exe','fontdrvhost.exe',
    'sihost.exe','ctfmon.exe','explorer.exe','searchhost.exe','startmenuexperiencehost.exe',
    'runtimebroker.exe','applicationframehost.exe','textinputhost.exe','conhost.exe',
    'spoolsv.exe','wmiprvse.exe','dllhost.exe','securityhealthservice.exe'
  ]);
  const grouped=new Map();
  for(const item of Array.isArray(processes?.items)?processes.items:[]){
    const name=String(item?.name||'').trim();
    if(!name || systemNames.has(name.toLowerCase())) continue;
    const key=name.toLowerCase();
    const current=grouped.get(key)||{name,pids:[]};
    if(item?.pid) current.pids.push(Number(item.pid));
    grouped.set(key,current);
  }
  const items=[...grouped.values()]
    .map(x=>({...x,count:x.pids.length}))
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'tr-TR'))
    .slice(0,80);
  return {ok:true,user:os.userInfo().username,count:items.length,items};
}

async function getUsageReport() {
  const processes=await currentProcesses();
  const recent=await recentWindowsItems();
  const top=Object.entries(usageState.counts||{})
    .map(([name,count])=>({name,count:Number(count)||0}))
    .sort((a,b)=>b.count-a.count)
    .slice(0,20);

  return {
    user:os.userInfo().username,
    trackedByAura:top,
    lastLaunch:usageState.lastLaunch,
    recentWindowsItems:recent.slice(0,30),
    runningProcesses:processes,
    note:'AURA gerçek toplam ekran süresi ölçmez; AURA üzerinden açılanları, Windows Son Öğeler listesini ve anlık çalışan işlemleri raporlar.'
  };
}

async function discoverKnownWindowsGames(appsInput=null, options={}) {
  const apps=Array.isArray(appsInput) ? appsInput : await discoverShortcutApps({deep:options.deep !== false}).catch(()=>[]);
  const found=[];
  const seen=new Set();
  for(const app of apps){
    if(!looksLikeGame(app.name)) continue;
    const key=normalizedSearchText(app.name);
    if(seen.has(key)) continue;
    seen.add(key);
    found.push({
      name:app.name,
      path:app.path,
      source:'windows-app'
    });
  }
  return found;
}

async function scanEnvironment(options={}) {
  const mode=options?.mode==='deep' ? 'deep' : 'quick';
  const force=Boolean(options?.force);
  if (!force && environmentProfile?.scannedAt && environmentProfile?.scanMode===mode) {
    const age=Date.now()-new Date(environmentProfile.scannedAt).getTime();
    if (Number.isFinite(age) && age < 30*1000) return environmentProfile;
  }
  if (environmentScanPromise) return environmentScanPromise;
  scanControl={active:true,cancelled:false,mode,step:'başlıyor',progress:0,startedAt:new Date().toISOString()};
  environmentScanPromise = performEnvironmentScan({mode}).catch(error=>{
    if(error?.code==='AURA_SCAN_CANCELLED') return {cancelled:true,scanMode:mode,scanErrors:[]};
    throw error;
  }).finally(() => {
    scanControl={active:false,cancelled:false,mode,step:'idle',progress:0,startedAt:null};
    environmentScanPromise = null;
  });
  return environmentScanPromise;
}

function cancelEnvironmentScan(){
  if(!scanControl.active) return {ok:true,active:false,cancelled:false};
  scanControl.cancelled=true;
  scanControl.step='iptal ediliyor';
  return {ok:true,active:true,cancelled:true};
}

function scanCheckpoint(step,progress){
  scanControl.step=String(step||'çalışıyor');
  scanControl.progress=Math.max(0,Math.min(100,Number(progress)||0));
  if(scanControl.cancelled){
    const error=new Error('PC taraması kullanıcı tarafından iptal edildi.');
    error.code='AURA_SCAN_CANCELLED';
    throw error;
  }
}

function getScanStatus(){
  return {...scanControl};
}

async function performEnvironmentScan({mode='quick'}={}) {
  const deep=mode==='deep';
  const home=os.homedir();
  const rootList=allowedRoots();
  scanCheckpoint('izinli klasörler hazırlanıyor',5);
  const profile={
    scannedAt:new Date().toISOString(),
    scanMode:mode,
    live:true,
    system:await systemInfo(),
    desktop:null,
    documents:null,
    downloads:null,
    roots:[],
    apps:[],
    games:[],
    runningProcesses:[],    recentWindowsItems:[],
    permissions:rootList,
    scanErrors:[],
    scanScope:'current-user',
    user:{
      name:os.userInfo().username,
      home
    },
    applicationSummary:null
  };

  const safeStep=async(name,fn,fallback,progress=0)=>{
    scanCheckpoint(name,progress);
    try{return await fn();}
    catch(error){
      profile.scanErrors.push({step:name,error:error?.message||String(error)});
      return fallback;
    }
  };

  const uniqueRoots=[];
  for(const root of rootList){
    if(!uniqueRoots.some(x=>x.toLowerCase()===root.toLowerCase())) uniqueRoots.push(root);
  }
  const rootSummaries = deep ? await Promise.all(uniqueRoots.map(root =>
    safeStep('folder:'+root,()=>directorySummary(root),{path:root,exists:false,error:true},8)
  )) : [];
  profile.roots.push(...rootSummaries);

  const [desktop,documents,downloads,shortcutApps,registryApps] = await Promise.all([
    safeStep('masaüstü',()=>directorySummary(path.join(home,'Desktop')),{path:path.join(home,'Desktop'),exists:false,error:true},12),
    safeStep('belgeler',()=>directorySummary(path.join(home,'Documents')),{path:path.join(home,'Documents'),exists:false,error:true},15),
    safeStep('indirilenler',()=>directorySummary(path.join(home,'Downloads')),{path:path.join(home,'Downloads'),exists:false,error:true},18),
    safeStep('uygulamalar',()=>discoverShortcutApps({deep}),[],25),
    deep ? safeStep('kullanıcı uygulamaları',()=>discoverCurrentUserInstalledApps(),[],28) : []
  ]);
  profile.desktop=desktop;
  profile.documents=documents;
  profile.downloads=downloads;
  const combinedApps=[...shortcutApps,...registryApps];
  const userApps=combinedApps.filter(x=>!isSystemUtility(x.name));
  const systemApps=combinedApps.filter(x=>isSystemUtility(x.name));
  const appMap=new Map();
  for(const item of userApps){
    const key=normalizedSearchText(item.name);
    if(key&&!appMap.has(key)) appMap.set(key,item);
  }
  profile.apps=[...appMap.values()].slice(0,500);
  profile.applicationSummary={
    userApps:userApps.length,
    systemUtilities:systemApps.length,
    totalDiscovered:combinedApps.length
  };

  scanCheckpoint('oyunlar taranıyor',35);
  const [steamGames,windowsGames] = await Promise.all([
    safeStep('steam oyunları',()=>discoverSteamGames(),[],40),
    safeStep('Windows oyunları',()=>discoverKnownWindowsGames(shortcutApps,{deep}),[],45)
  ]);
  const filteredSteamGames=steamGames.filter(x=>!isClearlyNonGame(x.name));
  const gameMap=new Map();
  for(const game of [...filteredSteamGames,...windowsGames]){
    const key=normalizedSearchText(game.name);
    if(key && !isClearlyNonGame(game.name) && !gameMap.has(key)) gameMap.set(key,game);
  }
  profile.games=[...gameMap.values()].slice(0,300);
  scanCheckpoint('çalışan işlemler okunuyor',70);
  const [runningProcesses,recentItems] = await Promise.all([
    safeStep('işlemler',()=>currentProcesses(),{count:0,items:[]},72),
    deep ? safeStep('son öğeler',()=>recentWindowsItems(),[],78) : []
  ]);
  profile.runningProcesses=runningProcesses;
  profile.recentWindowsItems=recentItems;

  scanCheckpoint('sonuçlar kaydediliyor',92);
  environmentProfile=profile;
  try{
    await fsp.mkdir(path.dirname(PROFILE_FILE),{recursive:true});
    await fsp.writeFile(PROFILE_FILE,JSON.stringify(profile,null,2),'utf8');
  }catch{}

  scanCheckpoint('tamamlandı',100);
  return profile;
}
async function getEnvironmentProfile() {
  if (environmentProfile?.scannedAt) {
    const age=Date.now()-new Date(environmentProfile.scannedAt).getTime();
    if (Number.isFinite(age) && age < 30*1000) return environmentProfile;
  }
  try {
    const raw=await fsp.readFile(PROFILE_FILE,'utf8');
    const data=JSON.parse(raw);
    const age=Date.now()-new Date(data?.scannedAt||0).getTime();
    if (data?.scannedAt && age < 10*60*1000) {
      environmentProfile=data;
      return data;
    }
  } catch {}
  return scanEnvironment({mode:'quick'});
}

function isAllowedPath(target) {
  const p = normalizePath(target).toLowerCase();
  return allowedRoots().some(root => { const r = root.toLowerCase(); return p === r || p.startsWith(r + path.sep); });
}
function safeUrl(value) {
  try { const u = new URL(String(value)); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}
async function confirmAction(title, message) {
  const r = await dialog.showMessageBox({ type:'question', buttons:['İptal','İzin ver'], defaultId:0, cancelId:0, noLink:true, title, message });
  return r.response === 1;
}

async function chooseFolder(purpose) {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'AURA — Klasör erişim izni'
  });
  if (result.canceled || !result.filePaths[0]) throw new Error('Klasör seçimi iptal edildi.');
  const selected = normalizePath(result.filePaths[0]);
  const exists = allowedRoots().some(root => selected.toLowerCase() === root.toLowerCase());
  if (!exists) {
    const ok = await confirmAction(
      'AURA — Klasöre erişim izni',
      'AURA şu klasöre erişim izni ekleyecek:\n\n' + selected + '\n\nAmaç: ' + String(purpose || 'bilgisayar işlemi')
    );
    if (!ok) throw new Error('Kullanıcı izin vermedi.');
    extraRoots = [...extraRoots, selected].slice(-30);
    await saveExtraRoots();
  }
  return { ok:true, path:selected, roots:allowedRoots() };
}

async function listDrives() {
  const command = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress";
  return await new Promise(resolve=>{
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,maxBuffer:2*1024*1024},(error,stdout)=>{
      if(error) return resolve([]);
      try{
        const value=JSON.parse(String(stdout||'[]'));
        const list=Array.isArray(value)?value:(value?[value]:[]);
        resolve(list.filter(x=>x?.DeviceID).map(x=>{
          const total=Number(x.Size||0), free=Number(x.FreeSpace||0);
          return {drive:String(x.DeviceID),device:String(x.DeviceID),name:String(x.VolumeName||'Yerel Disk'),totalGB:Number((total/1024/1024/1024).toFixed(1)),freeGB:Number((free/1024/1024/1024).toFixed(1)),usedPercent:total?Number(((total-free)/total*100).toFixed(1)):null};
        }));
      }catch{ resolve([]); }
    });
  });
}

async function copyPath(source, destination) {
  source=normalizePath(source); destination=normalizePath(destination);
  if(!isAllowedPath(source)||!isAllowedPath(destination)) throw new Error('Kaynak veya hedef için erişim izni yok.');
  const ok=await confirmAction('AURA — Kopyalama izni','Kaynak:\n'+source+'\n\nHedef:\n'+destination+'\n\nDevam edilsin mi?');
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  await fsp.cp(source,destination,{recursive:true,force:true});
  return {ok:true,source,destination};
}

async function movePath(source, destination) {
  source=normalizePath(source); destination=normalizePath(destination);
  if(!isAllowedPath(source)||!isAllowedPath(destination)) throw new Error('Kaynak veya hedef için erişim izni yok.');
  const ok=await confirmAction('AURA — Taşıma izni','Kaynak:\n'+source+'\n\nHedef:\n'+destination+'\n\nDevam edilsin mi?');
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  await fsp.rename(source,destination);
  return {ok:true,source,destination};
}

async function searchFiles(root, query, maxResults=80) {
  root=normalizePath(root);
  if(!isAllowedPath(root)) throw new Error('Bu klasöre erişim izni yok.');
  const q=String(query||'').toLowerCase().trim();
  if(!q) throw new Error('Arama sorgusu boş.');
  const results=[];
  async function walk(dir, depth=0) {
    if(depth>8 || results.length>=maxResults) return;
    let entries=[];
    try { entries=await fsp.readdir(dir,{withFileTypes:true}); } catch { return; }
    for(const entry of entries) {
      const full=path.join(dir,entry.name);
      if(entry.name.startsWith('.') || entry.name==='node_modules' || entry.name==='Library' && path.basename(root).toLowerCase()==='unity') continue;
      if(entry.name.toLowerCase().includes(q)) results.push({path:full,type:entry.isDirectory()?'directory':'file'});
      if(entry.isDirectory()) await walk(full,depth+1);
      if(results.length>=maxResults) return;
    }
  }
  await walk(root);
  return {root,query:q,results};
}

async function runPowerShell(command) {
  const cmd=String(command||'').trim();
  if(!cmd) throw new Error('PowerShell komutu boş.');
  if(cmd.length>4000) throw new Error('Komut 4000 karakter sınırını aşıyor.');
  if(/(?:-EncodedCommand|Start-Process\\s+.*-Verb\\s+RunAs|runas(?:\.exe)?)/i.test(cmd)) {
    throw new Error('Yetki yükseltme veya kodlanmış komutlar AURA tarafından engelleniyor.');
  }
  const ok=await confirmAction('AURA — PowerShell çalıştırma izni','AURA şu PowerShell komutunu çalıştıracak:\n\n'+cmd+'\n\nKomut yönetici yetkisiyle çalıştırılmayacak. Devam edilsin mi?');
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  return new Promise((resolve,reject)=>{
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',cmd],{windowsHide:true,maxBuffer:1024*1024},(error,stdout,stderr)=>{
      resolve({
        ok:!error,
        exitCode:error?.code ?? 0,
        stdout:String(stdout||'').slice(0,30000),
        stderr:String(stderr||'').slice(0,12000)
      });
    });
  });
}

async function readTextFile(filePath) {
  if (!isAllowedPath(filePath)) throw new Error('Bu klasöre erişim izni yok.');
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error('Bu yol bir dosya değil.');
  if (stat.size > 2 * 1024 * 1024) throw new Error('Dosya 2 MB sınırını aşıyor.');
  return fsp.readFile(filePath,'utf8');
}
async function listDirectory(dirPath) {
  if (!isAllowedPath(dirPath)) throw new Error('Bu klasöre erişim izni yok.');
  const entries = await fsp.readdir(dirPath,{withFileTypes:true});
  return entries.slice(0,300).map(e => ({name:e.name,type:e.isDirectory()?'directory':'file'}));
}
async function writeTextFile(filePath, content) {
  if (!isAllowedPath(filePath)) throw new Error('Bu klasöre yazma izni yok.');
  const text = String(content ?? '');
  if (text.length > 2 * 1024 * 1024) throw new Error('Metin 2 MB sınırını aşıyor.');
  const ok = await confirmAction('AURA — Dosya yazma izni', 'AURA şu dosyayı oluşturacak/değiştirecek:\n\n'+filePath+'\n\nDevam edilsin mi?');
  if (!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  await fsp.mkdir(path.dirname(filePath),{recursive:true});
  await fsp.writeFile(filePath,text,'utf8');
  return {ok:true,path:filePath};
}
async function makeDirectory(dirPath) {
  if (!isAllowedPath(dirPath)) throw new Error('Bu klasöre yazma izni yok.');
  const ok = await confirmAction('AURA — Klasör oluşturma izni','Şu klasör oluşturulacak:\n\n'+dirPath);
  if (!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  await fsp.mkdir(dirPath,{recursive:true});
  return {ok:true,path:dirPath};
}
async function deletePath(targetPath) {
  if (!isAllowedPath(targetPath)) throw new Error('Bu yola silme izni yok.');
  const ok = await confirmAction('AURA — SİLME ONAYI','AURA şu yolu kalıcı olarak silmeye çalışıyor:\n\n'+targetPath+'\n\nBu işlem geri alınamayabilir. Devam edilsin mi?');
  if (!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  await fsp.rm(targetPath,{recursive:true,force:false});
  return {ok:true,path:targetPath};
}
async function openPath(targetPath) {
  if (!isAllowedPath(targetPath)) throw new Error('Bu yola erişim izni yok.');
  const ok = await confirmAction('AURA — Yol açma izni','AURA şu yolu açacak:\n\n'+targetPath);
  if (!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  const error = await shell.openPath(targetPath);
  if (error) throw new Error(error);
  return {ok:true,path:targetPath};
}

function findUnityEditor() {
  const direct = ['C:\\Program Files\\Unity Hub\\Unity Hub.exe', path.join(os.homedir(),'AppData','Local','Programs','Unity Hub','Unity Hub.exe')];
  for (const p of direct) { try { fs.accessSync(p); return p; } catch {} }
  const root = 'C:\\Program Files\\Unity\\Hub\\Editor';
  try {
    const versions = fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort().reverse();
    for (const v of versions) { const p=path.join(root,v,'Editor','Unity.exe'); try { fs.accessSync(p); return p; } catch {} }
  } catch {}
  return null;
}
async function openUnityProject(projectPath) {
  if (!isAllowedPath(projectPath)) throw new Error('Unity projesi izin verilen klasörlerin dışında.');
  const stat = await fsp.stat(projectPath).catch(()=>null);
  if (!stat?.isDirectory()) throw new Error('Unity proje klasörü bulunamadı.');
  const unity = findUnityEditor();
  if (!unity) throw new Error('Unity Hub/Editor bulunamadı.');
  const ok = await confirmAction('AURA — Unity açma izni','AURA Unity ile şu projeyi açacak:\n\n'+projectPath);
  if (!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  execFile(unity,['-projectPath',projectPath],{windowsHide:false});
  return {ok:true,executable:unity,projectPath};
}

async function launchStartApp(item) {
  const appId=String(item?.appId||'').trim();
  if(!appId) throw new Error('Windows uygulama kimliği bulunamadı.');
  const name=String(item?.name||appId).trim();

  const ok=await confirmAction(
    'AURA — Uygulama/oyun açma izni',
    'AURA şu Windows uygulamasını açacak:\n\n'+name
  );
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');

  const target='shell:AppsFolder\\'+appId;
  const child=execFile('explorer.exe',[target],{windowsHide:false});

  await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('spawn',resolve);
  });

  await recordLaunch(name,'start-app',appId);
  return {ok:true,app:name,type:'start-app',appId};
}
const AURA_PROTECTED_PROCESS_NAMES=new Set(['aura.exe','electron.exe','smss.exe','csrss.exe','wininit.exe','services.exe','lsass.exe','svchost.exe','winlogon.exe','dwm.exe','system.exe','idle.exe']);
function normalizeAppControlName(value){return String(value||'').trim().replace(/^[“”"'\s]+|[“”"'\s]+$/g,'').replace(/['’](?:y?[ıiuü])$/i,'').replace(/(?:y[ıiuü])$/i,'').replace(/\s+(?:uygulamasını|uygulamasini|programını|programini|oyununu)$/i,'').trim();}
async function closeAppByName(appName){
  const target=normalizeAppControlName(appName),norm=normalizedSearchText(target);
  if(!target)throw new Error('Kapatılacak uygulama adı boş.');
  if(norm==='aura'||norm==='electron')throw new Error('AURA kendi çalışma sürecini kapatamaz.');
  const queries=expandedAppQueries(target),procs=await currentProcesses();
  const matches=(procs.items||[]).filter(p=>p?.pid&&!AURA_PROTECTED_PROCESS_NAMES.has(String(p.name||'').toLowerCase())).map(p=>({p,score:Math.max(...queries.map(q=>candidateScore(q,p.name)))})).filter(x=>x.score>=520).sort((a,b)=>b.score-a.score).slice(0,30).map(x=>x.p);
  if(!matches.length)throw new Error('Çalışan uygulama bulunamadı: '+target);
  const preview=matches.slice(0,8).map(p=>p.name+' (PID '+p.pid+')').join('\n');
  if(!await confirmAction('AURA — Uygulama kapatma izni','Kapatılacak uygulama:\n\n'+target+'\n\n'+preview+'\n\nDevam edilsin mi?'))throw new Error('Kullanıcı işlemi iptal etti.');
  const ids=matches.map(p=>p.pid).join(',');
  const command="$sid=(Get-Process -Id $PID).SessionId;$ids=@("+ids+");foreach($id in $ids){$p=Get-Process -Id $id -ErrorAction SilentlyContinue;if($p -and $p.SessionId -eq $sid){try{$p.CloseMainWindow()|Out-Null}catch{}}};Start-Sleep -Milliseconds 1200;foreach($id in $ids){$p=Get-Process -Id $id -ErrorAction SilentlyContinue;if($p -and $p.SessionId -eq $sid){try{$p.Kill()}catch{}}}";
  await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,maxBuffer:1024*1024},(e,so,se)=>e&&Number(e.code)!==0?reject(new Error(String(se||so||e.message))):resolve()));
  environmentProfile=null; return {ok:true,app:target,closed:matches.map(p=>p.pid)};
}
async function uninstallAppByName(appName){
  const target=normalizeAppControlName(appName),q=String(target||'').replace(/'/g,"''");
  if(!target)throw new Error('Kaldırılacak uygulama adı boş.');
  if(isSystemUtility(target))throw new Error('Windows sistem araçları AURA tarafından kaldırılmaz.');
  const command="[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*"+q+"*' } | Select-Object -First 1 DisplayName,UninstallString,QuietUninstallString,Publisher,DisplayVersion | ConvertTo-Json -Compress)))";
  const reg=await new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,maxBuffer:1024*1024},(e,so)=>{if(e)return resolve(null);try{resolve(JSON.parse(Buffer.from(String(so||'').trim(),'base64').toString('utf8')||'null'));}catch{resolve(null);}}));
  if(reg?.UninstallString){
    const cmd=String(reg.QuietUninstallString||reg.UninstallString);
    if(!await confirmAction('AURA — Uygulama kaldırma izni','Windows kaldırma aracını çalıştır:\n\n'+reg.DisplayName+(reg.Publisher?'\nYayıncı: '+reg.Publisher:'')+(reg.DisplayVersion?'\nSürüm: '+reg.DisplayVersion:'')+'\n\nDevam edilsin mi?'))throw new Error('Kullanıcı işlemi iptal etti.');
    await new Promise((resolve,reject)=>execFile('cmd.exe',['/d','/s','/c',cmd],{windowsHide:false,maxBuffer:2*1024*1024},(e,so,se)=>e?reject(new Error(String(se||so||e.message))):resolve()));
    environmentProfile=null; return {ok:true,app:String(reg.DisplayName),type:'user-install'};
  }
  const ac="[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-AppxPackage | Where-Object { $_.Name -like '*"+q+"*' -and -not $_.IsFramework -and -not $_.NonRemovable } | Select-Object -First 1 Name,PackageFullName | ConvertTo-Json -Compress)))";
  const appx=await new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',ac],{windowsHide:true,maxBuffer:1024*1024},(e,so)=>{if(e)return resolve(null);try{resolve(JSON.parse(Buffer.from(String(so||'').trim(),'base64').toString('utf8')||'null'));}catch{resolve(null);}}));
  if(appx?.PackageFullName){
    if(!await confirmAction('AURA — Store uygulaması kaldırma izni','Kaldırılacak uygulama:\n\n'+String(appx.Name)+'\n\nDevam edilsin mi?'))throw new Error('Kullanıcı işlemi iptal etti.');
    const full=String(appx.PackageFullName).replace(/'/g,"''");
    const removeCmd="Get-AppxPackage | Where-Object { $_.PackageFullName -eq '"+full+"' -and -not $_.IsFramework -and -not $_.NonRemovable } | Remove-AppxPackage -ErrorAction Stop";
    await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',removeCmd],{windowsHide:true,maxBuffer:1024*1024},(e,so,se)=>e?reject(new Error(String(se||so||e.message))):resolve()));
    environmentProfile=null; return {ok:true,app:String(appx.Name),type:'user-appx'};
  }
  throw new Error('Kaldırılabilir bir uygulama bulunamadı: '+target);
}

async function launchApp(appName) {
  const name=String(appName||'').toLowerCase().trim();
  const map={
    notepad:'C:\\Windows\\System32\\notepad.exe',
    calculator:'C:\\Windows\\System32\\calc.exe',
    explorer:'C:\\Windows\\explorer.exe'
  };
  if (!map[name]) throw new Error('Uygulama AURA güvenli kısayol listesinde değil.');
  const file=map[name];
  if (!fs.existsSync(file)) throw new Error('Uygulama bulunamadı: '+file);
  const ok=await confirmAction('AURA — Uygulama açma izni','AURA şu uygulamayı açacak:\n\n'+name);
  if (!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  execFile(file,{windowsHide:false});
  return {ok:true,app:name};}


async function findAndLaunchApp(appName) {
  return findAndLaunchGameOrApp(appName);
}

function stopWindowsSpeech() {
  if (activeSpeechProcess) {
    try { activeSpeechProcess.kill(); } catch {}
    activeSpeechProcess = null;
  }
  return {ok:true};
}

function speakTextWindows(text) {
  stopWindowsSpeech();
  return new Promise((resolve,reject)=>{
    const child=spawn(
      'powershell.exe',
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',
        "$inputText=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $voice=$s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'tr-*' } | Select-Object -First 1; if($voice){$s.SelectVoice($voice.VoiceInfo.Name)}; $s.Rate=0; $s.Volume=100; $s.Speak($inputText) } finally { $s.Dispose() }"
      ],
      {windowsHide:true,stdio:['pipe','ignore','pipe']}
    );
    activeSpeechProcess = child;
    let stderr='';
    child.stderr.on('data',d=>{stderr+=String(d)});
    child.on('error',reject);
    child.on('close',code=>{
      if(activeSpeechProcess===child) activeSpeechProcess=null;
      if(code===0) resolve({ok:true});
      else reject(new Error(stderr||('Windows ses motoru hata verdi ('+code+').')));
    });
    child.stdin.end(String(text||'').slice(0,4000),'utf8');
  });
}

async function openCamera(){
  try{
    await shell.openExternal('microsoft.windows.camera:');
    return {ok:true,message:'Kamera uygulaması açıldı.'};
  }catch{
    const camera=path.join(process.env.WINDIR||'C:\\Windows','System32','Camera.exe');
    if(fs.existsSync(camera)){
      execFile(camera,{windowsHide:false});
      return {ok:true,message:'Kamera uygulaması açıldı.'};
    }
    throw new Error('Windows Kamera uygulaması bulunamadı.');
  }
}

async function openWindowsUtility(kind){
  const map={
    screenshot:{uri:'ms-screenclip:',message:'Ekran alıntısı aracı açıldı.'},
    settings:{uri:'ms-settings:',message:'Windows Ayarları açıldı.'},
    taskmanager:{exe:'taskmgr.exe',message:'Görev Yöneticisi açıldı.'},
    calculator:{exe:'calc.exe',message:'Hesap Makinesi açıldı.'},
    notepad:{exe:'notepad.exe',message:'Not Defteri açıldı.'},
    downloads:{path:path.join(os.homedir(),'Downloads'),message:'İndirilenler klasörü açıldı.'},
    desktop:{path:path.join(os.homedir(),'Desktop'),message:'Masaüstü açıldı.'},
    documents:{path:path.join(os.homedir(),'Documents'),message:'Belgeler açıldı.'}
  };
  const item=map[String(kind||'').toLowerCase()];
  if(!item) throw new Error('Bilinmeyen Windows aracı.');
  if(item.uri){
    await shell.openExternal(item.uri);
  }else if(item.path){
    await shell.openPath(item.path);
  }else{
    execFile(item.exe,{windowsHide:false});
  }
  return {ok:true,message:item.message};
}

async function openExternalUrl(url) {
  if(!safeUrl(url)) throw new Error('Sadece HTTP/HTTPS adresleri açılabilir.');
  const ok=await confirmAction('AURA — Web adresi açma izni','AURA şu adresi varsayılan tarayıcıda açacak:\n\n'+url);
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  await shell.openExternal(url);
  return {ok:true,url};
}

async function webResearch(query,maxResults=12) {
  const q=String(query||'').trim();
  if(!q || q.length>300) throw new Error('Geçersiz araştırma sorgusu.');
  const queries=[
    q,
    q+' güncel',
    q+' official',
  ];
  const seen=new Set();
  const results=[];
  for(const variant of queries){
    const data=await search(variant);
    for(const item of (data?.results||[])){
      const url=String(item?.url||item?.link||'');
      const key=(url||String(item?.title||'')).toLowerCase();
      if(!key||seen.has(key)) continue;
      seen.add(key);
      results.push({
        title:String(item?.title||'').slice(0,220),
        url,
        snippet:String(item?.description||'').slice(0,500),
        query:variant
      });
      if(results.length>=Math.max(4,Math.min(24,Number(maxResults)||12))) break;
    }
    if(results.length>=Math.max(4,Math.min(24,Number(maxResults)||12))) break;
  }
  return {query:q,searches:queries,results};
}

async function webSearch(query) {
  const q=String(query||'').trim();
  if (!q || q.length>300) throw new Error('Geçersiz arama sorgusu.');
  const result=await search(q);
  return {query:q,results:(result.results||[]).slice(0,8).map(x=>({title:x.title,url:x.url||x.link||'',snippet:x.description||''}))};
}
async function fetchWebPage(url) {
  if (!safeUrl(url)) throw new Error('Sadece HTTP/HTTPS adreslerine izin veriliyor.');
  const response=await fetch(url,{headers:{'User-Agent':'AURA-Desktop/1.0'},redirect:'follow'});
  if (!response.ok) throw new Error('Web sayfası alınamadı (HTTP '+response.status+').');
  const raw=await response.text();
  const text=raw.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  return {url,status:response.status,text:text.slice(0,30000)};
}
async function findUnityProjects(maxResults=20){
  const roots=[
    path.join(os.homedir(),'Desktop'),
    path.join(os.homedir(),'Documents'),
    path.join(os.homedir(),'Downloads'),
    ...extraRoots
  ].map(normalizePath);
  const limit=Math.max(1,Math.min(50,Number(maxResults)||20));
  const found=[];
  const seen=new Set();
  const skip=new Set(['Library','Temp','Logs','obj','bin','Builds','UserSettings','node_modules','.git','.vs','.idea','PackagesCache']);

  async function walk(dir,depth){
    if(depth>5 || found.length>=limit) return;
    let entries=[];
    try{ entries=await fsp.readdir(dir,{withFileTypes:true}); }catch{return;}
    let hasAssets=false,hasSettings=false;
    for(const e of entries){
      if(!e.isDirectory()) continue;
      if(e.name==='Assets') hasAssets=true;
      else if(e.name==='ProjectSettings') hasSettings=true;
    }
    if(hasAssets&&hasSettings){
      const key=dir.toLowerCase();
      if(!seen.has(key)){
        seen.add(key);
        found.push({name:path.basename(dir),path:dir,source:'unity-project'});
      }
      return;
    }
    const dirs=entries
      .filter(e=>e.isDirectory()&&!skip.has(e.name)&&!e.name.startsWith('.'))
      .slice(0,80);
    for(const e of dirs){
      if(found.length>=limit) break;
      await walk(path.join(dir,e.name),depth+1);
    }
  }

  await Promise.all(roots.map(root=>walk(root,0)));
  return {count:found.length,items:found.slice(0,limit)};
}

async function unityHealthCheck(projectPath){
  const editor=findUnityEditorExecutable() || findUnityEditor();
  const root=normalizePath(projectPath||'');
  const result={
    ok:false,
    unityEditor:editor||null,
    unityEditorExists:Boolean(editor&&fs.existsSync(editor)),
    projectPath:root||null,
    projectExists:Boolean(root&&fs.existsSync(root)),
    isUnityProject:false,
    assets:false,
    projectSettings:false,
    packages:false,
    scripts:0,
    scenes:0
  };
  if(!root) return result;
  result.assets=fs.existsSync(path.join(root,'Assets'));
  result.projectSettings=fs.existsSync(path.join(root,'ProjectSettings'));
  result.packages=fs.existsSync(path.join(root,'Packages'));
  result.isUnityProject=result.assets&&result.projectSettings;
  if(!result.isUnityProject) return result;
  try{
    const tree=await unityProjectTree(root,5,1800);
    result.scripts=tree.items.filter(x=>x.type==='file'&&/\\.cs$/i.test(x.path)).length;
    result.scenes=tree.items.filter(x=>x.type==='file'&&/\\.unity$/i.test(x.path)).length;
  }catch{}
  result.ok=result.unityEditorExists&&result.isUnityProject;
  return result;
}

const WEATHER_CACHE_TTL=10*60*1000;
const weatherCache=new Map();

function weatherText(code){
  const c=Number(code);
  const map={
    0:'Açık',
    1:'Çoğunlukla açık',
    2:'Parçalı bulutlu',
    3:'Kapalı',
    45:'Sis',
    48:'Kırağılı sis',
    51:'Hafif çiseleme',
    53:'Çiseleme',
    55:'Yoğun çiseleme',
    56:'Hafif dondurucu çiseleme',
    57:'Yoğun dondurucu çiseleme',
    61:'Hafif yağmur',
    63:'Yağmur',
    65:'Kuvvetli yağmur',
    66:'Hafif dondurucu yağmur',
    67:'Kuvvetli dondurucu yağmur',
    71:'Hafif kar',
    73:'Kar',
    75:'Yoğun kar',
    77:'Kar taneleri',
    80:'Hafif sağanak',
    81:'Sağanak',
    82:'Kuvvetli sağanak',
    85:'Hafif kar sağanağı',
    86:'Yoğun kar sağanağı',
    95:'Gök gürültülü fırtına',
    96:'Dolu ihtimalli fırtına',
    99:'Kuvvetli dolu ihtimalli fırtına'
  };
  return map[c] || 'Bilinmeyen hava durumu';
}

async function getWeather(city='Istanbul'){
  const query=String(city||'Istanbul').trim().slice(0,120) || 'Istanbul';
  const key=query.toLocaleLowerCase('tr-TR');
  const cached=weatherCache.get(key);
  if(cached && Date.now()-cached.at<WEATHER_CACHE_TTL) return cached.data;

  const geoUrl='https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(query)+'&count=8&language=tr&format=json';
  const geoResponse=await fetch(geoUrl,{headers:{'User-Agent':'AURA-Desktop/4.2'}});
  if(!geoResponse.ok) throw new Error('Hava konumu bulunamadı (HTTP '+geoResponse.status+').');
  const geo=await geoResponse.json();
  const results=Array.isArray(geo?.results)?geo.results:[];
  const location=results.find(x=>String(x?.country_code||'').toUpperCase()==='TR') || results[0];
  if(!location) throw new Error('“'+query+'” için bir konum bulunamadı.');

  const forecastUrl='https://api.open-meteo.com/v1/forecast?latitude='+encodeURIComponent(location.latitude)+'&longitude='+encodeURIComponent(location.longitude)+'&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto';
  const response=await fetch(forecastUrl,{headers:{'User-Agent':'AURA-Desktop/4.2'}});
  if(!response.ok) throw new Error('Hava verisi alınamadı (HTTP '+response.status+').');
  const data=await response.json();
  const current=data?.current||{};
  const daily=data?.daily||{};
  const out={
    fetchedAt:new Date().toISOString(),
    location:{
      name:String(location.name||query),
      country:String(location.country||''),
      countryCode:String(location.country_code||''),
      latitude:Number(location.latitude),
      longitude:Number(location.longitude),
      timezone:String(data?.timezone||location.timezone||'')
    },
    current:{
      temperatureC:Number(current.temperature_2m),
      apparentTemperatureC:Number(current.apparent_temperature),
      humidityPercent:Number(current.relative_humidity_2m),
      weatherCode:Number(current.weather_code),
      description:weatherText(current.weather_code),
      windKmh:Number(current.wind_speed_10m),
      isDay:Number(current.is_day)===1
    },
    today:{
      maxC:Number(Array.isArray(daily.temperature_2m_max)?daily.temperature_2m_max[0]:NaN),
      minC:Number(Array.isArray(daily.temperature_2m_min)?daily.temperature_2m_min[0]:NaN),
      precipitationProbability:Number(Array.isArray(daily.precipitation_probability_max)?daily.precipitation_probability_max[0]:NaN)
    }
  };  weatherCache.set(key,{at:Date.now(),data:out});
  return out;
}

async function getBatteryStatus(){
  const result=await new Promise(resolve=>{
    const command="[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $b=@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object Name,BatteryStatus,EstimatedChargeRemaining,EstimatedRunTime); if($b.Count -eq 0){[PSCustomObject]@{available=$false}|ConvertTo-Json -Compress}else{$b | Select-Object -First 1 | Add-Member -NotePropertyName available -NotePropertyValue $true -PassThru | ConvertTo-Json -Compress}";
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,maxBuffer:1024*1024},(error,stdout)=>{
      if(error) return resolve({available:false});
      try{ resolve(JSON.parse(String(stdout||'{}'))||{available:false}); }
      catch{ resolve({available:false}); }
    });
  });
  const remaining=Number(result?.EstimatedChargeRemaining);
  const runtime=Number(result?.EstimatedRunTime);
  return {
    available:result?.available===true,
    name:String(result?.Name||''),
    chargePercent:Number.isFinite(remaining)?remaining:null,
    status:Number.isFinite(Number(result?.BatteryStatus))?Number(result.BatteryStatus):null,
    estimatedRuntimeMinutes:Number.isFinite(runtime)?runtime:null
  };
}

async function collectHardwareMetrics(){
  const totalGB=Number((os.totalmem()/1024/1024/1024).toFixed(1));
  const freeGB=Number((os.freemem()/1024/1024/1024).toFixed(1));
  const usedPercent=totalGB ? ((totalGB-freeGB)/totalGB)*100 : null;
  let cpu={usage:null,model:os.cpus()?.[0]?.model||'Bilinmiyor',cores:os.cpus()?.length||0};
  let disks=[];
  let psNet={downloadBps:0,uploadBps:0};
  try{
    const command=[
      "$cpu=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average",
      "$disks=Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,Size,FreeSpace",
      "$net=Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Where-Object { $_.Name } | Measure-Object -Property ReceivedBytes -Sum -Maximum; $net2=Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Where-Object { $_.Name } | Measure-Object -Property SentBytes -Sum -Maximum",
      "[pscustomobject]@{cpu=$cpu;disks=@($disks);recv=[double]$net.Sum;sent=[double]$net2.Sum} | ConvertTo-Json -Compress"
    ].join(';');
    const raw=await new Promise((resolve)=>{
      execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,maxBuffer:4*1024*1024},(error,stdout)=>resolve(error?'':String(stdout||'')));
    });
    if(raw){
      const data=JSON.parse(raw);
      cpu.usage=Number.isFinite(Number(data.cpu))?Number(data.cpu):null;
      disks=(Array.isArray(data.disks)?data.disks:[data.disks]).filter(Boolean).map(d=>{
        const size=Number(d.Size||0), free=Number(d.FreeSpace||0);
        const used=size-free;
        return {drive:String(d.DeviceID||'').trim(),totalGB:Number((size/1024/1024/1024).toFixed(1)),freeGB:Number((free/1024/1024/1024).toFixed(1)),usedPercent:size?used/size*100:null};
      }).filter(d=>d.drive);
      psNet={downloadBps:Number(data.recv||0),uploadBps:Number(data.sent||0)};
    }
  }catch{}
  let gpu={name:null,usage:null,temperatureC:null,memoryUsedMB:null,memoryTotalMB:null,source:null};
  try{
    const nvidia=await new Promise(resolve=>execFile('nvidia-smi.exe',['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total','--format=csv,noheader,nounits'],{windowsHide:true,maxBuffer:1024*1024},(error,stdout)=>resolve(error?'':String(stdout||''))));
    if(nvidia.trim()){
      const parts=nvidia.trim().split(',').map(x=>x.trim());
      gpu={name:parts[0]||null,usage:Number(parts[1]),temperatureC:Number(parts[2]),memoryUsedMB:Number(parts[3]),memoryTotalMB:Number(parts[4]),source:'nvidia-smi'};
    }
  }catch{}
  const now=Date.now();
  let downloadMbps=0,uploadMbps=0;
  if(hardwareSnapshot?.at && Number.isFinite(psNet.downloadBps) && Number.isFinite(psNet.uploadBps)){
    const seconds=Math.max(.25,(now-hardwareSnapshot.at)/1000);
    downloadMbps=Math.max(0,((psNet.downloadBps-(hardwareSnapshot.recv||0))*8/seconds)/1e6);
    uploadMbps=Math.max(0,((psNet.uploadBps-(hardwareSnapshot.sent||0))*8/seconds)/1e6);
  }
  hardwareSnapshot={at:now,recv:psNet.downloadBps,sent:psNet.uploadBps};
  return {
    timestamp:new Date().toISOString(),
    cpu,
    memory:{totalGB,freeGB,usedGB:Number((totalGB-freeGB).toFixed(1)),usedPercent},
    disks,
    gpu,
    network:{downloadMbps,uploadMbps,receivedBytes:psNet.downloadBps,sentBytes:psNet.uploadBps},
    temperatureSource:gpu.source||null
  };
}

const HARDWARE_CACHE_TTL=5000;
let hardwareMetricsCache=null;
let hardwareMetricsPromise=null;

async function getHardwareMetrics(){
  const now=Date.now();
  if(hardwareMetricsCache && now-hardwareMetricsCache.at<HARDWARE_CACHE_TTL){
    return hardwareMetricsCache.data;
  }
  if(hardwareMetricsPromise) return hardwareMetricsPromise;
  hardwareMetricsPromise=collectHardwareMetrics()
    .then(data=>{
      hardwareMetricsCache={at:Date.now(),data};
      return data;
    })
    .finally(()=>{hardwareMetricsPromise=null;});
  return hardwareMetricsPromise;
}

async function readClipboardText(){
  return {ok:true,text:String(clipboard.readText()||'').slice(0,20000)};
}

async function writeClipboardText(text){
  const value=String(text||'');
  if(!value.trim()) throw new Error('Panoya yazılacak metin boş.');
  const ok=await confirmAction('AURA — Pano onayı','AURA aşağıdaki metni Windows panosuna yazacak:\n\n'+value.slice(0,1200)+(value.length>1200?'…':'')+'\n\nDevam edilsin mi?');
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  clipboard.writeText(value);
  return {ok:true,length:value.length,message:'Metin Windows panosuna kopyalandı.'};
}

async function captureAuraScreen(name='aura'){
  const win=BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if(!win) throw new Error('AURA penceresi bulunamadı.');
  const ok=await confirmAction('AURA — Ekran görüntüsü','AURA mevcut AURA penceresinin ekran görüntüsünü Pictures\\AURA Captures klasörüne kaydedecek.\n\nDevam edilsin mi?');
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  const image=await win.webContents.capturePage();
  const dir=path.join(app.getPath('pictures'),'AURA Captures');
  await fsp.mkdir(dir,{recursive:true});
  const safe=String(name||'aura').replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ_-]+/g,'_').slice(0,60)||'aura';
  const file=path.join(dir,safe+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png');
  await fsp.writeFile(file,image.toPNG());
  return {ok:true,path:file,message:'Ekran görüntüsü kaydedildi: '+file};
}

function showAuraNotification(title='AURA',body=''){
  const text=String(body||'').trim();
  if(!text) throw new Error('Bildirim metni boş.');
  if(!Notification.isSupported()) throw new Error('Windows bildirimleri bu sistemde desteklenmiyor.');
  new Notification({title:String(title||'AURA').slice(0,120),body:text.slice(0,1000)}).show();
  return {ok:true,message:'Windows bildirimi gösterildi.'};
}

async function systemInfo(){
  let totalGB=os.totalmem()/1024/1024/1024;
  let freeGB=os.freemem()/1024/1024/1024;
  try{
    const raw=await new Promise(resolve=>{
      const command="[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json -Compress";
      execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,maxBuffer:1024*1024},(error,stdout)=>resolve(error?'':String(stdout||'')));
    });
    const data=JSON.parse(raw||'{}');
    const totalKB=Number(data?.TotalVisibleMemorySize);
    const freeKB=Number(data?.FreePhysicalMemory);
    if(Number.isFinite(totalKB)&&totalKB>0) totalGB=totalKB/1024/1024;
    if(Number.isFinite(freeKB)&&freeKB>=0) freeGB=freeKB/1024/1024;
  }catch{}
  totalGB=Number(totalGB.toFixed(1));
  freeGB=Number(Math.max(0,freeGB).toFixed(1));
  return {
    platform:process.platform,arch:process.arch,os:os.type()+' '+os.release(),hostname:os.hostname(),
    cpu:os.cpus()?.[0]?.model||'Bilinmiyor',cpuCount:os.cpus()?.length||0,
    memoryGB:totalGB,freeMemoryGB:freeGB,
    usedMemoryGB:Number(Math.max(0,totalGB-freeGB).toFixed(1)),
    usedMemoryPercent:totalGB?Number(((totalGB-freeGB)/totalGB*100).toFixed(1)):null,
    home:os.homedir()
  };
}
function findUnityEditorExecutable(){
  const candidates=[]; if(process.env.UNITY_EDITOR)candidates.push(process.env.UNITY_EDITOR);
  for(const root of ['C:\\Program Files\\Unity\\Hub\\Editor','C:\\Program Files\\Unity\\Editor','C:\\Program Files (x86)\\Unity\\Editor']){try{if(fs.existsSync(root))for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isDirectory())candidates.push(path.join(root,e.name,'Editor','Unity.exe'));}catch{}}
  return candidates.map(normalizePath).find(p=>fs.existsSync(p))||null;
}

function validateUnityProject(projectPath){
  const root=normalizePath(projectPath);
  if(!isAllowedPath(root)) throw new Error('Unity projesi kullanıcı erişim alanının dışında.');
  if(!fs.existsSync(path.join(root,'Assets'))||!fs.existsSync(path.join(root,'ProjectSettings'))) throw new Error('Geçerli bir Unity projesi değil: Assets ve ProjectSettings bulunamadı.');
  return root;
}
function validateUnityRelative(projectPath,relativePath){
  const root=validateUnityProject(projectPath);
  const rel=String(relativePath||'').replace(/^[/\\]+/,'');
  if(!rel || rel.includes('..')) throw new Error('Geçersiz Unity proje yolu.');
  const target=normalizePath(path.join(root,rel));
  const prefix=root.toLowerCase()+path.sep;
  if(target.toLowerCase()!==root.toLowerCase()&&!target.toLowerCase().startsWith(prefix)) throw new Error('Unity proje dışına erişim engellendi.');
  return {root,target,relative:rel};
}
async function unityProjectTree(projectPath,maxDepth=5,maxEntries=1200){
  const root=validateUnityProject(projectPath);
  const limit=Math.max(50,Math.min(3000,Number(maxEntries)||1200));
  const depthLimit=Math.max(1,Math.min(12,Number(maxDepth)||5));
  const skip=new Set(['Library','Temp','Logs','obj','Builds','UserSettings','.git','.vs','.idea']);
  const items=[];
  async function walk(dir,depth){
    if(depth>depthLimit||items.length>=limit)return;
    let entries=[];
    try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch{return;}
    entries.sort((a,b)=>a.name.localeCompare(b.name,'tr-TR'));
    for(const entry of entries){
      if(items.length>=limit)break;
      if(entry.name.startsWith('.')&&entry.name!=='.gitignore')continue;
      const full=path.join(dir,entry.name);
      const rel=path.relative(root,full).replace(/\\/g,'/');
      if(entry.isDirectory()&&skip.has(entry.name))continue;
      items.push({path:rel,type:entry.isDirectory()?'directory':'file'});
      if(entry.isDirectory())await walk(full,depth+1);
    }
  }
  await walk(root,0);
  return {ok:true,projectPath:root,count:items.length,truncated:items.length>=limit,items};
}
async function unityReadProjectFile(projectPath,relativePath){
  const {target,relative}=validateUnityRelative(projectPath,relativePath);
  const stat=await fsp.stat(target);
  if(!stat.isFile())throw new Error('Unity yolu bir dosya değil.');
  if(stat.size>5*1024*1024)throw new Error('Unity dosyası 5 MB sınırını aşıyor.');
  if(/\.(png|jpg|jpeg|gif|webp|ico|psd|tga|fbx|obj|blend|wav|mp3|ogg|mp4|mov|dll|so|exe|zip|7z|unitypackage)$/i.test(target)) throw new Error('Bu Unity dosyası ikili formatta; metin aracıyla okunamaz.');
  return {ok:true,projectPath:normalizePath(projectPath),relativePath:relative,content:await fsp.readFile(target,'utf8')};
}
async function unityWriteProjectFile(projectPath,relativePath,content){
  const {root,target,relative}=validateUnityRelative(projectPath,relativePath);
  const value=String(content??'');
  if(value.length>5*1024*1024)throw new Error('Unity dosyası 5 MB sınırını aşıyor.');
  const ok=await confirmAction('AURA — Unity dosyası değiştirme izni','AURA şu Unity dosyasını oluşturacak/değiştirecek:\n\n'+relative+'\n\nProje: '+root+'\n\nDevam edilsin mi?');
  if(!ok)throw new Error('Kullanıcı işlemi iptal etti.');
  await fsp.mkdir(path.dirname(target),{recursive:true});
  await fsp.writeFile(target,value,'utf8');
  return {ok:true,path:target,relativePath:relative,bytes:Buffer.byteLength(value,'utf8'),message:'Unity dosyası güncellendi.'};
}
async function unityCreateDirectory(projectPath,relativePath){
  const {root,target,relative}=validateUnityRelative(projectPath,relativePath);
  const ok=await confirmAction('AURA — Unity klasörü oluşturma izni','AURA şu Unity klasörünü oluşturacak:\n\n'+relative+'\n\nProje: '+root+'\n\nDevam edilsin mi?');
  if(!ok)throw new Error('Kullanıcı işlemi iptal etti.');
  await fsp.mkdir(target,{recursive:true});
  return {ok:true,path:target,relativePath:relative,message:'Unity klasörü oluşturuldu.'};
}
async function unityRunEditorMethod(projectPath,method,args=[]){
  const root=validateUnityProject(projectPath);
  const editor=findUnityEditorExecutable();
  if(!editor)throw new Error('Unity Editor bulunamadı.');
  const name=String(method||'').trim();
  if(!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name))throw new Error('Geçersiz Unity Editor method adı.');
  const safeArgs=Array.isArray(args)?args.map(x=>String(x).slice(0,1000)).slice(0,8):[];
  const ok=await confirmAction('AURA — Unity Editor otomasyonu','AURA Unity Editor üzerinde şu işlemi çalıştıracak:\n\n'+name+(safeArgs.length?'\nArgümanlar: '+safeArgs.join(' | '):'')+'\n\nProje: '+root+'\n\nDevam edilsin mi?');
  if(!ok)throw new Error('Kullanıcı işlemi iptal etti.');
  const cli=['-batchmode','-quit','-projectPath',root,'-executeMethod',name];
  for(const arg of safeArgs)cli.push('-auraArg',arg);
  return await runBackgroundProcess(editor,cli,{priority:'BelowNormal'});
}

async function createUnityProject(projectPath,projectName='AURA Game'){
  const root=normalizePath(projectPath); if(!isAllowedPath(root))throw new Error('Unity projesi yalnızca mevcut kullanıcı erişim alanında oluşturulabilir.');
  const ok=await confirmAction('AURA — Unity projesi oluşturma izni','AURA şu klasörde yeni bir Unity projesi oluşturacak:\n\n'+root+'\n\nDevam edilsin mi?'); if(!ok)throw new Error('Kullanıcı işlemi iptal etti.');
  const editor=findUnityEditorExecutable(); if(!editor)throw new Error('Unity Editor bulunamadı. UNITY_EDITOR ortam değişkeniyle Unity.exe yolunu gösterebilirsin.');
  await fsp.mkdir(root,{recursive:true});
  await runBackgroundProcess(editor,['-quit','-batchmode','-createProject',root],{priority:'BelowNormal'});
  return {ok:true,path:root,projectName,unityEditor:editor,message:'Unity projesi oluşturuldu.'};
}

async function unityApplyPlan(args={}) {
  const projectPath=normalizePath(args.projectPath||'');
  if(!projectPath) throw new Error('Unity proje yolu gerekli.');
  const root=validateUnityProject(projectPath);
  const files=Array.isArray(args.files)?args.files:[];
  const editor=args.editor && typeof args.editor==='object'?args.editor:null;
  const build=Boolean(args.build);
  const open=Boolean(args.open);
  if(files.length>80) throw new Error('Tek planda en fazla 80 Unity dosyası değiştirilebilir.');
  const operations=[];
  for(const item of files){
    const rel=String(item?.relativePath||'').replace(/^[/\\]+/,'');
    const content=String(item?.content??'');
    if(!rel || rel.includes('..')) throw new Error('Geçersiz Unity dosya yolu: '+rel);
    const checked=validateUnityRelative(root,rel);
    if(content.length>5*1024*1024) throw new Error('Unity dosyası 5 MB sınırını aşıyor: '+rel);
    operations.push({relativePath:checked.relative,target:checked.target,content});
  }
  let editorOp=null;
  if(editor){
    const rel=String(editor.relativePath||'Assets/Editor/AURAEditorBridge.cs').replace(/^[/\\]+/,'');
    const content=String(editor.content||'');
    const method=String(editor.method||'').trim();
    if(!rel.startsWith('Assets/') || !rel.startsWith('Assets/Editor/') || !rel.endsWith('.cs')) throw new Error('Editor otomasyon dosyası Assets/Editor altında .cs olmalı.');
    if(!method || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(method)) throw new Error('Geçersiz Unity Editor methodu.');
    const checked=validateUnityRelative(root,rel);
    operations.push({relativePath:checked.relative,target:checked.target,content});
    editorOp={method,args:Array.isArray(editor.args)?editor.args.map(x=>String(x).slice(0,1000)).slice(0,8):[]};
  }
  if(!operations.length && !editorOp && !open && !build) throw new Error('Unity autopilot planı boş.');
  const summary=operations.map(x=>x.relativePath).join('\n');
  const ok=await confirmAction('AURA — Unity Autopilot','AURA bu Unity projesinde otomatik geliştirme planını uygulayacak.\n\nProje:\n'+root+'\n\nDosyalar:\n'+(summary||'Dosya değişikliği yok')+'\n\nEditor otomasyonu: '+(editorOp?editorOp.method:'yok')+'\nBuild: '+(build?'EVET':'hayır')+'\n\nDevam edilsin mi?');
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  for(const op of operations){
    await fsp.mkdir(path.dirname(op.target),{recursive:true});
    await fsp.writeFile(op.target,op.content,'utf8');
  }
  let editorResult=null;
  if(editorOp) editorResult=await unityRunEditorMethod(root,editorOp.method,editorOp.args);
  let buildResult=null;
  if(build) buildResult=await buildUnityProject(root,'StandaloneWindows64');
  if(open) await openUnityProject(root);
  return {ok:true,projectPath:root,filesChanged:operations.map(x=>x.relativePath),editor:editorResult,build:buildResult,opened:open};
}

async function unityCreateScript(projectPath,relativePath,content){
  const root=normalizePath(projectPath),target=normalizePath(path.join(root,String(relativePath||'')));
  if(!isAllowedPath(root)||!isAllowedPath(target)||!target.toLowerCase().startsWith(path.join(root,'assets').toLowerCase()+path.sep)||!target.toLowerCase().endsWith('.cs'))throw new Error('Unity script yalnızca izinli projenin Assets altında .cs olarak oluşturulabilir.');
  return writeTextFile(target,String(content||''));
}
async function unityOpenProject(projectPath){return openUnityProject(normalizePath(projectPath));}
async function buildUnityProject(projectPath,target='StandaloneWindows64'){
  const root=normalizePath(projectPath); if(!isAllowedPath(root))throw new Error('Unity proje yolu izinli değil.');
  const editor=findUnityEditorExecutable(); if(!editor)throw new Error('Unity Editor bulunamadı.');
  const ok=await confirmAction('AURA — Unity build izni','AURA Unity projesini derleyecek:\n\n'+root+'\n\nHedef: '+target); if(!ok)throw new Error('Kullanıcı işlemi iptal etti.');
  const buildDir=path.join(root,'Builds'); await fsp.mkdir(buildDir,{recursive:true});
  const buildFile=path.join(buildDir,'AURA.exe');
  const bootstrap=path.join(root,'Assets','Scripts','AURABuild.cs');
  const source=['using UnityEditor;','public static class AURABuild {',' public static void Build(){','  BuildPipeline.BuildPlayer(EditorBuildSettings.scenes, "'+buildFile.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'", BuildTarget.StandaloneWindows64, BuildOptions.None);',' }','}'].join('\n');
  await writeTextFile(bootstrap,source);
  const result=await runBackgroundProcess(editor,['-batchmode','-quit','-projectPath',root,'-executeMethod','AURABuild.Build','-logFile','-'],{priority:'BelowNormal'});
  return {ok:true,project:root,target,buildFile,taskId:result.taskId,priority:result.priority,exitCode:result.exitCode,log:appendCapped(result.stdout||'',result.stderr||'',16000)};
}
async function getAuraSelfDiagnostics(){
  const checks=[];
  const add=(name,ok,detail)=>checks.push({name,ok:Boolean(ok),detail:String(detail||'')});
  try{
    const root=path.resolve(__dirname,'..');
    const renderer=path.join(__dirname,'renderer');
    const indexPath=app.isPackaged?path.join(renderer,'index.html'):path.join(root,'index.html');
    const aiPath=app.isPackaged?path.join(renderer,'local-ai.js'):path.join(root,'local-ai.js');
    const [indexExists,aiExists]=await Promise.all([
      fsp.access(indexPath).then(()=>true).catch(()=>false),
      fsp.access(aiPath).then(()=>true).catch(()=>false)
    ]);
    add('Renderer index.html',indexExists,indexPath);
    add('Renderer local-ai.js',aiExists,aiPath);
    let indexSource='';
    if(indexExists){
      indexSource=await fsp.readFile(indexPath,'utf8');
      add('Drive intent',indexSource.includes('function isDriveListRequest') && indexSource.includes('function safeDriveListRequest'),indexSource.includes('function isDriveListRequest')?'isDriveListRequest mevcut':'isDriveListRequest eksik');
      add('Core state',indexSource.includes('setCoreState'),indexSource.includes('setCoreState')?'çekirdek durum sistemi mevcut':'çekirdek durum sistemi eksik');
      add('Self-test routing',indexSource.includes('isDiagnosticsRequest(q)') && indexSource.includes('desktop_self_diagnostics'),indexSource.includes('isDiagnosticsRequest(q)')?'kendini test yönlendirmesi mevcut':'kendini test yönlendirmesi eksik');
    }
    if(aiExists){
      const source=await fsp.readFile(aiPath,'utf8');
      add('Local AI module',source.includes('CreateMLCEngine'),source.includes('CreateMLCEngine')?'yerel AI motoru mevcut':'yerel AI motoru eksik');
    }
  }catch(error){
    add('Renderer dosya kontrolü',false,error?.message||error);
  }
  try{ const drives=await listDrives(); add('Sürücü aracı',Array.isArray(drives)&&drives.length>0,Array.isArray(drives)?drives.length+' sürücü bulundu':'sonuç alınamadı'); }
  catch(error){ add('Sürücü aracı',false,error?.message||error); }
  try{ const hw=await getHardwareMetrics(); add('Donanım aracı',Boolean(hw),hw?.cpu?'CPU verisi hazır':'donanım verisi eksik'); }
  catch(error){ add('Donanım aracı',false,error?.message||error); }
  add('Kalıcı hafıza',Array.isArray(memoryState?.items),Array.isArray(memoryState?.items)?memoryState.items.length+' kayıt':'hafıza durumu bozuk');
  add('Konuşma geçmişi',Array.isArray(conversationState?.items),Array.isArray(conversationState?.items)?conversationState.items.length+' kayıt':'geçmiş durumu bozuk');
  add('Telefon bağlantısı',Boolean(remoteServerPort),remoteServerPort?'HTTP '+remoteServerPort+' hazır':'remote sunucusu kapalı');
  const failed=checks.filter(x=>!x.ok);
  return {ok:failed.length===0,version:'6.2.0',checkedAt:new Date().toISOString(),summary:failed.length?failed.length+' kontrol başarısız.':'Tüm temel AURA kontrolleri başarılı.',checks};
}

async function getAuraSystemHealth(){
  const results=await Promise.allSettled([getHardwareMetrics(),getUsageReport(),getEnvironmentProfile(),getBackgroundTaskStatus(),Promise.resolve(listMemory()),Promise.resolve(listReminders()),Promise.resolve(listRoutines()),Promise.resolve(getRemoteControlInfo())]);
  const v=(i,f)=>results[i]?.status==='fulfilled'?results[i].value:f;
  const hw=v(0,{}), usage=v(1,{}), profile=v(2,{}), background=v(3,{}), memory=v(4,{items:[]}), reminders=v(5,{items:[]}), routines=v(6,{items:[]}), remote=v(7,{enabled:false});
  const warnings=[]; const cpu=Number(hw?.cpu?.usage), ram=Number(hw?.memory?.usedPercent), disk=Number(hw?.disks?.[0]?.usedPercent), temp=Number(hw?.gpu?.temperatureC);
  if(Number.isFinite(cpu)&&cpu>=90) warnings.push('CPU kullanımı çok yüksek.');
  if(Number.isFinite(ram)&&ram>=90) warnings.push('RAM kullanımı çok yüksek.');
  if(Number.isFinite(disk)&&disk>=90) warnings.push('Ana disk doluluk oranı çok yüksek.');
  if(Number.isFinite(temp)&&temp>=85) warnings.push('GPU sıcaklığı yüksek.');
  return {ok:true,version:'6.1.0',user:os.userInfo().username,hardware:hw,usage,profileSummary:{apps:Number(profile?.applicationSummary?.userApps||0),games:Array.isArray(profile?.games)?profile.games.length:0,processes:Number(profile?.runningProcesses?.count||0)},background,memory:{count:Array.isArray(memory?.items)?memory.items.length:0},reminders:{count:Array.isArray(reminders?.items)?reminders.items.length:0},routines:{count:Array.isArray(routines?.items)?routines.items.length:0},remote,warnings};
}

async function getAuraAppCatalog(){
  const profile=await getEnvironmentProfile();
  const apps=Array.isArray(profile?.apps)?profile.apps:[]; const games=Array.isArray(profile?.games)?profile.games:[];
  return {ok:true,apps:apps.slice(0,250),games:games.slice(0,250),counts:{apps:apps.length,games:games.length}};
}

function getAuraMemoryStats(){
  const items=Array.isArray(memoryState?.items)?memoryState.items:[]; const tags={};
  for(const item of items) for(const tag of (Array.isArray(item.tags)?item.tags:[])) tags[tag]=(tags[tag]||0)+1;
  const newest=[...items].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0]||null;
  return {ok:true,count:items.length,tags,newest};
}
async function handleTool(tool,args) {
  switch(tool) {
    case 'openclaw_status': return openclaw.status();
    case 'openclaw_configure': return (async()=>{
      const ok=await confirmAction('AURA — OpenClaw bağlantısı','OpenClaw Gateway bağlantı bilgileri kaydedilecek. Token yalnızca bu bilgisayardaki AURA kullanıcı verilerinde tutulur. Devam edilsin mi?');
      if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
      return openclaw.configure(args||{});
    })();
    case 'openclaw_chat': return openclaw.chat(args?.input||'',args||{});
    case 'desktop_self_diagnostics': return getAuraSelfDiagnostics();
    case 'desktop_get_hardware_metrics': return getHardwareMetrics();
    case 'desktop_get_system_health': return getAuraSystemHealth();
    case 'desktop_get_app_catalog': return getAuraAppCatalog();
    case 'desktop_get_memory_stats': return getAuraMemoryStats();
    case 'desktop_reminder_create': return createReminder(args||{});
    case 'desktop_reminder_list': return listReminders();
    case 'desktop_reminder_cancel': return cancelReminder(args?.query);
    case 'desktop_routine_create': return createRoutine(args||{});
    case 'desktop_routine_list': return listRoutines();
    case 'desktop_routine_cancel': return cancelRoutine(args?.query);
    case 'desktop_daily_briefing': return dailyBriefing();
    case 'desktop_clipboard_read': return readClipboardText();
    case 'desktop_clipboard_write': return writeClipboardText(args.text);
    case 'desktop_capture_screen': return captureAuraScreen(args.name||'aura');
    case 'desktop_notify': return showAuraNotification(args.title||'AURA',args.body);

    case 'desktop_get_remote_control': return getRemoteControlInfo();
    case 'desktop_get_remote_qr': return getRemoteControlQr();
    case 'desktop_phone_push': return pushPhoneTransfer(args);
    case 'desktop_phone_get_session': return getPhoneSession();
    case 'desktop_phone_clear': return clearPhoneSession();
    case 'desktop_get_weather': return getWeather(args.city||'Istanbul');
    case 'desktop_get_battery_status': return getBatteryStatus();
    case 'desktop_open_camera': return openCamera();
    case 'desktop_open_windows_utility': return openWindowsUtility(args.kind);
    case 'desktop_find_unity_projects': return findUnityProjects(args.maxResults||20);
    case 'desktop_unity_health_check': return unityHealthCheck(args.projectPath||'');
    case 'desktop_get_system_info': return await systemInfo();
    case 'desktop_list_directory': return listDirectory(normalizePath(args.path));
    case 'desktop_read_text_file': return {path:normalizePath(args.path),content:await readTextFile(normalizePath(args.path))};
    case 'desktop_write_text_file': return writeTextFile(normalizePath(args.path),args.content);
    case 'desktop_create_directory': return makeDirectory(normalizePath(args.path));
    case 'desktop_delete_path': return deletePath(normalizePath(args.path));
    case 'desktop_open_path': return openPath(normalizePath(args.path));
    case 'desktop_choose_folder': return chooseFolder(args.purpose);
    case 'desktop_list_drives': return listDrives();
    case 'desktop_copy_path': return copyPath(args.source,args.destination);
    case 'desktop_move_path': return movePath(args.source,args.destination);
    case 'desktop_search_files': return searchFiles(args.root,args.query,args.maxResults||80);
    case 'desktop_run_powershell': return runPowerShell(args.command);
    case 'desktop_launch_app': return launchApp(args.app);
    case 'desktop_find_and_launch_app': return findAndLaunchApp(args.app);
    case 'desktop_close_app': return closeAppByName(args.app);
    case 'desktop_restart_app': {
      const target=normalizeAppControlName(args.app);
      await closeAppByName(target);
      await new Promise(r=>setTimeout(r,900));      return {...await findAndLaunchApp(target),restarted:true};
    }
    case 'desktop_uninstall_app': return uninstallAppByName(args.app);
    case 'desktop_scan_environment': return scanEnvironment({mode:args?.mode==='deep'?'deep':'quick',force:Boolean(args?.force)});
    case 'desktop_cancel_scan': return cancelEnvironmentScan();
    case 'desktop_get_scan_status': return getScanStatus();
    case 'desktop_get_background_tasks': return getBackgroundTaskStatus();
    case 'desktop_get_environment_profile': return getEnvironmentProfile();
    case 'desktop_get_running_apps': return getRunningApps();
    case 'desktop_get_usage_report': return getUsageReport();
    case 'desktop_memory_save': return remember(args.text,args.tags||[]);
    case 'desktop_conversation_search': return searchConversations(args.query,args.maxResults||18);
    case 'desktop_conversation_log': return logConversation(args.user,args.assistant,args.mode||'chat');
    case 'desktop_memory_search': return searchMemory(args.query,args.maxResults||12);
    case 'desktop_memory_list': return listMemory();
    case 'desktop_memory_forget': return forgetMemory(args.query);
    case 'desktop_memory_clear': return clearMemory();
    case 'desktop_open_external_url': return openExternalUrl(args.url);
    case 'desktop_speak_text': return speakTextWindows(args.text);
    case 'desktop_stop_speech': return stopWindowsSpeech();
    case 'desktop_open_unity_project': return openUnityProject(normalizePath(args.projectPath));
    case 'desktop_unity_project_tree': return unityProjectTree(args.projectPath,args.maxDepth,args.maxEntries);
    case 'desktop_unity_read_file': return unityReadProjectFile(args.projectPath,args.relativePath);
    case 'desktop_unity_write_file': return unityWriteProjectFile(args.projectPath,args.relativePath,args.content);
    case 'desktop_unity_create_directory': return unityCreateDirectory(args.projectPath,args.relativePath);
    case 'desktop_unity_run_editor': return unityRunEditorMethod(args.projectPath,args.method,args.args||[]);
    case 'desktop_create_unity_project': return createUnityProject(args.projectPath,args.projectName||'AURA Game');
    case 'desktop_unity_create_script': return unityCreateScript(args.projectPath,args.relativePath,args.content);
    case 'desktop_unity_open_project': return unityOpenProject(args.projectPath);
    case 'desktop_unity_build': return buildUnityProject(args.projectPath,args.target||'StandaloneWindows64');
    case 'desktop_unity_autopilot': return unityApplyPlan(args);
    case 'desktop_web_research': return webResearch(args.query,args.maxResults||12);
    case 'desktop_web_search': return webSearch(args.query);
    case 'desktop_fetch_web_page': return fetchWebPage(args.url);
    default: throw new Error('Bilinmeyen AURA aracı: '+tool);
  }
}

function localRendererRoot() {
  return app.isPackaged ? path.join(__dirname,'renderer') : path.join(__dirname,'..');
}

function startLocalRendererServer() {
  if (localServer && localServerPort) return Promise.resolve(localServerPort);

  return new Promise((resolve,reject)=>{
    const root=path.resolve(localRendererRoot());
    const mime={
      '.html':'text/html; charset=utf-8',
      '.js':'text/javascript; charset=utf-8',
      '.json':'application/json; charset=utf-8',
      '.css':'text/css; charset=utf-8',
      '.png':'image/png',
      '.jpg':'image/jpeg',
      '.jpeg':'image/jpeg',
      '.svg':'image/svg+xml',
      '.ico':'image/x-icon'
    };
    const allowed=new Set(['index.html','local-ai.js']);

    localServer=http.createServer(async(req,res)=>{
      try{
        const requestPath=decodeURIComponent(String(req.url||'/').split('?')[0]);
        const relative=requestPath==='/' ? 'index.html' : requestPath.split('/').filter(Boolean).join('/');

        if(!allowed.has(relative)){
          res.writeHead(404,{'Cache-Control':'no-store'});
          res.end('Not Found');
          return;
        }

        const file=path.resolve(root,relative);
        if(file!==path.resolve(root,'index.html') && file!==path.resolve(root,'local-ai.js')){
          res.writeHead(403,{'Cache-Control':'no-store'});
          res.end('Forbidden');
          return;
        }

        const body=await fsp.readFile(file);
        res.writeHead(200,{
          'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream',
          'Cache-Control':'no-store'
        });
        res.end(body);
      }catch{
        res.writeHead(500,{'Cache-Control':'no-store'});
        res.end('AURA local server error');
      }
    });

    localServer.once('error',reject);
    localServer.listen(0,'127.0.0.1',()=>{
      localServerPort=localServer.address().port;
      resolve(localServerPort);
    });
  });
}


async function loadRemoteControlToken(){
  try{const raw=await fsp.readFile(REMOTE_FILE,'utf8');const data=JSON.parse(raw);if(typeof data?.token==='string'&&/^[a-f0-9]{32,128}$/i.test(data.token)){remoteControlToken=data.token;return;}}catch{}
  remoteControlToken=crypto.randomBytes(24).toString('hex');
  try{await fsp.mkdir(path.dirname(REMOTE_FILE),{recursive:true});await fsp.writeFile(REMOTE_FILE,JSON.stringify({token:remoteControlToken,createdAt:new Date().toISOString()},null,2),'utf8');}catch{}
}
function getLanAddress(){
  const nets=os.networkInterfaces();
  for(const entries of Object.values(nets)) for(const item of (entries||[])) if(item&&item.family==='IPv4'&&!item.internal&&!String(item.address).startsWith('127.')) return item.address;
  return '127.0.0.1';
}
function remoteAuthorized(url){return String(url?.searchParams?.get('token')||'')===String(remoteControlToken||'');}
function pushPhoneTransfer(args={}){
  const kind=String(args.kind||'text').slice(0,40);
  const title=String(args.title||'AURA aktarımı').trim().slice(0,160);
  const text=String(args.text||'').trim().slice(0,20000);
  const user=String(args.user||'').trim().slice(0,4000);
  const assistant=String(args.assistant||'').trim().slice(0,12000);
  const conversation=Array.isArray(args.conversation)
    ? args.conversation.slice(-40).map(item=>({
        role:String(item?.role||'').slice(0,20),
        text:String(item?.text||'').slice(0,7000)
      }))
    : [];
  const item={
    id:'phone_'+Date.now().toString(36)+'_'+crypto.randomBytes(4).toString('hex'),
    kind,title,text,user,assistant,conversation,
    createdAt:new Date().toISOString()
  };
  phoneState.items.unshift(item);
  phoneState.items=phoneState.items.slice(0,30);
  phoneState.updatedAt=item.createdAt;
  return {ok:true,id:item.id,title:item.title,createdAt:item.createdAt};
}
function getPhoneSession(){
  return {
    version:phoneState.version,
    updatedAt:phoneState.updatedAt,
    items:phoneState.items.slice(0,20)
  };
}
function clearPhoneSession(){
  phoneState={version:1,updatedAt:null,items:[]};
  return {ok:true,cleared:true};
}

function remotePage(){
  return "<!doctype html>\n<html lang=\"tr\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"theme-color\" content=\"#03070c\">\n<title>AURA Telefon</title>\n<style>\n*{box-sizing:border-box}\nbody{margin:0;background:#03070c;color:#edfaff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh;background:radial-gradient(circle at 50% 8%,#12313d,#03070c 44%)}\nmain{width:min(720px,100%);margin:auto;padding:20px 16px 44px}\n.brand{text-align:center;letter-spacing:6px;font-weight:850;font-size:21px}\n.subtitle{text-align:center;color:#67808d;font-size:9px;letter-spacing:1.4px;margin-top:5px}\n.core{width:190px;height:190px;margin:22px auto 13px;position:relative;border-radius:50%;display:grid;place-items:center;border:1px solid #3fe5ff88;box-shadow:0 0 55px #28dfff22,inset 0 0 35px #28dfff16}\n.core:before,.core:after{content:\"\";position:absolute;border-radius:50%;border:1px solid #53eaff55}\n.core:before{inset:16px;border-style:dashed;animation:r1 8s linear infinite}\n.core:after{inset:35px;border-top-color:#7b8cff;border-bottom-color:#62e8ff;animation:r1 4s linear infinite reverse}\n.orb{width:62px;height:62px;border-radius:50%;background:radial-gradient(circle,#fff,#68efff 20%,#0b7188 48%,transparent 72%);box-shadow:0 0 35px #48eaff}\n.online{text-align:center;color:#6ff0b1;font-size:10px;letter-spacing:2px}\n.panel{margin-top:14px;padding:14px;border:1px solid #172833;border-radius:16px;background:#071018dc;box-shadow:0 14px 40px #0004}\n.title{font-size:9px;letter-spacing:1.8px;color:#78929f}\ninput{width:100%;margin-top:9px;padding:13px;border-radius:11px;border:1px solid #243743;background:#081017;color:white;outline:0}\n.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:9px}\nbutton{font:inherit;border:1px solid #20313b;background:#0c161e;color:#d9faff;border-radius:11px;padding:11px;cursor:pointer}\nbutton.primary{border-color:#35dfff55;background:#0c2530}\n.out,.content,.conversation{white-space:pre-wrap;color:#b0c0c9;font-size:12px;line-height:1.55}\n.out{min-height:24px;margin-top:10px}\n.content{margin-top:8px;color:#e8faff}\n.conversation{margin-top:12px;padding-top:11px;border-top:1px solid #12232d;color:#8ea6b2;max-height:260px;overflow:auto}\n.transferMeta{display:flex;justify-content:space-between;gap:10px;margin-top:5px;color:#5e7580;font-size:9px}\n.stat{display:flex;justify-content:space-between;color:#78909c;font-size:11px;padding:8px 0;border-bottom:1px solid #13212a}\n.stat b{color:#e8f8fb}\n.small{text-align:center;color:#536875;font-size:9px;margin-top:13px;line-height:1.5}\n.empty{color:#5e7580}\n@keyframes r1{to{transform:rotate(360deg)}}\n</style>\n</head>\n<body>\n<main>\n  <div class=\"brand\">AURA</div>\n  <div class=\"subtitle\">PHONE LINK · LOCAL NETWORK</div>\n  <div class=\"core\"><div class=\"orb\"></div></div>\n  <div class=\"online\">● AURA PHONE LINK ONLINE</div>\n\n  <div class=\"panel\">\n    <div class=\"title\">PC KOMUTU</div>\n    <input id=\"cmd\" placeholder=\"Minecraft aç, PC durumu, kamera aç...\">\n    <div class=\"grid\">\n      <button class=\"primary\" onclick=\"act('minecraft aç')\">Minecraft</button>\n      <button onclick=\"act('kamera aç')\">Kamera</button>\n      <button onclick=\"act('Chrome aç')\">Chrome</button>\n      <button onclick=\"act('Görev yöneticisi')\">Görev Yöneticisi</button>\n      <button onclick=\"act('Bilgisayarımı tara')\">PC Tara</button>\n      <button onclick=\"act('Hesap makinesi')\">Hesap Makinesi</button>\n    </div>\n    <div class=\"grid\">\n      <button onclick=\"status()\">PC Durumu</button>\n      <button onclick=\"act('Masaüstünü aç')\">Masaüstü</button>\n    </div>\n    <div class=\"out\" id=\"out\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <div class=\"title\">TELEFONA AKTARILAN</div>\n    <div id=\"transferTitle\" class=\"content empty\">Henüz aktarım yok.</div>\n    <div id=\"transferMeta\" class=\"transferMeta\"><span>—</span><span>—</span></div>\n    <div id=\"transferText\" class=\"content\"></div>\n    <div id=\"conversation\" class=\"conversation\" style=\"display:none\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <div class=\"title\">CANLI PC</div>\n    <div class=\"stat\"><span>CPU</span><b id=\"cpu\">—</b></div>\n    <div class=\"stat\"><span>RAM</span><b id=\"ram\">—</b></div>\n    <div class=\"stat\"><span>GPU</span><b id=\"gpu\">—</b></div>\n    <div class=\"stat\"><span>Sıcaklık</span><b id=\"temp\">—</b></div>\n    <div class=\"stat\"><span>Kullanıcı</span><b id=\"user\">—</b></div>\n  </div>\n\n  <div class=\"small\">Telefon ve AURA Desktop aynı Wi‑Fi ağında olmalı.<br>Bağlantı token ile korunur; bu sayfa internete açılmaz.</div>\n</main>\n\n<script>\nconst token=new URLSearchParams(location.search).get('token')||'';\nlet lastTransferId='';\n\nasync function requestJson(path,options){\n  const joiner=path.includes('?')?'&':'?';\n  const r=await fetch(path+joiner+'token='+encodeURIComponent(token),options||{cache:'no-store'});\n  return await r.json();\n}\nasync function act(command){\n  document.getElementById('out').textContent='Çalışıyor...';\n  try{\n    const j=await requestJson('/api/action?command='+encodeURIComponent(command));\n    document.getElementById('out').textContent=j.message||j.error||'Tamam';\n    await status();\n  }catch{\n    document.getElementById('out').textContent='Bağlantı hatası';\n  }\n}\nasync function status(){\n  try{\n    const j=await requestJson('/api/status');\n    if(!j.ok)return;\n    const h=j.hardware||{};\n    document.getElementById('cpu').textContent=h.cpu?.usage!=null?h.cpu.usage+'%':'—';\n    document.getElementById('ram').textContent=h.memory?.usedPercent!=null?h.memory.usedPercent.toFixed(0)+'%':'—';\n    document.getElementById('gpu').textContent=h.gpu?.usage!=null?h.gpu.usage+'%':'—';\n    document.getElementById('temp').textContent=h.gpu?.temperatureC!=null?h.gpu.temperatureC+'°C':'ölçüm yok';\n    document.getElementById('user').textContent=j.user||'—';\n  }catch{}\n}\nasync function loadPhone(){\n  try{\n    const j=await requestJson('/api/phone');\n    if(!j.ok)return;\n    const items=Array.isArray(j.session?.items)?j.session.items:[];\n    const last=items[0];\n    if(!last){\n      document.getElementById('transferTitle').textContent='Henüz aktarım yok.';\n      document.getElementById('transferTitle').className='content empty';\n      return;\n    }\n    if(last.id===lastTransferId)return;\n    lastTransferId=last.id;\n    const title=document.getElementById('transferTitle');\n    const text=document.getElementById('transferText');\n    const meta=document.getElementById('transferMeta');\n    const conversation=document.getElementById('conversation');\n    title.className='content';\n    title.textContent=last.title||'AURA aktarımı';\n    text.textContent=last.text||last.assistant||last.user||'';\n    const when=last.createdAt?new Date(last.createdAt).toLocaleString('tr-TR'):'—';\n    meta.innerHTML='';\n    const a=document.createElement('span'); a.textContent=last.kind||'text';\n    const b=document.createElement('span'); b.textContent=when;\n    meta.append(a,b);\n    if(Array.isArray(last.conversation)&&last.conversation.length){\n      conversation.style.display='block';\n      conversation.textContent=last.conversation.map(x=>{\n        const role=String(x?.role||'').toLowerCase()==='user'?'SEN':'AURA';\n        return role+' · '+String(x?.text||'');\n      }).join('\\n\\n');\n    }else{\n      conversation.style.display='none';\n      conversation.textContent='';\n    }\n  }catch{}\n}\ndocument.getElementById('cmd').addEventListener('keydown',e=>{\n  if(e.key==='Enter'&&e.target.value.trim()){act(e.target.value.trim());e.target.value='';}\n});\nstatus();\nloadPhone();\nsetInterval(status,5000);\nsetInterval(loadPhone,1000);\n</script>\n</body>\n</html>";
}
function remoteCommand(command){
  const q=String(command||'').toLocaleLowerCase('tr-TR').trim();
  if(/^(pc tara|bilgisayarımı tara|bilgisayarimi tara|sistemi tara)$/.test(q)) return ['desktop_scan_environment',{}];
  if(/^(pc durumu|bilgisayar durumu|sistem durumu|donanım|donanim|performans)$/.test(q)) return ['desktop_get_hardware_metrics',{}];
  if(/^(kamera|kamerayı aç|kamerayi ac|kamera aç|kamera ac|webcam|webcamı aç|webcami ac|cam aç|cam ac)$/.test(q)) return ['desktop_open_camera',{}];
  if(/^(görev yöneticisi|gorev yoneticisi|task manager|taskmgr)$/.test(q)) return ['desktop_open_windows_utility',{kind:'taskmanager'}];
  if(/^(hesap makinesi|calculator)$/.test(q)) return ['desktop_open_windows_utility',{kind:'calculator'}];
  if(/^(not defteri|notepad)$/.test(q)) return ['desktop_open_windows_utility',{kind:'notepad'}];
  if(/^(masaüstü|desktop|masaüstünü aç|masaustunu ac)$/.test(q)) return ['desktop_open_windows_utility',{kind:'desktop'}];
  if(/^(ayarlar|windows ayarları|windows ayarlari|ayarlari ac)$/.test(q)) return ['desktop_open_windows_utility',{kind:'settings'}];
  const close=q.match(/^(.+?)\\s+(kapat|kapatın|kapatir|kapatır)$/);
  if(close) return ['desktop_close_app',{app:close[1].trim()}];
  const restart=q.match(/^(.+?)\\s+(yeniden başlat|yeniden baslat|restart)$/);
  if(restart) return ['desktop_restart_app',{app:restart[1].trim()}];
  const m=q.match(/^(.+?)\\s+aç$/);
  if(m) return ['desktop_find_and_launch_app',{app:m[1].trim().replace(/['’](?:y?[ıiuü])$/i,'').replace(/(?:y[ıiuü])$/i,'')}];
  return null;
}
async function startRemoteControlServer(){
  if(remoteServer&&remoteServerPort)return;
  await loadRemoteControlToken();
  remoteServer=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/', 'http://'+(req.headers.host||'127.0.0.1'));
      if(url.pathname==='/'||url.pathname==='/remote'){
        if(!remoteAuthorized(url)){res.writeHead(401,{'Content-Type':'text/plain; charset=utf-8'});return res.end('AURA remote yetkisi gerekli.');}
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(remotePage());
      }
      if(!remoteAuthorized(url)){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:false,error:'Yetkisiz remote erişim.'}));}
      if(url.pathname==='/api/status'){
        const hardware=await getHardwareMetrics();
        const profile=await getEnvironmentProfile();
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        return res.end(JSON.stringify({ok:true,hardware,user:os.userInfo().username,apps:profile?.applicationSummary?.userApps||0,games:Array.isArray(profile?.games)?profile.games.length:0}));
      }
      if(url.pathname==='/api/phone'){
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        return res.end(JSON.stringify({ok:true,session:getPhoneSession()}));
      }
      if(url.pathname==='/api/action'){
        const command=url.searchParams.get('command')||'';
        const pair=remoteCommand(command);
        if(!pair)throw new Error('Bu telefon komutu henüz desteklenmiyor.');
        const result=await handleTool(pair[0],pair[1]);
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        return res.end(JSON.stringify({ok:true,message:result?.message||'Komut tamamlandı.',result}));
      }
      res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:false,error:'Bulunamadı'}));
    }catch(error){
      res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:false,error:error?.message||'Remote hata'}));
    }
  });
  await new Promise((resolve,reject)=>{remoteServer.once('error',reject);remoteServer.listen(0,'0.0.0.0',()=>{remoteServerPort=remoteServer.address().port;resolve();});});
}
function getRemoteControlInfo(){
  const ip=getLanAddress();
  return {
    enabled:Boolean(remoteServerPort),
    ip,
    port:remoteServerPort,
    url:remoteServerPort?('http://'+ip+':'+remoteServerPort+'/?token='+remoteControlToken):null
  };
}
async function getRemoteControlQr(){
  const info=getRemoteControlInfo();
  if(!info.url) throw new Error('Telefon kumandası henüz başlatılmadı.');
  const dataUrl=await QRCode.toDataURL(info.url,{
    errorCorrectionLevel:'M',
    margin:1,
    width:420,
    color:{dark:'#07131b',light:'#ffffff'}
  });
  return {...info,dataUrl};
}
async function stopRemoteControlServer(){const server=remoteServer;remoteServer=null;remoteServerPort=null;if(!server)return;await new Promise(resolve=>{try{server.close(()=>resolve());}catch{resolve();}});}

async function closeLocalRendererServer(){
  const server=localServer;
  localServer=null;
  localServerPort=null;
  if(!server)return;
  await new Promise(resolve=>{
    try{server.close(()=>resolve());}catch{resolve();}
  });
}

async function loadAuraRenderer(win){
  const port=await startLocalRendererServer();
  await win.loadURL('http://127.0.0.1:'+port+'/index.html');
}

function createWindow(){
  const win=new BrowserWindow({
    width:1480,
    height:920,
    minWidth:1000,
    minHeight:680,
    backgroundColor:'#02050b',
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true
    }
  });

  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.setAudioMuted(false);
  win.webContents.setBackgroundThrottling(false);

  win.webContents.on('will-navigate',(event,url)=>{
    try{
      const u=new URL(url);
      const isLocalRenderer=u.hostname==='127.0.0.1' && u.protocol==='http:';
      if(u.protocol==='file:' || u.origin===ALLOWED_REMOTE_ORIGIN || isLocalRenderer) return;
      event.preventDefault();
    }catch{
      event.preventDefault();
    }
  });

  win.webContents.on('did-fail-load',(_event,errorCode,errorDescription)=>{
    console.error('[AURA] renderer load failed:',errorCode,errorDescription);
  });

  const isTrustedRenderer = (webContents) => {
    try {
      const raw = webContents?.getURL?.() || '';
      const u = new URL(raw);
      return u.protocol === 'file:' ||
        (u.protocol === 'http:' && u.hostname === '127.0.0.1') ||
        u.origin === ALLOWED_REMOTE_ORIGIN;
    } catch {
      return false;
    }
  };

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission !== 'media') return false;
    try {
      const u = new URL(String(requestingOrigin || webContents?.getURL?.() || ''));
      const trustedOrigin = u.protocol === 'file:' ||
        (u.protocol === 'http:' && u.hostname === '127.0.0.1') ||
        u.origin === ALLOWED_REMOTE_ORIGIN;
      return trustedOrigin && isTrustedRenderer(webContents);
    } catch {
      return false;
    }
  });

  session.defaultSession.setPermissionRequestHandler((webContents,permission,callback)=>{
    if(permission !== 'media') return callback(false);
    callback(isTrustedRenderer(webContents));
  });

  win.on('closed',()=>{
    if(activeSpeechProcess){
      try{activeSpeechProcess.kill();}catch{}
      activeSpeechProcess=null;
    }
  });

  loadAuraRenderer(win).catch(error=>{
    console.error('[AURA] renderer start failed:',error);
    dialog.showErrorBox('AURA başlatılamadı',String(error?.message||error));
  });
}

app.whenReady().then(async()=>{
  await loadExtraRoots();
  await loadUsageState();
  await loadMemoryState();
  await loadConversationState();
  await loadReminderState();
  await loadRoutineState();
  await startRemoteControlServer();

  ipcMain.handle('aura:tool',async(event,payload)=>{
    try{
      const senderUrl=event?.senderFrame?.url || '';
      const isLocal=(()=>{
        try{
          const u=new URL(senderUrl);          return u.protocol==='file:' || (u.hostname==='127.0.0.1' && u.protocol==='http:');
        }catch{
          return false;
        }
      })();
      const isRemote=(()=>{
        try{return new URL(senderUrl).origin===ALLOWED_REMOTE_ORIGIN;}
        catch{return false;}
      })();

      if(!isLocal && !isRemote){
        return {ok:false,error:'Yetkisiz pencere.'};
      }

      return {
        ok:true,
        result:await handleTool(payload?.tool,payload?.args||{})
      };
    }catch(error){
      return {ok:false,error:error?.message||'Bilinmeyen hata'};
    }
  });

  ipcMain.handle('aura:desktop-info',async()=>({
    connected:true,
    version:'6.2.0',
    mode:'secure-local-agent-pc-aware-core',
    roots:allowedRoots(),
    features:[
      'memory',
      'conversation-memory',
      'pc-core',
      'hardware-hud',
      'weather',
      'battery',
      'web-research',
      'unity-tools',
      'unity-project-files',
      'unity-editor-automation',
      'code-mode',
      'phone-remote-control',
      'qr-phone-pairing',
      'openclaw-gateway',
      'background-game-builds',
      'background-unity-automation'
    ]
  }));

  createWindow();
  scanEnvironment({mode:'quick'}).catch(()=>{});

  app.on('activate',()=>{
    if(BrowserWindow.getAllWindows().length===0){
      createWindow();
      scanEnvironment({mode:'quick'}).catch(()=>{});
    }
  });
});

app.on('before-quit',()=>{
  stopRemoteControlServer().catch(()=>{});
  closeLocalRendererServer().catch(()=>{});
});

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin') app.quit();
});