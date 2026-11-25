
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
let webllmModule;
try {
  webllmModule = await import("https://esm.sh/@mlc-ai/web-llm@0.2.85");
} catch (primaryError) {
  console.warn("[AURA] Primary WebLLM CDN failed; trying jsDelivr fallback.", primaryError);
  webllmModule = await import("https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm");
}
const { CreateMLCEngine, prebuiltAppConfig } = webllmModule;

const CHAT_MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";
// 3B genel sohbet modeli, Türkçe bilgi yanıtlarında daha yüksek kalite için kullanılır.
// Kod görevleri ayrı ve daha hafif Coder modeliyle devam eder.
const CODE_MODEL_ID = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
const CODE_LARGE_MODEL_ID = "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC";
const CODE_FALLBACK_MODEL_ID = CODE_MODEL_ID;
const WEB_MODEL_ID = CHAT_MODEL_ID;
const DESKTOP_MODEL_ID = CHAT_MODEL_ID;
const AURA_CORE_VERSION = '6.4.3';

function desktopAvailable() {
  return !!globalThis.auraDesktop?.isDesktop;
}

const MODEL_ID = CHAT_MODEL_ID;
const SYSTEM_PROMPT = [
  "AURA: Türkçe konuşan, yerel çalışan kişisel masaüstü AI asistanısın. Doğal, açık ve doğrudan cevap ver; ilk cümlede sonucu söyle. Kullanıcının istediği dil, biçim, uzunluk ve örnek sayısına uy.",
  "DOĞRULUK: Soruyu tam anla ve yalnızca onu yanıtla. Gerçek, tahmin ve belirsizliği ayır; bilmediğini veya doğrulayamadığını açıkça söyle. Kaynak görmediysen kaynak kullandığını iddia etme. Hesaplamaları kontrol et; uydurma bilgi, isim, fiyat, yorum veya sonuç ekleme.",
  "BAĞLAM: Son mesajı önceki konuşmayla birlikte yorumla. 'bunu', 'onu', 'devam et', 'aynısını yap' gibi takip ifadelerinde en yakın ilgili isteği kullan; çelişkide en yeni açık talimat geçerlidir. İlgisiz eski konuları taşıma. İstek açıksa gereksiz soru sorma; gerçekten gerekiyorsa tek bir net soru sor.",
  "HAFIZA: Kalıcı hafızaya yalnızca kullanıcı açıkça kaydetmemi istediğinde yaz. Önceki konuşma veya kişisel proje sorularında ilgili hafıza/konuşma geçmişini ara; ilgisiz kayıtları cevaba katma.",
  "PC GÜVENLİĞİ: Masaüstü araçlarının izin ve onay kurallarını aşma. Erişimi yalnızca kullanıcının seçtiği çalışma klasörleriyle sınırla; tüm sürücüleri, Windows, Program Files, AppData veya kimlik bilgilerini tarama. Yeni klasör için desktop_choose_folder kullan. Dosya yazma/silme, PowerShell, uygulama kapatma ve mouse/klavye işlemlerinde gereken kullanıcı onayını bekle.",
  "GÜNCELLEME: Kullanıcı en son sürümü yükle, AURA'yı güncelle veya güncelleme kontrolü istediğinde desktop_update_latest aracını çağır. Araç sonucu zaten güncelse bunu söyle; yeni sürüm bulunduysa indirme ve kurulum onayı akışını açıkça bildir. Güncellemenin kurulduğunu, uygulama yeniden başlatılıp sürüm doğrulanmadan iddia etme.",
  "ARAÇLAR: Yalnızca izin verilen araçları doğru JSON biçiminde çağır. Araç sonucunu kontrol etmeden başarı iddia etme; hata varsa saklama. Araçtan sonra ilk göreve devam et ve sonucu kullanıcı isteğiyle ilişkilendir. Aynı aracı aynı argümanlarla tekrarlama; çok adımlı işlerde kısa plan yap ve en fazla 7 araç turu kullan. OpenClaw'ı yalnızca kullanıcı açıkça isterse kullan.",
  "KOD: Çalışabilir kod üret; pseudocode verme. İstenen dili ve dosya yapısını koru. Değişiklikten önce mevcut projeyi/dosyayı oku; küçük ve kontrollü değişiklik yap, uygun test/build ile doğrula.",
  "UNITY: Önce gerçek projeyi ve Unity Editor kurulumunu incele. Mevcut dosyaları rastgele silme; mümkünse desktop_unity_autopilot ve desktop_unity_health_check kullan. Oyun içi hava, trafik, yağmur, sis veya zaman mekaniğini gerçek dünya verisi sanma. Kullanıcı açıkça gerçek hava durumu istemedikçe desktop_get_weather kullanma; Unity görevinde web/hava araçlarına yönelme.",
  "AURA KENDİNİ GELİŞTİRME: Kullanıcı AURA'yı geliştirmemi istediğinde gerçek kaynak projesini bul ve doğrula; kurulu app.asar veya çalışan uygulama dosyalarını değiştirme. Kaynak yoksa klasör konumu uydurma, kullanıcıdan seçmesini iste. Mimarîyi, ilgili dosyaları, testleri ve developer_self_test sonucunu incele; değişecek her dosya için önce snapshot oluştur. Kaynak dosyalarını yazmadan önce kullanıcı onayı al. Sonra syntax/test/build çalıştır; başarısızsa nedeni incele ve güvenli değilse snapshot geri yükle. GitHub push, release, installer yayınlama, uygulamayı kapatma/yeniden başlatma için ayrıca açık onay gerekir. Değişiklikleri, testleri ve kalan sorunları dürüstçe bildir. Bu yetki sınırsız değildir.",
  "KAZANÇ MODU: Küçük işletmeler için sıfır bütçeli, teslim edilebilir web sitesi demosu hazırla. Eksik işletme adı, adres, telefon, fiyat veya hizmet bilgisini uydurma; yer tutucu kullan. Desktop\\AURA-Gelir altında düzenli HTML/CSS/JS dosyaları oluştur, yerel kontroller yap ve kişiselleştirilebilir teklif taslağı hazırla. Gelir veya müşteri garantisi verme. Kullanıcı/veli onayı olmadan mesaj gönderme, site yayınlama, hesap açma, sözleşme veya ödeme işlemi yapma. Spam, sahte yorum, yanıltıcı vaat, ücretli API/abonelik veya başlangıç harcaması kullanma.",
  "AURA STUDIO: Reklam isteğinde desktop_marketing_create_kit kullan. Özgün başlık, açıklama, çağrı metni ve seslendirme taslağı hazırla; gerçek olmayan fiyat/indirim/yorum/sonuç/iletişim bilgisi uydurma. Araç SVG gönderi/hikâye, paylaşım metni, seslendirme metni, Reels akış planı ve metin/grafik animasyonlu dikey WebM üretir; gerçek çekim veya ses üretmez. Çıktı taslaktır; paylaşma, yayınlama ve müşteri iletişimi için ayrıca kullanıcı/veli onayı gerekir. Ücretli API/abonelik önerme.",
  "YOUTUBE: YouTube isteğinde önce youtube_studio_get_profile kullan. Kanal URL'lerini izlemiş gibi davranma; içerik analizinde gerçek video içeriği veya transkript gerekir. Shorts üretiminde ilk 2 saniyede güçlü merak kancası, tek ve anlaşılır hikâye, doğal konuşma dili, 10–90 saniyelik süreye uygun kısa senaryo ve 6–16 anlamlı sahne oluştur. Türkçe senaryoyu doğal İngilizceye uyarla; iki dilde sahne sayısı ve akışı tutarlı olsun. Sahne açıklamaları kısa, görselleştirilebilir ve karakter tutarlılığını koruyan ifadeler olsun. youtube_studio_create_plan ile taslağı kaydet, ardından youtube_studio_render_plan ile 9:16 sahne geçişli animasyon, ekrana gömülü altyazı, ayrı SRT altyazı dosyası ve Windows yerel Türkçe/İngilizce seslendirmesiyle iki WebM dosyası üret. Windows'ta ilgili dilin ses paketi yoksa bunu açık hata olarak bildir; yanlış dilde seslendirme yapma. Dosyaları kullanıcıya bildir; YouTube'a otomatik yükleme veya yayınlama yapma.",
].join("\n");

