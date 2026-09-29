const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { search } = require('duck-duck-scrape');
const QRCode = require('qrcode');

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
const REMOTE_FILE = path.join(app.getPath('userData'), 'aura-remote.json');

function normalizePath(value) { return path.resolve(String(value || '')); }
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
let usageState = { launches: [], counts: {}, lastLaunch: null };
let memoryState = { version:1, items:[] };
let conversationState = { version:1, items:[] };
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
  return memorySearchScore(q,t);
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
  if(t===q) return 1000;
  if(t.includes(q)) return 800;
  let score=0;
  for(const token of q.split(' ').filter(Boolean)){
    if(t.includes(token)) score+=120;
  }
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
  const items=memoryState.items
    .map(x=>({...x,score:memorySearchScore(q,x.text+' '+(x.tags||[]).join(' '))}))
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
  const ok=await confirmAction('AURA — Hafızayı temizleme onayı','AURA kayıtlı kalıcı hafızadaki tüm maddeleri silecek.\n\nDevam edilsin mi?');
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
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
    runningProcesses:[],
    recentWindowsItems:[],
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
  const found=[];
  const seen=new Set();
  const skip=new Set(['node_modules','.git','Library','Temp','Logs','obj','bin','.vs','.idea']);
  async function walk(dir,depth){
    if(depth>6 || found.length>=maxResults) return;
    let entries=[];
    try{ entries=await fsp.readdir(dir,{withFileTypes:true}); }catch{return;}
    const hasAssets=entries.some(e=>e.isDirectory()&&e.name==='Assets');
    const hasProjectSettings=entries.some(e=>e.isDirectory()&&e.name==='ProjectSettings');
    if(hasAssets&&hasProjectSettings){
      const key=dir.toLowerCase();
      if(!seen.has(key)){
        seen.add(key);
        found.push({name:path.basename(dir),path:dir,source:'unity-project'});
      }
      return;
    }
    for(const e of entries.filter(e=>e.isDirectory()&&!skip.has(e.name)&&!e.name.startsWith('.')).slice(0,120)){
      if(found.length>=maxResults) break;
      await walk(path.join(dir,e.name),depth+1);
    }
  }
  for(const root of roots){
    if(found.length>=maxResults) break;
    await walk(root,0);
  }
  return {count:found.length,items:found.slice(0,maxResults)};
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
  };
  weatherCache.set(key,{at:Date.now(),data:out});
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

