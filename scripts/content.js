"use strict";

(function () {
  if (window.__screenShadeRunning === true) return true;
  window.__screenShadeRunning = true;

  const DEFAULT_MARGIN = 15;
  const MIN_SIZE = 40;

  // ---------- State ----------
  let overlayEl = null;
  let currentTheme = Themes.LIGHT;
  let currentBlur = BlurConfig.DEFAULT;

  // ---------- Message Listener ----------
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === Actions.SHOW_OVERLAY_CS) {
      onShowCommand(request.data.theme, request.data.glassBlur);
    } else if (request.action === Actions.UPDATE_BLUR) {
      currentBlur = clampBlur(request.data?.glassBlur);
      applyBlur();
    } else if (request.action === Actions.RESET_PREFS) {
      chrome.storage.local.remove(StorageKeys.PREFS);
    }
  });

  // ---------- Show / Close ----------
  function onShowCommand(theme, glassBlur) {
    // ポップアップで選択されたテーマを常に優先
    currentTheme = theme ?? Themes.LIGHT;
    currentBlur = clampBlur(glassBlur);

    if (!overlayEl) {
      createOverlay();
    } else {
      // テーマ・ぼかし変更
      overlayEl.dataset.theme = currentTheme;
      applyBlur();
      savePrefs();
    }
  }

  /** Glass テーマの blur をインラインスタイルで適用 */
  function applyBlur() {
    if (!overlayEl) return;
    if (currentTheme === Themes.GLASS) {
      const val = `blur(${currentBlur}px) saturate(180%)`;
      overlayEl.style.setProperty("-webkit-backdrop-filter", val, "important");
      overlayEl.style.setProperty("backdrop-filter", val, "important");
    } else {
      overlayEl.style.removeProperty("-webkit-backdrop-filter");
      overlayEl.style.removeProperty("backdrop-filter");
    }
  }

  function closeOverlay() {
    cleanupResize();
    cleanupDrag();
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  // ---------- Persistence ----------
  function savePrefs() {
    if (!overlayEl) return;
    chrome.storage.local.set({
      [StorageKeys.PREFS]: {
        theme: currentTheme,
        top: parseFloat(overlayEl.style.top),
        left: parseFloat(overlayEl.style.left),
        width: parseFloat(overlayEl.style.width),
        height: parseFloat(overlayEl.style.height),
      },
    });
  }

  function loadPrefsAndApply() {
    chrome.storage.local.get(StorageKeys.PREFS, (result) => {
      const prefs = result[StorageKeys.PREFS];
      if (!prefs || !overlayEl) return;

      // テーマはポップアップで選択されたものを優先するため復元しない
      // 位置・サイズのみ復元
      if (
        typeof prefs.top === "number" &&
        typeof prefs.left === "number" &&
        typeof prefs.width === "number" &&
        typeof prefs.height === "number"
      ) {
        overlayEl.style.top = `${prefs.top}px`;
        overlayEl.style.left = `${prefs.left}px`;
        overlayEl.style.width = `${prefs.width}px`;
        overlayEl.style.height = `${prefs.height}px`;
      }

      // 位置・サイズ復元後にテーマを含めて保存
      savePrefs();
    });
  }

  // ---------- Create Overlay ----------
  function createOverlay() {
    overlayEl = document.createElement("div");
    overlayEl.id = "screenShadeOverlay";
    overlayEl.dataset.theme = currentTheme;

    // 明示的に top/left/width/height で位置指定（bottom/right は使わない）
    overlayEl.style.cssText = `
      top: ${DEFAULT_MARGIN}px !important;
      left: ${DEFAULT_MARGIN}px !important;
      width: ${window.innerWidth - DEFAULT_MARGIN * 2}px !important;
      height: ${window.innerHeight - DEFAULT_MARGIN * 2}px !important;
    `;

    // 閉じるボタン
    const closeBtn = document.createElement("i");
    closeBtn.id = "shader-close";
    closeBtn.addEventListener("click", closeOverlay);
    overlayEl.appendChild(closeBtn);

    // リサイズハンドル（8方向）
    const directions = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
    for (const dir of directions) {
      const handle = document.createElement("div");
      handle.classList.add("shader-handle", `shader-handle-${dir}`);
      handle.dataset.direction = dir;
      handle.addEventListener("pointerdown", onResizeStart);
      overlayEl.appendChild(handle);
    }

    // ドラッグ移動（overlay本体で開始、ハンドル/ボタンは除外）
    overlayEl.addEventListener("pointerdown", onDragStart);

    document.body.appendChild(overlayEl);

    // Glass テーマの blur を適用
    applyBlur();

    // 保存された位置・サイズを読み込む（コールバック内で savePrefs を呼ぶ）
    loadPrefsAndApply();
  }

  // ---------- Drag Logic (Pointer Events) ----------
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOrigTop = 0;
  let dragOrigLeft = 0;

  function onDragStart(e) {
    // ハンドルや閉じるボタン上ではドラッグしない
    if (
      e.target.classList.contains("shader-handle") ||
      e.target.id === "shader-close"
    ) {
      return;
    }

    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOrigTop = parseFloat(overlayEl.style.top);
    dragOrigLeft = parseFloat(overlayEl.style.left);
    overlayEl.setPointerCapture(e.pointerId);
    overlayEl.style.setProperty("cursor", "grabbing", "important");

    overlayEl.addEventListener("pointermove", onDragMove);
    overlayEl.addEventListener("pointerup", onDragEnd);
    overlayEl.addEventListener("pointercancel", onDragEnd);
  }

  function onDragMove(e) {
    if (!isDragging || !overlayEl) return;

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    overlayEl.style.top = `${dragOrigTop + dy}px`;
    overlayEl.style.left = `${dragOrigLeft + dx}px`;
  }

  function onDragEnd(e) {
    isDragging = false;
    if (overlayEl) {
      overlayEl.releasePointerCapture(e.pointerId);
      overlayEl.style.setProperty("cursor", "grab", "important");
    }
    cleanupDrag();
    savePrefs();
  }

  function cleanupDrag() {
    if (overlayEl) {
      overlayEl.removeEventListener("pointermove", onDragMove);
      overlayEl.removeEventListener("pointerup", onDragEnd);
      overlayEl.removeEventListener("pointercancel", onDragEnd);
    }
  }

  // ---------- Resize Logic (Pointer Events) ----------
  let resizeDir = "";
  let startX = 0;
  let startY = 0;
  let startTop = 0;
  let startLeft = 0;
  let startWidth = 0;
  let startHeight = 0;

  function onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();

    resizeDir = e.currentTarget.dataset.direction;
    startX = e.clientX;
    startY = e.clientY;
    startTop = parseFloat(overlayEl.style.top);
    startLeft = parseFloat(overlayEl.style.left);
    startWidth = parseFloat(overlayEl.style.width);
    startHeight = parseFloat(overlayEl.style.height);

    document.addEventListener("pointermove", onResizeMove);
    document.addEventListener("pointerup", onResizeEnd);
    document.addEventListener("pointercancel", onResizeEnd);
  }

  function onResizeMove(e) {
    if (!overlayEl) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let top = startTop;
    let left = startLeft;
    let width = startWidth;
    let height = startHeight;

    // 北（上辺）: top を動かし height を逆方向に変える
    if (resizeDir.includes("n")) {
      const newHeight = startHeight - dy;
      if (newHeight >= MIN_SIZE) {
        top = startTop + dy;
        height = newHeight;
      }
    }
    // 南（下辺）
    if (resizeDir.includes("s")) {
      height = Math.max(MIN_SIZE, startHeight + dy);
    }
    // 西（左辺）
    if (resizeDir.includes("w")) {
      const newWidth = startWidth - dx;
      if (newWidth >= MIN_SIZE) {
        left = startLeft + dx;
        width = newWidth;
      }
    }
    // 東（右辺）
    if (resizeDir.includes("e")) {
      width = Math.max(MIN_SIZE, startWidth + dx);
    }

    overlayEl.style.top = `${top}px`;
    overlayEl.style.left = `${left}px`;
    overlayEl.style.width = `${width}px`;
    overlayEl.style.height = `${height}px`;
  }

  function onResizeEnd() {
    cleanupResize();
    savePrefs();
  }

  function cleanupResize() {
    document.removeEventListener("pointermove", onResizeMove);
    document.removeEventListener("pointerup", onResizeEnd);
    document.removeEventListener("pointercancel", onResizeEnd);
  }
})();
