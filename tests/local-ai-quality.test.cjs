"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "local-ai.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, "missing source marker: " + startMarker);
  assert.notEqual(end, -1, "missing end marker: " + endMarker);
  return source.slice(start, end);
}

const streamHelpers = extract("async function collectChatCompletionStream(", "\nfunction isCodeMode");

const updateIntentHelper = extract("function isUpdateRequestIntent(", "\nexport async function askLocalAI");
const helpers = [
  extract("function compactMemory(", "\nfunction toolDirectoryPrompt"),
  extract("function resolveAnswerTokenBudget(", "\nfunction cleanMessages"),
  extract("function cleanMessages(", "\nfunction compactEnvironment"),
  extract("function shouldReviewAnswer(", "\nfunction resolveFollowUpIntent"),
  extract("function resolveFollowUpIntent(", "\nexport async function askLocalAI")
].join("\n");

const updateSandbox = {};
vm.runInNewContext(updateIntentHelper + "\nthis.isUpdateRequestIntent = isUpdateRequestIntent;", updateSandbox);

const sandbox = {};
vm.runInNewContext(helpers + "\nthis.compactMemory = compactMemory; this.cleanMessages = cleanMessages; this.resolveFollowUpIntent = resolveFollowUpIntent; this.resolveAnswerTokenBudget = resolveAnswerTokenBudget; this.shouldReviewAnswer = shouldReviewAnswer;", sandbox);


test("update commands are routed deterministically without relying on model tool calls", () => {
  for (const phrase of ["En son sürümü yükle", "AURA'yı güncelle", "Güncelleme kontrolü yap", "Yeni sürümü indir"]) {
    assert.equal(updateSandbox.isUpdateRequestIntent(phrase), true, phrase);
  }
  for (const phrase of ["Merhaba", "Bilgisayarımın RAM durumunu göster"]) {
    assert.equal(updateSandbox.isUpdateRequestIntent(phrase), false, phrase);
  }
  assert.match(source, /desktopCall\("desktop_update_latest",\s*\{\}\)/);
});

test("ordinary factual questions do not receive unrelated saved memories", () => {
  const memories = [
    { text: "AURA projesinde Qwen modelini kullanıyoruz", tags: ["AURA", "AI"] },
    { text: "Kullanıcı futbol orta saha oynuyor", tags: ["futbol"] }
  ];
  assert.deepEqual(Array.from(sandbox.compactMemory(memories, "Fotosentez klorofil nedir?")), []);
});

test("memory retrieval ranks exact Turkish topic matches", () => {
  const memories = [
    { text: "Futbol hedefi: orta saha oyuncusu olmak", tags: ["spor"] },
    { text: "AURA yerel yapay zekâ kalitesini artırma projesi", tags: ["AURA", "AI"] },
    { text: "Restoran web sitesi demo tasarımı", tags: ["web"] }
  ];
  const result = Array.from(sandbox.compactMemory(memories, "AURA yapay zekâ projesine devam edelim"));
  assert.ok(result.length > 0);
  assert.match(result[0].text, /AURA/);
});

test("Turkish diacritics and suffixes match saved memories", () => {
  const memories = [{ text: "AURA yapay zekâ projesi geliştiriliyor", tags: ["AURA"] }];
  const result = Array.from(sandbox.compactMemory(memories, "AURA yapay zeka projesine devam"));
  assert.equal(result.length, 1);
  assert.match(result[0].text, /yapay zekâ/);
});

test("explicit continuity request falls back to recent memories when no term matches", () => {
  const memories = [{ text: "Eski kayıt" }, { text: "En yeni kayıt" }];
  const result = Array.from(sandbox.compactMemory(memories, "Nerede kalmıştık?"));
  assert.deepEqual(result.map(x => x.text), ["En yeni kayıt", "Eski kayıt"]);
});

test("memory payload is bounded", () => {
  const memories = Array.from({ length: 30 }, (_, i) => ({ text: "proje " + i + " ayrıntısı ".repeat(100), tags: ["proje"] }));
  const result = Array.from(sandbox.compactMemory(memories, "proje"));
  assert.ok(result.length <= 6);
  assert.ok(result.every(x => x.text.length <= 340 && x.tags.length <= 3));
});

test("short follow-up inherits the most recent user request", () => {
  const history = [
    { role: "user", content: "Restoran için mobil uyumlu web sitesi hazırla" },
    { role: "assistant", content: "Taslağı hazırlıyorum" }
  ];
  const result = sandbox.resolveFollowUpIntent("bunu da ekle", history);
  assert.equal(result.isShortFollowUp, true);
  assert.match(result.intentValue, /restoran için mobil uyumlu web sitesi/);
});

