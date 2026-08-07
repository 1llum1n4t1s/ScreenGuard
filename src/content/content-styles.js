"use strict";

// Shadow DOM 内に流し込む CSS 文字列。ページ側のスタイルから完全に隔離されるため !important 不要。
// background.js が executeScript でこのファイルを content.js より前に注入する。
// グローバル名は衝突回避のため __screenShade プレフィックス。
window.__screenShadeStyles = `
.overlay {
  position: fixed;
  box-sizing: border-box;
  border-radius: 12px;
  cursor: grab;
  transition: background-color 0.3s ease, box-shadow 0.3s ease;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
}

.overlay[data-theme="light"] {
  --close-bg: rgba(0, 0, 0, 0.12);
  --x-color: rgba(0, 0, 0, 0.5);
  background-color: #f0f0f0;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.15),
    0 2px 8px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.overlay[data-theme="dark"] {
  --close-bg: rgba(255, 255, 255, 0.12);
  --x-color: rgba(255, 255, 255, 0.6);
  background-color: #2a2a2e;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 2px 8px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.overlay[data-theme="glass"] {
  --close-bg: rgba(0, 0, 0, 0.15);
  --x-color: rgba(0, 0, 0, 0.6);
  /* backdrop-filter は content.js からインラインで設定（ぼかし強度可変） */
  background-color: rgba(255, 255, 255, 0.15);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.12),
    0 2px 8px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.close {
  position: absolute;
  right: 16px;
  top: 16px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 2;
  border: none;
  background-color: var(--close-bg);
  /* 既定は常時表示。オーバーレイを閉じる手段はこのボタンだけなので、
     ホバーを持たない環境（タッチ・ペン）で隠すと閉じられなくなる。 */
  opacity: 1;
  pointer-events: auto;
  padding: 0;
  margin: 0;
  font: inherit;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

/* マウス・トラックパッドのように確実にホバーできる環境でだけ、
   非ホバー時に隠して覆い面をすっきり見せる。 */
@media (hover: hover) and (pointer: fine) {
  .close {
    opacity: 0;
    pointer-events: none;
  }

  .overlay:hover .close {
    opacity: 1;
    pointer-events: auto;
  }
}

/* キーボード操作時はホバー環境でも必ず可視化する（.close より詳細度が高いので上の隠蔽に勝つ） */
.close:focus-visible {
  opacity: 1;
  pointer-events: auto;
  outline: 2px solid var(--x-color);
  outline-offset: 2px;
}

.close:hover {
  background-color: #e74c3c;
}

.close::before,
.close::after {
  content: "";
  position: absolute;
  display: block;
  margin: auto;
  inset: 0;
  width: 14px;
  height: 0;
  border-top: 2px solid var(--x-color);
  transform-origin: center;
  transition: border-color 0.2s ease;
}

.close:hover::before,
.close:hover::after {
  border-top-color: #fff;
}

.close::before { transform: rotate(45deg); }
.close::after  { transform: rotate(-45deg); }

.handle {
  position: absolute;
  z-index: 1;
  background-color: transparent;
}

.handle-nw, .handle-ne, .handle-sw, .handle-se {
  width: 16px;
  height: 16px;
}

.handle-n, .handle-s {
  height: 8px;
  left: 16px;
  right: 16px;
}

.handle-e, .handle-w {
  width: 8px;
  top: 16px;
  bottom: 16px;
}

.handle-nw { top: 0; left: 0; cursor: nw-resize; }
.handle-ne { top: 0; right: 0; cursor: ne-resize; }
.handle-sw { bottom: 0; left: 0; cursor: sw-resize; }
.handle-se { bottom: 0; right: 0; cursor: se-resize; }
.handle-n  { top: 0; cursor: n-resize; }
.handle-s  { bottom: 0; cursor: s-resize; }
.handle-e  { right: 0; cursor: e-resize; }
.handle-w  { left: 0; cursor: w-resize; }
`;
