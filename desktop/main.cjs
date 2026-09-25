const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { execFile } = require('child_process');
const { search } = require('duck-duck-scrape');

const PROD_URL = 'https://aura-ki-isel-asistan.vercel.app/';
const ALLOWED_REMOTE_ORIGIN = 'https://aura-ki-isel-asistan.vercel.app';

function normalizePath(value) { return path.resolve(String(value || '')); }
function allowedRoots() {
  const home = os.homedir();
  return [home, path.join(home,'Desktop'), path.join(home,'Documents'), path.join(home,'Downloads'), path.join(home,'OneDrive'), 'C:\\Projects', 'C:\\Games'].map(normalizePath);
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
  const target=String(appName||'').toLowerCase().trim();
  if(!target || target.length>80) throw new Error('Uygulama adı geçersiz.');

  const dirs=[
    path.join(process.env.ProgramData||'C:\\ProgramData','Microsoft','Windows','Start Menu','Programs'),
    path.join(os.homedir(),'AppData','Roaming','Microsoft','Windows','Start Menu','Programs'),
    path.join(os.homedir(),'Desktop')
  ];

  const wanted=[];
  async function walk(dir,depth=0){
    if(depth>3 || wanted.length>=20) return;
    let entries=[];
    try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){
        await walk(full,depth+1);
      }else{
        const lower=entry.name.toLowerCase();
        if((lower.endsWith('.lnk')||lower.endsWith('.exe')) && lower.includes(target)) wanted.push(full);
      }
      if(wanted.length>=20) return;
    }
  }
  for(const dir of dirs) await walk(dir);
  if(!wanted.length) throw new Error('Uygulama bulunamadı: '+appName);

  const chosen=wanted[0];
  const ok=await confirmAction('AURA — Uygulama açma izni','AURA şu uygulamayı açacak:\n\n'+chosen);
  if(!ok) throw new Error('Kullanıcı işlemi iptal etti.');
  const err=await shell.openPath(chosen);
  if(err) throw new Error(err);
  return {ok:true,app:appName,path:chosen,matches:wanted.slice(0,10)};
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
    case 'desktop_launch_app': return launchApp(args.app);
    case 'desktop_find_and_launch_app': return findAndLaunchApp(args.app);
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
  win.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==ALLOWED_REMOTE_ORIGIN)event.preventDefault();}catch{event.preventDefault();}});
  session.defaultSession.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='media'));
  win.loadURL(PROD_URL);
}
app.whenReady().then(()=>{
  ipcMain.handle('aura:tool',async(event,payload)=>{
    try{
      const senderUrl = event?.senderFrame?.url || '';
      if(new URL(senderUrl).origin !== ALLOWED_REMOTE_ORIGIN){
        return {ok:false,error:'Yetkisiz pencere.'};
      }
      return {ok:true,result:await handleTool(payload?.tool,payload?.args||{})};
    }catch(error){
      return {ok:false,error:error?.message||'Bilinmeyen hata'};
    }
  });
  ipcMain.handle('aura:desktop-info',async()=>({connected:true,version:'1.0.0',mode:'secure-local-agent',roots:allowedRoots()}));
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
