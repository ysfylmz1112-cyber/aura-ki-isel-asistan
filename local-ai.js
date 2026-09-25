import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.85";

const WEB_MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";
const DESKTOP_MODEL_ID = "Qwen2.5-7B-Instruct-q4f16_1-MLC";

function desktopAvailable() {
  return !!globalThis.auraDesktop?.isDesktop;
}

const MODEL_ID = desktopAvailable() ? DESKTOP_MODEL_ID : WEB_MODEL_ID;

const SYSTEM_PROMPT = [
  "Sen AURA'sın: kullanıcının kişisel, yerel ve Türkçe yapay zeka asistanısın.",
  "Doğru, net ve yararlı cevap ver. Bilmediğini uydurma.",
  "Güncel bilgi gerektiğinde ve masaüstü ajanı bağlı olduğunda web araması araçlarını kullan.",
  "Masaüstü ajanı bağlıysa bilgisayardaki izinli dosya ve uygulama araçlarını kullanabilirsin.",
  "Dosya yazma, silme, klasör oluşturma, uygulama açma ve Unity açma gibi değişiklik yapan işlemleri sadece kullanıcı açıkça istiyorsa araç olarak seç.",
  "Kritik veya geri alınması zor işlemleri yapmadan önce aracın kullanıcı onay penceresinin çalışmasına izin ver.",
  "Kullanıcı Unity ile oyun geliştiriyorsa; proje dosyalarını okuyup anlayabilir, C# scriptleri oluşturabilir/değiştirebilir ve Unity projesini açabilir.",
  "Bilgisayarda keyfi sistem komutu çalıştırma aracı yoktur; bu sınırı aşmaya çalışma.",
  "Türkçe konuş. Gereksiz tekrar yapma."
].join("\n");

