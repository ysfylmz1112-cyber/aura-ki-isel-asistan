import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.85";

const MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const SYSTEM_PROMPT = [
  "Sen AURA adlı Türkçe konuşan kişisel yapay zeka asistanısın.",
  "Kullanıcıya doğrudan, anlaşılır ve yararlı cevaplar ver.",
  "Bilim, tarih, teknoloji, programlama, web geliştirme, oyun geliştirme, matematik ve günlük konularda yardımcı ol.",
  "Bilmediğin bilgiyi uydurma; emin olmadığında bunu açıkça söyle.",
  "Kısa sorularda kısa, karmaşık sorularda düzenli ve açıklayıcı cevap ver.",
  "Kullanıcı Türkçe yazıyorsa Türkçe cevap ver."
].join("\n");

let engine = null;
let enginePromise = null;

function assertWebGPU() {
  if (!navigator.gpu) throw new Error("Bu tarayıcı WebGPU desteklemiyor. Güncel Chrome veya Edge ile aç.");
}

export async function ensureLocalAI(onProgress = () => {}) {
  assertWebGPU();
  if (engine) return engine;
  if (enginePromise) return enginePromise;

  enginePromise = CreateMLCEngine(MODEL_ID, {
    initProgressCallback: (progress) => {
      try {
        const percent = typeof progress?.progress === "number"
          ? Math.max(0, Math.min(100, Math.round(progress.progress * 100)))
          : null;
        onProgress({
          percent,
          text: progress?.text || "Yerel AI modeli hazırlanıyor..."
        });
      } catch {}
    }
  }).then(result => {
    engine = result;
    onProgress({ percent: 100, text: "Yerel AI hazır." });
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
      role: m.role,
      content: String(m.content || "").slice(0, 3500)
    }));
}

export async function askLocalAI(message, history = [], onProgress = () => {}) {
  const value = String(message || "").trim();
  if (!value) throw new Error("Mesaj boş.");

  const localEngine = await ensureLocalAI(onProgress);
  const response = await localEngine.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...cleanMessages(history),
      { role: "user", content: value }
    ],
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: 512,
    stream: false
  });

  const answer = response?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Yerel AI cevap üretmedi.");
  return answer;
}

export function getLocalAIModel() { return MODEL_ID; }