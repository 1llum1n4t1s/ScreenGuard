importScripts("/scripts/actions.js");

let state = {
  theme: Themes.LIGHT,
  glassBlur: BlurConfig.DEFAULT,
};

// ---------- Message Handler ----------
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === Actions.SHOW_OVERLAY) {
    handleShowOverlay(request).then(() => sendResponse({ ok: true }));
    return true; // 非同期 sendResponse のため
  } else if (request.action === Actions.RESET_PREFS || request.action === Actions.UPDATE_BLUR) {
    // リセット / blur 更新を content script に中継
    forwardToActiveTab(request);
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function handleShowOverlay(request) {
  state.theme = request.data?.theme ?? Themes.LIGHT;
  state.glassBlur = request.data?.glassBlur ?? BlurConfig.DEFAULT;

  const tab = await getActiveTab();
  if (!tab?.id) return;

  // chrome://, edge://, about: などの特殊ページにはスクリプトを注入できない
  const url = tab.url ?? "";
  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file://")) {
    return;
  }

  const tabId = tab.id;

  // 既にスクリプト注入済みか確認
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__screenShadeRunning === true,
  });

  // 未注入なら content script + CSS を並列注入
  if (!result?.result) {
    await Promise.all([
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["scripts/actions.js", "scripts/content.js"],
      }),
      chrome.scripting.insertCSS({
        target: { tabId },
        files: ["css/content.css"],
      }),
    ]);
  }

  // content script へオーバーレイ表示指示
  chrome.tabs.sendMessage(tabId, {
    action: Actions.SHOW_OVERLAY_CS,
    data: { theme: state.theme, glassBlur: state.glassBlur },
  });
}

async function forwardToActiveTab(message) {
  const tab = await getActiveTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}
