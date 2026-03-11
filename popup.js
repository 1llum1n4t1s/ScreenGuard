"use strict";

/** デバウンスヘルパー */
function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

document.addEventListener("DOMContentLoaded", () => {
  const $btn = document.getElementById("showOverlay");
  const $reset = document.getElementById("resetPrefs");
  const $themeBtns = document.querySelectorAll(".theme-btn");
  const $blurSetting = document.getElementById("blurSetting");
  const $blurRange = document.getElementById("blurRange");
  const $blurValue = document.getElementById("blurValue");

  let selectedTheme = Themes.LIGHT;
  let glassBlur = BlurConfig.DEFAULT;

  // ---------- Restore Settings ----------
  chrome.storage.local.get([StorageKeys.PREFS, StorageKeys.GLASS_BLUR], (result) => {
    if (result[StorageKeys.PREFS]?.theme) {
      setTheme(result[StorageKeys.PREFS].theme);
    }
    if (result[StorageKeys.GLASS_BLUR] != null) {
      glassBlur = clampBlur(result[StorageKeys.GLASS_BLUR]);
    }
    $blurRange.value = glassBlur;
    $blurValue.textContent = `${glassBlur}px`;
  });

  // ---------- Theme Events ----------
  $themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.dataset.theme));
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
  // storage への保存はデバウンスで間引く
  const saveBlurDebounced = debounce((blur) => {
    chrome.storage.local.set({ [StorageKeys.GLASS_BLUR]: blur });
  }, 300);

  $blurRange.addEventListener("input", () => {
    glassBlur = clampBlur($blurRange.value);
    $blurRange.value = glassBlur;
    $blurValue.textContent = `${glassBlur}px`;
    saveBlurDebounced(glassBlur);
    // 表示中のオーバーレイにリアルタイム反映
    chrome.runtime.sendMessage({
      action: Actions.UPDATE_BLUR,
      data: { glassBlur },
    });
  });

  // ---------- Show Overlay ----------
  $btn.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      action: Actions.SHOW_OVERLAY,
      data: { theme: selectedTheme, glassBlur: clampBlur(glassBlur) },
    });
    window.close();
  });

  // ---------- Reset Prefs ----------
  $reset.addEventListener("click", () => {
    chrome.storage.local.remove([StorageKeys.PREFS, StorageKeys.GLASS_BLUR]);
    chrome.runtime.sendMessage({ action: Actions.RESET_PREFS });
    $reset.textContent = "完了!";
    $reset.disabled = true;
    setTimeout(() => window.close(), 600);
  });
});