test("natural continuation variants are recognized", () => {
  const previous = [{ role: "user", content: "AURA AI kalitesini geliştir" }];
  for (const phrase of ["devam et", "daha da geliştir", "geliştirmeye devam et", "bunu da ekle", "daha fazla"]) {
    assert.equal(sandbox.resolveFollowUpIntent(phrase, previous).isShortFollowUp, true, phrase);
  }
});

test("standalone greetings do not inherit old task intent", () => {
  const result = sandbox.resolveFollowUpIntent("Merhaba", [
    { role: "user", content: "Unity oyunu geliştir" }
  ]);
  assert.equal(result.isShortFollowUp, false);
  assert.equal(result.intentValue, "merhaba");
});

test("conversation history filters roles, preserves order and caps message count", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: "mesaj-" + i
  }));
  history.push({ role: "system", content: "must be filtered" });
  const result = Array.from(sandbox.cleanMessages(history));
  assert.equal(result.length, 12);
  assert.equal(result[0].content, "mesaj-8");
  assert.equal(result.at(-1).content, "mesaj-19");
});

test("very long individual messages are bounded without losing their latest part", () => {
  const result = Array.from(sandbox.cleanMessages([
    { role: "user", content: "A".repeat(3000) }
  ]));
  assert.equal(result[0].content.length, 2400);
  assert.equal(result[0].content, "A".repeat(2400));
});


test("renderer starts model warmup promptly with a bounded idle wait", () => {
  assert.match(rendererSource, /requestIdleCallback\(startWarmup,\s*\{\s*timeout:\s*2500\s*\}\)/);
  assert.match(rendererSource, /setTimeout\(startWarmup,\s*700\)/);
  assert.match(rendererSource, /setTimeout\(\(\)=>warmLocalModel\(\),1200\)/);
});

