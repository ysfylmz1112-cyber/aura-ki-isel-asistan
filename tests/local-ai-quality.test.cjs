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

const streamHelpers = extract("async function collectChatCompletionStream(", "\n// WebLLM inference can take longer");

const helpers = [
  extract("function compactMemory(", "\nfunction toolDirectoryPrompt"),
  extract("function resolveAnswerTokenBudget(", "\nfunction cleanMessages"),
  extract("function cleanMessages(", "\nfunction compactEnvironment"),
  extract("function resolveFollowUpIntent(", "\nexport async function askLocalAI")
].join("\n");

const sandbox = {};
vm.runInNewContext(helpers + "\nthis.compactMemory = compactMemory; this.cleanMessages = cleanMessages; this.resolveFollowUpIntent = resolveFollowUpIntent; this.resolveAnswerTokenBudget = resolveAnswerTokenBudget;", sandbox);

test("ordinary factual questions do not receive unrelated saved memories", () => {
  const memories = [
    { text: "AURA projesinde Qwen modelini kullanıyoruz", tags: ["AURA", "AI"] },
    { text: "Kullanıcı futbol orta saha oynuyor", tags: ["futbol"] }
  ];
  assert.deepEqual(Array.from(sandbox.compactMemory(memories, "Fotosentez nedir?")), []);
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
  assert.match(source, /const AURA_CORE_VERSION = ['"]6\.3\.1['"]/);
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
test("primary answer generation streams and renderer shows the live response", () => {
  assert.match(source, /stream:true/);
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
  assert.equal(sandbox.resolveAnswerTokenBudget("Fotosentez nedir?"), 320);
  assert.equal(sandbox.resolveAnswerTokenBudget("Bu konuyu adım adım ve detaylı açıkla"), 640);
  assert.equal(sandbox.resolveAnswerTokenBudget("A".repeat(501)), 640);
  assert.equal(sandbox.resolveAnswerTokenBudget("Kod yaz", "code"), 1000);
  assert.equal(sandbox.resolveAnswerTokenBudget("Oyun geliştir", "background-code"), 650);
});
