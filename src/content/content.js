"use strict";

(function () {
  if (window.__screenShadeRunning === true) return true;

  // 共有定数（actions.js 由来）
  const { DEFAULT_SIZE, DEFAULT_MARGIN, MIN_SIZE, VISIBLE_THRESHOLD } = Dimensions;

  // ---------- State ----------
  // host: ページ body 配下の透明コンテナ（ページ CSS 攻撃を inline !important で弾く役）
  // shadowRoot: closed モード。ページ JS から覗けない
  // overlayEl: shadow 内の実 overlay。位置/サイズ/テーマ/blur を持ち、ページ CSS 影響なし
  let host = null;
  let shadowRoot = null;
  let overlayEl = null;
  let currentTheme = Themes.LIGHT;
  let currentBlur = BlurConfig.DEFAULT;
  let resizeObs = null;
  let mutationObs = null;
  // 中央追従: 直近に観測した viewport サイズ。createOverlay で初期化し、
  // ResizeObserver で diff/2 だけ overlay を移動して中心-中心の相対位置を保つ。
  let prevViewportW = 0;
  let prevViewportH = 0;
  // ResizeObserver 起因の savePrefs を間引くタイマー
  let savePrefsTimer = null;

  // IIFE 初期化成功が確定してからフラグを立てる（失敗時の永続ロックを避ける）
  try {
    installMessageListener();
    installFullscreenWatcher();
    installKeyboardWatcher();
    window.__screenShadeRunning = true;
  } catch (err) {
    console.error("[ScreenGuard] init failed:", err);
    return true;
  }

  function installMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender) => {
      if (sender.id !== chrome.runtime.id) return;

      if (request.action === Actions.SHOW_OVERLAY_CS) {
        onShowCommand(request.data?.theme, request.data?.glassBlur);
      } else if (request.action === Actions.UPDATE_BLUR) {
        currentBlur = clampBlur(request.data?.glassBlur);
        applyBlur();
      } else if (request.action === Actions.RESET_PREFS) {
        resetOverlayPosition();
      }
    });
  }

  // ---------- Show / Close ----------
  function onShowCommand(theme, glassBlur) {
    currentTheme = sanitizeTheme(theme);
    currentBlur = clampBlur(glassBlur);

    // body 要素そのものを差し替える SPA（Turbo 等）や document.write では、
    // MutationObserver が切り離された旧 body を監視し続けるため host の除去を検知できず、
    // detach された host/overlayEl の参照だけが残る。この状態で下の else へ入ると
    // 画面に存在しない残骸を更新して終わり、background は sendMessage 成功で ok:true を返すため
    // ポップアップが黙って閉じ、ユーザーには「押しても何も出ない」としか見えない。
    if (host && !document.contains(host)) {
      cleanupResize();
      cleanupDrag();
      disconnectObservers();
      host = null;
      shadowRoot = null;
      overlayEl = null;
    }

    if (!host) {
      createOverlay();
    } else {
      overlayEl.dataset.theme = currentTheme;
      applyBlur();
      applyPosition(ensureVisibleFromElement());
      savePrefs();
    }
  }

  /** Glass テーマの blur をインライン適用（shadow 内なので !important 不要） */
  function applyBlur() {
    if (!overlayEl) return;
    if (currentTheme === Themes.GLASS) {
      const val = `blur(${currentBlur}px) saturate(180%)`;
      overlayEl.style.webkitBackdropFilter = val;
      overlayEl.style.backdropFilter = val;
    } else {
      overlayEl.style.webkitBackdropFilter = "";
      overlayEl.style.backdropFilter = "";
    }
  }

  /** 位置・サイズの一括設定（shadow 内なので !important 不要） */
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
    // ビューポートが MIN_SIZE + マージン*2 を下回ると、マージンを引いた結果が
    // MIN_SIZE 未満（さらに小さいと負）になる。ensureVisible 経由で ResizeObserver からも
    // 呼ばれるため、放置するとウィンドウを縮めるたびに overlay が縮んで savePrefs で永続化され、
    // ウィンドウを戻しても復元されない（閉じるボタンごと潰れて操作不能になる）。下限で止める。
    const cw = Math.max(MIN_SIZE, Math.min(w, vw - DEFAULT_MARGIN * 2));
    const ch = Math.max(MIN_SIZE, Math.min(h, vh - DEFAULT_MARGIN * 2));
    return {
      top: Math.round((vh - ch) / 2),
      left: Math.round((vw - cw) / 2),
      width: cw,
      height: ch,
    };
  }

  function resetOverlayPosition() {
    if (!overlayEl) return;
    // storage 削除は popup.js の責務。ここで savePrefs すると直前の remove を即座に上書きしてしまうため呼ばない。
    // ResizeObserver 由来の debounce 保存が未発火のまま残っていると、popup の remove 完了後に
    // 古い位置を書き戻してリセットが無かったことになるので、ここで取り消す。
    clearTimeout(savePrefsTimer);
    applyPosition(centerPosition(DEFAULT_SIZE, DEFAULT_SIZE));
  }

  function closeOverlay() {
    cleanupResize();
    cleanupDrag();
    disconnectObservers();
    if (host) {
      host.remove();
      host = null;
      shadowRoot = null;
      overlayEl = null;
    }
  }

  // ---------- Persistence ----------
  function savePrefs() {
    if (!overlayEl) return;
    const prefs = {
      theme: currentTheme,
      top: parseFloat(overlayEl.style.top),
      left: parseFloat(overlayEl.style.left),
      width: parseFloat(overlayEl.style.width),
      height: parseFloat(overlayEl.style.height),
    };
    chrome.storage.local.set({ [StorageKeys.PREFS]: prefs }).catch((err) => {
      console.error("[ScreenGuard] storage.set failed:", err);
    });
  }

  // ResizeObserver による中央追従からの save は連続発火するので debounce。
  // ユーザー操作起点の savePrefs（drag/resize 終了時）は即時で OK。
  function savePrefsDebounced() {
    clearTimeout(savePrefsTimer);
    savePrefsTimer = setTimeout(savePrefs, 300);
  }

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

  function ensureVisibleFromElement() {
    if (!overlayEl) return centerPosition(DEFAULT_SIZE, DEFAULT_SIZE);
    return ensureVisible(
      parseFloat(overlayEl.style.top),
      parseFloat(overlayEl.style.left),
      parseFloat(overlayEl.style.width),
      parseFloat(overlayEl.style.height),
    );
  }

  function loadPrefsAndApply() {
    chrome.storage.local.get(StorageKeys.PREFS, (result) => {
      if (chrome.runtime.lastError) {
        console.error("[ScreenGuard] storage.get failed:", chrome.runtime.lastError);
        return;
      }
      if (!overlayEl) return;
      // storage.get は非同期に返る。待っている間にユーザーが overlay を掴んでいた場合、
      // ここで保存位置を適用すると手元から overlay を奪い、その座標をさらに永続化してしまう。
      if (isDragging || resizeActive) return;

      const prefs = result[StorageKeys.PREFS];
      const isValid = prefs
        && [prefs.top, prefs.left, prefs.width, prefs.height].every((v) => Number.isFinite(v));

      if (isValid) {
        // 旧バージョンが centerPosition 経由で保存した MIN_SIZE 未満の潰れたサイズを救済する。
        // 末尾の savePrefs で修正後の値がそのまま永続化される。
        const width = Math.max(MIN_SIZE, prefs.width);
        const height = Math.max(MIN_SIZE, prefs.height);
        applyPosition(ensureVisible(prefs.top, prefs.left, width, height));
      }

      // 表示が確定した時点の状態を必ず保存する。ここを「位置補正が起きたときだけ」に
      // 限定すると、初回表示や補正不要のケースでテーマが保存されず、
      // 次回ポップアップが PREFS.theme から古いテーマを復元してしまう
      // （README が謳うテーマ自動保存の契約が破れる）。
      savePrefs();
    });
  }

  // ---------- Observers ----------
  function installObservers() {
    if (typeof ResizeObserver === "function") {
      resizeObs = new ResizeObserver(() => {
        if (!overlayEl) return;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const dw = vw - prevViewportW;
        const dh = vh - prevViewportH;
        // 操作中も viewport は変わり得る（DevTools dock 等）。prev は常に更新して
        // 「操作中の viewport 変化」が操作終了直後に一気に効かないようにする。
        prevViewportW = vw;
        prevViewportH = vh;

        // drag/resize 中は pointer 入力を優先。observer が overlay を動かすと
        // ユーザーの手元から overlay を奪ってしまうためスキップ。
        if (isDragging || resizeActive) return;
        if (dw === 0 && dh === 0) return;

        // 中心-中心の相対位置追従: viewport delta の半分だけ overlay を移動。
        // 中央配置レイアウトのコンテンツ（動画プレイヤー等）と同じ動きで追従する。
        const curTop = parseFloat(overlayEl.style.top);
        const curLeft = parseFloat(overlayEl.style.left);
        const curWidth = parseFloat(overlayEl.style.width);
        const curHeight = parseFloat(overlayEl.style.height);
        const newTop = curTop + dh / 2;
        const newLeft = curLeft + dw / 2;
        // 極端に縮められた場合に備えて既存の画面外補正を最後に通す。
        applyPosition(ensureVisible(newTop, newLeft, curWidth, curHeight));
        savePrefsDebounced();
      });
      resizeObs.observe(document.documentElement);
    }
    if (typeof MutationObserver === "function") {
      mutationObs = new MutationObserver(() => {
        // host が DOM から外されたら状態リセット。
        // subtree:true にしておくことで、フルスクリーン要素配下に移設中でもその sub-tree 除去を検知できる。
        if (host && !document.contains(host)) {
          cleanupResize();
          cleanupDrag();
          host = null;
          shadowRoot = null;
          overlayEl = null;
          disconnectObservers();
        }
      });
        // body ではなく documentElement を監視する。body を監視すると、body 要素ごと
      // 差し替える SPA で observer が切り離された旧 body に取り残され、host の除去を検知できなくなる。
      // documentElement + subtree は body 配下の childList を包含するので検知範囲は落ちない。
      mutationObs.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function disconnectObservers() {
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (mutationObs) { mutationObs.disconnect(); mutationObs = null; }
  }

  // ---------- Fullscreen 対応 ----------
  function installFullscreenWatcher() {
    document.addEventListener("fullscreenchange", () => {
      if (!host) return;
      const parent = document.fullscreenElement ?? document.body;
      if (host.parentNode !== parent) {
        parent.appendChild(host);
      }
    });
  }

  // ---------- キーボード操作 ----------
  /**
   * Escape でオーバーレイを閉じる。
   * 閉じる手段が shadow 内の × ボタンだけだと、ポインタが使いにくい環境で詰むため。
   * overlay 表示中のみ反応し、非表示時はページ側の Escape 挙動を一切妨げない。
   */
  function installKeyboardWatcher() {
    document.addEventListener("keydown", (e) => {
      if (!host || e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
    }, true);
  }

  // ---------- Host 防御 ----------
  /**
   * Host 要素に inline !important スタイルを適用。
   * CSS cascade 上、author !important inline は author !important と同じレイヤだが、
   * inline は specificity 無限大として扱われるため、ページ側の !important ルールに勝つ。
   */
  function applyHostDefense() {
    const set = (k, v) => host.style.setProperty(k, v, "important");
    // 継承・ユーザースタイル・ページの汎用 CSS からの影響を初期化
    set("all", "initial");
    // 透明なゼロサイズ基点コンテナとして固定
    set("position", "fixed");
    set("top", "0");
    set("left", "0");
    set("width", "0");
    set("height", "0");
    set("margin", "0");
    set("padding", "0");
    set("border", "0");
    set("overflow", "visible");
    // pointer は shadow 内 overlay のみが受ける（host の空ゼロ領域はクリック透過）
    set("pointer-events", "none");
    set("z-index", "2147483647");
    set("display", "block");
    set("visibility", "visible");
    set("opacity", "1");
    set("transform", "none");
    set("filter", "none");
    set("clip", "auto");
    set("clip-path", "none");
    // NOTE: `contain: strict` を付けると paint containment によって 0×0 host に descendants が clip され、
    // shadow root 内の overlay が完全不可視になる（shadow 境界は layout/paint を isolate しない）。
    // 同様に backdrop-filter / perspective / filter: 非none も fixed の containing block を host に変えてしまうため、
    // ここでは transform/filter/clip-path を明示的に none に戻すだけで containment は一切付与しない。
  }

  // ---------- Create Overlay ----------
  function createOverlay() {
    // 拡張の更新・再読み込み後は、旧 isolated world が作った closed shadow host だけが
    // DOM に残ることがある。新しい world から内部へ触れないため、作成前に全残骸を除去する。
    document.querySelectorAll("#screenShadeHost").forEach((staleHost) => staleHost.remove());

    host = document.createElement("div");
    host.id = "screenShadeHost";
    applyHostDefense();

    // Closed mode: ページ JS から host.shadowRoot アクセス不可
    shadowRoot = host.attachShadow({ mode: "closed" });

    // CSS 注入（content-styles.js が先に載せた window.__screenShadeStyles を使用）
    const style = document.createElement("style");
    style.textContent = window.__screenShadeStyles ?? "";
    shadowRoot.appendChild(style);

    // 実 overlay（位置・サイズ・テーマ・blur を持つ）
    overlayEl = document.createElement("div");
    overlayEl.className = "overlay";
    overlayEl.dataset.theme = currentTheme;
    applyPosition(centerPosition(DEFAULT_SIZE, DEFAULT_SIZE));

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "オーバーレイを閉じる");
    closeBtn.addEventListener("click", closeOverlay);
    overlayEl.appendChild(closeBtn);

    // Resize handles
    const directions = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
    for (const dir of directions) {
      const handle = document.createElement("div");
      handle.classList.add("handle", `handle-${dir}`);
      handle.dataset.direction = dir;
      handle.addEventListener("pointerdown", onResizeStart);
      overlayEl.appendChild(handle);
    }

    // Drag は overlay 本体で受ける
    overlayEl.addEventListener("pointerdown", onDragStart);

    shadowRoot.appendChild(overlayEl);

    // Host を DOM に append（フルスクリーン時は fullscreen 要素配下）
    const parent = document.fullscreenElement ?? document.body;
    parent.appendChild(host);

    applyBlur();
    // ResizeObserver の中央追従は「前回観測した viewport」との差分を使うので、
    // observer 起動前に baseline を必ず初期化しておく。
    prevViewportW = window.innerWidth;
    prevViewportH = window.innerHeight;
    installObservers();
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
    // ハンドル・閉じるボタン上ではドラッグしない（shadow 内で classList 判定）
    if (
      e.target.classList?.contains("handle") ||
      e.target.classList?.contains("close")
    ) {
      return;
    }

    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOrigTop = parseFloat(overlayEl.style.top);
    dragOrigLeft = parseFloat(overlayEl.style.left);
    dragWidth = parseFloat(overlayEl.style.width);
    dragHeight = parseFloat(overlayEl.style.height);
    try { overlayEl.setPointerCapture(e.pointerId); } catch {}
    overlayEl.style.cursor = "grabbing";

    overlayEl.addEventListener("pointermove", onDragMove);
    overlayEl.addEventListener("pointerup", onDragEnd);
    overlayEl.addEventListener("pointercancel", onDragEnd);
  }

  function onDragMove(e) {
    if (!isDragging || !overlayEl) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    const minVisible = Math.min(VISIBLE_THRESHOLD, MIN_SIZE);
    // viewport は drag 中に変化し得る（DevTools dock toggle / Aero snap / orientation change / IME etc）ため live 読み。
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const newLeft = Math.max(minVisible - dragWidth, Math.min(vw - minVisible, dragOrigLeft + dx));
    const newTop = Math.max(minVisible - dragHeight, Math.min(vh - minVisible, dragOrigTop + dy));
    overlayEl.style.top = `${newTop}px`;
    overlayEl.style.left = `${newLeft}px`;
  }

  function onDragEnd(e) {
    isDragging = false;
    if (overlayEl) {
      try { overlayEl.releasePointerCapture(e.pointerId); } catch {}
      overlayEl.style.cursor = "grab";
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
  let resizeActive = false;
  let resizeTarget = null;
  let resizePointerId = -1;
  let resizeDir = "";
  let resizeN = false, resizeS = false, resizeE = false, resizeW = false;
  let startX = 0;
  let startY = 0;
  let startTop = 0;
  let startLeft = 0;
  let startWidth = 0;
  let startHeight = 0;

  function onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();

    resizeActive = true;
    resizeTarget = e.currentTarget;
    resizePointerId = e.pointerId;
    resizeDir = resizeTarget.dataset.direction;
    resizeN = resizeDir.includes("n");
    resizeS = resizeDir.includes("s");
    resizeE = resizeDir.includes("e");
    resizeW = resizeDir.includes("w");
    startX = e.clientX;
    startY = e.clientY;
    startTop = parseFloat(overlayEl.style.top);
    startLeft = parseFloat(overlayEl.style.left);
    startWidth = parseFloat(overlayEl.style.width);
    startHeight = parseFloat(overlayEl.style.height);

    try { resizeTarget.setPointerCapture(resizePointerId); } catch {}

    resizeTarget.addEventListener("pointermove", onResizeMove);
    resizeTarget.addEventListener("pointerup", onResizeEnd);
    resizeTarget.addEventListener("pointercancel", onResizeEnd);
  }

  function onResizeMove(e) {
    if (!resizeActive || !overlayEl) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let top = startTop;
    let left = startLeft;
    let width = startWidth;
    let height = startHeight;

    if (resizeN) {
      const newHeight = startHeight - dy;
      if (newHeight >= MIN_SIZE) {
        top = startTop + dy;
        height = newHeight;
      }
    }
    if (resizeS) {
      height = Math.max(MIN_SIZE, startHeight + dy);
    }
    if (resizeW) {
      const newWidth = startWidth - dx;
      if (newWidth >= MIN_SIZE) {
        left = startLeft + dx;
        width = newWidth;
      }
    }
    if (resizeE) {
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
    resizeActive = false;
    if (resizeTarget) {
      try { resizeTarget.releasePointerCapture(resizePointerId); } catch {}
      resizeTarget.removeEventListener("pointermove", onResizeMove);
      resizeTarget.removeEventListener("pointerup", onResizeEnd);
      resizeTarget.removeEventListener("pointercancel", onResizeEnd);
      resizeTarget = null;
      resizePointerId = -1;
    }
  }
})();
