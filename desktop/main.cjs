const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { execFile } = require('child_process');
const { search } = require('duck-duck-scrape');

const PROD_URL = 'https://aura-ki-isel-asistan.vercel.app/';
const ALLOWED_REMOTE_ORIGIN = 'https://aura-ki-isel-asistan.vercel.app';
const LOCAL_INDEX = path.join(__dirname,'..','index.html');
const PERMISSIONS_FILE = path.join(app.getPath('userData'), 'aura-permissions.json');
let extraRoots = [];

function normalizePath(value) { return path.resolve(String(value || '')); }
function allowedRoots() {
  const home = os.homedir();
  return [home, path.join(home,'Desktop'), path.join(home,'Documents'), path.join(home,'Downloads'), path.join(home,'OneDrive'), 'C:\\Projects', 'C:\\Games', ...extraRoots].map(normalizePath);
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
let usageState = { launches: [], counts: {}, lastLaunch: null };
let environmentProfile = null;

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

async function discoverShortcutApps() {
  const dirs = [
    path.join(process.env.ProgramData || 'C:\\ProgramData','Microsoft','Windows','Start Menu','Programs'),
    path.join(os.homedir(),'AppData','Roaming','Microsoft','Windows','Start Menu','Programs'),
    path.join(os.homedir(),'Desktop'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public','Desktop')
  ];
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

  for(const dir of dirs) await walk(dir);

  // Windows StartApps: güvenilir uygulama kataloğu.
  const startApps=await new Promise(resolve=>{
    execFile(
      'powershell.exe',
      ['-NoProfile','-NonInteractive','-Command',
       "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"],
      {windowsHide:true,maxBuffer:4*1024*1024},
      (error,stdout)=>{
        if(error) return resolve([]);
        try{
          const value=JSON.parse(String(stdout||'[]'));
          const list=Array.isArray(value)?value:[value];
          resolve(list.filter(x=>x?.Name).map(x=>({
            name:String(x.Name),
            path:String(x.AppID||''),
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
  'minecraft','fortnite','valorant','league of legends','league of legends',
  'counter-strike','cs2','apex','albion','terraria','stardew','gta',
  'grand theft auto','red dead','cyberpunk','the witcher','witcher',
  'assassin','far cry','watch dogs','need for speed','fifa','ea sports',
  'pes','efootball','football manager','nba 2k','wwe','ark','rust',
  'valheim','hades','elden ring','dark souls','sekiro','doom','quake',
  'overwatch','destiny','warframe','palworld','among us','roblox',
  'rocket league','fall guys','pubg','steam','epic games','riot client'
];

function looksLikeGame(name) {
  const n=normalizedSearchText(name);
  return GAME_NAME_HINTS.some(h=>n===normalizedSearchText(h)||n.includes(normalizedSearchText(h)));
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
        if(id&&name){
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

  const queries=expandedAppQueries(target);
  const games=await discoverSteamGames();
  const gameCandidates=games
    .map(g=>({...g,score:Math.max(...queries.map(q=>candidateScore(q,g.name)))}))
    .filter(x=>x.score>=120)
    .sort((a,b)=>b.score-a.score);

  if(gameCandidates.length && gameCandidates[0].score>=950) return launchSteamGame(gameCandidates[0]);

  const apps=await discoverShortcutApps();
  const appCandidates=apps
    .map(a=>({...a,score:Math.max(...queries.map(q=>candidateScore(q,a.name)))}))
    .filter(x=>x.score>=100)
    .sort((a,b)=>b.score-a.score);

  if(!appCandidates.length && gameCandidates.length) return launchSteamGame(gameCandidates[0]);
  if(!appCandidates.length) throw new Error('Uygulama veya oyun bulunamadı: '+target);

  const chosen=appCandidates[0];
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
    execFile(
      'powershell.exe',
      ['-NoProfile','-NonInteractive','-Command',
       "Get-Process | Select-Object -First 300 ProcessName,Id | ConvertTo-Json -Compress"],
      {windowsHide:true,maxBuffer:4*1024*1024},
      (error,stdout)=>{
        if(error) return resolve([]);
        try{
          const value=JSON.parse(String(stdout||'[]'));
          const list=Array.isArray(value)?value:[value];
          resolve(list.filter(x=>x?.ProcessName).map(x=>({
            name:String(x.ProcessName)+'.exe',
            pid:Number(x.Id)||0
          })));
        }catch{
          resolve([]);
        }
      }
    );
  });
}


async function getUsageReport() {
  const processes=await currentProcesses();
  const recent=await recentWindowsItems();
  const top=Object.entries(usageState.counts||{})
    .map(([name,count])=>({name,count:Number(count)||0}))
    .sort((a,b)=>b.count-a.count)
    .slice(0,30);
  return {
    trackedByAura:top,
    lastLaunch:usageState.lastLaunch,
    recentWindowsItems:recent,
    runningProcesses:processes
  };
}

async function scanEnvironment() {
  const home=os.homedir();
  const rootList=allowedRoots();
  const profile={
    scannedAt:new Date().toISOString(),
    live:true,
    system:systemInfo(),
    desktop:null,
    documents:null,
    downloads:null,
    roots:[],
    apps:[],
    games:[],
    runningProcesses:[],
    recentWindowsItems:[],
    permissions:rootList,
    scanErrors:[]
  };

  const safeStep=async(name,fn,fallback)=>{
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
  for(const root of uniqueRoots){
    profile.roots.push(await safeStep(
      'folder:'+root,
      ()=>directorySummary(root),
      {path:root,exists:false,error:true}
    ));
  }

  profile.desktop=await safeStep('desktop',()=>directorySummary(path.join(home,'Desktop')),{path:path.join(home,'Desktop'),exists:false,error:true});
  profile.documents=await safeStep('documents',()=>directorySummary(path.join(home,'Documents')),{path:path.join(home,'Documents'),exists:false,error:true});
  profile.downloads=await safeStep('downloads',()=>directorySummary(path.join(home,'Downloads')),{path:path.join(home,'Downloads'),exists:false,error:true});

  const shortcutApps=await safeStep('applications',()=>discoverShortcutApps(),[]);
  profile.apps=shortcutApps.slice(0,500);

  profile.games=await safeStep('steam-games',()=>discoverSteamGames(),[]);
  profile.runningProcesses=await safeStep('processes',()=>currentProcesses(),[]);
  profile.recentWindowsItems=await safeStep('recent-windows',()=>recentWindowsItems(),[]);

  environmentProfile=profile;
  try{
    await fsp.mkdir(path.dirname(PROFILE_FILE),{recursive:true});
    await fsp.writeFile(PROFILE_FILE,JSON.stringify(profile,null,2),'utf8');
  }catch{}

  return profile;
}
async function getEnvironmentProfile() {
  if (environmentProfile) return environmentProfile;
  try {
    const raw=await fsp.readFile(PROFILE_FILE,'utf8');
    const data=JSON.parse(raw);
    const age=Date.now()-new Date(data?.scannedAt||0).getTime();
    if (data?.scannedAt && age < 10*60*1000) {
      environmentProfile=data;
      return data;
    }
  } catch {}
  return scanEnvironment();
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

function listDrives() {
  const drives = [];
  for (let code=67; code<=90; code++) {
    const drive=String.fromCharCode(code)+':\\';
    if (fs.existsSync(drive)) drives.push(drive);
  }
  return drives;
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
  return {ok:true,app:name};
}


async function findAndLaunchApp(appName) {
  return findAndLaunchGameOrApp(appName);
}

async function openExternalUrl(url) {
  if(!safeUrl(url)) throw new Error('Sadece HTTP/HTTPS adresleri açılabilir.');
  const ok=await confirmAction('AURA — Web adresi açma izni','AURA şu adresi varsayılan tarayıcıda açacak:\n\n'+url);
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  await shell.openExternal(url);
  return {ok:true,url};
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
function systemInfo() {
  return {platform:process.platform,arch:process.arch,os:os.type()+' '+os.release(),hostname:os.hostname(),cpu:os.cpus()?.[0]?.model||'Bilinmiyor',cpuCount:os.cpus()?.length||0,memoryGB:Math.round(os.totalmem()/1024/1024/1024),freeMemoryGB:Math.round(os.freemem()/1024/1024/1024),home:os.homedir()};
}
async function handleTool(tool,args) {
  switch(tool) {
    case 'desktop_get_system_info': return systemInfo();
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
    case 'desktop_scan_environment': return scanEnvironment();
    case 'desktop_get_environment_profile': return getEnvironmentProfile();
    case 'desktop_get_usage_report': return getUsageReport();
    case 'desktop_open_external_url': return openExternalUrl(args.url);
    case 'desktop_open_unity_project': return openUnityProject(normalizePath(args.projectPath));
    case 'desktop_web_search': return webSearch(args.query);
    case 'desktop_fetch_web_page': return fetchWebPage(args.url);
    default: throw new Error('Bilinmeyen AURA aracı: '+tool);
  }
}

function createWindow() {
  const win=new BrowserWindow({width:1480,height:920,minWidth:1000,minHeight:680,backgroundColor:'#02050b',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{
    try{
      const u=new URL(url);
      if(u.protocol==='file:') return;
      if(u.origin!==ALLOWED_REMOTE_ORIGIN) event.preventDefault();
    }catch{ event.preventDefault(); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='media'));
  win.webContents.session.clearCache().catch(()=>{});
  win.loadFile(LOCAL_INDEX);
}
app.whenReady().then(async()=>{
  await loadExtraRoots();
  await loadUsageState();
  ipcMain.handle('aura:tool',async(event,payload)=>{
    try{
      const senderUrl = event?.senderFrame?.url || '';
      const isLocal = senderUrl.startsWith('file://');
      const isRemote = (()=>{ try { return new URL(senderUrl).origin === ALLOWED_REMOTE_ORIGIN; } catch { return false; } })();
      if(!isLocal && !isRemote){
        return {ok:false,error:'Yetkisiz pencere.'};
      }
      return {ok:true,result:await handleTool(payload?.tool,payload?.args||{})};
    }catch(error){
      return {ok:false,error:error?.message||'Bilinmeyen hata'};
    }
  });
  ipcMain.handle('aura:desktop-info',async()=>({connected:true,version:'1.8.0',mode:'secure-local-agent-pc-aware',roots:allowedRoots()}));
  createWindow();
  scanEnvironment().catch(()=>{});
  app.on('activate',()=>{
    if(BrowserWindow.getAllWindows().length===0){
      createWindow();
      scanEnvironment().catch(()=>{});
    }
  });
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