async function getHardwareMetrics(){
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
async function handleTool(tool,args) {
  switch(tool) {
    case 'desktop_get_hardware_metrics': return getHardwareMetrics();
    case 'desktop_get_remote_control': return getRemoteControlInfo();
    case 'desktop_get_remote_qr': return getRemoteControlQr();
    case 'desktop_get_weather': return getWeather(args.city||'Istanbul');
    case 'desktop_get_battery_status': return getBatteryStatus();
    case 'desktop_open_camera': return openCamera();
    case 'desktop_open_windows_utility': return openWindowsUtility(args.kind);
    case 'desktop_find_unity_projects': return findUnityProjects(args.maxResults||20);
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
      await new Promise(r=>setTimeout(r,900));
      return {...await findAndLaunchApp(target),restarted:true};
    }
    case 'desktop_uninstall_app': return uninstallAppByName(args.app);
    case 'desktop_scan_environment': return scanEnvironment({mode:args?.mode==='deep'?'deep':'quick',force:Boolean(args?.force)});
    case 'desktop_cancel_scan': return cancelEnvironmentScan();
    case 'desktop_get_scan_status': return getScanStatus();
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
function remotePage(){
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#03070c"><title>AURA Remote</title><style>*{box-sizing:border-box}body{margin:0;background:#03070c;color:#edfaff;font-family:system-ui;min-height:100vh;background:radial-gradient(circle at 50% 15%,#12313d,#03070c 42%)}main{max-width:560px;margin:auto;padding:22px 16px 40px}.brand{text-align:center;letter-spacing:5px;font-weight:800;font-size:20px}.core{width:190px;height:190px;margin:24px auto;position:relative;border-radius:50%;display:grid;place-items:center;border:1px solid #3fe5ff88;box-shadow:0 0 55px #28dfff22,inset 0 0 35px #28dfff16}.core:before,.core:after{content:"";position:absolute;border-radius:50%;border:1px solid #53eaff55}.core:before{inset:16px;border-style:dashed;animation:r 8s linear infinite}.core:after{inset:35px;border-top-color:#7b8cff;border-bottom-color:#62e8ff;animation:r 4s linear infinite reverse}.orb{width:62px;height:62px;border-radius:50%;background:radial-gradient(circle,#fff,#68efff 20%,#0b7188 48%,transparent 72%);box-shadow:0 0 35px #48eaff}.online{text-align:center;color:#6ff0b1;font-size:11px;letter-spacing:2px}.panel{margin-top:16px;padding:14px;border:1px solid #172833;border-radius:16px;background:#071018cc}input{width:100%;padding:13px;border-radius:11px;border:1px solid #243743;background:#081017;color:white;outline:0}button{font:inherit;border:1px solid #20313b;background:#0c161e;color:#d9faff;border-radius:11px;padding:11px;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:9px}.primary{border-color:#35dfff55;background:#0c2530}.stat{display:flex;justify-content:space-between;color:#78909c;font-size:11px;padding:7px 0;border-bottom:1px solid #13212a}.stat b{color:#e8f8fb}.out{white-space:pre-wrap;color:#9eb0bb;font-size:12px;line-height:1.5;min-height:30px}.small{text-align:center;color:#536875;font-size:9px;margin-top:13px}@keyframes r{to{transform:rotate(360deg)}}</style></head><body><main><div class="brand">AURA</div><div class="core"><div class="orb"></div></div><div class="online">● REMOTE CORE ONLINE</div><div class="panel"><input id="cmd" placeholder="Komut: Minecraft aç, kamera aç..."><div class="grid"><button class="primary" onclick="act('minecraft aç')">Minecraft</button><button onclick="act('kamera aç')">Kamera</button><button onclick="act('Chrome aç')">Chrome</button><button onclick="act('Görev yöneticisi')">Görev Yöneticisi</button><button onclick="act('Bilgisayarımı tara')">PC Tara</button><button onclick="act('Hesap makinesi')">Hesap Makinesi</button></div><div class="grid"><button onclick="status()">PC Durumu</button><button onclick="act('Masaüstünü aç')">Masaüstü</button></div><div class="out" id="out"></div></div><div class="panel"><div class="stat"><span>CPU</span><b id="cpu">—</b></div><div class="stat"><span>RAM</span><b id="ram">—</b></div><div class="stat"><span>GPU</span><b id="gpu">—</b></div><div class="stat"><span>Sıcaklık</span><b id="temp">—</b></div></div><div class="small">AURA telefon kumandası · Aynı Wi‑Fi ağı üzerinde çalışır</div></main><script>
const token=new URLSearchParams(location.search).get('token')||'';
async function act(command){document.getElementById('out').textContent='Çalışıyor...';try{const r=await fetch('/api/action?token='+encodeURIComponent(token)+'&command='+encodeURIComponent(command));const j=await r.json();document.getElementById('out').textContent=j.message||j.error||'Tamam';await status()}catch(e){document.getElementById('out').textContent='Bağlantı hatası';}}
async function status(){try{const r=await fetch('/api/status?token='+encodeURIComponent(token));const j=await r.json();if(j.hardware){document.getElementById('cpu').textContent=j.hardware.cpu?.usage!=null?j.hardware.cpu.usage+'%':'—';document.getElementById('ram').textContent=j.hardware.memory?.usedPercent!=null?j.hardware.memory.usedPercent.toFixed(0)+'%':'—';document.getElementById('gpu').textContent=j.hardware.gpu?.usage!=null?j.hardware.gpu.usage+'%':'—';document.getElementById('temp').textContent=j.hardware.gpu?.temperatureC!=null?j.hardware.gpu.temperatureC+'°C':'—';}}catch{}}
document.getElementById('cmd').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.value.trim()){act(e.target.value.trim());e.target.value='';}});status();
</script></body></html>`;
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

  session.defaultSession.setPermissionRequestHandler((_wc,permission,callback)=>{
    callback(permission==='media');
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
  await startRemoteControlServer();

  ipcMain.handle('aura:tool',async(event,payload)=>{
    try{
      const senderUrl=event?.senderFrame?.url || '';
      const isLocal=(()=>{
        try{
          const u=new URL(senderUrl);
          return u.protocol==='file:' || (u.hostname==='127.0.0.1' && u.protocol==='http:');
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
    version:'4.9.0',
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
      'code-mode',
      'phone-remote-control',
      'qr-phone-pairing'
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
