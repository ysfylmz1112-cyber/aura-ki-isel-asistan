
// Global renderer helper: drive-list requests are handled by the desktop command layer.
globalThis.isDriveListRequest = function isDriveListRequest(q) {
  const x = String(q || "").toLocaleLowerCase("tr-TR").trim();
  return /^(sürücüleri göster|suruculeri goster|sürücüler|suruculer|diskleri göster|diskleri goster|diskler|hangi sürücüler var|hangi suruculer var|sürücülerim|suruculerim|disklerim)\??$/.test(x);
};
import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.85";

const CHAT_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const CODE_MODEL_ID = "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC";
const CODE_FALLBACK_MODEL_ID = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
const WEB_MODEL_ID = CHAT_MODEL_ID;
const DESKTOP_MODEL_ID = CHAT_MODEL_ID;

function desktopAvailable() {
  return !!globalThis.auraDesktop?.isDesktop;
}

const MODEL_ID = CHAT_MODEL_ID;
const SYSTEM_PROMPT = [
  "AURA 4.9: Telefon kumandası AURA Desktop içindeki yerel, token korumalı sunucudur; telefon üzerinden gelen komutlar da masaüstü onay mekanizmalarını aşmamalıdır.",
  "Sen AURA'sın: kişisel, yerel ve Türkçe bir AI asistanısın.",
  "Önce kullanıcının ne istediğini doğru anla. Bilmediğin bilgiyi uydurma.",
  "Güncel bilgi gerektiğinde yalnızca izin verilen web araçlarını kullan ve kaynağı ayırt et.",
  "Kullanıcının kalıcı hafızası ve konuşma geçmişi sana ayrıca verilebilir. Bunları gerçek bağlam olarak kullan; yeni bilgi kaydetmeden önce açık bir hatırlama isteği gelmiş olmalı.",
  "ZAMANLI HAFIZA: Kullanıcı geçmiş konuşmalarından söz ederse konuşma geçmişi aracını kullan. 'dün', 'geçen hafta', 'bugün' gibi ifadeleri araca aynen taşı.",
  "WEB ARAŞTIRMA: Güncel bilgi gerektiğinde araştırma aracını kullan; mümkünse birden fazla arama varyasyonu çalıştırılmış sonuçları karşılaştır ve kaynak adreslerini yanıta dahil et.",
  "PC CORE: Canlı CPU/RAM/GPU/disk/ağ değerlerini yalnızca masaüstü aracı döndürdüğü verilerle söyle; ölçülmeyen sıcaklık veya performansı uydurma.",
  "UNITY GELİŞTİRME: Unity projesi bulunması, proje klasörü açılması veya kod dosyası okunması istendiğinde ilgili masaüstü araçlarını kullan. Yazma/silme/komut çalıştırma gibi değişikliklerde kullanıcı onayını bekle.",
  "KOD ÜRETİM: Her yaygın programlama dilinde gerçek ve çalıştırılabilir kod üret. Pseudocode veya yarım örnek verme. İstenen dili aynen kullan. Tam dosya istenirse tam dosyayı ver. Importları, bağımlılıkları, hata yönetimini ve isim tutarlılığını düşün.",
  "KOD DÜZELTME: Hata verildiğinde problemi kısa biçimde belirle ve düzeltilmiş tam kodu üret. Kullanıcı istemedikçe uzun eğitim metnine girme.",
  "KOD MODU: C#, C++, C, Java, Kotlin, Swift, Python, JavaScript, TypeScript, Rust, Go, PHP, Ruby, Lua, Dart, SQL, HTML, CSS, Bash, PowerShell ve diğer yaygın dillerde kod yaz.",
  "Masaüstü ajanı bağlıysa PC, dosya, klasör, uygulama, oyun, Unity ve sistem araçlarını yalnızca görev gerçekten gerektiriyorsa kullan.",
  "Kullanıcı açıkça istemediği sürece dosya yazma, silme, taşıma, uygulama çalıştırma veya komut çalıştırma araçlarını kullanma.",
  "PowerShell aracı yalnızca kullanıcı açıkça bir PowerShell veya sistem komutu istediğinde kullanılmalıdır.",
  "Türkçe konuş."
].join("\n");