test("AI core version matches the current desktop release", () => {
  assert.match(source, /const AURA_CORE_VERSION = ['"]6.4.3['"]/);
});

test("stream collector emits incremental text and returns a compatible final message", async () => {
  const chunks = [
    { choices: [{ delta: { content: "Mer" } }] },
    { choices: [{ delta: { content: "haba" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] }
  ];
  const emitted = [];
  const stream = (async function* () { for (const chunk of chunks) yield chunk; })();
  const sandbox = {};
  vm.runInNewContext(streamHelpers + "\nthis.collectChatCompletionStream = collectChatCompletionStream;", sandbox);
  const result = await sandbox.collectChatCompletionStream(stream, value => emitted.push(value));
  assert.deepEqual(emitted, ["Mer", "Merhaba"]);
  assert.equal(result.choices[0].message.content, "Merhaba");
  assert.equal(result.choices[0].message.role, "assistant");
});

test("stream collector reconstructs fragmented tool calls", async () => {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_", type: "function", function: { name: "desktop_", arguments: '{"path":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "abc", function: { name: "read_text_file", arguments: '"a.txt"}' } }] } }] }
  ];
  const stream = (async function* () { for (const chunk of chunks) yield chunk; })();
  const sandbox = {};
  vm.runInNewContext(streamHelpers + "\nthis.collectChatCompletionStream = collectChatCompletionStream;", sandbox);
  const result = await sandbox.collectChatCompletionStream(stream);
  const call = result.choices[0].message.tool_calls[0];
  assert.equal(call.id, "call_abc");
  assert.equal(call.function.name, "desktop_read_text_file");
  assert.equal(call.function.arguments, '{"path":"a.txt"}');
});

test("stream async-iterable provider error retries as a non-stream completion", async () => {
  const sandbox = { setTimeout, clearTimeout };
  vm.runInNewContext(streamHelpers + "\nthis.runChatCompletionWithTimeout = runChatCompletionWithTimeout;", sandbox);
  const calls = [];
  const engine = { chat: { completions: { create: async options => {
    calls.push(options.stream);
    if (options.stream) throw new Error("stream is not async iterable");
    return { choices: [{ message: { role: "assistant", content: "Güncelleme kontrol edildi." } }] };
  } } } };
  const emitted = [];
  const result = await sandbox.runChatCompletionWithTimeout(engine, { messages: [], stream: true }, 1000, "test", text => emitted.push(text));
  assert.deepEqual(calls, [true, false]);
  assert.equal(result.choices[0].message.content, "Güncelleme kontrol edildi.");
  assert.deepEqual(emitted, ["Güncelleme kontrol edildi."]);
});

test("non-iterable stream response retries without streaming", async () => {
  const sandbox = { setTimeout, clearTimeout };
  vm.runInNewContext(streamHelpers + "\nthis.runChatCompletionWithTimeout = runChatCompletionWithTimeout;", sandbox);
  const calls = [];
  const engine = { chat: { completions: { create: async options => {
    calls.push(options.stream);
    return options.stream ? { unexpected: true } : { choices: [{ message: { role: "assistant", content: "Tamam." } }] };
  } } } };
  const result = await sandbox.runChatCompletionWithTimeout(engine, { messages: [], stream: true }, 1000);
  assert.deepEqual(calls, [true, false]);
  assert.equal(result.choices[0].message.content, "Tamam.");
});
test("primary answer generation streams and renderer shows the live response", () => {
  assert.match(source, /stream:true/);
  assert.match(source, /stream:false/);
  assert.match(source, /Some bundled WebLLM builds reject stream:true internally/);
  assert.match(source, /collectChatCompletionStream/);
  assert.ok(rendererSource.includes('p?.stage === "generating"'));
  assert.ok(rendererSource.includes("finish(q, answer, true, streamingMessage)"));
});

test("stream placeholder is created only after direct command routing", () => {
  const runStart = rendererSource.indexOf("async function run(q)");
  const directReturn = rendererSource.indexOf("if (direct) {", runStart);
  const streamStart = rendererSource.indexOf("streamingMessage = addMessage", runStart);
  assert.ok(directReturn > runStart);
  assert.ok(streamStart > directReturn);
});


test("stream collector preserves independent tool-call indexes", async () => {
  const chunks = [
    { choices: [{ delta: { tool_calls: [
      { index: 0, id: "call_a", type: "function", function: { name: "first", arguments: "{}" } },
      { index: 1, id: "call_b", type: "function", function: { name: "second", arguments: '{"ok":true}' } }
    ] } }] }
  ];
  const stream = (async function* () { for (const chunk of chunks) yield chunk; })();
  const sandbox = {};
  vm.runInNewContext(streamHelpers + "\nthis.collectChatCompletionStream = collectChatCompletionStream;", sandbox);
  const result = await sandbox.collectChatCompletionStream(stream);
  const calls = result.choices[0].message.tool_calls;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].function.name, "first");
  assert.equal(calls[1].function.name, "second");
  assert.equal(calls[1].function.arguments, '{"ok":true}');
});

test("empty stream returns a valid empty assistant message", async () => {
  const stream = (async function* () {})();
  const sandbox = {};
  vm.runInNewContext(streamHelpers + "\nthis.collectChatCompletionStream = collectChatCompletionStream;", sandbox);
  const result = await sandbox.collectChatCompletionStream(stream);
  assert.equal(result.choices[0].message.content, "");
  assert.equal(result.choices[0].message.role, "assistant");
});

test("stream collector propagates iterator errors instead of returning partial success", async () => {
  const stream = (async function* () {
    yield { choices: [{ delta: { content: "yarım" } }] };
    throw new Error("stream transport failed");
  })();
  const sandbox = {};
  vm.runInNewContext(streamHelpers + "\nthis.collectChatCompletionStream = collectChatCompletionStream;", sandbox);
  await assert.rejects(() => sandbox.collectChatCompletionStream(stream), /stream transport failed/);
});

test("renderer throttles token paints while final answer remains complete", () => {
  assert.match(rendererSource, /lastStreamPaintAt === 0 \|\| now - lastStreamPaintAt >= 40/);
  assert.ok(rendererSource.includes("finish(q, answer, true, streamingMessage)"));
});


test("follow-up intent normalizes Turkish accents, punctuation and common variants", () => {
  const previous = [{ role: "user", content: "AURA sohbet hafızasını geliştir" }];
  for (const phrase of [
    "Bunu da ekle!",
    "Şunu düzelt.",
    "Aynı şekilde devam et",
    "Kaldığın yerden devam et",
    "Devamını getir",
    "Biraz daha geliştir",
    "Uzun sürsün"
  ]) {
    const result = sandbox.resolveFollowUpIntent(phrase, previous);
    assert.equal(result.isShortFollowUp, true, phrase);
    assert.ok(result.intentValue.startsWith("aura sohbet"));
  }
});

test("short follow-ups always request related project context", () => {
  assert.ok(source.includes("const needsRelatedContext = isShortFollowUp ||"));
});


test("adaptive token budget keeps short answers fast and detailed requests complete", () => {
  assert.ok(source.includes("max_tokens:resolveAnswerTokenBudget(value,effectiveMode)"));
  assert.equal(sandbox.resolveAnswerTokenBudget("Merhaba"), 320);
  assert.equal(sandbox.resolveAnswerTokenBudget("Fotosentez klorofil nedir?"), 320);
  assert.equal(sandbox.resolveAnswerTokenBudget("Bu konuyu adım adım ve detaylı açıkla"), 640);
  assert.equal(sandbox.resolveAnswerTokenBudget("A".repeat(501)), 640);
  assert.equal(sandbox.resolveAnswerTokenBudget("Kod yaz", "code"), 1000);
  assert.equal(sandbox.resolveAnswerTokenBudget("Oyun geliştir", "background-code"), 650);
});

test("factual answer review catches short empty and clearly unrelated drafts", () => {
  assert.equal(sandbox.shouldReviewAnswer("Fotosentez klorofil nedir?", "Fotosentez, klorofil sayesinde ışık enerjisini kullanarak besin üretme sürecidir."), false);
  assert.equal(sandbox.shouldReviewAnswer("Fotosentez klorofil nedir?", "Bu konu oldukça önemlidir ve günlük yaşamda sıkça karşımıza çıkar."), true);
  assert.equal(sandbox.shouldReviewAnswer("Fotosentez klorofil nedir?", "Kısa."), true);
});

test("answer review skips non-factual chat and preserves long factual review", () => {
  assert.equal(sandbox.shouldReviewAnswer("Merhaba, nasılsın?", "İyiyim, teşekkürler."), false);
  assert.equal(sandbox.shouldReviewAnswer("Fotosentez nedir? " + "Ayrıntı ".repeat(70), "Bitkiler ışık enerjisini kullanır."), true);
});

test("factual review recognizes common Turkish who-when-where-how-many questions", () => {
  for (const question of [
    "Türkiye'nin başkenti nerede bulunur?",
    "Cumhuriyet ne zaman ilan edildi?",
    "Bir insanın kaç kemiği vardır?",
    "Dünya'nın en büyük okyanusu hangisidir?",
    "Fotosentez ne işe yarar?"
  ]) {
    assert.equal(sandbox.shouldReviewAnswer(question, "Bu yanıt konuya yeterince değinmiyor ve soruyu doğrudan açıklamıyor."), true, question);
  }
});

test("generation timing records first token and total inference duration", () => {
  assert.match(source, /const generationStartedAt = Date\.now\(\)/);
  assert.match(source, /if \(partial && firstTokenAt === null\) firstTokenAt = Date\.now\(\)/);
  assert.match(source, /timeToFirstTokenMs:/);
  assert.match(source, /generationMs:/);
  assert.match(source, /onProgress\(timing\)/);
});

test("renderer displays first-token and total generation timings", () => {
  assert.ok(rendererSource.includes('p?.stage === "metrics"'));
  assert.ok(rendererSource.includes("generationMetrics.timeToFirstTokenMs"));
  assert.ok(rendererSource.includes("generationMetrics.generationMs"));
});


test("YouTube Shorts requests expose the real render tool and avoid the marketing-only video tool", () => {
  assert.match(source, /if\(youtube\) add\(\["youtube_studio_get_profile","youtube_studio_save_profile","youtube_studio_create_plan","youtube_studio_list_plans","youtube_studio_render_plan"\]\)/);
  assert.match(source, /if \(youtube\) \{[\s\S]*?toolHints\.push\("youtube_studio_get_profile", "youtube_studio_create_plan", "youtube_studio_render_plan", "youtube_studio_list_plans"\)/);
  assert.doesNotMatch(source, /const marketing=\/[^;]*(?:shorts|video)/);
});


test("explicit update command requests silent install and automatic restart", () => {
  const mainPath = path.join(__dirname, "..", "desktop", "main.cjs");
  const mainSource = fs.readFileSync(mainPath, "utf8");
  assert.match(mainSource, /case 'desktop_update_latest': return checkAuraLatestUpdate\(\{installWhenReady:true\}\)/);
  assert.match(mainSource, /autoUpdater\.quitAndInstall\(false, true\)/);
  assert.match(mainSource, /if \(auraUpdateInstallRequested\) installDownloadedAuraUpdate\(\)/);
  assert.doesNotMatch(mainSource, /buttons: \['Şimdi yeniden başlat', 'Daha sonra'\]/);
});


test("explicit Shorts requests always enter the render pipeline instead of replying with a caption only", () => {
  assert.match(source, /const videoCreationIntent = \/\(\?:shorts\|video\)/);
  assert.match(source, /saniye\(\?:lik\)\?/);
  assert.match(source, /await desktopCall\("youtube_studio_create_plan", plan\)/);
  assert.match(source, /await desktopCall\("youtube_studio_render_plan", \{ planId:planId \}\)/);
  assert.match(source, /outputs.length !== 2/);
  assert.match(source, /Video oluşturulmuş gibi gösterilmedi/);
});