const TOOLS = [
  {
    type: "function",
    function: {
      name: "desktop_get_system_info",
      description: "Bilgisayarın işletim sistemi, CPU, RAM ve kullanıcı klasörü gibi güvenli sistem bilgilerini alır.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_list_directory",
      description: "İzin verilen bir klasörün içeriğini listeler.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string",description:"Klasör yolu"} },
        required:["path"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_read_text_file",
      description: "İzin verilen bir metin dosyasını okur. Kod dosyalarını incelemek için kullan.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string",description:"Dosya yolu"} },
        required:["path"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_write_text_file",
      description: "İzin verilen bir dosyayı oluşturur veya değiştirir. Kullanıcı açıkça kod/dosya oluşturma veya değiştirme istediğinde kullan.",
      parameters: {
        type:"object",
        properties:{
          path:{type:"string",description:"Dosya yolu"},
          content:{type:"string",description:"Dosyanın tamamı"}
        },
        required:["path","content"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_create_directory",
      description: "İzin verilen bir klasörü oluşturur.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string"} },
        required:["path"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_delete_path",
      description: "İzin verilen bir dosya veya klasörü siler. Sadece açık ve net silme isteğinde kullan.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string"} },
        required:["path"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_open_path",
      description: "İzin verilen bir dosya veya klasörü Windows'ta açar.",
      parameters: {
        type:"object",
        properties:{ path:{type:"string"} },
        required:["path"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_launch_app",
      description: "Güvenli uygulama kısayollarından Not Defteri, Hesap Makinesi veya Dosya Gezgini açar.",
      parameters: {
        type:"object",
        properties:{ app:{type:"string",enum:["notepad","calculator","explorer"]} },
        required:["app"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_open_unity_project",
      description: "Unity Editor'ı verilen Unity proje klasörü ile açar.",
      parameters: {
        type:"object",
        properties:{ projectPath:{type:"string",description:"Unity proje klasörü"} },
        required:["projectPath"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_find_and_launch_app",
      description: "Windows Başlat menüsü ve masaüstünde adı verilen uygulamayı bulur ve açar. Açmadan önce kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{ app:{type:"string",description:"Uygulama adı"} },
        required:["app"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_choose_folder",
      description: "Windows'ta kullanıcının seçtiği bir klasöre AURA erişim izni verir.",
      parameters: {
        type:"object",
        properties:{ purpose:{type:"string",description:"Klasörün neden seçildiği"} },
        required:["purpose"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_list_drives",
      description: "Windows'taki sürücüleri listeler.",
      parameters: {type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_run_powershell",
      description: "Kullanıcının açık isteğiyle bir PowerShell komutunu çalıştırır. Çalıştırmadan önce tam komut için kullanıcı onayı gösterilir. Yönetici yetkisi yükseltmez.",
      parameters: {
        type:"object",
        properties:{ command:{type:"string",description:"Çalıştırılacak PowerShell komutu"} },
        required:["command"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_open_external_url",
      description: "Verilen HTTP/HTTPS adresini varsayılan tarayıcıda açar. Açmadan önce kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{ url:{type:"string",description:"Web adresi"} },
        required:["url"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_web_search",
      description: "İnternette güncel bilgi arar ve başlık, URL ve özet döndürür.",
      parameters: {
        type:"object",
        properties:{ query:{type:"string",description:"Arama sorgusu"} },
        required:["query"], additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_fetch_web_page",
      description: "Verilen HTTP/HTTPS web sayfasının metin içeriğini getirir.",
      parameters: {
        type:"object",
        properties:{ url:{type:"string",description:"Web adresi"} },
        required:["url"], additionalProperties:false
      }
    }
  }
];

let engine = null;
let enginePromise = null;

function assertWebGPU() {
  if (!navigator.gpu) {
    throw new Error("Bu tarayıcı WebGPU desteklemiyor. Güncel Chrome veya Edge ile aç.");
  }
}

async function desktopCall(name, args) {
  if (!desktopAvailable()) {
    throw new Error("Masaüstü ajanı bağlı değil. AURA web sürümünde çalışıyor.");
  }
  const result = await globalThis.auraDesktop.call(name, args || {});
  if (!result?.ok) throw new Error(result?.error || "Masaüstü işlemi başarısız.");
  return result.result;
}

export async function ensureLocalAI(onProgress = () => {}) {
  assertWebGPU();
  if (engine) return engine;
  if (enginePromise) return enginePromise;

  enginePromise = CreateMLCEngine(MODEL_ID, {
    initProgressCallback: progress => {
      try {
        const percent = typeof progress?.progress === "number"
          ? Math.max(0, Math.min(100, Math.round(progress.progress * 100)))
          : null;
        onProgress({percent,text:progress?.text || "Yerel AI modeli hazırlanıyor..."});
      } catch {}
    }
  }).then(result => {
    engine = result;
    onProgress({percent:100,text:"Yerel AI hazır."});
    return result;
  }).catch(error => {
    engine = null;
    enginePromise = null;
    throw error;
  });

  return enginePromise;
}

function cleanMessages(history) {
  return (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .slice(-8)
    .map(m => ({
      role:m.role,
      content:String(m.content || "").slice(0,5000)
    }));
}

function parseArguments(value) {
  try { return JSON.parse(value || "{}"); }
  catch { return {}; }
}

async function executeTool(toolCall) {
  const name = toolCall?.function?.name;
  const args = parseArguments(toolCall?.function?.arguments);
  return desktopCall(name,args);
}

export async function askLocalAI(message, history = [], onProgress = () => {}) {
  const value = String(message || "").trim();
  if (!value) throw new Error("Mesaj boş.");

  const localEngine = await ensureLocalAI(onProgress);
  const messages = [
    {role:"system",content:SYSTEM_PROMPT + (desktopAvailable()
      ? "\nMasaüstü ajanı: BAĞLI. İzinli araçları gerektiğinde kullan."
      : "\nMasaüstü ajanı: BAĞLI DEĞİL. Sadece sohbet cevapları üret.")},
    ...cleanMessages(history),
    {role:"user",content:value}
  ];

  const maxRounds = 4;

  for (let round=0; round<maxRounds; round++) {
    let response;
    try {
      response = await localEngine.chat.completions.create({
        messages,
        tools: desktopAvailable() ? TOOLS : undefined,
        tool_choice: desktopAvailable() ? "auto" : undefined,
        temperature:0.55,
        top_p:0.9,
        max_tokens:768,
        stream:false
      });
    } catch (firstError) {
      if (!desktopAvailable()) throw firstError;
      response = await localEngine.chat.completions.create({
        messages,
        temperature:0.55,
        top_p:0.9,
        max_tokens:768,
        stream:false
      });
    }

    const choice = response?.choices?.[0];
    const assistantMessage = choice?.message;

    if (!assistantMessage) throw new Error("Yerel AI cevap üretmedi.");

    const toolCalls = Array.isArray(assistantMessage.tool_calls)
      ? assistantMessage.tool_calls
      : [];

    messages.push(assistantMessage);

    if (!toolCalls.length) {
      const answer = String(assistantMessage.content || "").trim();
      if (!answer) throw new Error("Yerel AI boş cevap verdi.");
      return answer;
    }

    for (const call of toolCalls.slice(0,4)) {
      try {
        const result = await executeTool(call);
        messages.push({
          role:"tool",
          tool_call_id:call.id,
          name:call.function.name,
          content:JSON.stringify(result).slice(0,30000)
        });
      } catch (error) {
        messages.push({
          role:"tool",
          tool_call_id:call.id,
          name:call.function.name,
          content:JSON.stringify({error:error?.message || "Araç hatası"})
        });
      }
    }
  }

  return "İşlemi birkaç araç adımında tamamlayamadım. Son durumu kontrol edip tekrar deneyebilirsin.";
}

export function getLocalAIModel() { return MODEL_ID; }
export function getWebModel() { return WEB_MODEL_ID; }
export function getDesktopModel() { return DESKTOP_MODEL_ID; }
export function hasDesktopAgent() { return desktopAvailable(); }