const TOOLS = [
  {
    type: "function",
    function: {
      name: "desktop_update_latest",
      description: "Kurulu AURA'nın resmi GitHub sürümünü kontrol eder. Yeni sürüm varsa electron-updater arka planda indirir; indirme bitince kurulum için yeniden başlatma onayı gösterilir.",
      parameters: {type:"object",properties:{},additionalProperties:false}
    }
  },
  {
    type: "function",
    function: {
      name: "desktop_developer_self_test",
      description: "Developer Agent altyapısının temel snapshot, dosya, PowerShell ve Unity araçlarının bağlı olup olmadığını kontrol eder. Dosya değiştirmez.",
      parameters: {type:"object",properties:{},additionalProperties:false}
    }
  },
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
      name: "desktop_income_create_site",
      description: "Kullanıcı açıkça Kazanç Modu ve restoran/web sitesi demosu istediğinde, onay alarak LAVİN örnek sitesini AURA-Gelir klasörüne oluşturur. Dosyaları kontrol eder; yayınlama veya mesaj gönderme yapmaz.",
      parameters: {
        type:"object",
        properties:{ folderName:{type:"string"} },
        additionalProperties:false
      }
    }
  },
  {
    type:"function",function:{name:"youtube_studio_get_profile",description:"Kanal profilini, kayıtlı Shorts bağlantılarını ve günlük TR→EN düzenini getirir; bağlantıların analiz edildiğini varsaymaz.",parameters:{type:"object",properties:{},additionalProperties:false}}
  },
  {
    type:"function",function:{name:"youtube_studio_save_profile",description:"Kanal URL'sini, örnek Shorts bağlantılarını ve Türkçe ilk/4 saat sonra İngilizce günlük düzenini yerel kaydeder. Videoları izlemez.",parameters:{type:"object",properties:{channelUrl:{type:"string"},exampleUrls:{type:"array",items:{type:"string"}},channelNotes:{type:"string"},publishTimeLocal:{type:"string"}},required:["channelUrl","exampleUrls"],additionalProperties:false}}
  },
  {
    type:"function",function:{name:"youtube_studio_create_plan",description:"Türkçe Shorts ve İngilizce uyarlamasını, sahne planları ve açıklamalarıyla taslak olarak yerel kaydeder. Yayınlamaz ve video üretmez.",parameters:{type:"object",properties:{topic:{type:"string"},hookTr:{type:"string"},hookEn:{type:"string"},scriptTr:{type:"string"},scriptEn:{type:"string"},scenesTr:{type:"array",items:{type:"string"}},scenesEn:{type:"array",items:{type:"string"}},captionTr:{type:"string"},captionEn:{type:"string"},hashtagsTr:{type:"array",items:{type:"string"}},hashtagsEn:{type:"array",items:{type:"string"}},durationSeconds:{type:"integer",minimum:10,maximum:90}},required:["topic","scriptTr","scriptEn"],additionalProperties:false}}
  },
  {
    type:"function",function:{name:"youtube_studio_list_plans",description:"Kaydedilmiş YouTube Shorts taslaklarını ve kanal profilini listeler.",parameters:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:50}},additionalProperties:false}}
  },
  {
    type:"function",function:{name:"youtube_studio_render_plan",description:"Kaydedilmiş Türkçe/İngilizce Shorts taslağını sahne geçişli 9:16 stickman animasyonuna, ekrana gömülü altyazılara, ayrı SRT altyazı dosyalarına ve Windows yerel seslendirmesine dönüştürerek iki WebM videosu oluşturur. Kullanıcı onayı alır; yalnızca bilgisayara kaydeder, YouTube'a yüklemez.",parameters:{type:"object",properties:{planId:{type:"string"}},additionalProperties:false}}
  },
  {
    type: "function",
    function: {
      name: "desktop_marketing_create_kit",
      description: "AURA Studio reklam/tanıtım paketi oluşturur: Instagram gönderisi ve hikâyesi SVG tasarımları, paylaşım metni, seslendirme metni, Reels akış planı ve animasyonlu dikey WebM video. Dosyaları yerel klasöre yazar; sosyal medyada paylaşmaz.",
      parameters: {
        type: "object",
        properties: {
          businessName: { type: "string", description: "Tanıtımı yapılan işletme veya marka adı." },
          businessType: { type: "string", description: "İşletmenin sektörü." },
          campaignGoal: { type: "string", description: "Reklamın amacı." },
          audience: { type: "string", description: "Hedef kitle." },
          headline: { type: "string", description: "Kısa, dikkat çekici ve gerçeğe uygun reklam başlığı." },
          supportingText: { type: "string", description: "Başlığı açıklayan kısa metin." },
          callToAction: { type: "string", description: "Kısa eylem çağrısı." },
          voiceover: { type: "string", description: "Videoda daha sonra seslendirilebilecek kısa Türkçe metin; video dosyasına ses eklenmez." },
          durationSeconds: { type: "integer", minimum: 6, maximum: 20, description: "Video süresi: 6–20 saniye." }
        },
        required: ["businessName", "businessType", "campaignGoal", "headline", "supportingText", "callToAction", "voiceover"],
        additionalProperties: false
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

// WebLLM inference can take longer on first use or with large prompts.
// A timeout must interrupt the actual GPU generation too; Promise.race alone
// only rejects the UI promise and leaves the model busy in the background.
async function collectChatCompletionStream(stream, onToken = () => {}) {
  let content = "";
  const toolCalls = [];
  let finishReason = null;
  let usage = null;
  for await (const chunk of stream) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      try { onToken(content); } catch (_) {}
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) {
        const index = Number.isInteger(part?.index) ? part.index : 0;
        if (!toolCalls[index]) toolCalls[index] = { id: "", type: "function", function: { name: "", arguments: "" } };
        const target = toolCalls[index];
        if (part.id) target.id += part.id;
        if (part.type) target.type = part.type;
        if (part.function?.name) target.function.name += part.function.name;
        if (part.function?.arguments) target.function.arguments += part.function.arguments;
      }
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk?.usage) usage = chunk.usage;
  }
  return { choices: [{ index: 0, message: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls.filter(Boolean) } : {}) }, finish_reason: finishReason }], ...(usage ? { usage } : {}) };
}

