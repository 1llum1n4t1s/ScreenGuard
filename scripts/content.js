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
      // popup.js と同じく PREFS と GLASS_BLUR の両方を削除
      chrome.storage.local.remove([StorageKeys.PREFS, StorageKeys.GLASS_BLUR]);
      resetOverlayPosition();
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

  /** オーバーレイの位置・サイズを一括設定 */
  function applyPosition({ top, left, width, height }) {
    if (!overlayEl) return;
    overlayEl.style.top = `${top}px`;
    overlayEl.style.left = `${left}px`;
    overlayEl.style.width = `${width}px`;
    overlayEl.style.height = `${height}px`;
  }

  /** 表示領域の中央に配置する座標を計算 */
  function centerPosition(w, h) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = Math.min(w, vw - DEFAULT_MARGIN * 2);
    const ch = Math.min(h, vh - DEFAULT_MARGIN * 2);
    return {
      top: Math.round((vh - ch) / 2),
      left: Math.round((vw - cw) / 2),
      width: cw,
      height: ch,
    };
  }

  /** リセット: 表示領域の中央に 300×300 で再配置 */
  function resetOverlayPosition() {
    applyPosition(centerPosition(300, 300));
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

  /** オーバーレイが表示領域内に十分見えているか判定し、範囲外なら中央に移動 */
  const VISIBLE_THRESHOLD = 100; // 閉じるボタン・リサイズハンドルが操作可能な最低限の表示量
  function ensureVisible(top, left, width, height) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visibleX = Math.min(left + width, vw) - Math.max(left, 0);
    const visibleY = Math.min(top + height, vh) - Math.max(top, 0);
    const isVisible =
      visibleX >= Math.min(VISIBLE_THRESHOLD, width) &&
      visibleY >= Math.min(VISIBLE_THRESHOLD, height);

    return isVisible ? { top, left, width, height } : centerPosition(width, height);
  }

  function loadPrefsAndApply() {
    chrome.storage.local.get(StorageKeys.PREFS, (result) => {
      const prefs = result[StorageKeys.PREFS];
      if (!prefs || !overlayEl) return;

      // テーマはポップアップで選択されたものを優先するため復元しない
      const { top, left, width, height } = prefs;
      if ([top, left, width, height].every((v) => typeof v === "number")) {
        applyPosition(ensureVisible(top, left, width, height));
      }

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

    // 閉じるボタン（セマンティクス・アクセシビリティ対応）
    const closeBtn = document.createElement("button");
    closeBtn.id = "shader-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "オーバーレイを閉じる");
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
  let dragWidth = 0;
  let dragHeight = 0;

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
    // ドラッグ開始時にサイズをキャッシュ（毎フレームの parseFloat を回避）
    dragWidth = parseFloat(overlayEl.style.width);
    dragHeight = parseFloat(overlayEl.style.height);
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
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 画面内に VISIBLE_THRESHOLD 分は残るよう制限
    const minVisible = Math.min(VISIBLE_THRESHOLD, MIN_SIZE);
    const newLeft = Math.max(minVisible - dragWidth, Math.min(vw - minVisible, dragOrigLeft + dx));
    const newTop = Math.max(minVisible - dragHeight, Math.min(vh - minVisible, dragOrigTop + dy));

    overlayEl.style.top = `${newTop}px`;
    overlayEl.style.left = `${newLeft}px`;
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
