"use strict";

(function () {
  if (window.__screenShadeRunning === true) return true;
  window.__screenShadeRunning = true;

  const STORAGE_KEY = "shadePrefs";
  const DEFAULT_BLUR = 5;

  // ---------- State ----------
  let overlayEl = null;
  let currentTheme = "light";
  let currentBlur = DEFAULT_BLUR;

  // ---------- Message Listener ----------
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === Actions.SHOW_OVERLAY_CS) {
      onShowCommand(request.data.theme, request.data.glassBlur);
    }
    if (request.action === Actions.UPDATE_BLUR) {
      currentBlur = clampBlur(request.data?.glassBlur);
      applyBlur();
    }
    if (request.action === Actions.RESET_PREFS) {
      chrome.storage.local.remove(STORAGE_KEY);
    }
  });

  // ---------- Show / Close ----------
  function onShowCommand(theme, glassBlur) {
    // ポップアップで選択されたテーマを常に優先
    currentTheme = theme ?? "light";
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

  /** blur 値を有効範囲に収める */
  function clampBlur(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_BLUR;
    return Math.max(1, Math.min(20, Math.round(n)));
  }

  /** Glass テーマの blur をインラインスタイルで適用 */
  function applyBlur() {
    if (!overlayEl) return;
    if (currentTheme === "glass") {
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
      [STORAGE_KEY]: {
        theme: currentTheme,
        top: parseFloat(overlayEl.style.top),
        left: parseFloat(overlayEl.style.left),
        width: parseFloat(overlayEl.style.width),
        height: parseFloat(overlayEl.style.height),
      },
    });
  }

  function loadPrefsAndApply() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const prefs = result[STORAGE_KEY];
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
    });
  }

  // ---------- Create Overlay ----------
  function createOverlay() {
    overlayEl = document.createElement("div");
    overlayEl.id = "screenShadeOverlay";
    overlayEl.dataset.theme = currentTheme;

    // 明示的に top/left/width/height で位置指定（bottom/right は使わない）
    const margin = 15;
    overlayEl.style.cssText = `
      top: ${margin}px !important;
      left: ${margin}px !important;
      width: ${window.innerWidth - margin * 2}px !important;
      height: ${window.innerHeight - margin * 2}px !important;
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

    // 保存された位置・サイズを読み込む（テーマは復元しない）
    loadPrefsAndApply();

    // テーマを含めて保存
    savePrefs();
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
    overlayEl.style.cursor = "grabbing !important";

    overlayEl.addEventListener("pointermove", onDragMove);
    overlayEl.addEventListener("pointerup", onDragEnd);
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
      overlayEl.style.cursor = "";
    }
    cleanupDrag();
    savePrefs();
  }

  function cleanupDrag() {
    if (overlayEl) {
      overlayEl.removeEventListener("pointermove", onDragMove);
      overlayEl.removeEventListener("pointerup", onDragEnd);
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
  }

  function onResizeMove(e) {
    if (!overlayEl) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let top = startTop;
    let left = startLeft;
    let width = startWidth;
    let height = startHeight;

    const MIN_SIZE = 40;

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
  }
})();
