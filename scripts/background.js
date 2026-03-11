importScripts("/scripts/actions.js");

let state = {
  theme: "light",
};

// ---------- Message Handler ----------
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === Actions.SHOW_OVERLAY) {
    handleShowOverlay(request).then(() => sendResponse({ ok: true }));
    return true; // 非同期 sendResponse のため
  }

  // リセットを content script に中継
  if (request.action === Actions.RESET_PREFS) {
    forwardToActiveTab(request);
    return false;
  }
});

async function handleShowOverlay(request) {
  state.theme = request.data?.theme ?? "light";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

  // 未注入なら content script + CSS を注入
  if (!result?.result) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["scripts/actions.js", "scripts/content.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["css/content.css"],
    });
  }

  // content script へオーバーレイ表示指示
  chrome.tabs.sendMessage(tabId, {
    action: Actions.SHOW_OVERLAY_CS,
    data: { theme: state.theme },
  });
}

async function forwardToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}
