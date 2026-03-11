"use strict";

const DEFAULT_BLUR = 5;
const MIN_BLUR = 1;
const MAX_BLUR = 20;

/** 値を有効範囲に収める */
function clampBlur(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_BLUR;
  return Math.max(MIN_BLUR, Math.min(MAX_BLUR, Math.round(n)));
}

document.addEventListener("DOMContentLoaded", () => {
  const $btn = document.getElementById("showOverlay");
  const $reset = document.getElementById("resetPrefs");
  const $themeBtns = document.querySelectorAll(".theme-btn");
  const $blurSetting = document.getElementById("blurSetting");
  const $blurRange = document.getElementById("blurRange");
  const $blurValue = document.getElementById("blurValue");

  let selectedTheme = "light";
  let glassBlur = DEFAULT_BLUR;

  // ---------- Restore Settings ----------
  chrome.storage.local.get(["shadePrefs", "glassBlur"], (result) => {
    if (result.shadePrefs?.theme) {
      setTheme(result.shadePrefs.theme);
    }
    if (result.glassBlur != null) {
      glassBlur = clampBlur(result.glassBlur);
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
    $blurSetting.classList.toggle("visible", theme === "glass");
  }

  // ---------- Blur Slider ----------
  $blurRange.addEventListener("input", () => {
    glassBlur = clampBlur($blurRange.value);
    $blurRange.value = glassBlur;
    $blurValue.textContent = `${glassBlur}px`;
    chrome.storage.local.set({ glassBlur });
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
    chrome.storage.local.remove(["shadePrefs", "glassBlur"]);
    chrome.runtime.sendMessage({ action: Actions.RESET_PREFS });
    $reset.textContent = "完了!";
    $reset.disabled = true;
    setTimeout(() => window.close(), 600);
  });
});
