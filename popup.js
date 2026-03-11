"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const $btn = document.getElementById("showOverlay");
  const $reset = document.getElementById("resetPrefs");
  const $themeBtns = document.querySelectorAll(".theme-btn");

  let selectedTheme = "light";

  // ---------- Restore Theme ----------
  // storage から前回のテーマを復元
  chrome.storage.local.get("shadePrefs", (result) => {
    if (result.shadePrefs?.theme) {
      setTheme(result.shadePrefs.theme);
    }
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
  }

  // ---------- Show Overlay ----------
  $btn.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      action: Actions.SHOW_OVERLAY,
      data: { theme: selectedTheme },
    });
    window.close();
  });

  // ---------- Reset Prefs ----------
  $reset.addEventListener("click", () => {
    chrome.storage.local.remove("shadePrefs");
    // 既に注入済みの content script にもリセットを通知
    chrome.runtime.sendMessage({ action: Actions.RESET_PREFS });
    $reset.textContent = "完了!";
    $reset.disabled = true;
    setTimeout(() => window.close(), 600);
  });
});
