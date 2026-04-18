importScripts("/src/lib/actions.js");

const INJECTABLE_PROTOCOLS = Object.freeze(["http:", "https:", "file:"]);

// イミュータブルなステート管理（SW 再起動で揮発するキャッシュ）
let state = Object.freeze({
  theme: Themes.LIGHT,
  glassBlur: BlurConfig.DEFAULT,
});

// popup から指示された最後の tabId をキャッシュ（forwardToActiveTab の tabs.query 往復を削減）
let cachedTabId = null;

// タブ切替・閉鎖時はキャッシュを無効化
chrome.tabs.onActivated.addListener((info) => {
  cachedTabId = info.tabId;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (cachedTabId === tabId) cachedTabId = null;
});

// ---------- Message Handler ----------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 同一拡張以外（外部ページ・別拡張）からのメッセージは拒否
  if (sender.id !== chrome.runtime.id) return;

  if (request.action === Actions.SHOW_OVERLAY) {
    handleShowOverlay(request)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[ScreenGuard] handleShowOverlay failed:", err);
        sendResponse({ ok: false, error: err?.message ?? String(err) });
      });
    return true; // 非同期 sendResponse のため
  }

  if (request.action === Actions.UPDATE_BLUR) {
    // ステートも更新して SHOW_OVERLAY 次回呼び出し時の整合を取る
    state = Object.freeze({ ...state, glassBlur: clampBlur(request.data?.glassBlur) });
    forwardToActiveTab(request);
    return;
  }

  if (request.action === Actions.RESET_PREFS) {
    forwardToActiveTab(request);
    return;
  }
});

async function resolveTabId(request) {
  // popup 側で決定した tabId を優先（アクティブタブ曖昧性を回避）
  if (typeof request?.tabId === "number") return request.tabId;
  if (typeof cachedTabId === "number") return cachedTabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function handleShowOverlay(request) {
  state = Object.freeze({
    theme: sanitizeTheme(request.data?.theme),
    glassBlur: clampBlur(request.data?.glassBlur),
  });

  const tabId = await resolveTabId(request);
  if (typeof tabId !== "number") return;
  cachedTabId = tabId;

  // タブ URL のプロトコル検証（chrome://, edge://, about: 等の拡張注入不可領域を除外）
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;
  try {
    if (!INJECTABLE_PROTOCOLS.includes(new URL(tab.url).protocol)) return;
  } catch {
    return;
  }

  // 既にスクリプト注入済みか確認
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__screenShadeRunning === true,
  });

  // 未注入なら content script 群を注入（CSS は shadow root 内で適用するため insertCSS は不要）
  // actions.js → content-styles.js → content.js の順で window グローバルを揃える
  if (!result?.result) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "src/lib/actions.js",
        "src/content/content-styles.js",
        "src/content/content.js",
      ],
    });
  }

  // content script へオーバーレイ表示指示
  await chrome.tabs.sendMessage(tabId, {
    action: Actions.SHOW_OVERLAY_CS,
    data: { theme: state.theme, glassBlur: state.glassBlur },
  });
}

async function forwardToActiveTab(message) {
  const tabId = await resolveTabId(message);
  if (typeof tabId !== "number") return;
  // content script 未注入タブへの sendMessage は握りつぶし（意図的な silent fail）
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
