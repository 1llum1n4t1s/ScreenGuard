"use strict";

(function () {
  if (window.__screenShadeRunning === true) return true;
  window.__screenShadeRunning = true;

  const TIMER_INTERVAL_MS = 1000;
  const STORAGE_KEY = "shadePrefs";

  // ---------- State ----------
  let overlayEl = null;
  let timerLabelEl = null;
  let isTimeoutEnabled = false;
  let remainingMs = 0;
  let timerIntervalId = null;
  let currentTheme = "light";

  // ---------- Message Listener ----------
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === Actions.SHOW_OVERLAY_CS) {
      onShowCommand(
        request.data.isTimeoutEnabled,
        request.data.timeout,
        request.data.theme
      );
    }
  });

  // ---------- Local Timer ----------
  function startTimer() {
    stopTimer();
    timerIntervalId = setInterval(() => {
      if (!overlayEl || !isTimeoutEnabled) {
        stopTimer();
        return;
      }
      remainingMs -= TIMER_INTERVAL_MS;
      if (remainingMs <= 0) {
        closeOverlay();
      } else {
        updateTimerLabel();
      }
    }, TIMER_INTERVAL_MS);
  }

  function stopTimer() {
    if (timerIntervalId !== null) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  // ---------- Show / Close ----------
  function onShowCommand(enabled, timeout, theme) {
    isTimeoutEnabled = enabled;
    remainingMs = timeout ?? 0;
    currentTheme = theme ?? "light";

    if (!overlayEl) {
      createOverlay();
    } else {
      // テーマ変更のみ
      overlayEl.dataset.theme = currentTheme;
      if (!isTimeoutEnabled && timerLabelEl) {
        timerLabelEl.textContent = "";
      }
    }

    if (isTimeoutEnabled && remainingMs > 0) {
      startTimer();
    } else {
      stopTimer();
    }
  }

  function closeOverlay() {
    stopTimer();
    cleanupResize();
    cleanupDrag();
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
      timerLabelEl = null;
    }
  }

  // ---------- Persistence ----------
  function savePrefs() {
    if (!overlayEl) return;
    const rect = overlayEl.getBoundingClientRect();
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        theme: currentTheme,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
    });
  }

  function loadPrefsAndApply() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const prefs = result[STORAGE_KEY];
      if (!prefs || !overlayEl) return;

      // テーマ復元
      if (prefs.theme) {
        currentTheme = prefs.theme;
        overlayEl.dataset.theme = currentTheme;
      }

      // 位置・サイズ復元
      if (
        typeof prefs.top === "number" &&
        typeof prefs.left === "number" &&
        typeof prefs.width === "number" &&
        typeof prefs.height === "number"
      ) {
        overlayEl.style.top = `${prefs.top}px`;
        overlayEl.style.left = `${prefs.left}px`;
        overlayEl.style.right = "auto";
        overlayEl.style.bottom = "auto";
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

    // 閉じるボタン
    const closeBtn = document.createElement("i");
    closeBtn.id = "shader-close";
    closeBtn.addEventListener("click", closeOverlay);
    overlayEl.appendChild(closeBtn);

    // タイマーラベル
    timerLabelEl = document.createElement("div");
    timerLabelEl.id = "shader-timeout-label";
    overlayEl.appendChild(timerLabelEl);

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

    if (isTimeoutEnabled && remainingMs > 0) {
      updateTimerLabel();
    }

    document.body.appendChild(overlayEl);

    // 保存された設定を読み込む
    loadPrefsAndApply();
  }

  // ---------- Timer Label ----------
  function updateTimerLabel() {
    if (!timerLabelEl) return;
    const totalSec = Math.ceil(remainingMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const secStr = sec.toString().padStart(2, "0");
    timerLabelEl.textContent =
      min > 0 ? `${min}:${secStr}` : `${sec}`;
  }

  // ---------- Drag Logic (Pointer Events) ----------
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartRect = null;

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
    dragStartRect = overlayEl.getBoundingClientRect();
    overlayEl.style.cursor = "grabbing";

    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", onDragEnd);
  }

  function onDragMove(e) {
    if (!isDragging || !overlayEl || !dragStartRect) return;

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    overlayEl.style.top = `${dragStartRect.top + dy}px`;
    overlayEl.style.left = `${dragStartRect.left + dx}px`;
    overlayEl.style.right = "auto";
    overlayEl.style.bottom = "auto";
  }

  function onDragEnd() {
    isDragging = false;
    if (overlayEl) {
      overlayEl.style.cursor = "";
    }
    cleanupDrag();
    savePrefs();
  }

  function cleanupDrag() {
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", onDragEnd);
    dragStartRect = null;
  }

  // ---------- Resize Logic (Pointer Events) ----------
  let resizeDir = "";
  let startX = 0;
  let startY = 0;
  let startRect = null;

  function onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();

    resizeDir = e.currentTarget.dataset.direction;
    startX = e.clientX;
    startY = e.clientY;
    startRect = overlayEl.getBoundingClientRect();

    document.addEventListener("pointermove", onResizeMove);
    document.addEventListener("pointerup", onResizeEnd);
  }

  function onResizeMove(e) {
    if (!overlayEl || !startRect) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let top = startRect.top;
    let left = startRect.left;
    let width = startRect.width;
    let height = startRect.height;

    const MIN_SIZE = 40;

    if (resizeDir.includes("n")) {
      const newHeight = height - dy;
      if (newHeight >= MIN_SIZE) {
        top = startRect.top + dy;
        height = newHeight;
      }
    }
    if (resizeDir.includes("s")) {
      height = Math.max(MIN_SIZE, height + dy);
    }
    if (resizeDir.includes("w")) {
      const newWidth = width - dx;
      if (newWidth >= MIN_SIZE) {
        left = startRect.left + dx;
        width = newWidth;
      }
    }
    if (resizeDir.includes("e")) {
      width = Math.max(MIN_SIZE, width + dx);
    }

    overlayEl.style.top = `${top}px`;
    overlayEl.style.left = `${left}px`;
    overlayEl.style.right = "auto";
    overlayEl.style.bottom = "auto";
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
    startRect = null;
  }
})();
