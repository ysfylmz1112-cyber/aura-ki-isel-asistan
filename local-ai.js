
// Drive-list intent is local to this module. Never depend on a bare global
// function because the renderer can load modules in a different order.
function isDriveListRequest(q) {
  const x = String(q || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[?.!,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /^(sürücüler|suruculer|sürücüleri göster|suruculeri goster|diskler|diskleri göster|diskleri goster|disklerim|sürücülerim)$/.test(x) ||
    /^(hangi|neler|ne) (sürücüler|suruculer|diskler)( var| bulunuyor)?$/.test(x) ||
    /^(sürücü|surucu) (listesi|listele|liste)$/.test(x);
}

// Eski renderer/inline script sürümleri bu fonksiyonu globalden çağırabiliyor.
// Modül içinde de globalde de aynı güvenli sürücü algılama fonksiyonunu kullan.
globalThis.isDriveListRequest = isDriveListRequest;
import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.85";

const CHAT_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
// 1.5B Coder varsayılan: Windows/WebGPU üzerinde UI donmasını önler.
// Büyük model yalnızca ileride açıkça opt-in yapılırsa kullanılabilir.
const CODE_MODEL_ID = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
const CODE_LARGE_MODEL_ID = "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC";
const CODE_FALLBACK_MODEL_ID = CODE_MODEL_ID;
const WEB_MODEL_ID = CHAT_MODEL_ID;
const DESKTOP_MODEL_ID = CHAT_MODEL_ID;
const AURA_CORE_VERSION = '6.2.0';

function desktopAvailable() {
  return !!globalThis.auraDesktop?.isDesktop;
}

const MODEL_ID = CHAT_MODEL_ID;
const SYSTEM_PROMPT = [
  "AURA: yerel Türkçe kişisel masaüstü AI asistanısın.",
  "Bilmediğin bilgiyi uydurma. Güncel bilgi gerekiyorsa web araştırma araçlarını kullan.",
  "PC, dosya, uygulama ve sistem işlemlerinde masaüstü ajanının güvenlik ve onay kurallarına uy; bunları aşma.",
  "Kalıcı hafızaya yalnızca kullanıcı açıkça hatırlamamı istediğinde yaz. Geçmiş konuşma sorularında konuşma geçmişini ara.",
  "Unity görevlerinde önce mevcut projeyi ve Unity Editor kurulumunu incele; gerçek dosyaları oluştur/değiştir, mevcut yapıyı rastgele silme ve sonucu doğrula. Unity için mümkün olduğunca desktop_unity_autopilot ve desktop_unity_health_check araçlarını kullan.",
  "Unity/oyun geliştirme isteğinde yalnızca mevcut kullanıcı mesajının görevine odaklan. Sohbet geçmişindeki başka bir konuya atlama.",
  "Kullanıcı mevcut mesajında açıkça hava durumu istemedikçe desktop_get_weather aracını ASLA kullanma. Unity oyunundaki hava, yağmur, sis, zaman veya iklim sistemi gerçek İstanbul hava durumu değildir.",
  "Unity/oyun geliştirme görevinde web/hava araçlarını kullanma; önce Unity proje yapısını bul ve ilgili gerçek dosyaları incele.",
  "Kod görevlerinde gerçek çalışabilir kod üret; pseudocode verme. İstenen dili ve dosya yapısını koru.",
  "OpenClaw'ı yalnızca kullanıcı açıkça istediğinde kullan.",
  "Araç gerekiyorsa yalnızca izin verilen aracı JSON çağrısıyla kullan; araç sonucundan sonra ilk göreve devam et.",
  "Türkçe konuş.",
  "Kullanıcı açık ve basit bir talimat verdiğinde doğrudan o talimatı yerine getir; gereksiz yere 'daha fazla veri verin', 'daha fazla bilgi verin' veya benzeri belirsiz cevaplar verme.",
  "Kullanıcının isteği yeterince açıksa ek soru sorma. Eksik bilgi gerçekten gerekiyorsa yalnızca gereken tek bilgiyi kısa biçimde sor.",
  "Kullanıcı belirli bir çıktı biçimi isterse (ör. yalnızca bir kelime, kısa cevap, liste veya kod) o biçime mümkün olduğunca tam uy.",
  "Kullanıcı 'test', 'merhaba', 'nasılsın' gibi basit bir mesaj gönderdiğinde doğal, kısa ve yardımcı cevap ver; kullanıcıyı veri sağlamaya yönlendirme.",
  "Yanıtın ilk cümlesi mümkün olduğunca doğrudan sonucu versin. Gereksiz kurumsal, robotik veya İngilizce ifadeler kullanma.",
  "Bir araç başarısız olursa hatayı gizleme; neyin başarısız olduğunu kısa söyle ve güvenli bir alternatif öner.",
  "Araç çağrısından sonra araç sonucunu kullanıcı isteğiyle ilişkilendirerek tamamla; ham araç çıktısını tek başına kullanıcıya gönderme."
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
      name: "desktop_get_background_tasks",
      description: "AURA'nın arka planda çalışan oyun/Unity işlemlerini ve düşük öncelikli görevlerini listeler.",
      parameters: {type:"object",properties:{},additionalProperties:false}
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
      name: "desktop_self_diagnostics",
      description: "AURA çekirdeğinin kendisini test eder: renderer dosyaları, sürücü algılama, PC araçları, hafıza, konuşma geçmişi ve telefon bağlantısının hazır olup olmadığını kontrol eder.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
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
      name: "desktop_get_system_health",
      description: "AURA sistem sağlık kontrolü: CPU, RAM, disk, GPU sıcaklığı, arka plan görevleri, hafıza, hatırlatıcılar, rutinler ve telefon bağlantısını tek sonuçta verir.",
      parameters: {type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_get_app_catalog",
      description: "Kullanıcının keşfedilmiş Windows uygulamalarını ve oyunlarını katalog halinde getirir.",
      parameters: {type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_get_memory_stats",
      description: "AURA kalıcı hafızasının kayıt sayısını, etiketlerini ve en yeni kaydını verir.",
      parameters: {type:"object",properties:{},additionalProperties:false}
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
      name: "desktop_create_file_snapshot",
      description: "İzinli bir kod/metin dosyasının mevcut halini AURA kullanıcı veri klasöründeki güvenli snapshot alanına kaydeder. Kod değişikliğinden önce geri alma noktası oluşturmak için kullanılır.",
      parameters: {type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_restore_file_snapshot",
      description: "Daha önce oluşturulmuş bir dosya snapshot'ını geri yükler. Mevcut dosyanın üzerine yazmadan önce kullanıcı onayı ister.",
      parameters: {type:"object",properties:{id:{type:"string"}},required:["id"],additionalProperties:false}
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
        type:"object",        properties:{ path:{type:"string"} },        required:["path"],        additionalProperties:false
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
      name: "desktop_get_screen_context",
      description: "Windows ekranının boyutlarını ve aktif pencere bağlamını okur. Mouse koordinatlarının ekran sınırları içinde olup olmadığını ve hedef pencereyi doğrulamak için kullanılır; işlem yapmaz.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_get_foreground_window",
      description: "Windows'ta o anda aktif olan pencerenin başlığını ve işlem kimliğini okur. Mouse/klavye etkileşiminden önce hedef pencereyi doğrulamak için kullanılır; işlem yapmaz.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_mouse_click",
      description: "Kullanıcı onayıyla Windows ekranında belirli koordinata sol veya sağ tıklama yapar. Koordinatlar kullanıcıdan veya güvenilir ekran bağlamından gelmelidir.",
      parameters: {
        type:"object",
        properties:{x:{type:"number"},y:{type:"number"},button:{type:"string",enum:["left","right"]},clicks:{type:"number"}},
        required:["x","y"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_keyboard_type",
      description: "Kullanıcı onayıyla aktif pencereye metin yazar. Parola, güvenlik kodu veya hassas kimlik bilgilerini otomatik olarak girmek için kullanılmaz.",
      parameters: {
        type:"object",
        properties:{text:{type:"string"}},
        required:["text"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_keyboard_key",
      description: "Kullanıcı onayıyla aktif pencereye sınırlı bir klavye tuşu gönderir.",
      parameters: {
        type:"object",
        properties:{key:{type:"string"}},
        required:["key"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_clipboard_read",
      description: "Windows panosundaki metni okur. Şifreleri veya hassas verileri kendiliğinden isteme; kullanıcı açıkça pano içeriğini istediğinde kullan.",
      parameters: { type:"object", properties:{}, additionalProperties:false }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_clipboard_write",
      description: "Verilen metni Windows panosuna yazar. Kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{text:{type:"string"}},
        required:["text"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_capture_screen",
      description: "AURA penceresinin ekran görüntüsünü PNG olarak kullanıcının Pictures\AURA Captures klasörüne kaydeder. Kullanıcı onayı gösterilir.",
      parameters: {
        type:"object",
        properties:{name:{type:"string"}},
        additionalProperties:false
      }
    }
  },
  {
    type:"function",
    function:{
      name:"desktop_routine_create",
      description:"Kalıcı tekrarlayan AURA rutini oluşturur. Günlük, haftalık veya belirli aralıklarla Windows bildirimi gösterebilir.",
      parameters:{type:"object",properties:{text:{type:"string"},title:{type:"string"},nextAt:{type:"number"},repeat:{type:"string",enum:["daily","weekly","interval"]},intervalMs:{type:"number"}},required:["text","nextAt"],additionalProperties:false}
    }
  },
  {
    type:"function",
    function:{
      name:"desktop_routine_list",
      description:"Aktif AURA rutinlerini listeler.",
      parameters:{type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type:"function",
    function:{
      name:"desktop_routine_cancel",
      description:"Belirtilen tekrarlayan AURA rutinini iptal eder.",
      parameters:{type:"object",properties:{query:{type:"string"}},required:["query"],additionalProperties:false}
    }
  },
  {
    type:"function",
    function:{
      name:"desktop_daily_briefing",
      description:"AURA'nın tek çağrıda günlük durum özetini verir: kullanıcı, canlı donanım, aktif hatırlatıcılar ve rutinler.",
      parameters:{type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_reminder_create",
      description: "Kullanıcının istediği gelecek zaman için kalıcı AURA hatırlatıcısı oluşturur. Zamanı kesinleştirilmiş bir gelecek timestamp'i milliseconds olarak ver.",
      parameters: {
        type:"object",
        properties:{
          text:{type:"string"},
          title:{type:"string"},
          dueAt:{type:"number"}
        },
        required:["text","dueAt"],
        additionalProperties:false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_reminder_list",
      description: "Aktif ve geçmiş AURA hatırlatıcılarını listeler.",
      parameters: {type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_reminder_cancel",
      description: "Kullanıcının belirttiği aktif hatırlatıcıyı iptal eder.",
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
      name: "desktop_notify",
      description: "Windows masaüstü bildirimi gösterir. Kullanıcı tarafından istenen hatırlatma veya bilgi mesajlarında kullanılabilir.",
      parameters: {
        type:"object",
        properties:{title:{type:"string"},body:{type:"string"}},
        required:["body"],
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
  },
  {type:"function",function:{name:"desktop_create_unity_project",description:"İzinli kullanıcı klasöründe gerçek Unity proje oluşturur.",parameters:{type:"object",properties:{projectPath:{type:"string"},projectName:{type:"string"}},required:["projectPath"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_autopilot",description:"Unity geliştirme görevini tek planda uygular: mevcut projeyi doğrular, birden çok dosyayı yazar, isteğe bağlı Editor otomasyon scriptini batchmode çalıştırır, isterse Windows build alır ve projeyi açar. Kod/oyun geliştirme görevlerinde ilk tercih edilen araçtır.",parameters:{type:"object",properties:{projectPath:{type:"string"},files:{type:"array",items:{type:"object",properties:{relativePath:{type:"string"},content:{type:"string"}},required:["relativePath","content"],additionalProperties:false}},editor:{type:"object",properties:{relativePath:{type:"string"},content:{type:"string"},method:{type:"string"},args:{type:"array",items:{type:"string"}}},required:["content","method"],additionalProperties:false},build:{type:"boolean"},open:{type:"boolean"}},required:["projectPath"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_create_script",description:"Unity Assets altında gerçek C# script oluşturur veya günceller.",parameters:{type:"object",properties:{projectPath:{type:"string"},relativePath:{type:"string"},content:{type:"string"}},required:["projectPath","relativePath","content"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_open_project",description:"Unity projesini Editor ile açar.",parameters:{type:"object",properties:{projectPath:{type:"string"}},required:["projectPath"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_build",description:"Unity projesinden Windows build alır.",parameters:{type:"object",properties:{projectPath:{type:"string"},target:{type:"string"}},required:["projectPath"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_project_tree",description:"Unity projesinin dosya ve klasör yapısını listeler; Library/Temp gibi üretilen klasörleri atlar.",parameters:{type:"object",properties:{projectPath:{type:"string"},maxDepth:{type:"number"},maxEntries:{type:"number"}},required:["projectPath"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_health_check",description:"Unity Editor kurulumunu ve verilen Unity projesinin Assets/ProjectSettings/Packages yapısını hızlıca doğrular; script ve sahne sayılarını döndürür.",parameters:{type:"object",properties:{projectPath:{type:"string"}},required:["projectPath"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_read_file",description:"Unity projesindeki metin tabanlı dosyaları okur.",parameters:{type:"object",properties:{projectPath:{type:"string"},relativePath:{type:"string"}},required:["projectPath","relativePath"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_write_file",description:"Unity projesindeki metin tabanlı dosyayı oluşturur veya değiştirir; kullanıcı onayı gerekir.",parameters:{type:"object",properties:{projectPath:{type:"string"},relativePath:{type:"string"},content:{type:"string"}},required:["projectPath","relativePath","content"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_create_directory",description:"Unity projesi içinde klasör oluşturur; kullanıcı onayı gerekir.",parameters:{type:"object",properties:{projectPath:{type:"string"},relativePath:{type:"string"}},required:["projectPath","relativePath"],additionalProperties:false}}},
  {type:"function",function:{name:"openclaw_status",description:"AURA ile yerel OpenClaw Gateway bağlantısının erişilebilirlik ve kimlik doğrulama durumunu kontrol eder.",parameters:{type:"object",properties:{},additionalProperties:false}}},
  {type:"function",function:{name:"openclaw_chat",description:"Kullanıcının açıkça OpenClaw'a devretmek istediği görevi OpenClaw Gateway ajanına gönderir ve sonucu alır.",parameters:{type:"object",properties:{input:{type:"string"},user:{type:"string"},previousResponseId:{type:"string"}},required:["input"],additionalProperties:false}}},
  {type:"function",function:{name:"desktop_unity_run_editor",description:"Mevcut Unity projesinde bir static Editor methodunu batchmode ile çalıştırır; method projedeki Editor C# kodu tarafından sağlanmalıdır.",parameters:{type:"object",properties:{projectPath:{type:"string"},method:{type:"string"},args:{type:"array",items:{type:"string"}}},required:["projectPath","method"],additionalProperties:false}}},
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

function isCodeMode(mode){
  return mode === "code" || mode === "background-code";
}

function desiredModel(mode){
  if (mode === "background-code") return CODE_MODEL_ID;
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
    try {      if (engine) {        onProgress({percent:0,text:"AURA model değiştiriyor: "+target});
        await engine.reload(target);        activeModel=target;
      } else {
        await createEngine(target,config,onProgress);
      }
      activeMode=mode;
      return engine;
    } catch (error) {
      const message=String(error?.message||error);
      const memoryError=/memory|alloc|out of memory|device lost|device|buffer|gpu|webgpu/i.test(message);

      if(mode==="code" && memoryError && target===CODE_LARGE_MODEL_ID){
        onProgress({percent:0,text:"Büyük Coder modeli için bellek yetersiz; küçük Coder modele geçiliyor..."});
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

function compactLongUserRequest(text, maxChars = 6000) {
  const source = String(text || "").replace(/\r/g, "").trim();
  if (source.length <= maxChars) return source;

  // Çok uzun isteklerde bölüm başlıklarını ve her bölümün ana maddelerini koru.
  // Böylece model 4096 token sınırına takılmazken görevin kapsamını kaybetmez.
  const lines = source.split("\n");
  const sections = [];
  let current = [];

  const flush = () => {
    if (current.length) {
      sections.push(current.join("\n").trim());
      current = [];
    }
  };

  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line.trim()) && current.length) flush();
    current.push(line);
  }
  flush();

  const priority = sections.filter(s =>
    /İLK PROTOTİP|TEKNİK YAPI|GELİŞTİRME KURALI|OYUN DÖNGÜSÜ|GERÇEKÇİLİK/i.test(s)
  );
  const normal = sections.filter(s => !priority.includes(s));

  const result = [];
  const seen = new Set();
  const addSection = (section, limit) => {
    if (!section || seen.has(section)) return;
    seen.add(section);
    const lines = section.split("\n");
    const head = lines[0] || "";
    const body = lines.slice(1)
      .filter(x => x.trim())
      .slice(0, 7)
      .join("\n");
    const compact = (head + "\n" + body).slice(0, limit).trim();
    if (compact) result.push(compact);
  };

  // Önce kritik teknik bölümler.
  priority.forEach(s => addSection(s, 800));
  normal.forEach(s => addSection(s, 250));

  let output = result.join("\n\n");
  if (output.length > maxChars) output = output.slice(0, maxChars);

  return [
    "[UZUN İSTEK SIKIŞTIRILDI]",
    "Aşağıdaki metin kullanıcının uzun isteğinin bölüm başlıklarını ve ana gereksinimlerini koruyan sıkıştırılmış halidir. Eksik ayrıntıları uydurma; mevcut gereksinimlere göre ilerle.",
    output
  ].join("\\n\\n");
}

function cleanMessages(history) {
  return (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .slice(-2)
    .map(m => ({
      role:m.role,
      content:String(m.content || "").slice(0,480)
    }));
}

function compactEnvironment(environment) {
  if (!environment || typeof environment !== "object") return "";
  const apps=Array.isArray(environment.apps) ? environment.apps.slice(0,8).map(x=>String(x?.name||"")).filter(Boolean) : [];
  const games=Array.isArray(environment.games) ? environment.games.slice(0,8).map(x=>String(x?.name||"")).filter(Boolean) : [];
  const processItems=Array.isArray(environment.runningProcesses)
    ? environment.runningProcesses
    : (Array.isArray(environment.runningProcesses?.items) ? environment.runningProcesses.items : []);
  const running=processItems.slice(0,8).map(x=>String(x?.name||"")).filter(Boolean);
  return JSON.stringify({
    scannedAt:environment.scannedAt||null,
    roots:Array.isArray(environment.roots)?environment.roots.length:0,
    appCount:Array.isArray(environment.apps)?environment.apps.length:0,
    gameCount:Array.isArray(environment.games)?environment.games.length:0,
    runningCount:Number(environment.runningProcesses?.count ?? processItems.length),
    apps,games,running
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
  return items.slice(-10).map(x=>({
    text:String(x?.text||"").slice(0,360),
    tags:Array.isArray(x?.tags)?x.tags.slice(0,4):[]
  })).filter(x=>x.text);
}

function toolDirectoryPrompt(query = "", mode = "chat") {
  const q=String(query||"").toLocaleLowerCase("tr-TR");
  const selected=new Set();
  const add=(names)=>names.forEach(name=>selected.add(name));

  const unity=/unity|kamyon|nakliye|oyun geliştir|oyun gelistir|oyun yap|oyun projesi|game dev/.test(q) || isCodeMode(mode);
  const files=/dosya|klasör|klasor|kod|script|proje|oku|yaz|oluştur|olustur|düzenle|duzenle|sil|taşı|tasi|kopya|kopyala|build|derle/.test(q);
  const pc=/bilgisayar|pc|sistem|cpu|ram|gpu|disk|donanım|donanim|performans|çalışan|calisan|uygulama|program|oyun|masaüstü|masaustu/.test(q);
  // Unity/oyun geliştirme görevlerinde "hava durumu", "trafik", "yağmur" gibi
  // kelimeler oyun mekaniği olabilir; bunları gerçek dünya hava aracına yönlendirme.
  const web=!unity && /güncel|guncel|araştır|arastir|internette|web|site|haber|kaynak|hava/.test(q);
  const memory=/hafıza|hafiza|hatırla|hatirla|unut|geçmiş|gecmis|dün|dun|bugün|bugun|geçen hafta|gecen hafta/.test(q);

  if(unity) add([
    "desktop_find_unity_projects","desktop_create_unity_project","desktop_unity_health_check","desktop_unity_project_tree",
    "desktop_unity_read_file","desktop_unity_write_file","desktop_create_file_snapshot","desktop_restore_file_snapshot","desktop_unity_create_directory",
    "desktop_unity_autopilot","desktop_unity_create_script","desktop_unity_open_project",
    "desktop_unity_build","desktop_unity_run_editor"
  ]);
  if(files) add([
    "desktop_search_files","desktop_list_directory","desktop_read_text_file","desktop_write_text_file","desktop_create_file_snapshot","desktop_restore_file_snapshot",
    "desktop_create_directory","desktop_copy_path","desktop_move_path","desktop_delete_path",
    "desktop_open_path","desktop_run_powershell"
  ]);
  if(pc) add([
    "desktop_scan_environment","desktop_get_environment_profile","desktop_get_usage_report",
    "desktop_get_hardware_metrics","desktop_get_system_info","desktop_list_drives",
    "desktop_get_running_apps","desktop_get_background_tasks",
    "desktop_find_and_launch_app","desktop_close_app","desktop_restart_app","desktop_launch_app"
  ]);
  if(web) add(["desktop_web_research","desktop_web_search","desktop_fetch_web_page","desktop_get_weather"]);
  if(memory) add([
    "desktop_memory_save","desktop_memory_search","desktop_memory_list","desktop_memory_forget",
    "desktop_conversation_search","desktop_memory_clear"
  ]);
  if(/hatırlat|hatirlat|alarm/.test(q)) add(["desktop_reminder_create","desktop_reminder_list","desktop_reminder_cancel"]);
  if(/pano|clipboard/.test(q)) add(["desktop_clipboard_read","desktop_clipboard_write"]);
  if(/ekran görüntüsü|ekran goruntusu|screenshot/.test(q)) add(["desktop_capture_screen"]);
  if(/bildirim|notification/.test(q)) add(["desktop_notify"]);
  if(/telefon|phone/.test(q)) add(["desktop_open_external_url"]);
  if(/openclaw/.test(q)) add(["openclaw_status","openclaw_chat"]);

  if(selected.size===0){
    add([
      "desktop_get_system_info","desktop_get_hardware_metrics","desktop_get_system_health","desktop_get_app_catalog","desktop_get_memory_stats","desktop_list_drives",
      "desktop_search_files","desktop_read_text_file","desktop_find_and_launch_app",
      "desktop_web_search","desktop_memory_search"
    ]);
  }

  const compact=[];
  for(const tool of TOOLS){
    const fn=tool?.function;
    if(!fn || !selected.has(fn.name)) continue;
    const schema=fn.parameters?.properties||{};
    const keys=Object.keys(schema);
    compact.push("- "+fn.name+(keys.length?"("+keys.join(",")+")":"()")+" — "+String(fn.description||"").slice(0,120));
    if(compact.length>=16) break;
  }
  return compact.join("\n");
}

function buildAgentPlan(query, mode = "chat") {
  const q = String(query || "").toLocaleLowerCase("tr-TR");
  const steps = [];
  const toolHints = [];

  const code = mode === "code" || /kod|script|proje|unity|oyun geliştir|oyun gelistir|dosya oluştur|dosya olustur/.test(q);
  const inputOps = /tıkla|tikla|fare|mouse|klavye|tuş|tus|bas|enter|tab|ekrana yaz/.test(q);
  const fileOps = !inputOps && /dosya|klasör|klasor|metin dosyası|dosyası|dosyayi|dosyayı|oku|yaz|oluştur|olustur|sil|taşı|tasi|kopyala|kopya|dosya yolu|dosya yolu|klasör yolu/.test(q);
  const processOps = !fileOps && !inputOps && /işlem|islem|process|süreç|surec|çalışan süreç|calisan surec|çalışan program|calisan program|görev yöneticisi|gorev yoneticisi/.test(q);
  const systemOps = !processOps && /cpu|işlemci|ram|bellek|gpu|ekran kartı|ekran karti|disk|depolama|donanım|donanim|sistem bilgisi|performans|sıcaklık|sicaklik|batarya|pil|ağ|ag|network|internet hız|internet hiz/.test(q);

  const mediaOps = !systemOps && !inputOps && /ekran görüntüsü|ekran goruntusu|screenshot|ekranı gör|ekrani gor|pano|clipboard|panoya|kopyala|yapıştır|yapistir/.test(q);
  const terminalOps = !mediaOps && /powershell|terminal|komut satırı|komut satiri|shell|cmd|komut çalıştır|komut calistir|script çalıştır|script calistir/.test(q);
  const appOps = !terminalOps && !fileOps && !processOps && /uygulama|program|uygulamayı|uygulamayi|programı|programi|başlat|baslat|kapat|çalışan|calisan|uygulama aç|uygulama ac|program aç|program ac/.test(q);
  const pc = /bilgisayar|pc|uygulama|program|sistem|cpu|ram|gpu|disk|masaüstü|masaustu/.test(q);
  const memory = /hafıza|hafiza|hatırla|hatirla|unut|geçmiş|gecmis|dün|dun|bugün|bugun|geçen hafta|gecen hafta/.test(q);
  const web = /güncel|guncel|araştır|arastir|internette|web|kaynak|site|haber/.test(q);
  const destructive = /sil|kapat|kaldır|kaldir|taşı|tasi|değiştir|degistir|yaz|oluştur|olustur|çalıştır|calistir/.test(q);

  if (code) {
    steps.push("görevi ve mevcut proje/dosya durumunu belirle", "ilgili kaynak dosyalarını oku ve değişiklik kapsamını çıkar", "değişikliği kontrollü şekilde uygula", "test/build/sağlık kontrolü çalıştır", "sonucu gerçek dosya veya proje durumu ile doğrula");
    toolHints.push("desktop_find_unity_projects", "desktop_unity_health_check", "desktop_unity_project_tree", "desktop_unity_read_file", "desktop_unity_write_file", "desktop_read_text_file", "desktop_create_file_snapshot", "desktop_write_text_file", "desktop_restore_file_snapshot", "desktop_run_powershell");
  } else if (processOps) {
    steps.push("hedef işlem veya süreç bilgisini belirle", "çalışan süreçleri güvenli şekilde incele", "istenen işlemi onay kurallarına göre uygula", "işlem/süreç durumunu doğrula");
    toolHints.push("desktop_get_background_tasks", "desktop_get_running_apps");
    if (/kapat|sonlandır|durdur|öldür|oldur/.test(q)) toolHints.push("desktop_run_powershell");
  } else if (fileOps) {
    steps.push("hedef dosya/klasörü belirle", "yol ve erişim kapsamını güvenli şekilde kontrol et", "dosya işlemini onay kurallarına göre uygula", "sonucu gerçek dosya sistemi durumu ile doğrula");
    toolHints.push("desktop_list_directory", "desktop_read_text_file", "desktop_search_files", "desktop_open_path");
    if (/yaz|oluştur|olustur/.test(q)) toolHints.push("desktop_write_text_file", "desktop_create_directory");
    if (/sil/.test(q)) toolHints.push("desktop_delete_path");
    if (/taşı|tasi/.test(q)) toolHints.push("desktop_move_path");
    if (/kopyala|kopya/.test(q)) toolHints.push("desktop_copy_path");
  } else if (systemOps) {
    steps.push("istenen sistem/donanım bilgisini belirle", "gerekli PC durum araçlarını seç", "ölçümleri al", "ölçüm sonucunu doğrula");
    toolHints.push("desktop_pc_agent_context", "desktop_get_system_info", "desktop_get_hardware_metrics", "desktop_get_battery_status");
  } else if (inputOps) {
    steps.push("istenen kullanıcı etkileşimini belirle", "hedef pencere ve işlem kapsamını kontrol et", "mouse/klavye işlemini kullanıcı onayına göre uygula", "etkileşimin sonucunu doğrula");
    toolHints.push("desktop_get_screen_context", "desktop_get_foreground_window", "desktop_capture_screen", "desktop_mouse_click", "desktop_keyboard_type", "desktop_keyboard_key");
  } else if (mediaOps) {
    steps.push("istenen ekran/pano bilgisini belirle", "gerekli erişimi ve işlem riskini kontrol et", "ekran görüntüsü veya pano işlemini uygula", "çıktıyı doğrula");
    toolHints.push("desktop_capture_screen", "desktop_clipboard_read", "desktop_clipboard_write");
    if (/pano|clipboard|kopyala|yapıştır|yapistir/.test(q)) {
      toolHints.push("desktop_clipboard_read", "desktop_clipboard_write");
    }
  } else if (terminalOps) {
    steps.push("komutu ve hedefi belirle", "komutun riskini ve kapsamını kontrol et", "PowerShell işlemini onay kurallarına göre çalıştır", "çıktıyı ve sonucu doğrula");
    toolHints.push("desktop_run_powershell", "desktop_get_system_info");
  } else if (appOps) {
    steps.push("hedef uygulamayı belirle", "mevcut çalışan uygulamaları kontrol et", "uygulamayı açma veya kapatma işlemini onay kurallarına göre uygula", "uygulamanın beklenen durumda olduğunu doğrula");
    toolHints.push("desktop_get_running_apps", "desktop_find_and_launch_app", "desktop_launch_app");
    if (/kapat/.test(q)) toolHints.push("desktop_run_powershell");
  } else if (fileOps) {
    steps.push("hedef dosya/klasörü belirle", "işlemin güvenli ve izinli olduğunu kontrol et", "dosya/klasör işlemini uygula", "sonucu doğrula");
    toolHints.push("desktop_list_directory", "desktop_read_text_file", "desktop_write_text_file", "desktop_create_directory", "desktop_search_files", "desktop_open_path");
    if (/sil/.test(q)) toolHints.push("desktop_delete_path");
    if (/taşı|tasi/.test(q)) toolHints.push("desktop_move_path");
    if (/kopyala|kopya/.test(q)) toolHints.push("desktop_copy_path");
  } else if (pc) {
    steps.push("PC bağlamını belirle", "gerekli PC aracını seç", "işlemi uygula", "sonucu doğrula");
    toolHints.push("desktop_pc_agent_context", "desktop_get_system_info", "desktop_get_hardware_metrics", "desktop_get_environment_profile");
  } else if (memory) {
    steps.push("ilgili geçmiş/hafıza kaydını belirle", "hafıza aracını seç", "sonucu doğrula");
    toolHints.push("desktop_memory_search", "desktop_conversation_search");
  } else if (web) {
    steps.push("araştırma hedefini belirle", "kaynakları seç", "bilgiyi karşılaştır", "sonucu kaynaklarla doğrula");
    toolHints.push("desktop_web_search", "desktop_fetch_web_page");
  } else {
    steps.push("kullanıcı amacını belirle", "gerekli araç olup olmadığını değerlendir", "cevabı oluştur", "sonucu kontrol et");
  }

  const uniqueHints = [...new Set(toolHints)];
  const verification = code
    ? ["hedef dosya/proje mevcut", "değişiklik uygulanmış", "ilgili test/build veya sağlık kontrolü çalıştırılmış", "test/build/sağlık sonucu başarılı veya hata açıkça tespit edilip düzeltilmiş", "son dosya/proje durumu tekrar doğrulanmış"]
    : inputOps
      ? ["istenen mouse/klavye işlemi uygulandı", "etkileşim sonucu mümkün olan PC durumu veya ekran bağlamı ile doğrulandı"]
      : processOps
        ? ["istenen süreç/işlem bilgisi alındı", "işlem sonucu çalışan süreç durumu ile doğrulandı"]
      : appOps
        ? ["hedef uygulama belirlendi", "uygulama beklenen açık/kapalı durumuna geldi ve çalışan uygulamalarla doğrulandı"]
        : fileOps
          ? ["hedef yol bulundu veya oluşturuldu", "dosya işlemi gerçek dosya sistemi durumu ile doğrulandı"]
          : systemOps
            ? ["istenen sistem/donanım ölçümü alındı", "ölçüm sonucu gerçek PC durumuyla uyumlu"]
            : pc
              ? ["hedef durum bulundu", "işlem sonucu beklenen duruma geldi"]
              : memory
                ? ["ilgili kayıt bulundu", "hafıza işlemi sonucu doğrulandı"]
                : web
                  ? ["kaynaklar bulundu", "bilgiler karşılaştırıldı", "kaynak temeli korunuyor"]
                  : ["cevap/işlem kullanıcı isteğiyle uyumlu"];

  return {
    version: "agent-core-3-developer",
    goal: String(query || "").trim().slice(0, 1200),
    mode: String(mode || "chat"),
    steps,
    toolHints: uniqueHints,
    verification,
    requiresApproval: destructive || inputOps,
    executionStatus: "planned",
    currentStep: 0,
    lastTool: null,
    lastToolStatus: null,
    history: [],
    policy: "Önce planla → uygun aracı seç → sonucu değerlendir → gerekiyorsa düzelt → doğrulama kriterlerini kontrol et → sonra tamamla.",
    maxExecutionRounds: 5,
    developerChangePlan: code ? {
      status: "needs_inspection", targetProject: null, candidateFiles: [], changeActions: [], testStrategy: [],
      snapshotId: null, snapshotCreated: false, snapshots: [], rollbackAttempted: false, rollbackStatus: "not_attempted"
    } : null
  };
}

function buildPcToolRouter(plan, availableTools = []) {
  const names = Array.isArray(availableTools) ? availableTools.map(String) : [];
  const hints = new Set(Array.isArray(plan?.toolHints) ? plan.toolHints : []);
  const groups = {
    terminal: names.filter(name => /desktop_run_powershell/i.test(name)),
    files: names.filter(name => /desktop_(list_directory|read_text_file|write_text_file|create_directory|search_files|open_path|delete_path|move_path|copy_path)/i.test(name)),
    apps: names.filter(name => /desktop_(get_running_apps|find_and_launch_app|launch_app)/i.test(name)),
    processes: names.filter(name => /desktop_(get_background_tasks|get_running_apps)/i.test(name)),
    system: names.filter(name => /desktop_(pc_agent_context|get_system_info|get_hardware_metrics|get_environment_profile|get_battery_status)/i.test(name)),
    media: names.filter(name => /desktop_(capture_screen|clipboard_read|clipboard_write)/i.test(name)),
    input: names.filter(name => /desktop_(mouse_click|keyboard_type|keyboard_key)/i.test(name)),
    developer: names.filter(name => /desktop_(create_file_snapshot|restore_file_snapshot|read_text_file|write_text_file|run_powershell|unity_read_file|unity_write_file|unity_project_tree|unity_health_check|unity_build)/i.test(name))
  };
  const goal = String(plan?.goal || "");
  const category = /powershell|terminal|komut|shell|cmd/i.test(goal) ? "terminal"
    : /dosya|klasör|klasor/i.test(goal) ? "files"
    : /uygulama|program/i.test(goal) ? "apps"
    : /işlem|islem|process|süreç|surec/i.test(goal) ? "processes"
    : /cpu|ram|gpu|disk|donanım|donanim|sistem/i.test(goal) ? "system"
    : /tıkla|tikla|fare|mouse|klavye|tuş|tus|ekrana yaz/i.test(goal) ? "input"
    : /ekran|screenshot|pano|clipboard/i.test(goal) ? "media"
    : null;
  return {
    category,
    selected: names.filter(name => hints.has(name)),
    availableByGroup: groups,
    routingRule: category
      ? "Önce görev kategorisinin araçlarını kullan; sonuç yetersizse başka PC grubuna geç."
      : "Agent Core toolHints sıralamasını kullan.",
    requiresApproval: Boolean(plan?.requiresApproval)
  };
}

function selectAgentTools(plan, availableTools = []) {
  const names = Array.isArray(availableTools) ? availableTools.map(String) : [];
  const hints = new Set(Array.isArray(plan?.toolHints) ? plan.toolHints : []);
  const scored = names.map(name => {
    let score = 0;
    if (hints.has(name)) score += 100;
    if (plan?.mode === "code" && /unity|code|file|project|github|test/i.test(name)) score += 20;
    if (plan?.mode === "chat" && /memory|conversation/i.test(name)) score += 10;
    if (plan?.requiresApproval && /delete|remove|write|run|execute|move|kill|close/i.test(name)) score -= 5;
    return { name, score };
  });
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.name);
}

function buildDeveloperAgentInstruction(plan) {
  if (plan?.mode !== "code" && plan?.mode !== "background-code") return "";
  return "\nDEVELOPER AGENT KURALI:\n" +
    "Önce yapılandırılmış bir DEVELOPER CHANGE PLAN çıkar: hedef proje, aday dosyalar, değişiklikler, test stratejisi ve geri alma noktası. " +
    "Aday dosyaları varsayma; proje ağacını ve ilgili dosyaları okuyarak kapsamı daralt. " +
    "Değişecek her mevcut dosyada değişiklikten önce desktop_create_file_snapshot kullan ve snapshotId'yi plan durumuna kaydet. " +
    "Kod değişikliğinden önce mevcut dosya/proje durumunu oku ve değişecek dosyanın snapshot'ını oluştur. " +
    "Değişiklik başarısız olursa mümkünse snapshot'tan geri dönmeden önce kullanıcı onayını koru. " +
    "Değişiklikten sonra uygun bir test, build, compile veya sağlık kontrolü çalıştır. " +
    "Test başarısızsa önce hatanın nedenini analiz et; küçük ve kontrollü bir düzeltme güvenliyse uygula ve testi yeniden çalıştır. " +
    "Aynı dosyada tekrarlanan başarısızlık sürerse mevcut snapshotId ile desktop_restore_file_snapshot çağrısını kullanarak geri alma isteği başlat ve geri yükleme sonucunu doğrula. " +
    "Geri alma mevcut dosyanın üzerine yazacağı için kullanıcı onayını asla atlama. " +
    "Doğrulanmamış kodu başarılı ilan etme. Kullanıcı istemedikçe ilgisiz dosyaları değiştirme. " +
    "Silme veya geniş kapsamlı değişikliklerde mevcut onay kurallarını koru.";
}

function developerPlanCompletionState(plan) {
  if (plan?.mode !== "code" && plan?.mode !== "background-code") return {ready:true,reason:"not_developer_task"};
  const d = plan?.developerChangePlan;
  if (!d) return {ready:false,reason:"developer_plan_missing"};
  const failed = Array.isArray(plan?.failedSteps) && plan.failedSteps.length > 0;
  if (failed && d.rollbackStatus === "failed") return {ready:false,reason:"rollback_failed"};
  if (d.status !== "verified_or_failed" && d.status !== "rolled_back") return {ready:false,reason:"verification_not_executed"};
  if (d.status === "rolled_back") return {ready:false,reason:"change_was_rolled_back"};
  if (failed) return {ready:false,reason:"failed_step_present"};
  return {ready:true,reason:"verified"};
}

function buildAgentVerificationInstruction(plan) {
  const criteria = Array.isArray(plan?.verification) ? plan.verification : [];
  const completed = Array.isArray(plan?.completedSteps) ? plan.completedSteps : [];
  return "\nAGENT CORE SON DOĞRULAMA:\n" +
    "Görevi tamamlandı olarak bildirmeden önce gerçek sonucu kontrol et. " +
    "Doğrulama kriterleri: " + JSON.stringify(criteria) + ". " +
    "Tamamlanan araç/adımlar: " + JSON.stringify(completed.slice(-8)) + ". " +
    "Kriterler karşılanmıyorsa başarı iddiasında bulunma; eksik adımı tamamla veya açıkça belirt.";
}

function buildPcToolRecoveryInstruction(plan) {
  const router = plan?.pcToolRouter;
  if (!router) return "";
  return "\nPC TOOL YÖNLENDİRME:\n" +
    (router.category ? "Görev kategorisi: " + router.category + ". " : "") +
    "Seçilen araçlar: " + (Array.isArray(router.selected) ? router.selected.join(", ") || "yok" : "yok") + ". " +
    "İlk araç başarısız olursa aynı çağrıyı körlemesine tekrarlama; hata nedenini değerlendir, " +
    "uygun alternatif PC aracını veya daha küçük güvenli adımı seç. " +
    "Riskli işlemlerde mevcut onay gereksinimini koru ve gerçek sonucu tekrar doğrula.";
}

function buildAgentRecoveryInstruction(plan) {
  if (!plan?.failedSteps?.length) return "";
  const snapshots = plan?.developerChangePlan?.snapshots || [];
  const rollbackHint = snapshots.length ? " Developer Agent değişiklikten sonra doğrulama başarısızsa ilgili snapshotId'yi seçip desktop_restore_file_snapshot ile geri alma sürecini başlatmalı ve ardından dosyayı yeniden okumalıdır." : "";
  const failed = plan.failedSteps.slice(-3).join(", ");
  return "\nAGENT CORE HATA DÜZELTME:\n" +
    "Son başarısız araç/adımlar: " + failed + ". " +
    "Aynı çağrıyı körlemesine tekrarlama. Hatanın nedenini değerlendir, " +
    "gerekirse daha uygun alternatif araç veya daha küçük bir adım seç, " +
    "sonucu tekrar doğrula. Riskli/değiştirici işlemlerde onay gereksinimini koru."+rollbackHint;
}

function updateAgentPlanFromToolResult(plan, toolName, toolResult) {
  const next = { ...plan, developerChangePlan: plan?.developerChangePlan ? {...plan.developerChangePlan} : null };
  if (next.developerChangePlan) {
    const name = String(toolName || "");
    if (name.includes("unity_project_tree") || name.includes("list_directory")) next.developerChangePlan.status = "inspected";
    if (name.includes("unity_read_file") || name.includes("read_text_file")) next.developerChangePlan.status = "file_read";
    if (name.includes("unity_write_file") || name.includes("write_text_file")) next.developerChangePlan.status = "changed";
    if (name.includes("unity_health_check") || name.includes("unity_build") || name.includes("run_powershell")) {
      next.developerChangePlan.testStrategy = [...new Set([...(next.developerChangePlan.testStrategy || []), name])];
      if (name.includes("health_check") || name.includes("build") || name.includes("run_powershell")) next.developerChangePlan.status = "verified_or_failed";
    }
  }
  const textResult = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult ?? "");
  const lower = textResult.toLocaleLowerCase("tr-TR");
  const failed = /hata|başarısız|basarisiz|error|failed|exception|bulunamadı|bulunamadi/.test(lower);
  next.completedSteps = Array.isArray(next.completedSteps) ? [...next.completedSteps] : [];
  next.failedSteps = Array.isArray(next.failedSteps) ? [...next.failedSteps] : [];
  next.history = Array.isArray(next.history) ? [...next.history] : [];
  const tool = String(toolName || "unknown_tool");
  const status = failed ? "failed" : "completed";
  const isInputTool = /desktop_(mouse_click|keyboard_type|keyboard_key)/i.test(tool);
  const isContextTool = /desktop_(get_screen_context|get_foreground_window)/i.test(tool);
  const isSnapshotTool = /desktop_create_file_snapshot/i.test(tool);
  const isRestoreTool = /desktop_restore_file_snapshot/i.test(tool);
  if (next.developerChangePlan) {
    if (isSnapshotTool && !failed && toolResult?.id) {
      const snapshot = {id:String(toolResult.id), path:String(toolResult.path||""), createdAt:String(toolResult.createdAt||new Date().toISOString()), sha256:toolResult.sha256||null};
      next.developerChangePlan.snapshotId=snapshot.id;
      next.developerChangePlan.snapshotCreated=true;
      next.developerChangePlan.snapshots=[...(next.developerChangePlan.snapshots||[]), snapshot].slice(-10);
    }
    if (isRestoreTool) {
      next.developerChangePlan.rollbackAttempted=true;
      next.developerChangePlan.rollbackStatus=failed ? "failed" : "restored";
      next.developerChangePlan.status=failed ? "rollback_failed" : "rolled_back";
    }
  }
  next.history.push({ tool, status, at: new Date().toISOString(), summary: textResult.slice(0, 500) });
  next.history = next.history.slice(-20);
  next.lastTool = tool;
  next.lastToolStatus = status;
  next.currentStep = Math.min(Array.isArray(next.steps) ? next.steps.length : 0, (Number(next.currentStep) || 0) + (failed ? 0 : 1));
  next.executionStatus = failed ? "recovery" : "running";
  if (failed) {
    next.failedSteps.push(tool);
    next.nextAction = "Hatanın nedenini analiz et ve uygun düzeltme veya alternatif araç seç.";
  } else {
    next.completedSteps.push(tool);
    if (isContextTool && next.executionStatus !== "recovery") {
      next.nextAction = "Ekran/aktif pencere bağlamını kullanarak hedefi doğrula; ardından gerekiyorsa kullanıcı onaylı etkileşimi uygula.";
    } else if (isInputTool && next.executionStatus !== "recovery") {
      next.nextAction = "Mouse/klavye işleminin etkisini ekran veya aktif pencere bağlamıyla doğrula; beklenen sonuç yoksa başarı iddiasında bulunma.";
    } else {
      next.nextAction = "Sonucu değerlendir; doğrulama kriterleri tamamlanmadıysa sıradaki adıma geç.";
    }
  }
  return next;
}

function agentCorePrompt(plan) {
  const recovery = buildAgentRecoveryInstruction(plan);
  const verification = buildAgentVerificationInstruction(plan);
  const pcRecovery = buildPcToolRecoveryInstruction(plan);
  return "\nAURA AGENT CORE PLANI:\n" + JSON.stringify(plan) +
    "\nPlanı körü körüne uygulama; araç sonucu planla uyuşmuyorsa planı güncelle. " +
    "Her araç sonucunu değerlendir. Planın verification kriterleri karşılanmadan görevi tamamlandı sayma. " +
    "Başarısız bir adım varsa aynı işlemi körlemesine tekrarlama; hataya göre düzeltme veya alternatif araç seç. " +
    "Gereksiz araç çağrısı yapma." + recovery + verification + pcRecovery;
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
  return "ARAÇ SONUCU\nAraç: " + toolCall.name +
    "\nSonuç:\n" + JSON.stringify(result).slice(0, 2600) +
    "\n\nİlk göreve devam et. Başka bir araç gerekiyorsa yalnızca JSON çağrısı üret.";
}

export async function askLocalAI(message, history = [], onProgress = () => {}, environment = null, mode = "chat", memory = []) {
  const value = String(message || "").trim();
  if (!value) throw new Error("Mesaj boş.");

  const lowerValue = value.toLocaleLowerCase("tr-TR");
  const gameDevelopmentIntent = /unity|kamyon|nakliye|taşıma oyunu|tasima oyunu|oyun yap|oyun yapalım|oyun yapalim|oyun geliştir|oyun gelistir|oyun oluştur|oyun olustur|oyun yapmaya|game dev|game development|oyun projesi|oyun projesi oluştur|oyun projesi olustur/.test(lowerValue);
  const developmentIntent = mode === "code" || gameDevelopmentIntent || /proje oluştur|proje olustur|dosya oluştur|dosya olustur|dosya yaz|kod yaz|kodu düzelt|kodu duzelt|hata düzelt|hata duzelt|build al|derle|compile|script oluştur|script olustur|sahne oluştur|sahne olustur|component oluştur|component olustur|prefab oluştur|prefab olustur/.test(lowerValue);
  const effectiveMode = gameDevelopmentIntent ? "background-code" : (developmentIntent ? "code" : mode);
  const codeLikeMode = isCodeMode(effectiveMode);
  const localEngine = await ensureLocalAI(effectiveMode,onProgress);
  const memoryItems = compactMemory(memory);
  let memoryContext = memoryItems.length
    ? "\nKALICI HAFIZA:\n" + JSON.stringify(memoryItems)
    : "\nKALICI HAFIZA: boş.";
  if (desktopAvailable() && value.trim()) {
    try {
      const related = await desktopCall("desktop_relevant_context", { query: value, maxMemory: 5, maxConversations: 5 });
      if (related && (related.memory?.length || related.conversations?.length)) {
        memoryContext += "\nİLGİLİ GEÇMİŞ BAĞLAMI:\n" + JSON.stringify(related).slice(0, 7000);
      }
    } catch {}
  }

  const generalToolIntent = /openclaw|güncel|guncel|araştır|arastir|internette|web|site|dosya|klasör|klasor|uygulama|oyun|bilgisayar|masaüstü|masaustu|sistem|kullanım|kullanim|hatırla|hatirla|unut|geçen hafta|gecen hafta|dün|dun|bugün|bugun|konuşma geçmişi|konusma gecmisi|pano|clipboard|ekran görüntüsü|ekran goruntusu|screenshot|bildirim|notification|unity|kamyon|nakliye|cpu|ram|gpu|disk|performans|donanım|donanim|hava|sıcaklık|sicaklik|derece|pil|batarya/.test(lowerValue);

  const modePrompt = effectiveMode === "background-code"
    ? "\nOYUN GELİŞTİRME ARKA PLAN MODU: Bu görev kaynak tüketimini düşük tutan Coder modeliyle yürütülüyor. Gerçek dosyaları oluştur/değiştir ve Unity işlemlerini arka planda çalıştır. Kullanıcı bilgisayarını normal şekilde kullanmaya devam edebilmeli."
    : effectiveMode === "code"
      ? "\nKOD MODU AKTİF: Doğrudan çalışan kod üret. İstenen dili kullan. Gerekli importları ve dosya yapısını unutma."
      : "\nSOHBET MODU AKTİF: Net, mantıklı ve doğal cevap ver.";

  const pcContext = desktopAvailable() && environment
    ? "\nPC BAĞLAM ÖZETİ:\n" + compactEnvironment(environment)
    : "";

  const wantsTools = desktopAvailable() && (generalToolIntent || developmentIntent);

  const promptValue = compactLongUserRequest(value, effectiveMode==="background-code" ? 3600 : (codeLikeMode ? 4500 : 6000));
  const toolProtocol = wantsTools
    ? "\nARAÇ PROTOKOLÜ: Gerektiğinde yalnızca tek JSON nesnesi üret: " + JSON.stringify({tool:"desktop_tool_name",args:{}}) + ". JSON dışında metin yazma. Araç sonucu gelince göreve devam et.\nKULLANILABİLEN ARAÇLAR:\n" + toolDirectoryPrompt(lowerValue,effectiveMode)
    : "";

  let agentPlan = buildAgentPlan(value, effectiveMode);
    const availableToolNames = Array.isArray(toolDirectory)
      ? toolDirectory.map(tool => typeof tool === "string" ? tool : tool?.name).filter(Boolean)
      : [];
    const preferredAgentTools = selectAgentTools(agentPlan, availableToolNames);
    if (preferredAgentTools.length) {
      agentPlan.preferredTools = preferredAgentTools.slice(0, 8);
    }
    agentPlan.pcToolRouter = buildPcToolRouter(agentPlan, availableToolNames);
  const messages = [
    {
      role:"system",
      content: SYSTEM_PROMPT + modePrompt + memoryContext + pcContext +
        (desktopAvailable() ? "\nMasaüstü ajanı BAĞLI." : "\nMasaüstü ajanı BAĞLI DEĞİL.") +
        agentCorePrompt(agentPlan) +
        buildDeveloperAgentInstruction(agentPlan) +
        toolProtocol
    },
    ...cleanMessages(codeLikeMode ? history.slice(-2) : history),
    { role:"user", content:promptValue }
  ];

  const seenToolCalls = new Set();
  let agentRound = 0;
  let developerRepairRounds = 0;
  const maxDeveloperRepairRounds = 2;
  for(let round=0; round<5; round++){
    agentRound = round + 1;
    let response;
    try {
      const responsePromise = localEngine.chat.completions.create({
        messages,
        temperature:codeLikeMode?0.16:0.45,
        top_p:codeLikeMode?0.82:0.85,
        max_tokens:effectiveMode==="background-code"?650:(effectiveMode==="code"?900:192),
        stream:false
      });
      response = await Promise.race([
        responsePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Yerel AI yanıtı zaman aşımına uğradı. Model henüz hazır olmayabilir; tekrar dene.")), effectiveMode==="background-code" ? 180000 : (codeLikeMode ? 120000 : 90000)))
      ]);
    } catch (error) {
      const msg=String(error?.message||error);
      if (/context window|prompt tokens exceed|maximum context|context length|too many tokens/i.test(msg)) {
        // Son çare: geçmişi, PC bağlamını ve araç listesini kaldırıp isteği daha da küçült.
        // Böylece WebLLM 4096 context modellerinde de cevap üretmeye devam eder.
        const emergencyPrompt=compactLongUserRequest(value,2600);
        const emergencyMessages=[
          {role:"system",content:SYSTEM_PROMPT+modePrompt+"\nÇok uzun kullanıcı isteği acil sıkıştırma modunda işlendi. Eksik ayrıntı uydurma; mevcut ana gereksinimlere göre iler."},
          {role:"user",content:emergencyPrompt}
        ];
        response=await localEngine.chat.completions.create({
          messages:emergencyMessages,
          temperature:codeLikeMode?0.14:0.4,
          top_p:0.82,
          max_tokens:codeLikeMode?500:160,
          stream:false
        });
      } else {
        throw error;
      }
    }

    let assistantMessage=response && response.choices && response.choices[0] ? response.choices[0].message : null;
    const readAssistantText = (message) => {
      if (!message) return "";
      if (typeof message.content === "string") return message.content.trim();
      if (Array.isArray(message.content)) {
        return message.content
          .map(part => typeof part === "string" ? part : String(part?.text || ""))
          .join("")
          .trim();
      }
      return String(message.content || "").trim();
    };

    // Bazı WebLLM sürümlerinde içerik dizi olarak gelebilir; boş cevapta
    // kullanıcıyı sessiz bırakmak yerine tek seferlik küçük bir kurtarma isteği yap.
    if (!assistantMessage || !readAssistantText(assistantMessage)) {
      const recoveryPrompt = String(value || "").slice(0, 2200);
      const recoveryResponse = await localEngine.chat.completions.create({
        messages: [
          { role:"system", content: SYSTEM_PROMPT + "\nKISA YANIT KURTARMA MODU: Kullanıcının isteğine Türkçe ve doğrudan cevap ver. Araç çağrısı yapma; gerekiyorsa eksikliği açıkça belirt." },
          { role:"user", content: recoveryPrompt }
        ],
        temperature:0.35,
        top_p:0.85,
        max_tokens:220,
        stream:false
      });
      assistantMessage = recoveryResponse?.choices?.[0]?.message || null;
    }

    if(!assistantMessage || !readAssistantText(assistantMessage)) {
      throw new Error("Yerel AI boş cevap verdi. Modeli yeniden başlatıp tekrar dene.");
    }
    messages.push(assistantMessage);

    if(wantsTools){
      const manual=extractManualToolCall(assistantMessage.content);
      if(manual){
        const signature = manual.name + ":" + JSON.stringify(manual.args || {});
        if (seenToolCalls.has(signature)) {
          return "Aynı araç çağrısı tekrarlandı; işlemi durdurdum. Unity/PC görevi için mevcut sonucu kullan veya daha spesifik bir istek ver.";
        }
        seenToolCalls.add(signature);
        let result;
        try {
          result=await desktopCall(manual.name,manual.args);
        } catch(error) {
          result={error:error && error.message ? error.message : "Araç hatası"};
        }
        agentPlan = updateAgentPlanFromToolResult(agentPlan, manual.name, result);
        const repairInstruction = agentPlan.lastToolStatus === "failed" && codeLikeMode
          ? (++developerRepairRounds <= maxDeveloperRepairRounds
            ? "\nDEVELOPER REPAIR: Araç başarısız oldu. Önce hatanın nedenini belirle, mevcut dosya/proje durumunu tekrar oku, yalnızca gerekli küçük düzeltmeyi uygula ve testi yeniden çalıştır. Bu onarım turu " + developerRepairRounds + "/" + maxDeveloperRepairRounds + "."
            : "\nDEVELOPER REPAIR SINIRI: İki kontrollü onarım turu kullanıldı. Daha fazla kör değişiklik yapma; sonucu doğrulanmamış olarak bildir.")
          : "";
        messages.push({
          role:"user",
          content:assistantToolResultMessage(manual,result) +
            buildAgentVerificationInstruction(agentPlan) +
            buildAgentRecoveryInstruction(agentPlan) +
            buildDeveloperAgentInstruction(agentPlan) +
            repairInstruction +
            "\n\nAGENT CORE DEĞERLENDİRMESİ: Bu araç sonucu görevin hangi adımını tamamladı? Eksik kaldıysa bir sonraki uygun adımı seç. Görev tamamlandıysa doğrulama yap ve sonra final cevap ver."
        });
        continue;
      }
    }

    const answer=readAssistantText(assistantMessage);
    if(!answer) throw new Error("Yerel AI boş cevap verdi.");
    if(wantsTools && developmentIntent){
      const manualAfterAnswer=extractManualToolCall(answer);
      if(manualAfterAnswer){
        let result;
        try { result=await desktopCall(manualAfterAnswer.name,manualAfterAnswer.args); }
        catch(error){ result={error:error?.message||"Araç hatası"}; }
        agentPlan = updateAgentPlanFromToolResult(agentPlan, manualAfterAnswer.name, result);
        const repairInstruction = agentPlan.lastToolStatus === "failed" && codeLikeMode
          ? (++developerRepairRounds <= maxDeveloperRepairRounds
            ? "\nDEVELOPER REPAIR: Hata sonrası kontrollü onarım turu " + developerRepairRounds + "/" + maxDeveloperRepairRounds + ". Önce mevcut durumu oku, küçük düzeltme yap ve yeniden doğrula."
            : "\nDEVELOPER REPAIR SINIRI: Daha fazla otomatik değişiklik yapma; doğrulanmamış sonucu açıkça belirt.")
          : "";
        messages.push({role:"assistant",content:answer});
        messages.push({
          role:"user",
          content:assistantToolResultMessage(manualAfterAnswer,result) +
            buildAgentVerificationInstruction(agentPlan) +
            buildAgentRecoveryInstruction(agentPlan) +
            buildDeveloperAgentInstruction(agentPlan) +
            repairInstruction +
            "\n\nAGENT CORE DEĞERLENDİRMESİ: İşlemi doğrula. Sonuç başarısızsa güvenli şekilde düzelt; başarılıysa görevin tamamlandığını açıkça kontrol et."
        });
        continue;
      }
    }
    if (wantsTools && codeLikeMode && developmentIntent) {
      const completion = developerPlanCompletionState(agentPlan);
      if (!completion.ready && round < 4) {
        messages.push({
          role:"user",
          content: "\nDEVELOPER COMPLETION GATE: Görevi henüz başarılı olarak kapatma. Durum: " + completion.reason +
            ". Önce eksik doğrulama/test adımını tamamla; gerekiyorsa mevcut snapshot ile güvenli rollback yap. " +
            "Gerçek sonuç doğrulanmadan başarı iddiasında bulunma."
        });
        continue;
      }
    }
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
/* AURA 6.2 UX + AUTO MEMORY UPGRADE */

(() => {
  const AURA_UPGRADE_KEY = "aura_transcript_mirror_v1";
  const MAX_MIRROR_ITEMS = 1200;
  function readMirror() {
    try { const data = JSON.parse(localStorage.getItem(AURA_UPGRADE_KEY) || "[]"); return Array.isArray(data) ? data : []; }
    catch { return []; }
  }
  function writeMirror(items) {
    try { localStorage.setItem(AURA_UPGRADE_KEY, JSON.stringify(items.slice(-MAX_MIRROR_ITEMS))); } catch {}
  }
  function saveUserUtterance(text) {
    const value = String(text || "").trim();
    if (!value) return;
    const items = readMirror();
    items.push({id:"u_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,7),role:"user",text:value,createdAt:new Date().toISOString()});
    writeMirror(items);
  }
  function addScreenUpgrade() {
    if (document.getElementById("aura62Style")) return;
    const style = document.createElement("style");
    style.id = "aura62Style";
    style.textContent = `
      .coreStage{background:radial-gradient(circle at 50% 46%,rgba(98,232,255,.12),transparent 20%),radial-gradient(circle at 50% 55%,rgba(119,140,255,.08),transparent 38%),linear-gradient(180deg,#03060b,#05070b 55%,#020409)}
      .aura-scanlines{position:absolute;inset:0;pointer-events:none;z-index:4;opacity:.18;background:repeating-linear-gradient(to bottom,transparent 0,transparent 3px,rgba(98,232,255,.035) 4px);mix-blend-mode:screen}
      .aura-grid{position:absolute;inset:0;pointer-events:none;z-index:3;opacity:.22;background-image:linear-gradient(rgba(98,232,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(98,232,255,.035) 1px,transparent 1px);background-size:42px 42px;mask-image:radial-gradient(circle at center,black 0%,transparent 68%)}
      .aura-orbit{position:absolute;left:50%;top:50%;width:510px;height:510px;transform:translate(-50%,-50%);border:1px solid rgba(98,232,255,.09);border-radius:50%;pointer-events:none;z-index:5;box-shadow:0 0 70px rgba(98,232,255,.035);animation:auraOrbit 28s linear infinite}
      .aura-orbit:before,.aura-orbit:after{content:"";position:absolute;border-radius:50%;width:7px;height:7px;background:#62e8ff;box-shadow:0 0 16px #62e8ff}
      .aura-orbit:before{left:50%;top:-4px}.aura-orbit:after{right:14%;bottom:12%;background:#778cff;box-shadow:0 0 16px #778cff}
      .aura-console{position:absolute;left:18px;bottom:18px;z-index:25;width:245px;padding:10px 11px;border:1px solid rgba(98,232,255,.10);background:rgba(5,9,14,.68);backdrop-filter:blur(12px);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.22)}
      .aura-console b{display:block;font-size:8px;letter-spacing:1.6px;color:#8fefff}.aura-console span{display:block;margin-top:5px;font-size:8px;color:#60717e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .aura-console i{display:inline-block;width:5px;height:5px;border-radius:50%;background:#62e7aa;box-shadow:0 0 10px #62e7aa;margin-right:6px}
      @keyframes auraOrbit{to{transform:translate(-50%,-50%) rotate(360deg)}}
      @media(max-width:760px){.aura-console{left:10px;bottom:10px;width:calc(100% - 20px)}}
    `;
    document.head.appendChild(style);
    const stage = document.querySelector(".coreStage");
    if (!stage) return;
    for (const cls of ["aura-grid","aura-scanlines","aura-orbit"]) {
      if (!stage.querySelector("." + cls)) { const el=document.createElement("div"); el.className=cls; stage.appendChild(el); }
    }
    if (!stage.querySelector(".aura-console")) {
      const box=document.createElement("div");
      box.className="aura-console";
      box.innerHTML='<b><i></i>AURA CORE // LIVE</b><span id="auraLiveConsole">Neural interface online · konuşma kaydı aktif</span>';
      stage.appendChild(box);
    }
    const live=document.getElementById("auraLiveConsole");
    const stateText={ready:"Neural interface online · bekliyor",listening:"Ses akışı alınıyor · dinliyorum",thinking:"Yerel model düşünüyor · işlem sürüyor",speaking:"Sesli yanıt üretiliyor · AURA konuşuyor"};
    const core=document.getElementById("core");
    if(core && live){
      const observer=new MutationObserver(()=>{live.textContent=stateText[core.dataset.state]||stateText.ready;});
      observer.observe(core,{attributes:true,attributeFilter:["data-state"]});
    }
    const welcome=document.querySelector(".welcome p");
    if(welcome) welcome.textContent="Konuş, yaz veya mikrofonu kullan. AURA sohbetlerini yerel olarak kaydeder.";
    const input=document.getElementById("input");
    if(input) input.placeholder="AURA'ya söyle... söylediklerin yerel sohbet geçmişine kaydedilir";
  }
  function boot(){
    addScreenUpgrade();
    const chat=document.querySelector(".chat");
    if(chat && !chat.dataset.aura62Observer){
      chat.dataset.aura62Observer="1";
      const seen=new Set();
      const capture=()=>{
        chat.querySelectorAll(".msg.me").forEach(el=>{
          const text=String(el.textContent||"").replace(/^SEN\\s*/,"").trim();
          if(!text || seen.has(text)) return;
          seen.add(text);
          saveUserUtterance(text);
        });
      };
      new MutationObserver(capture).observe(chat,{childList:true,subtree:true});
      capture();
    }
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true}); else boot();
})();
