"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const $btn = document.getElementById("showOverlay");
  const $enabled = document.getElementById("hideAfterEnabled");
  const $min = document.getElementById("hideAfterMin");
  const $sec = document.getElementById("hideAfterSec");

  // ---------- Restore State ----------
  chrome.runtime.sendMessage({ action: Actions.GET_POPUP_STATE }, (state) => {
    if (chrome.runtime.lastError || !state) return;

    $enabled.checked = state.isTimeoutEnabled;
    toggleTimerInputs(state.isTimeoutEnabled);

    if (state.timeout) {
      const totalSec = state.timeout / 1000;
      $min.value = Math.floor(totalSec / 60) || "";
      $sec.value = (totalSec % 60) || "";
    }
  });

  // ---------- Events ----------
  $enabled.addEventListener("change", () => {
    toggleTimerInputs($enabled.checked);
  });

  $btn.addEventListener("click", () => {
    const isTimeoutEnabled = $enabled.checked;
    let timeout = null;

    if (isTimeoutEnabled) {
      const mins = Math.max(0, parseInt($min.value, 10) || 0);
      const secs = Math.max(0, Math.min(59, parseInt($sec.value, 10) || 0));
      timeout = mins * 60_000 + secs * 1000;

      if (timeout <= 0) {
        $min.focus();
        return;
      }
    }

    chrome.runtime.sendMessage({
      action: Actions.SHOW_OVERLAY,
      data: { isTimeoutEnabled, timeout },
    });

    window.close();
  });

  // ---------- Helpers ----------
  function toggleTimerInputs(enabled) {
    $min.disabled = !enabled;
    $sec.disabled = !enabled;
  }
});
