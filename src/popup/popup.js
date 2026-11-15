"use strict";

// <html lang> を同期で合わせる（Kagayoi フッターは module で遅延実行され、実行前にこの lang を読む）
Localizer.applyDocumentLang();

/** デバウンスヘルパー */
function debounce(fn, ms) {
  let id;
  const debounced = (...args) => {
    clearTimeout(id);
    id = setTimeout(() => {
      id = undefined;
      fn(...args);
    }, ms);
  };
  debounced.cancel = () => {
    clearTimeout(id);
    id = undefined;
  };
  return debounced;
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

document.addEventListener("DOMContentLoaded", async () => {
  // 保存済みの言語を読み込んでから静的文言を置換し、言語セレクトを組み立てる
  await Localizer.ready;
  await Localizer.ensureFresh();
  Localizer.localizeDocument();
  Localizer.mountLanguageSelect(document.getElementById("uiLanguage"));

  // 共通フッターは読み込み直後（辞書の読み込み前）にラベルを決めるため、ブラウザの UI 言語と
  // 選択言語が違うと選択言語にならない。辞書が揃ってから作り直して選択言語で描かせる。
  // （ストア画像の検査 kana-in-non-ja で検出。未定義の間は何もせず、定義時に新しい要素が描画される）
  const footer = document.querySelector("kagayoi-support-footer");
  if (footer) footer.replaceWith(footer.cloneNode(true));

  const $btn = document.getElementById("showOverlay");
  const $reset = document.getElementById("resetPrefs");
  const $themeBtns = document.querySelectorAll(".theme-btn");
  const $blurSetting = document.getElementById("blurSetting");
  const $blurRange = document.getElementById("blurRange");
  const $blurValue = document.getElementById("blurValue");
  const $error = document.getElementById("statusError");

  /** 失敗理由を popup 内に表示する（popup を閉じずに残すことで無反応に見えるのを防ぐ） */
  function showError(message) {
    $error.textContent = message;
    $error.hidden = false;
  }

  function clearError() {
    $error.textContent = "";
    $error.hidden = true;
  }

  // HTML 側の min/max/value を BlurConfig から動的に上書き（二重管理を一方通行化）
  $blurRange.min = String(BlurConfig.MIN);
  $blurRange.max = String(BlurConfig.MAX);
  $blurRange.value = String(BlurConfig.DEFAULT);
  $blurValue.textContent = `${BlurConfig.DEFAULT}px`;

  /** スライダーの fill 量を CSS カスタムプロパティに同期（visual fill bar 用） */
  function syncBlurFill(value) {
    const pct = ((value - BlurConfig.MIN) / (BlurConfig.MAX - BlurConfig.MIN)) * 100;
    $blurRange.style.setProperty("--blur-pct", String(pct));
  }
  syncBlurFill(BlurConfig.DEFAULT);

  let selectedTheme = Themes.LIGHT;
  let glassBlur = BlurConfig.DEFAULT;
  let resetInProgress = false;

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
    syncBlurFill(glassBlur);
  });

  // ---------- Theme Events ----------
  $themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => setTheme(sanitizeTheme(btn.dataset.theme)));
  });

  function setTheme(theme) {
    selectedTheme = theme;
    $themeBtns.forEach((btn) => {
      const selected = btn.dataset.theme === theme;
      btn.classList.toggle("selected", selected);
      btn.setAttribute("aria-pressed", String(selected));
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
    if (resetInProgress) return;
    glassBlur = clampBlur($blurRange.value);
    $blurRange.value = glassBlur;
    $blurValue.textContent = `${glassBlur}px`;
    syncBlurFill(glassBlur);
    saveBlurDebounced(glassBlur);
    const tabId = await getTargetTabId();
    if (resetInProgress) return;
    sendBlurDebounced(glassBlur, tabId);
  });

  // ---------- Show Overlay ----------
  $btn.addEventListener("click", async () => {
    clearError();
    const tabId = await getTargetTabId();
    // background の処理完了（sendResponse）を待ってから閉じる。
    // 待たずに window.close() すると、SW が休止していた場合に
    // 起動待ちの間にポップアップごとメッセージが破棄され、初回クリックが
    // 無反応になる（2回目は SW が起きているため成功する）。
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        action: Actions.SHOW_OVERLAY,
        tabId,
        data: { theme: selectedTheme, glassBlur: clampBlur(glassBlur) },
      });
    } catch (err) {
      console.error("[ScreenGuard] sendMessage failed:", err);
    }
    // 注入不可ページや注入失敗は例外ではなく ok:false で返る。
    // ここで閉じると失敗が一切伝わらないので、閉じずに理由を出す。
    if (!res?.ok) {
      showError(res?.error ?? Localizer.t("popupErrorShowOverlay", undefined, "Could not show the overlay."));
      return;
    }
    window.close();
  });

  // ---------- Reset Prefs ----------
  $reset.addEventListener("click", async () => {
    resetInProgress = true;
    saveBlurDebounced.cancel();
    sendBlurDebounced.cancel();

    // storage の削除は popup 側のみ（content.js は画面のリセットのみを担当）
    try {
      await chrome.storage.local.remove([StorageKeys.PREFS, StorageKeys.GLASS_BLUR]);
    } catch (err) {
      console.error("[ScreenGuard] storage.remove failed:", err);
      resetInProgress = false;
      showError(Localizer.t("popupErrorReset", undefined, "Could not reset the settings. Please try again."));
      return;
    }
    const tabId = await getTargetTabId();
    chrome.runtime.sendMessage({ action: Actions.RESET_PREFS, tabId }).catch(() => {});
    $reset.textContent = Localizer.t("popupResetDone", undefined, "Done!");
    $reset.disabled = true;
    setTimeout(() => window.close(), 600);
  });
});