const TOOLS = [
  {
    type: "function",
    function: {
      name: "desktop_scan_environment",
      description: "Bilgisayarın izinli klasörlerini, masaüstü yapısını, Başlat menüsündeki uygulamaları, Steam oyunlarını ve Windows son öğelerini tarar; AURA bilgisayar profilini günceller.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_get_environment_profile",
      description: "AURA'nın bilgisayar profilini getirir: tanınan uygulamalar, oyunlar, masaüstü ve izinli klasörlerin yapısı.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_get_usage_report",
      description: "AURA'nın açtığı uygulama/oyunların takip edilen açılış sayaçlarını, son açılanları ve o an çalışan Windows süreçlerinin anlık listesini verir. Tüm geçmiş Windows kullanım süresi değildir.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_memory_save",
      description: "Kullanıcının açıkça hatırlamamı istediği bir bilgiyi kalıcı yerel hafızaya kaydeder.",
      parameters: {
        type:"object",
        properties:{
          text:{type:"string"},
          tags:{type:"array",items:{type:"string"}}
        },
        required:["text"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_memory_search",
      description: "Kalıcı yerel hafızada bir konu arar.",
      parameters: {
        type:"object",
        properties:{query:{type:"string"},maxResults:{type:"number"}},
        required:["query"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_memory_list",
      description: "Kayıtlı kalıcı hafızanın son maddelerini listeler.",
      parameters: {type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_memory_forget",
      description: "Kullanıcının açıkça unutmamı istediği bir hafıza maddesini siler.",
      parameters: {
        type:"object",
        properties:{query:{type:"string"}},
        required:["query"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_conversation_search",
      description: "Kalıcı AURA konuşma geçmişinde bugünün, dünün, geçen haftanın veya sorgunun geçtiği eski konuşmaları arar. Kullanıcı 'geçen hafta ne demiştim?' gibi zaman ifadeleri kullanıyorsa tarih aralığını aracın kendisi yorumlar.",
      parameters: {
        type:"object",
        properties:{query:{type:"string"},maxResults:{type:"number"}},
        required:["query"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_conversation_log",
      description: "AURA sohbetindeki bir kullanıcı ve asistan mesajını yerel konuşma geçmişine kaydeder. Normalde arayüz tarafından otomatik kullanılır.",
      parameters: {
        type:"object",
        properties:{
          user:{type:"string"},
          assistant:{type:"string"},
          mode:{type:"string"}
        },
        required:["user","assistant"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_memory_clear",
      description: "Tüm kalıcı hafızayı, kullanıcı onayıyla temizler.",
      parameters: {type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_get_hardware_metrics",
      description: "Canlı PC Core verileri döndürür: CPU kullanımı, RAM kullanımı, disk kullanımı, NVIDIA GPU kullanım/sıcaklık/bellek bilgisi bulunabiliyorsa ve ağ aktarım hızı.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_get_weather",
      description: "Belirtilen şehir için gerçek ve güncel hava durumunu Open-Meteo üzerinden getirir. Sıcaklık, hissedilen sıcaklık, nem, rüzgar, hava açıklaması ve günlük en yüksek/düşük değerlerini döndürür.",
      parameters: {
        type:"object",
        properties:{city:{type:"string"}},
        required:["city"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_get_battery_status",
      description: "Windows pil durumunu getirir. Pil yoksa masaüstü bilgisayarda kullanılamadığını belirtir.",
      parameters: {type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_find_unity_projects",
      description: "İzin verilen kullanıcı klasörlerinde Unity projelerini (Assets + ProjectSettings) bulur.",
      parameters: {
        type:"object",
        properties:{maxResults:{type:"number"}},
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_get_system_info",
      description: "İşletim sistemi, CPU, RAM ve kullanıcı klasörü gibi sistem bilgilerini alır.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_list_drives",
      description: "Windows sürücülerini listeler.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_choose_folder",
      description: "Kullanıcının seçtiği klasörü AURA'nın erişim alanına ekler.",
      parameters: {
        type:"object",
        properties:{ purpose:{type:"string"} },
        required:["purpose"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_list_directory",
      description: "İzinli bir klasörün içeriğini listeler.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string"} },
        required:["path"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_search_files",
      description: "İzinli bir klasörde dosya veya klasör adı arar.",
      parameters: {
        type:"object",
        properties:{
          root:{type:"string"},
          query:{type:"string"},
          maxResults:{type:"number"}
        },
        required:["root","query"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_read_text_file",
      description: "İzinli bir metin veya kod dosyasını okur.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string"} },
        required:["path"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_write_text_file",
      description: "İzinli bir dosyayı oluşturur veya tamamen değiştirir. Kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{
          path:{type:"string"},
          content:{type:"string"}
        },
        required:["path","content"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_create_directory",
      description: "İzinli bir klasör oluşturur. Kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string"} },
        required:["path"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_copy_path",
      description: "İzinli bir dosya veya klasörü başka bir izinli yere kopyalar.",
      parameters: {
        type:"object",
        properties:{
          source:{type:"string"},
          destination:{type:"string"}
        },
        required:["source","destination"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_move_path",
      description: "İzinli bir dosya veya klasörü başka bir izinli yere taşır.",
      parameters: {
        type:"object",
        properties:{
          source:{type:"string"},
          destination:{type:"string"}
        },
        required:["source","destination"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_delete_path",
      description: "İzinli bir dosya veya klasörü siler. Kullanıcı onayı zorunludur.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string"} },
        required:["path"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_open_path",
      description: "İzinli bir dosya veya klasörü Windows'ta açar.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string"} },
        required:["path"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_find_and_launch_app",
      description: "Başlat menüsü ve masaüstünde bir uygulamayı bulup açar. Kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{ app:{type:"string"} },
        required:["app"],
        additionalProperties:false
      }
    }
  },
  {
    type:"function",function:{name:"desktop_close_app",description:"Mevcut Windows kullanıcısının çalışan uygulamasını kapatır. Kullanıcı onayı zorunludur.",parameters:{type:"object",properties:{app:{type:"string"}},required:["app"],additionalProperties:false}}
  },
  {
    type:"function",function:{name:"desktop_get_running_apps",description:"Mevcut Windows kullanıcısının oturumunda çalışan kullanıcı uygulamalarını listeler; sistem süreçlerini mümkün olduğunca filtreler.",parameters:{type:"object",properties:{},additionalProperties:false}}
  },
  {
    type:"function",function:{name:"desktop_restart_app",description:"Çalışan uygulamayı kapatıp yeniden açar. Kullanıcı onayı zorunludur.",parameters:{type:"object",properties:{app:{type:"string"}},required:["app"],additionalProperties:false}}
  },
  {
    type:"function",function:{name:"desktop_uninstall_app",description:"Kullanıcının mevcut kullanıcı uygulamasını kaldırır. Kullanıcı onayı zorunludur; Windows sistem araçları kaldırılmaz.",parameters:{type:"object",properties:{app:{type:"string"}},required:["app"],additionalProperties:false}}
  },
  {
    type: "function",
    function: {
      name: "desktop_launch_app",
      description: "Not Defteri, Hesap Makinesi veya Dosya Gezgini açar. Kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{
          app:{type:"string",enum:["notepad","calculator","explorer"]}
        },
        required:["app"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_open_unity_project",
      description: "Verilen Unity proje klasörünü Unity Editor ile açar. Kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{ projectPath:{type:"string"} },
        required:["projectPath"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_run_powershell",
      description: "Açıkça istenen PowerShell geliştirici/sistem komutunu çalıştırır. Yönetici yetkisine yükseltmez ve kullanıcıdan tam komut onayı ister.",
      parameters: {
        type:"object",
        properties:{ command:{type:"string"} },
        required:["command"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_open_external_url",
      description: "Bir HTTP/HTTPS adresini varsayılan tarayıcıda açar. Kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{ url:{type:"string"} },
        required:["url"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_web_research",
      description: "Güncel bir konu hakkında birden fazla sorguyla internet araştırması yapar, sonuçları birleştirir ve kaynak URL'lerini döndürür.",
      parameters: {
        type:"object",
        properties:{
          query:{type:"string"},
          maxResults:{type:"number"}
        },
        required:["query"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_web_search",
      description: "İnternette güncel bilgi arar.",
      parameters: {
        type:"object",
        properties:{ query:{type:"string"} },
        required:["query"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_fetch_web_page",
      description: "HTTP/HTTPS web sayfasının metin içeriğini getirir.",
      parameters: {
        type:"object",
        properties:{ url:{type:"string"} },
        required:["url"],
        additionalProperties:false
      }
    }
  }
];

let engine = null;
let enginePromise = null;
let activeModel = MODEL_ID;
let activeMode = "chat";

function assertWebGPU() {
  if (!navigator.gpu) {
    throw new Error("Bu tarayıcı WebGPU desteklemiyor. Güncel Chrome veya Edge kullan.");
  }
}

async function createEngine(modelId, config, onProgress) {
  activeModel = modelId;
  onProgress({ percent:0, text:"Yerel AI hazırlanıyor: " + modelId });

  const result = await CreateMLCEngine(modelId, config);
  engine = result;
  activeModel = modelId;
  onProgress({ percent:100, text:"Yerel AI hazır: " + modelId });
  return result;
}

function desiredModel(mode){
  return mode === "code" ? CODE_MODEL_ID : CHAT_MODEL_ID;
}

async function ensureLocalAI(mode = "chat", onProgress = () => {}) {
  assertWebGPU();
  const target = desiredModel(mode);

  if (engine && activeModel === target) {
    activeMode = mode;
    return engine;
  }
  if (enginePromise) {
    const pending = enginePromise;
    await pending;
    if (engine && activeModel === target) {
      activeMode = mode;
      return engine;
    }
  }

  const config = {
    initProgressCallback: progress => {
      try {
        const percent = typeof progress?.progress === "number"
          ? Math.max(0, Math.min(100, Math.round(progress.progress * 100)))
          : null;
        onProgress({ percent, text: progress?.text || "Model hazırlanıyor..." });
      } catch {}
    }
  };

  enginePromise = (async()=>{
    try {
      if (engine) {
        onProgress({percent:0,text:"AURA model değiştiriyor: "+target});
        await engine.reload(target);
        activeModel=target;
      } else {
        await createEngine(target,config,onProgress);
      }
      activeMode=mode;
      return engine;
    } catch (error) {
      const message=String(error?.message||error);
      const memoryError=/memory|alloc|out of memory|device lost|device|buffer|gpu|webgpu/i.test(message);

      if(mode==="code" && memoryError && target===CODE_MODEL_ID){
        onProgress({percent:0,text:"7B kod modeli için bellek yetersiz; küçük Coder modele geçiliyor..."});
        try {
          if(engine) await engine.unload().catch(()=>{});
          engine=null;
          await createEngine(CODE_FALLBACK_MODEL_ID,config,onProgress);
          activeMode="code";
          return engine;
        } catch(fallbackError) {
          engine=null;
          activeModel=CHAT_MODEL_ID;
          throw fallbackError;
        }
      }

      engine=null;
      activeModel=CHAT_MODEL_ID;
      activeMode="chat";
      throw error;
    } finally {
      enginePromise=null;
    }
  })();

  return enginePromise;
}

function cleanMessages(history) {
  return (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .slice(-2)
    .map(m => ({
      role:m.role,
      content:String(m.content || "").slice(0,700)
    }));
}

function compactEnvironment(environment) {
  if (!environment || typeof environment !== "object") return "";
  const apps=Array.isArray(environment.apps)
    ? environment.apps.slice(0,20).map(x=>String(x?.name||"")).filter(Boolean)
    : [];
  const games=Array.isArray(environment.games)
    ? environment.games.slice(0,20).map(x=>String(x?.name||"")).filter(Boolean)
    : [];
  const processItems=Array.isArray(environment.runningProcesses)
    ? environment.runningProcesses
    : (Array.isArray(environment.runningProcesses?.items) ? environment.runningProcesses.items : []);
  const running=processItems.slice(0,20).map(x=>String(x?.name||"")).filter(Boolean);
  const roots=Array.isArray(environment.roots) ? environment.roots.length : 0;
  return JSON.stringify({
    scannedAt:environment.scannedAt||null,
    roots,
    appCount:Array.isArray(environment.apps)?environment.apps.length:0,
    gameCount:Array.isArray(environment.games)?environment.games.length:0,
    runningCount:Number(environment.runningProcesses?.count ?? processItems.length),
    apps,
    games,
    running
  });
}

function parseArguments(value) {
  try { return JSON.parse(value || "{}"); }
  catch { return {}; }
}

async function executeTool(toolCall) {
  const name = toolCall?.function?.name;
  if (!name) throw new Error("Araç adı bulunamadı.");
  return desktopCall(name, parseArguments(toolCall?.function?.arguments));
}

function compactMemory(memory){
  const items=Array.isArray(memory)?memory:[];
  return items.slice(-30).map(x=>({
    text:String(x?.text||"").slice(0,600),
    tags:Array.isArray(x?.tags)?x.tags.slice(0,6):[]
  })).filter(x=>x.text);
}

function toolDirectoryPrompt() {
  return TOOLS.map(function(tool) {
    const fn = tool && tool.function ? tool.function : {};
    const schema = fn && fn.parameters && fn.parameters.properties ? fn.parameters.properties : {};
    const keys = Object.keys(schema);
    return "- " + String(fn.name || "") + (keys.length ? " args: " + keys.join(", ") : " args: yok") + " — " + String(fn.description || "");
  }).join("\n");
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const candidates = [raw];
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object") return value;
    } catch {}
  }
  return null;
}

function extractManualToolCall(text) {
  const value = extractJsonObject(text);
  if (!value) return null;
  let name = value.tool || value.name || value.action || (value.function && value.function.name);
  let args = value.args || value.arguments || value.parameters || (value.function && value.function.arguments) || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return null; }
  }
  name = String(name || "").trim();
  const known = TOOLS.some(function(tool) {
    return tool && tool.function && tool.function.name === name;
  });
  if (!known || !args || typeof args !== "object" || Array.isArray(args)) return null;
  return { name, args };
}

function assistantToolResultMessage(toolCall, result) {
  return "AURA ARAÇ SONUCU\nAraç: " + toolCall.name +
    "\nSonuç:\n" + JSON.stringify(result).slice(0, 7000) +
    "\n\nŞimdi kullanıcının ilk isteğine göre nihai cevabı ver. Başka bir araç gerçekten gerekiyorsa yalnızca JSON formatında yeni araç çağrısı üret.";
}

export async function askLocalAI(message, history = [], onProgress = () => {}, environment = null, mode = "chat", memory = []) {
  const value = String(message || "").trim();
  if (!value) throw new Error("Mesaj boş.");

  const localEngine = await ensureLocalAI(mode,onProgress);
  const memoryItems = compactMemory(memory);
  const memoryContext = memoryItems.length
    ? "\nKALICI HAFIZA:\n" + JSON.stringify(memoryItems)
    : "\nKALICI HAFIZA: boş.";

  const modePrompt = mode === "code"
    ? "\nKOD MODU AKTİF: Doğrudan çalışan kod üret. İstenen dili kullan. Gerekli importları ve dosya yapısını unutma."
    : "\nSOHBET MODU AKTİF: Net, mantıklı ve doğal cevap ver.";

  const pcContext = desktopAvailable() && environment
    ? "\nPC BAĞLAM ÖZETİ:\n" + compactEnvironment(environment)
    : "";

  const wantsTools = desktopAvailable() && mode !== "code" && /güncel|guncel|araştır|arastir|internette|web|site|dosya|klasör|klasor|uygulama|oyun|bilgisayar|masaüstü|masaustu|sistem|kullanım|kullanim|hatırla|hatirla|unut|geçen hafta|gecen hafta|dün|dun|bugün|bugun|konuşma geçmişi|konusma gecmisi|unity|cpu|ram|gpu|disk|performans|donanım|donanim|hava|sıcaklık|sicaklik|derece|pil|batarya/.test(
    value.toLocaleLowerCase("tr-TR")
  );

  const toolExample = JSON.stringify({tool:"desktop_tool_name", args:{}});
  const toolProtocol = wantsTools
    ? "\nARAÇ KULLANIMI: OpenAI tools alanı kullanılmıyor. Araç gerekiyorsa yalnızca " + toolExample + " biçiminde tek JSON nesnesi üret. JSON dışında metin yazma. Araç sonucu geldiğinde normal Türkçe cevap ver.\nKULLANILABİLEN ARAÇLAR:\n" + toolDirectoryPrompt()
    : "";

  const messages = [
    {
      role:"system",
      content: SYSTEM_PROMPT + modePrompt + memoryContext + pcContext +
        (desktopAvailable() ? "\nMasaüstü ajanı BAĞLI." : "\nMasaüstü ajanı BAĞLI DEĞİL.") +
        toolProtocol
    },
    ...cleanMessages(mode === "code" ? history.slice(-4) : history),
    { role:"user", content:value }
  ];

  for(let round=0; round<3; round++){
    const responsePromise = localEngine.chat.completions.create({
      messages,
      temperature:mode==="code"?0.16:0.45,
      top_p:mode==="code"?0.82:0.85,
      max_tokens:mode==="code"?2200:320,
      stream:false
    });
    const response = await Promise.race([
      responsePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Yerel AI yanıtı zaman aşımına uğradı. Model henüz hazır olmayabilir; tekrar dene.")), 90000))
    ]);

    const assistantMessage=response && response.choices && response.choices[0] ? response.choices[0].message : null;
    if(!assistantMessage) throw new Error("Yerel AI cevap üretmedi.");
    messages.push(assistantMessage);

    if(wantsTools){
      const manual=extractManualToolCall(assistantMessage.content);
      if(manual){
        let result;
        try {
          result=await desktopCall(manual.name,manual.args);
        } catch(error) {
          result={error:error && error.message ? error.message : "Araç hatası"};
        }
        messages.push({
          role:"user",
          content:assistantToolResultMessage(manual,result)
        });
        continue;
      }
    }

    const answer=String(assistantMessage.content || "").trim();
    if(!answer) throw new Error("Yerel AI boş cevap verdi.");
    return answer;
  }


}

export function getLocalAIModel() { return activeModel; }
export function getLocalAIMode() { return activeMode; }
export function getWebModel() { return WEB_MODEL_ID; }
export function getDesktopModel() { return DESKTOP_MODEL_ID; }
export function hasDesktopAgent() { return desktopAvailable(); }
export function desktopToolCount() { return TOOLS.length; }

async function desktopCall(name,args) {
  if (!desktopAvailable()) {
    throw new Error("Masaüstü ajanı bağlı değil.");
  }

  const result = await globalThis.auraDesktop.call(name,args || {});
  if (!result?.ok) {
    throw new Error(result?.error || "Masaüstü işlemi başarısız.");
  }

  return result.result;
}
