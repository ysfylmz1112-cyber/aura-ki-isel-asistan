import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.85";

const WEB_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const DESKTOP_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

function desktopAvailable() {
  return !!globalThis.auraDesktop?.isDesktop;
}

const MODEL_ID = desktopAvailable() ? DESKTOP_MODEL_ID : WEB_MODEL_ID;
const SYSTEM_PROMPT = [
  "Sen AURA'sın: kullanıcının kişisel, yerel ve Türkçe yapay zeka asistanısın.",
  "Doğru, net ve yararlı cevap ver. Bilmediğini uydurma.",
  "Güncel bilgi gerektiğinde masaüstü ajanındaki web arama araçlarını kullan.",
  "Masaüstü ajanı bağlıysa izinli dosya, klasör, uygulama, oyun ve Unity araçlarını kullanabilirsin. PC/uygulama/oyun işlemlerini doğrudan araçlarla yap; bunları tahmin etme.",
  "Kullanıcı bilgisayarında neler olduğunu, uygulamaları, oyunları, masaüstünü veya klasör yapısını sorarsa desktop_get_environment_profile kullan; gerekirse desktop_scan_environment ile yenile.",
  "Kullanıcı bir uygulama veya oyun açmanı istediğinde genel desktop_find_and_launch_app aracını kullan. Bu araç Google gibi birkaç özel uygulamayla sınırlı değildir; yaygın uygulamaları ve Steam oyunlarını isimle bulabilir.",
  "Kullanıcı kullanım hakkında sorarsa desktop_get_usage_report kullan ve bu verinin AURA tarafından izlenen açılışlar, Windows Son Öğeler ve anlık süreç görünümü olduğunu açıkça belirt.",
  "Kullanıcı açıkça istemediği sürece dosya yazma, silme, taşıma, uygulama çalıştırma veya komut çalıştırma araçlarını kullanma.",
  "Unity geliştirirken proje dosyalarını okuyabilir, C# ve yapılandırma dosyaları oluşturup değiştirebilir ve Unity projesini açabilirsin.",
  "PowerShell aracı yalnızca kullanıcı açıkça geliştirici veya sistem komutu istediğinde kullanılmalıdır.",
  "Web sonuçlarını kullanırken kaynakları ayırt et ve emin olmadığın bilgiyi kesin gerçek gibi sunma.",
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

function assertWebGPU() {
  if (!navigator.gpu) {
    throw new Error("Bu tarayıcı WebGPU desteklemiyor. Güncel Chrome veya Edge kullan.");
  }
}

async function createEngine(modelId, config, onProgress) {
  activeModel = modelId;
  onProgress({ percent:0, text:"Yerel AI modeli hazırlanıyor: " + modelId });

  return CreateMLCEngine(modelId, config).then(result => {
    engine = result;
    activeModel = modelId;
    onProgress({ percent:100, text:"Yerel AI hazır: " + modelId });
    return result;
  });
}

export async function ensureLocalAI(onProgress = () => {}) {
  assertWebGPU();
  if (engine) return engine;
  if (enginePromise) return enginePromise;

  const config = {
    initProgressCallback: progress => {
      try {
        const percent = typeof progress?.progress === "number"
          ? Math.max(0, Math.min(100, Math.round(progress.progress * 100)))
          : null;
        onProgress({
          percent,
          text: progress?.text || "Model hazırlanıyor..."
        });
      } catch {}
    }
  };

  enginePromise = createEngine(MODEL_ID, config, onProgress).catch(async error => {
    const message = String(error?.message || error);

    if (
      desktopAvailable() &&
      MODEL_ID === DESKTOP_MODEL_ID &&
      /memory|alloc|out of memory|device|buffer|gpu|webgpu/i.test(message)
    ) {
      onProgress({
        percent:0,
        text:"7B model bu bilgisayarda açılamadı; 3B yedek modele geçiliyor..."
      });

      try {
        return await createEngine(WEB_MODEL_ID, config, onProgress);
      } catch (fallbackError) {
        engine = null;
        enginePromise = null;
        throw fallbackError;
      }
    }

    engine = null;
    enginePromise = null;
    throw error;
  });

  return enginePromise;
}

function cleanMessages(history) {
  return (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .slice(-4)
    .map(m => ({
      role:m.role,
      content:String(m.content || "").slice(0,1200)
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

export async function askLocalAI(message, history = [], onProgress = () => {}, environment = null, mode = "chat") {
  const value = String(message || "").trim();
  if (!value) throw new Error("Mesaj boş.");

  const localEngine = await ensureLocalAI(onProgress);
  const modePrompt = mode === "code"
    ? "\nKOD MODU AKTİF: Kullanıcı kod istiyorsa doğrudan uygulanabilir, tam ve tutarlı kod üret. Gereksiz uzun açıklama yapma. Dosya yolu/isimleri gerekiyorsa açıkça belirt. Kullanıcı özellikle kaydetmeni isterse masaüstü araçlarını kullan."
    : "";
  const messages = [
    {
      role:"system",
      content: SYSTEM_PROMPT + modePrompt +
        (desktopAvailable()
          ? "\nMasaüstü ajanı BAĞLI." + (environment ? "\nKısa PC özeti:\n" + compactEnvironment(environment) : "")
          : "\nMasaüstü ajanı BAĞLI DEĞİL.")
    },
    ...cleanMessages(history),
    { role:"user", content:value }
  ];

  for (let round=0; round<3; round++) {
    let response;

    try {
      response = await localEngine.chat.completions.create({
        messages,
        tools: desktopAvailable() ? TOOLS : undefined,
        tool_choice: desktopAvailable() ? "auto" : undefined,
        temperature:mode==="code"?0.25:0.55,
        top_p:0.9,
        max_tokens:mode==="code"?700:256,
        stream:false
      });
    } catch (firstError) {
      if (!desktopAvailable()) throw firstError;

      response = await localEngine.chat.completions.create({
        messages,
        temperature:0.55,
        top_p:0.9,
        max_tokens:256,
        stream:false
      });
    }

    const assistantMessage = response?.choices?.[0]?.message;
    if (!assistantMessage) throw new Error("Yerel AI cevap üretmedi.");

    messages.push(assistantMessage);

    const toolCalls = Array.isArray(assistantMessage.tool_calls)
      ? assistantMessage.tool_calls
      : [];

    if (!toolCalls.length) {
      const answer = String(assistantMessage.content || "").trim();
      if (!answer) throw new Error("Yerel AI boş cevap verdi.");
      return answer;
    }

    for (const call of toolCalls.slice(0,2)) {
      try {
        const result = await executeTool(call);
        messages.push({
          role:"tool",
          tool_call_id:call.id,
          name:call.function.name,
          content:JSON.stringify(result).slice(0,6000)
        });
      } catch (error) {
        messages.push({
          role:"tool",
          tool_call_id:call.id,
          name:call.function.name,
          content:JSON.stringify({
            error:error?.message || "Araç hatası"
          }).slice(0,2000)
        });
      }
    }
  }

  return "Görevi tamamlamak için izin verilen araç adımlarının sınırına ulaştım.";
}

export function getLocalAIModel() { return activeModel; }
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
