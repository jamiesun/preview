import "./styles.css";
import * as api from "./api";

// Follow the appearance preference persisted by the main window.
try {
  const ap = JSON.parse(localStorage.getItem("preview-appearance") ?? "{}");
  const theme =
    ap.theme === "light" || ap.theme === "dark"
      ? ap.theme
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
} catch {
  /* system default */
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const apiBase = $("#api-base") as unknown as HTMLInputElement;
const apiKey = $("#api-key") as unknown as HTMLInputElement;
const model = $("#model") as unknown as HTMLInputElement;
const targetLang = $("#target-lang") as unknown as HTMLInputElement;
const concurrency = $("#concurrency") as unknown as HTMLInputElement;
const temperature = $("#temperature") as unknown as HTMLInputElement;
const systemPrompt = $("#system-prompt") as unknown as HTMLTextAreaElement;
const testResult = $("#test-result");
const cacheStatsEl = $("#cache-stats");

function collect(): api.Settings {
  return {
    apiBase: apiBase.value.trim() || "https://api.openai.com/v1",
    apiKey: apiKey.value.trim(),
    model: model.value.trim() || "gpt-4o-mini",
    targetLang: targetLang.value.trim() || "简体中文",
    concurrency: Math.min(8, Math.max(1, Number(concurrency.value) || 3)),
    temperature: Math.min(2, Math.max(0, Number(temperature.value) || 0.2)),
    systemPrompt: systemPrompt.value.trim(),
  };
}

async function refreshCacheStats() {
  try {
    const s = await api.cacheStats();
    const kb = (s.bytes / 1024).toFixed(1);
    cacheStatsEl.textContent = `${s.entries} 条缓存 · ${kb} KB`;
  } catch (e) {
    cacheStatsEl.textContent = String(e);
  }
}

(async () => {
  const s = await api.getSettings();
  apiBase.value = s.apiBase;
  apiKey.value = s.apiKey;
  model.value = s.model;
  targetLang.value = s.targetLang;
  concurrency.value = String(s.concurrency);
  temperature.value = String(s.temperature);
  systemPrompt.value = s.systemPrompt;
  refreshCacheStats();
})();

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api.saveSettings(collect());
    testResult.className = "test-result ok";
    testResult.textContent = "已保存 ✓";
    setTimeout(() => (testResult.textContent = ""), 2000);
  } catch (err) {
    testResult.className = "test-result err";
    testResult.textContent = String(err);
  }
});

$("#btn-test").addEventListener("click", async () => {
  testResult.className = "test-result";
  testResult.textContent = "测试中…";
  try {
    const reply = await api.testLlm(collect());
    testResult.className = "test-result ok";
    testResult.textContent = `连接成功：${reply.slice(0, 40)}`;
  } catch (err) {
    testResult.className = "test-result err";
    testResult.textContent = String(err);
  }
});

$("#btn-clear-cache").addEventListener("click", async () => {
  await api.clearCache();
  refreshCacheStats();
});