// WebLLM inference can take longer on first use or with large prompts.
// A timeout must interrupt the actual GPU generation too; Promise.race alone
// only rejects the UI promise and leaves the model busy in the background.
async function runChatCompletionWithTimeout(localEngine, options, timeoutMs, phase = "yanıt üretimi", onToken = () => {}) {
  let timeoutId;
  let timedOut = false;

  const readFinalContent = result => {
    const message = result?.choices?.[0]?.message;
    if (typeof message?.content === "string") return message.content;
    if (Array.isArray(message?.content)) {
      return message.content.map(part => typeof part === "string" ? part : String(part?.text || "")).join("");
    }
    return "";
  };

  const inference = (async () => {
    if (!options?.stream) {
      return await localEngine.chat.completions.create(options);
    }

    let streamResult;
    try {
      streamResult = await localEngine.chat.completions.create(options);
    } catch (streamError) {
      const message = String(streamError?.message || streamError || "");
      if (!/stream.*async iterable|async iterable.*stream/i.test(message)) throw streamError;

      // Some bundled WebLLM builds reject stream:true internally. Retry the
      // same request as a normal completion so commands/tool calls still work.
      const fallback = await localEngine.chat.completions.create({ ...options, stream: false });
      const finalText = readFinalContent(fallback);
      if (finalText) {
        try { onToken(finalText); } catch (_) {}
      }
      return fallback;
    }

    if (streamResult && typeof streamResult[Symbol.asyncIterator] === "function") {
      return await collectChatCompletionStream(streamResult, onToken);
    }
    if (streamResult && Array.isArray(streamResult.choices)) {
      const finalText = readFinalContent(streamResult);
      if (finalText) {
        try { onToken(finalText); } catch (_) {}
      }
      return streamResult;
    }

    // A provider may silently ignore stream:true and return an unsupported
    // object. Retry once without streaming rather than throwing an iterator error.
    const fallback = await localEngine.chat.completions.create({ ...options, stream: false });
    const finalText = readFinalContent(fallback);
    if (finalText) {
      try { onToken(finalText); } catch (_) {}
    }
    return fallback;
  })();

  try {
    return await Promise.race([
      inference,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          try {
            const interruption = localEngine?.interruptGenerate?.();
            if (interruption && typeof interruption.catch === "function") interruption.catch(() => {});
          } catch (_) {}
          reject(new Error("Yerel AI " + phase + " için " + Math.round(timeoutMs / 1000) + " saniyede yanıt veremedi. Üretim durduruldu; modeli yeniden başlatıp tekrar deneyebilirsin."));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (timedOut) {
      try { await localEngine?.interruptGenerate?.(); } catch (_) {}
    }
  }
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
    // Use IndexedDB instead of CacheStorage. This avoids CacheStorage.open failures
    // observed in some Electron persistent sessions while retaining local model caching.
    appConfig: { ...prebuiltAppConfig, cacheBackend: "indexeddb" },
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
  ].join("\n\n");
}

function resolveAnswerTokenBudget(message, mode = "chat") {
  if (mode === "background-code") return 650;
  if (mode === "code") return 1000;
  const value = String(message || "").trim();
  const normalized = value.toLocaleLowerCase("tr-TR");
  const asksForDepth = /uzun|detaylı|detayli|kapsamlı|kapsamli|ayrıntılı|ayrintili|adım adım|adim adim|tek tek|örneklerle|orneklerle|karşılaştır|karsilastir|analiz et|açıkla|acikla|rehber|rapor|plan hazırla|plan hazirla/.test(normalized);
  if (asksForDepth || value.length > 500) return 640;
  if (value.length <= 140) return 320;
  return 448;
}

function cleanMessages(history, options = {}) {
  const codeLike = options.codeLike === true;
  const maxMessages = codeLike ? 6 : 12;
  const maxTotalChars = codeLike ? 5200 : 7600;
  const maxMessageChars = codeLike ? 1800 : 2400;
  const source = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .slice(-maxMessages);

  // En yeni konuşma sırası korunur. Toplam bağlam bütçesi aşılırsa
  // en eski mesajlar çıkarılır; tek bir uzun mesaj tüm geçmişi tüketemez.
  const selected = [];
  let usedChars = 0;
  for (let i = source.length - 1; i >= 0; i--) {
    const item = source[i];
    let content = String(item.content || "").trim();
    if (!content) continue;
    if (content.length > maxMessageChars) {
      content = content.slice(-maxMessageChars);
    }
    const separatorCost = selected.length ? 32 : 0;
    if (usedChars + content.length + separatorCost > maxTotalChars) {
      // Son kullanıcı/yanıt bağlamını koru; daha eski mesajları bırak.
      if (!selected.length) {
        content = content.slice(-maxTotalChars);
      } else {
        break;
      }
    }
    selected.push({ role:item.role, content });
    usedChars += content.length + separatorCost;
  }
  return selected.reverse();
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

function compactMemory(memory, query = "") {
  const items = Array.isArray(memory) ? memory : [];
  const normalize = value => String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const stopWords = new Set(["ve","veya","ile","bir","bu","şu","o","ben","sen","biz","siz","için","gibi","mi","mı","mu","mü","ne","nasıl","nedir","da","de","çok","daha","olan","olarak","şey","şeyi","bana","beni","senin","benim","şimdi","lütfen","acaba","yani","var","yok","ise","ama","fakat","ki","her","hem","çok"]);
  const queryTerms = [...new Set(normalize(query).split(/\s+/).filter(word => word.length > 2 && !stopWords.has(word)))];
  const explicitContext = /hatırla|hatirla|geçmiş|gecmis|önceki|onceki|daha önce|daha once|geçen hafta|gecen hafta|geçen gün|gecen gun|dün|dun|az önce|az once|konuşmuştuk|konusmustuk|bahsetmiştim|bahsetmistim|devam et|devam edelim|kaldığımız|kaldigimiz|aynı proje|ayni proje|son yaptığımız|son yaptigimiz|ne yapmıştık|ne yapmistik|ne yapıyorduk|ne yapiyorduk|hangi noktadaydık|hangi noktadaydik|nerede kalmıştık|nerede kalmistik|sıradaki adım|siradaki adim|projemiz|planımız|planimiz/i.test(query);
  if (!queryTerms.length && !explicitContext) return [];

  const ranked = items.map((item, index) => {
    const text = String(item?.text || "");
    const tags = Array.isArray(item?.tags) ? item.tags.map(String) : [];
    const textTokens = new Set(normalize(text).split(/\s+/).filter(Boolean));
    const tagTokens = new Set(normalize(tags.join(" ")).split(/\s+/).filter(Boolean));
    let score = 0;
    for (const term of queryTerms) {
      if (textTokens.has(term)) score += 3;
      else if (tagTokens.has(term)) score += 5;
      else if (term.length > 5 && [...textTokens].some(token => token.length > 4 && (token.startsWith(term) || term.startsWith(token)))) score += 1;
    }
    const phrase = normalize(query);
    if (phrase.length >= 8 && normalize(text).includes(phrase)) score += 8;
    return { index, score, text, tags };
  });

  const matched = ranked.filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 6);
  const selected = matched.length
    ? matched
    : (explicitContext ? ranked.sort((a, b) => b.index - a.index).slice(0, 2) : []);

  return selected.map(({ text, tags }) => ({
    text: text.slice(0, 340),
    tags: tags.slice(0, 3)
  })).filter(item => item.text);
}

function toolDirectoryPrompt(query = "", mode = "chat") {
  const q=String(query||"").toLocaleLowerCase("tr-TR");
  const selected=new Set();
  const add=(names)=>names.forEach(name=>selected.add(name));

  const income=/kazanç modu|kazanc modu|aura üzerinden para kazan|aura uzerinden para kazan|aura ile para kazan|gelir amaçlı site|gelir amacli site|müşteri sitesi|musteri sitesi|işletme sitesi|isletme sitesi|restoran sitesi/.test(q);
  const selfDevelopment=/kendini geliştir|kendini gelistir|kendi kodunu|kendi kaynak kodunu|aura geliştir|aura gelistir|aura iyileştir|aura iyilestir|self.?improv|self.?develop/.test(q);
  const marketing=/reklam|tanıtım|tanitim|kampanya|instagram|reels|afiş|sosyal medya|gönderi|gonderi|hikaye|story|pazarlama/.test(q);
  const youtube=/youtube|shorts|kanal|video üret|video uret|video oluştur|video olustur|animasyonlu video/.test(q);
  const inputControl=/tıkla|tikla|fare|mouse|klavye|tuş|tus|ekrana yaz|enter tuşu|tab tuşu/.test(q);
  const unity=/unity|kamyon|nakliye|oyun geliştir|oyun gelistir|oyun yap|oyun projesi|game dev/.test(q) || (isCodeMode(mode) && !income && !selfDevelopment);
  const files=selfDevelopment || income || marketing || /dosya|klasör|klasor|kod|script|proje|oku|yaz|oluştur|olustur|düzenle|duzenle|sil|taşı|tasi|kopya|kopyala|build|derle|web sitesi|website|landing page/.test(q);
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
  if(marketing) add(["desktop_marketing_create_kit"]);
  if(youtube) add(["youtube_studio_get_profile","youtube_studio_save_profile","youtube_studio_create_plan","youtube_studio_list_plans","youtube_studio_render_plan"]);
  if(inputControl) add(["desktop_get_screen_context","desktop_get_foreground_window","desktop_capture_screen","desktop_mouse_click","desktop_keyboard_type","desktop_keyboard_key"]);
  if(selfDevelopment) add(["desktop_self_diagnostics","desktop_developer_self_test","desktop_get_system_health","desktop_search_files","desktop_list_directory","desktop_read_text_file","desktop_write_text_file","desktop_create_file_snapshot","desktop_restore_file_snapshot","desktop_run_powershell"]);
  if(files) add([
    "desktop_search_files","desktop_list_directory","desktop_read_text_file","desktop_write_text_file","desktop_create_file_snapshot","desktop_restore_file_snapshot",
    "desktop_create_directory","desktop_copy_path","desktop_move_path","desktop_delete_path",
    "desktop_open_path","desktop_run_powershell","desktop_choose_folder","desktop_income_create_site"
  ]);
  if(pc) add([
    "desktop_scan_environment","desktop_get_environment_profile","desktop_get_usage_report",
    "desktop_get_hardware_metrics","desktop_get_system_info","desktop_list_drives",
    "desktop_get_running_apps","desktop_get_background_tasks",
    "desktop_find_and_launch_app","desktop_close_app","desktop_restart_app","desktop_launch_app",
    "desktop_get_screen_context","desktop_get_foreground_window","desktop_capture_screen",
    "desktop_mouse_click","desktop_keyboard_type","desktop_keyboard_key"
  ]);
  if(web) add(["desktop_web_research","desktop_web_search","desktop_fetch_web_page","desktop_get_weather"]);
  if(memory) add([
    "desktop_memory_save","desktop_memory_search","desktop_memory_list","desktop_memory_forget",
    "desktop_conversation_search","desktop_memory_clear"
  ]);
  if(/en son sürüm|en son surum|güncelle|guncelle|update|yeni sürüm|yeni surum/.test(q)) add(["desktop_update_latest"]);
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

  const income = /kazanç modu|kazanc modu|aura üzerinden para kazan|aura uzerinden para kazan|aura ile para kazan|gelir amaçlı site|gelir amacli site|müşteri sitesi|musteri sitesi|işletme sitesi|isletme sitesi|restoran sitesi/.test(q);
  const youtube = /youtube|shorts|kanal|video üret|video uret|video oluştur|video olustur|animasyonlu video/.test(q);
  const marketing = /reklam|tanıtım|tanitim|kampanya|instagram|reels|afiş|sosyal medya|gönderi|gonderi|hikaye|story|pazarlama/.test(q) && !youtube;
  const code = mode === "code" || income || marketing || /kod|script|proje|unity|oyun geliştir|oyun gelistir|dosya oluştur|dosya olustur/.test(q);
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

  if (youtube) {
    steps.push("YouTube kanal profilini getir", "konuya uygun Türkçe ve İngilizce senaryo ile tutarlı sahneleri oluştur", "taslağı kaydet", "kullanıcı onayıyla iki dilde seslendirmeli, altyazılı 9:16 WebM videolarını render et", "çıktı dosyalarını doğrula; otomatik yayınlama yapma");
    toolHints.push("youtube_studio_get_profile", "youtube_studio_create_plan", "youtube_studio_render_plan", "youtube_studio_list_plans");
  } else if (marketing) {
    steps.push("reklam briefini ve gerçek işletme bilgilerini belirle", "özgün başlık, açıklama ve sahne akışı hazırla", "uygun grafik/animasyon çıktısını üret", "çıktı dosyalarını ve video biçimini doğrula", "yayınlama veya mesaj gönderme için ayrıca kullanıcı onayı bekle");
    toolHints.push("desktop_marketing_create_kit", "desktop_create_directory", "desktop_write_text_file", "desktop_open_path");
  } else if (income) {
    steps.push("AURA-Gelir çalışma klasörünü ve mevcut şablonları kontrol et", "küçük işletme için özgün ve mobil uyumlu web sitesi taslağı üret", "HTML/CSS/JavaScript dosyalarını kaydet", "yerel dosya ve sözdizimi kontrollerini çalıştır", "demo ve kişiselleştirilmiş teklif metnini hazırla; yayınlama veya iletişim için kullanıcı onayı bekle");
    toolHints.push("desktop_list_directory", "desktop_create_directory", "desktop_write_text_file", "desktop_read_text_file", "desktop_run_powershell", "desktop_open_path", "desktop_income_create_site");
  } else if (code) {
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
  const snapshots = Array.isArray(d.snapshots) ? d.snapshots : [];
  const hasChange = d.status === "changed" || d.snapshotCreated || snapshots.length > 0;
  const hasTest = Array.isArray(d.testStrategy) && d.testStrategy.length > 0;
  const hasRead = Array.isArray(plan?.completedSteps) && plan.completedSteps.some(x => /read_file|project_tree|list_directory/i.test(String(x)));
  const hasVerificationStep = Array.isArray(plan?.completedSteps) && plan.completedSteps.some(x => /health_check|unity_build|run_powershell/i.test(String(x)));
  if (failed && d.rollbackStatus === "failed") return {ready:false,reason:"rollback_failed"};
  if (d.status === "rolled_back") return {ready:false,reason:"change_was_rolled_back"};
  if (hasChange && !snapshots.length) return {ready:false,reason:"snapshot_missing"};
  if (hasChange && !hasRead) return {ready:false,reason:"source_not_read"};
  if (hasChange && !hasTest) return {ready:false,reason:"test_not_recorded"};
  if (hasChange && !hasVerificationStep) return {ready:false,reason:"verification_step_missing"};
  if (failed) return {ready:false,reason:"failed_step_present"};
  if (d.status !== "verified_or_failed") return {ready:false,reason:"verification_not_confirmed"};
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

function shouldReviewAnswer(question, answer) {
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  if (!q || !a) return false;
  const factualQuestion = /(^|[^a-zçğıöşü])(nedir|ne demek|kimdir|kim|neresidir|nerede|neden|niçin|nasıl çalışır|nasıl oluşur|nasıl işler|ne zaman|kaç|hangi[a-zçğıöşü]*|ne işe yarar|farkı|açıkla|örnek ver|örnekleri|hangi yıl|kim buldu|kim tarafından)(?=$|[^a-zçğıöşü])/i.test(q.toLocaleLowerCase('tr-TR'));
  if (!factualQuestion) return false;
  if (q.length > 500 || a.length < 55) return true;
  const stop = new Set(['nedir','neden','nasil','icin','olan','olarak','gibi','daha','veya','ile','bunu','bunun','hangi','eder','olur','yani']);
  const normalize = text => String(text || '').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(token => token.length >= 4 && !stop.has(token));
  const terms = [...new Set(normalize(q))];
  if (terms.length < 2) return false;
  const answerTerms = new Set(normalize(a));
  const overlap = terms.filter(term => answerTerms.has(term)).length / terms.length;
  return overlap < 0.2;
}

function resolveFollowUpIntent(message, history = []) {
  const value = String(message || "").trim();
  const normalizedValue = value.toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[.!?]+$/g, "")
    .trim();
  const previousUserMessage = Array.isArray(history)
    ? [...history].reverse().find(item => item?.role === "user" && String(item.content || "").trim())
    : null;
  // Turkish diacritics are normalized first, so common spelling variants
  // share one intent matcher instead of maintaining duplicate regex branches.
  const isShortFollowUp = normalizedValue.length <= 140 &&
    /^(?:(?:bunu|sunu|onu|aynisini|bu sekilde|simdi|daha da|biraz daha|ayni sekilde)\s+)*(?:da\s+)?(?:devam(?: et| edelim|ini getir|ini yap)?|gelistirmeye devam et|calismaya devam et|ekle|duzelt|yap|tamamla|surdur|ilerle|gelistir|genislet|iyilestir|kaldigin yerden devam et|devamini getir|daha fazla|biraz daha|sonraki adim|uzun sursun)\b$/.test(normalizedValue);
  const intentValue = isShortFollowUp && previousUserMessage
    ? (String(previousUserMessage.content || "") + " " + value).toLocaleLowerCase("tr-TR")
    : value.toLocaleLowerCase("tr-TR");
  return { intentValue, isShortFollowUp, previousUserMessage };
}

function isUpdateRequestIntent(value) {
  const q = String(value || "").toLocaleLowerCase("tr-TR").trim();
  return /(?:en\\s+son|son|yeni|güncel|guncel).{0,36}(?:sürüm|surum|yükle|yukle|indir|güncelle|guncelle)|(?:aura(?:'yı|’yı|yi)?\\s*)?(?:güncelle|guncelle)|güncelleme\\s+(?:kontrol|denetle)|update\\s+(?:aura|app|application)/i.test(q);
}


function buildFallbackVideoPlan(brief, durationSeconds) {
  const text = String(brief || "");
  const topicMatch = text.match(/(?:konu|tema)\\s*:\\s*([^\\n.]+)/i);
  const topic = (topicMatch && topicMatch[1] || "Disiplin, motivasyondan daha güçlüdür").trim().slice(0, 160);
  return {
    topic,
    hookTr: "Motivasyon bekleme. Başla.",
    hookEn: "Do not wait for motivation. Start.",
    scriptTr: "Motivasyon her gün gelmez. Ama disiplin, istemediğin günlerde bile seni harekete geçirir. Küçük bir adım at, sözünü tut ve devam et. Başarı, tekrar ettiğin seçimlerle oluşur.",
    scriptEn: "Motivation does not show up every day. Discipline keeps you moving even when you do not feel like it. Take one small step, keep your promise, and continue. Success is built by the choices you repeat.",
    scenesTr: [
      "Siyah-beyaz stickman alarmı kapatmak ister; ekranda büyük geri sayım başlar.",
      "Stickman kararsız kalır, sonra ayağa kalkar; kamera hızla yaklaşır.",
      "Stickman masasına oturur ve ilk küçük görevini tamamlar.",
      "Zaman hızlandırılmış geçişle akar; stickman çalışmayı sürdürür.",
      "Stickman ilerlemesini görür; küçük adımlar ekranda birikir.",
      "Stickman kameraya döner; ekranda Disiplin > Motivasyon yazısı belirir."
    ],
    scenesEn: [
      "A black-and-white stickman reaches to silence an alarm; a bold countdown appears.",
      "The stickman hesitates, then gets up; the camera quickly pushes in.",
      "The stickman sits at a desk and completes one small task.",
      "Time passes in a fast-motion transition while the stickman keeps working.",
      "The stickman notices progress as small completed steps add up on screen.",
      "The stickman faces the camera as the words Discipline > Motivation appear."
    ],
    captionTr: "Disiplin, motivasyondan daha güçlüdür.",
    captionEn: "Discipline is stronger than motivation.",
    durationSeconds: Math.max(10, Math.min(90, Number(durationSeconds) || 15))
  };
}
export async function askLocalAI(message, history = [], onProgress = () => {}, environment = null, mode = "chat", memory = []) {
  const value = String(message || "").trim();
  if (!value) throw new Error("Mesaj boş.");

  const lowerValue = value.toLocaleLowerCase("tr-TR");
  const followUp = resolveFollowUpIntent(value, history);
  const { intentValue, isShortFollowUp, previousUserMessage } = followUp;
  const workspaceAccessIntent = /tüm\s+(pc|bilgisayar)|bilgisayarın\s+tamamı|tüm\s+bilgisayar|pc.*erişim|bilgisayar.*erişim|aura.*erişim.*alanı|erişim alanı|çalışma\s+alanı.*(?:erişim|izin)|klasör\s+seçme|klasör.*erişim\s+izni|proje\s+klasörüne.*erişim\s+izni|çalışma alanı ekle|klasör erişim izni/.test(lowerValue);
  const incomeModeIntent = /kazanç modu|kazanc modu|aura üzerinden para kazan|aura uzerinden para kazan|aura ile para kazan|gelir amaçlı site|gelir amacli site|müşteri sitesi|musteri sitesi|işletme sitesi|isletme sitesi|restoran sitesi/.test(intentValue);
  const marketingModeIntent = /reklam|tanıtım|tanitim|kampanya|instagram|reels|shorts|video reklamı|video reklami|reklam videosu|afiş|sosyal medya|gönderi|gonderi|hikaye|story|pazarlama/.test(intentValue);
  const gameDevelopmentIntent = /unity|kamyon|nakliye|taşıma oyunu|tasima oyunu|oyun yap|oyun yapalım|oyun yapalim|oyun geliştir|oyun gelistir|oyun oluştur|oyun olustur|oyun yapmaya|game dev|game development|oyun projesi|oyun projesi oluştur|oyun projesi olustur/.test(intentValue);
  const developmentIntent = mode === "code" || gameDevelopmentIntent || incomeModeIntent || marketingModeIntent || /kendini geliştir|kendini gelistir|kendi kodunu|kendi kaynak kodunu|aura geliştir|aura gelistir|aura iyileştir|aura iyilestir|self.?improv|self.?develop|proje oluştur|proje olustur|dosya oluştur|dosya olustur|dosya yaz|kod yaz|kodu düzelt|kodu duzelt|hata düzelt|hata duzelt|build al|derle|compile|script oluştur|script olustur|sahne oluştur|sahne olustur|component oluştur|component olustur|prefab oluştur|prefab olustur/.test(intentValue);
  const effectiveMode = gameDevelopmentIntent ? "background-code" : (developmentIntent ? "code" : mode);
  const codeLikeMode = isCodeMode(effectiveMode);

  // Developer self-test deterministic path: never initialize the local LLM first.
  // Self-test only needs the Electron bridge, so a model-loading delay must not
  // turn an infrastructure diagnostic into a misleading timeout.
  const wantsDeveloperSelfTest = /developer agent self[- ]test|developer agent.*self test|desktop_developer_self_test|geliştirici ajan.*self[- ]test|gelistirici ajan.*self[- ]test/i.test(lowerValue);
  if (wantsDeveloperSelfTest) {
    if (!desktopAvailable()) {
      return "Aracın ham sonucu: " + JSON.stringify({
        ok: false,
        error: "Masaüstü ajanı köprüsü bu AURA oturumunda bağlı değil.",
        diagnostic: {
          auraDesktopPresent: !!globalThis.auraDesktop,
          isDesktop: !!globalThis.auraDesktop?.isDesktop,
          pageProtocol: globalThis.location?.protocol || null,
          pageOrigin: globalThis.location?.origin || null
        }
      });
    }
    try {
      const selfTestResult = await desktopCall("desktop_developer_self_test", {});
      return "Aracın ham sonucu: " + JSON.stringify(selfTestResult);
    } catch (error) {
      return "Aracın ham sonucu: " + JSON.stringify({ ok:false, error:String(error?.message || error) });
    }
  }


  // Update commands must never depend on the small local model deciding to call a tool.
  // Route them directly to Electron so "En son sürümü yükle" always checks the updater.
  if (isUpdateRequestIntent(intentValue)) {
    if (!desktopAvailable()) return "Otomatik güncelleme için AURA masaüstü uygulaması bağlı olmalı.";
    try {
      const update = await desktopCall("desktop_update_latest", {});
      const status = String(update?.status || "");
      if (status === "downloading") {
        return String(update?.message || "Yeni sürüm bulundu ve arka planda indiriliyor. İndirme bitince yeniden başlatma onayı çıkacak.");
      }
      if (status === "up-to-date") {
        return "AURA zaten en son sürümde (" + String(update?.currentVersion || "sürüm bilgisi alınamadı") + "). Yeni kurulum dosyası indirmen gerekmiyor.";
      }
      return String(update?.message || "Güncelleme kontrolü tamamlandı.") + (update?.ok === false ? " (Kontrol başarısız.)" : "");
    } catch (error) {
      return "Otomatik güncelleme kontrolü başarısız: " + String(error?.message || error);
    }
  }

  // Folder access is handled deterministically so the model cannot over-grant access.
  if (workspaceAccessIntent) {
    if (!desktopAvailable()) return "Masaüstü ajanı bağlı değil. AURA'nın klasör izinlerini ayarlamak için masaüstü uygulamasını aç.";
    try {
      const access = await desktopCall("desktop_choose_folder", { purpose: "AURA çalışma alanı — kullanıcının seçtiği dosya ve proje klasörleri" });
      const roots = Array.isArray(access?.roots) ? access.roots : [];
      return "AURA çalışma alanı izni güncellendi.\nSeçilen klasör: " + String(access?.path || "bilinmiyor") +
        "\nErişilebilir çalışma alanları: " + roots.join(" | ") +
        "\n\nAURA bu klasörlerin içindeki dosyalarda çalışabilir. Tüm sürücülere, Windows sistem klasörlerine, AppData'ya veya kimlik bilgilerine sınırsız erişim verilmedi. Dosya değişiklikleri ve PowerShell komutları için ayrıca onay gerekir.";
    } catch (error) {
      return "Klasör erişim izni eklenemedi: " + String(error?.message || error);
    }
  }

  // Build the sample site with a deterministic local tool; do not spend minutes
  // generating large source files with the small on-device language model.
  const incomeWebsiteIntent = incomeModeIntent && /(lavin|lavın|restoran|web sitesi|website|demo|site|devam|ekle|düzelt|duzelt|yap)/.test(intentValue);
  if (incomeWebsiteIntent) {
    if (!desktopAvailable()) return "Masaüstü ajanı bağlı değil. Kazanç Modu dosyaları oluşturmak için AURA masaüstü uygulamasını aç.";
    try {
      const result = await desktopCall("desktop_income_create_site", { folderName: "LAVIN-Demo" });
      const checks = result?.checks || {};
      const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
      return "AURA KAZANÇ MODU — LAVİN DEMO\n" +
        "Klasör: " + String(result?.folder || "bilinmiyor") + "\n" +
        "Dosyalar: " + (Array.isArray(result?.files) ? result.files.map(file => file.name).join(", ") : "kontrol edilemedi") + "\n" +
        "Kontroller: " + (failed.length ? "Eksik: " + failed.join(", ") : "HTML/CSS/JavaScript dosyaları ve bağlantıları kontrol edildi.") + "\n" +
        "Durum: " + String(result?.message || "Demo oluşturma tamamlandı.") + "\n\n" +
        "Not: Bu bir portföy demosudur. Gerçek işletme bilgileri eklenmeden yayınlanmamalıdır.";
    } catch (error) {
      return "Kazanç Modu demo oluşturamadı: " + String(error?.message || error);
    }
  }

  const localEngine = await ensureLocalAI(effectiveMode,onProgress);

  // Explicit video requests use a deterministic production pipeline: the model
  // writes a structured plan, then AURA must save and render it before replying.
  const videoCreationIntent = /(?:shorts|video).{0,100}(?:oluştur|olustur|üret|uret|hazırla|hazirla|yap)|(?:oluştur|olustur|üret|uret|hazırla|hazirla|yap).{0,60}(?:shorts|video)/i.test(value);
  if (videoCreationIntent) {
    if (!desktopAvailable()) return "Video üretimi için AURA masaüstü uygulaması bağlı olmalı.";
    if (!/(shorts|dikey)/i.test(value)) return "Bu üretim akışı şu anda dikey Shorts videoları için etkin. Normal yatay video motoru ayrıca tamamlanmalı.";
    const durationMatch = value.match(/(\d{1,3})\s*(?:saniye(?:lik)?|sn)\b/i);
    const requestedDuration = durationMatch ? Number(durationMatch[1]) : 35;
    if (!Number.isFinite(requestedDuration) || requestedDuration < 10 || requestedDuration > 90) {
      return "Mevcut Shorts render motoru şu anda 10–90 saniye aralığını destekliyor. Daha uzun süre sınırları tamamlanmadan video oluşturulduğunu söylemeyeceğim.";
    }
    try {
      onProgress({ stage:"video-production", text:"YouTube kanal ayarları kontrol ediliyor..." });
      await desktopCall("youtube_studio_get_profile", {});

      let generated;
      try {
        const planResponse = await runChatCompletionWithTimeout(localEngine, {
          messages: [
            { role:"system", content:"Sen AURA video senaryo hazırlayıcısısın. Kullanıcı briefine göre yalnızca geçerli JSON döndür; Markdown veya açıklama ekleme. Alanlar: topic, hookTr, hookEn, scriptTr, scriptEn, scenesTr (dizi), scenesEn (dizi), captionTr, captionEn. Türkçe ve İngilizce aynı hikâyeyi anlatsın. Süreye uygun kısa seslendirme ve 4–12 görselleştirilebilir sahne üret. Kullanıcının final mesajını captionTr alanında aynen koru." },
            { role:"user", content:"Süre: "+requestedDuration+" saniye. Brief:\\n"+value }
          ],
          temperature:0.2, top_p:0.8, max_tokens:650, stream:false
        }, 45000, "video senaryosu hazırlama");
        const rawPlan = String(planResponse && planResponse.choices && planResponse.choices[0] && planResponse.choices[0].message && planResponse.choices[0].message.content || "").trim();
        const jsonText = rawPlan.replace(/^\x60\x60\x60(?:json)?\\s*/i,"").replace(/\\s*\x60\x60\x60$/,"");
        const jsonStart = jsonText.indexOf("{"), jsonEnd = jsonText.lastIndexOf("}");
        if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error("Senaryo modeli geçerli JSON planı döndürmedi.");
        generated = JSON.parse(jsonText.slice(jsonStart,jsonEnd+1));
      } catch (generationError) {
        onProgress({ stage:"video-production", text:"Yerel AI senaryoyu zamanında hazırlayamadı; hızlı yerleşik senaryo şablonu kullanılıyor..." });
        generated = buildFallbackVideoPlan(value, requestedDuration);
      }
      const plan = {
        topic:String(generated.topic || "Disiplin ve motivasyon").trim(),
        hookTr:String(generated.hookTr || "").trim(),
        hookEn:String(generated.hookEn || "").trim(),
        scriptTr:String(generated.scriptTr || "").trim(),
        scriptEn:String(generated.scriptEn || "").trim(),
        scenesTr:Array.isArray(generated.scenesTr) ? generated.scenesTr : [],
        scenesEn:Array.isArray(generated.scenesEn) ? generated.scenesEn : [],
        captionTr:String((value.match(/sonunda[\s\S]{0,80}["“]([^"”]+)["”]/i) || [])[1] || generated.captionTr || "").trim(),
        captionEn:String(generated.captionEn || "").trim(),
        durationSeconds:requestedDuration
      };
      if (!plan.topic || !plan.scriptTr || !plan.scriptEn || !plan.scenesTr.length || !plan.scenesEn.length) {
        throw new Error("Senaryo planında konu, iki dilde seslendirme veya sahneler eksik.");
      }
      onProgress({ stage:"video-production", text:"Senaryo hazır. Video taslağı kaydediliyor..." });
      const saved = await desktopCall("youtube_studio_create_plan", plan);
      const planId = String(saved && saved.plan && saved.plan.id || "");
      if (!planId) throw new Error("Video taslağı kaydedildi bilgisi doğrulanamadı; plan kimliği yok.");
      onProgress({ stage:"video-production", text:"Animasyon, seslendirme ve altyazılar oluşturuluyor..." });
      const rendered = await desktopCall("youtube_studio_render_plan", { planId:planId });
      const outputs = Array.isArray(rendered && rendered.outputs) ? rendered.outputs : [];
      if (!rendered || rendered.ok !== true || outputs.length !== 2 || outputs.some(item => !item || !item.path || Number(item.bytes) < 1500)) {
        throw new Error("Video üretim aracı iki doğrulanmış çıktı döndürmedi.");
      }
      return "AURA VİDEO ÜRETİMİ TAMAMLANDI\nKonu: "+plan.topic+"\nSüre: "+requestedDuration+" saniye\nFormat: Dikey 9:16 Shorts\n"+
        outputs.map(item => (item.language === "tr" ? "Türkçe" : "İngilizce")+": "+item.path+" ("+Math.round(Number(item.bytes)/1024)+" KB)").join("\n")+
        "\nAltyazılar ve seslendirme metinleri de kaydedildi. YouTube yüklemesi yapılmadı.";
    } catch (error) {
      return "AURA video üretimini tamamlayamadı. Hata: "+String(error && error.message || error)+"\nVideo oluşturulmuş gibi gösterilmedi.";
    }
  }

  const memoryItems = compactMemory(memory, intentValue);
  let memoryContext = memoryItems.length
    ? "\nİLGİLİ KALICI HAFIZA:\n" + JSON.stringify(memoryItems)
    : "";
  const needsRelatedContext = isShortFollowUp || /hatırla|hatirla|geçmiş|gecmis|önceki|onceki|daha önce|daha once|geçen hafta|gecen hafta|geçen gün|gecen gun|dün|dun|az önce|az once|konuşmuştuk|konusmustuk|bahsetmiştim|bahsetmistim|devam et|devam edelim|kaldığımız|kaldigimiz|aynı proje|ayni proje|benim projem|son yaptığımız|son yaptigimiz|ne yapmıştık|ne yapmistik|ne yapıyorduk|ne yapiyorduk|hangi noktadaydık|hangi noktadaydik|nerede kalmıştık|nerede kalmistik|sıradaki adım|siradaki adim|planım|planim|kendini geliştir|kendini gelistir/i.test(intentValue);
  if (desktopAvailable() && value.trim() && needsRelatedContext) {
    try {
      const related = await desktopCall("desktop_relevant_context", { query: intentValue, maxMemory: 5, maxConversations: 5 });
      if (related && (related.memory?.length || related.conversations?.length)) {
        memoryContext += "\nİLGİLİ GEÇMİŞ BAĞLAMI:\n" + JSON.stringify(related).slice(0, 5200);
      }
    } catch {}
  }

  const generalToolIntent = incomeModeIntent || marketingModeIntent || /openclaw|güncel|guncel|araştır|arastir|internette|web|site|dosya|klasör|klasor|uygulama|oyun|bilgisayar|masaüstü|masaustu|sistem|kullanım|kullanim|hatırla|hatirla|unut|geçen hafta|gecen hafta|dün|dun|bugün|bugun|konuşma geçmişi|konusma gecmisi|pano|clipboard|ekran görüntüsü|ekran goruntusu|screenshot|bildirim|notification|unity|kamyon|nakliye|cpu|ram|gpu|disk|performans|donanım|donanim|hava|sıcaklık|sicaklik|derece|pil|batarya/.test(intentValue);

  const modePrompt = marketingModeIntent
    ? "\nAURA STUDIO REKLAM MODU: Önce işletme/marka, sektör, kampanya amacı ve hedef kitleyi mevcut istekteki bilgilerden çıkar. Gerçek olmayan fiyat, indirim, yorum, iletişim bilgisi veya sonuç iddiası uydurma. Kısa bir başlık, açıklama, çağrı ve Türkçe seslendirme taslağı hazırla. desktop_marketing_create_kit aracını çağırarak Instagram gönderisi/hikâyesi, paylaşım metni, seslendirme metni, Reels akış planı ve animasyonlu dikey WebM videosu üret. Video grafik ve metin animasyonudur; gerçek görüntü veya ses içermez. Çıktıyı Desktop\\AURA-Gelir\\AURA-Studio altında tut. Hiçbir içeriği otomatik paylaşma, yayınlama veya kimseye gönderme."
    : incomeModeIntent
    ? "\nAURA KAZANÇ MODU: İlk hedef küçük işletmelere satılabilir, mobil uyumlu tek sayfalık web sitesi demoları hazırlamak. Önce Desktop\\AURA-Gelir klasörünü kullan; yoksa oluştur. İşletme bilgileri verilmediyse örnek/demo olduğunu açıkça belirt ve sahte iletişim bilgisi yazma. index.html, styles.css, script.js ve kısa README/teslim notu üret. Dosyaları yerel olarak doğrula. Sonunda müşteri için kişiselleştirilebilir teklif metni hazırla; hiçbir şeyi otomatik gönderme veya yayınlama. Gerçek gelir oluştuğunu iddia etme."
    : effectiveMode === "background-code"
      ? "\nOYUN GELİŞTİRME ARKA PLAN MODU: Bu görev kaynak tüketimini düşük tutan Coder modeliyle yürütülüyor. Gerçek dosyaları oluştur/değiştir ve Unity işlemlerini arka planda çalıştır. Kullanıcı bilgisayarını normal şekilde kullanmaya devam edebilmeli."
      : effectiveMode === "code"
        ? "\\nKOD MODU AKTİF: Doğrudan çalışan kod üret. İstenen dili kullan. Gerekli importları ve dosya yapısını unutma."
        : "\\nSOHBET MODU AKTİF: Net, mantıklı ve doğal cevap ver.";

  const pcContext = desktopAvailable() && environment
    ? "\nPC BAĞLAM ÖZETİ:\n" + compactEnvironment(environment)
    : "";

  const wantsTools = desktopAvailable() && (generalToolIntent || developmentIntent);

  const promptValue = compactLongUserRequest(value, effectiveMode==="background-code" ? 3600 : (codeLikeMode ? 4500 : 6000));
  const toolProtocol = wantsTools
    ? "\nARAÇ PROTOKOLÜ: Gerektiğinde yalnızca tek JSON nesnesi üret: " + JSON.stringify({tool:"desktop_tool_name",args:{}}) + ". JSON dışında metin yazma. Araç sonucu gelince göreve devam et.\nKULLANILABİLEN ARAÇLAR:\n" + toolDirectoryPrompt(intentValue,effectiveMode)
    : "";

  let agentPlan = buildAgentPlan(isShortFollowUp && previousUserMessage ? String(previousUserMessage.content || "") + " " + value : value, effectiveMode);
    const availableToolNames = Array.isArray(TOOLS)
      ? TOOLS.map(tool => typeof tool === "string" ? tool : (tool?.function?.name || tool?.name)).filter(Boolean)
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
        (wantsTools
          ? agentCorePrompt(agentPlan) + buildDeveloperAgentInstruction(agentPlan)
          : "\nGENEL SOHBET KURALI: Bu istek bir bilgisayar/araç görevi değilse araç planı üretme. Sorulan bilgiye doğrudan, doğru ve sade Türkçe cevap ver; kullanıcının istediği örnek sayısına uy. Konuyla ilgisiz teknoloji, veri kümesi, entegrasyon veya kurumsal ifadeler uydurma.") +
        toolProtocol
    },
    ...cleanMessages(history, { codeLike: codeLikeMode }),
    { role:"user", content:promptValue }
  ];

  const seenToolCalls = new Set();
  let agentRound = 0;
  let developerRepairRounds = 0;
  const maxDeveloperRepairRounds = 2;
  const developerTestFailures = new Map();
  for(let round=0; round<7; round++){
    agentRound = round + 1;
    let response;
    const generationStartedAt = Date.now();
    let firstTokenAt = null;
    let latestPartialText = "";
    try {
      const inferenceTimeout = effectiveMode === "background-code" ? 480000 : (codeLikeMode ? 360000 : 300000);
      response = await runChatCompletionWithTimeout(localEngine, {
        messages,
        temperature:codeLikeMode?0.16:0.25,
        top_p:codeLikeMode?0.82:0.85,
        max_tokens:resolveAnswerTokenBudget(value,effectiveMode),
        stream:true
      }, inferenceTimeout, "yanıt üretimi", (partialText) => {
        const partial = String(partialText || "");
        if (partial && firstTokenAt === null) firstTokenAt = Date.now();
        if (partial) latestPartialText = partial;
        try { onProgress({ stage:"generating", text:partialText, model:effectiveMode==="code" ? CODE_MODEL_ID : CHAT_MODEL_ID }); } catch (_) {}
      });
      const generationFinishedAt = Date.now();
      const timing = {
        stage: "metrics",
        model: effectiveMode === "code" ? CODE_MODEL_ID : CHAT_MODEL_ID,
        timeToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - generationStartedAt,
        generationMs: generationFinishedAt - generationStartedAt,
        responseCharacters: latestPartialText.length,
        charactersPerSecond: generationFinishedAt > generationStartedAt
          ? Math.round(latestPartialText.length / ((generationFinishedAt - generationStartedAt) / 1000))
          : 0
      };
      try { onProgress(timing); } catch (_) {}
    } catch (error) {
      const msg=String(error?.message||error);
      if (/context window|prompt tokens exceed|maximum context|context length|too many tokens/i.test(msg)) {
        // Son çare: geçmişi, PC bağlamını ve araç listesini kaldırıp isteği daha da küçült.
        // Böylece WebLLM 4096 context modellerinde de cevap üretmeye devam eder.
        // Context overflow recovery must be genuinely tiny: the full system prompt
        // and mode instructions can themselves exceed the model's context window.
        const emergencyPrompt=compactLongUserRequest(value,1200);
        const emergencyMessages=[
          {role:"system",content:"AURA: Kullanıcıya Türkçe, kısa ve doğrudan cevap ver. Yalnızca son isteği yanıtla. Araç çağırma. Eksik bilgi uydurma."},
          {role:"user",content:emergencyPrompt}
        ];
        response=await runChatCompletionWithTimeout(localEngine, {
          messages:emergencyMessages,
          temperature:0.25,
          top_p:0.8,
          max_tokens:128,
          stream:false
        }, 120000, "küçültülmüş bağlam kurtarma");
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
      const recoveryResponse = await runChatCompletionWithTimeout(localEngine, {
        messages: [
          { role:"system", content: SYSTEM_PROMPT + "\nKISA YANIT KURTARMA MODU: Kullanıcının isteğine Türkçe ve doğrudan cevap ver. Araç çağrısı yapma; gerekiyorsa eksikliği açıkça belirt." },
          { role:"user", content: recoveryPrompt }
        ],
        temperature:0.35,
        top_p:0.85,
        max_tokens:220,
        stream:false
      }, 180000, "boş yanıt kurtarma");
      assistantMessage = recoveryResponse?.choices?.[0]?.message || null;
    }

    if(!assistantMessage || !readAssistantText(assistantMessage)) {
      throw new Error("Yerel AI boş cevap verdi. Modeli yeniden başlatıp tekrar dene.");
    }
    // General factual questions get a second, isolated review pass. Small local
    // models can produce fluent but irrelevant examples; ask the same model to
    // correct factual mismatches before the answer reaches the user.
    const draftTextForReview = readAssistantText(assistantMessage);
    if (!wantsTools && !codeLikeMode && shouldReviewAnswer(value, draftTextForReview) && round === 0) {
      try {
        const draftText = readAssistantText(assistantMessage);
        const reviewResponse = await runChatCompletionWithTimeout(localEngine, {
          messages: [
            {
              role: "system",
              content: "Sen AURA'nın Türkçe cevap denetleyicisisin. Taslak cevabın kullanıcı sorusunu gerçekten yanıtlayıp yanıtlamadığını ve olgusal doğruluğunu kontrol et. Konu dışı örnekleri, uydurma kişi/nesne adlarını ve anlamsız cümleleri düzelt. Emin olmadığın ayrıntıları uydurma. Doğru ve sade cevap ver; değerlendirme sürecini anlatma, yalnızca kullanıcıya verilecek nihai cevabı yaz."
            },
            {
              role: "user",
              content: "KULLANICI SORUSU:\n" + value + "\n\nDENETLENECEK TASLAK:\n" + draftText + "\n\nTaslak yanlış veya konu dışıysa cevabı baştan doğru biçimde yaz. Doğruysa kısa ve net biçimde koru."
            }
          ],
          temperature: 0.1,
          top_p: 0.7,
          max_tokens: 320,
          stream: false
        }, 120000, "yanıt denetimi");
        const reviewedText = readAssistantText(reviewResponse?.choices?.[0]?.message);
        if (reviewedText && reviewedText.length <= 3000) {
          assistantMessage = { ...assistantMessage, content: reviewedText };
        }
      } catch (reviewError) {
        // The first answer is retained if the optional review pass fails.
      }
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
        if (codeLikeMode && agentPlan.lastToolStatus === "failed" && /build|health_check|run_powershell/i.test(manual.name)) {
          const key = String(manual.name);
          developerTestFailures.set(key, (developerTestFailures.get(key) || 0) + 1);
        }
        const repeatedTestFailure = [...developerTestFailures.values()].some(count => count >= 2);
        const repairInstruction = agentPlan.lastToolStatus === "failed" && codeLikeMode
          ? (++developerRepairRounds <= maxDeveloperRepairRounds
            ? "\nDEVELOPER REPAIR: Araç başarısız oldu. Önce hatanın nedenini belirle, mevcut dosya/proje durumunu tekrar oku, yalnızca gerekli küçük düzeltmeyi uygula ve testi yeniden çalıştır. Bu onarım turu " + developerRepairRounds + "/" + maxDeveloperRepairRounds + "."
            : (repeatedTestFailure ? "\nDEVELOPER TEST FAILURE GUARD: Aynı test iki kez başarısız oldu. Yeni kör kod değişikliği yapma; mevcut snapshot ile onaylı rollback başlat, dosyayı yeniden oku ve sonucu doğrula." : "\nDEVELOPER REPAIR SINIRI: İki kontrollü onarım turu kullanıldı. Daha fazla kör değişiklik yapma; sonucu doğrulanmamış olarak bildir."))
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
