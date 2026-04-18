"use strict";

/** デバウンスヘルパー */
function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

/** popup から見たアクティブタブの tabId を取得（activeTab 権限で動作） */
async function getTargetTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch (err) {
    console.error("[ScreenGuard] tabs.query failed:", err);
    return null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const $btn = document.getElementById("showOverlay");
  const $reset = document.getElementById("resetPrefs");
  const $themeBtns = document.querySelectorAll(".theme-btn");
  const $blurSetting = document.getElementById("blurSetting");
  const $blurRange = document.getElementById("blurRange");
  const $blurValue = document.getElementById("blurValue");

  // HTML 側の min/max/value を BlurConfig から動的に上書き（二重管理を一方通行化）
  $blurRange.min = String(BlurConfig.MIN);
  $blurRange.max = String(BlurConfig.MAX);
  $blurRange.value = String(BlurConfig.DEFAULT);
  $blurValue.textContent = `${BlurConfig.DEFAULT}px`;

  let selectedTheme = Themes.LIGHT;
  let glassBlur = BlurConfig.DEFAULT;

  // ---------- Restore Settings ----------
  chrome.storage.local.get([StorageKeys.PREFS, StorageKeys.GLASS_BLUR], (result) => {
    if (chrome.runtime.lastError) {
      console.error("[ScreenGuard] storage.get failed:", chrome.runtime.lastError);
      return;
    }
    if (result[StorageKeys.PREFS]?.theme) {
      setTheme(sanitizeTheme(result[StorageKeys.PREFS].theme));
    }
    if (result[StorageKeys.GLASS_BLUR] != null) {
      glassBlur = clampBlur(result[StorageKeys.GLASS_BLUR]);
    }
    $blurRange.value = glassBlur;
    $blurValue.textContent = `${glassBlur}px`;
  });

  // ---------- Theme Events ----------
  $themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => setTheme(sanitizeTheme(btn.dataset.theme)));
  });

  function setTheme(theme) {
    selectedTheme = theme;
    $themeBtns.forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.theme === theme);
    });
    // Glass テーマ選択時のみぼかし設定を表示
    $blurSetting.classList.toggle("visible", theme === Themes.GLASS);
  }

  // ---------- Blur Slider ----------
  // storage への保存はデバウンス（300ms）
  const saveBlurDebounced = debounce((blur) => {
    chrome.storage.local.set({ [StorageKeys.GLASS_BLUR]: blur }).catch((err) => {
      console.error("[ScreenGuard] storage.set failed:", err);
    });
  }, 300);

  // UPDATE_BLUR の送信も軽くデバウンス（60fps の input イベント爆発を防ぐ）
  const sendBlurDebounced = debounce((blur, tabId) => {
    chrome.runtime.sendMessage({
      action: Actions.UPDATE_BLUR,
      tabId,
      data: { glassBlur: blur },
    }).catch(() => {});
  }, 80);

  $blurRange.addEventListener("input", async () => {
    glassBlur = clampBlur($blurRange.value);
    $blurRange.value = glassBlur;
    $blurValue.textContent = `${glassBlur}px`;
    saveBlurDebounced(glassBlur);
    const tabId = await getTargetTabId();
    sendBlurDebounced(glassBlur, tabId);
  });

  // ---------- Show Overlay ----------
  $btn.addEventListener("click", async () => {
    const tabId = await getTargetTabId();
    chrome.runtime.sendMessage({
      action: Actions.SHOW_OVERLAY,
      tabId,
      data: { theme: selectedTheme, glassBlur: clampBlur(glassBlur) },
    }).catch(() => {});
    window.close();
  });

  // ---------- Reset Prefs ----------
  $reset.addEventListener("click", async () => {
    // storage の削除は popup 側のみ（content.js は画面のリセットのみを担当）
    try {
      await chrome.storage.local.remove([StorageKeys.PREFS, StorageKeys.GLASS_BLUR]);
    } catch (err) {
      console.error("[ScreenGuard] storage.remove failed:", err);
    }
    const tabId = await getTargetTabId();
    chrome.runtime.sendMessage({ action: Actions.RESET_PREFS, tabId }).catch(() => {});
    $reset.textContent = "完了!";
    $reset.disabled = true;
    setTimeout(() => window.close(), 600);
  });
});
