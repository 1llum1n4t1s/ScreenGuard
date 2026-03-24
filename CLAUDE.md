# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

スクリーンカーテン (Screen Curtain) は Chrome 拡張機能 (Manifest V3)。ページ上にリサイズ・ドラッグ可能なオーバーレイを表示して内容を覆い隠す。3テーマ (Light/Dark/Glass blur) 対応。オーバーレイの位置・サイズ・テーマは `chrome.storage.local` で自動保存・復元される。UI は日本語。

## Build Commands

```bash
npm run build                # アイコン + スクリーンショット一括生成
npm run generate-icons       # icons/icon.svg → images/icon-{16,48,128}.png (sharp)
npm run generate-screenshots # webstore/*.html → webstore/images/*.png (Puppeteer)
```

テストフレームワーク・リンターは未導入。動作確認は Chrome に拡張機能を読み込んで手動テスト。

## Version Management

バージョン番号は以下の2ファイルに記載されており、**必ず同時に更新**すること:
- `manifest.json` — Chrome 拡張機能のバージョン
- `package.json` — npm パッケージのバージョン

`package-lock.json` は `npm install` 時に自動同期される。

## Architecture

3つのコンポーネントが `chrome.runtime` メッセージパッシングで連携する。アクション定数は `scripts/actions.js` で定義（`SHOW_OVERLAY`, `SHOW_OVERLAY_CS`, `RESET_PREFS`, `UPDATE_BLUR`）。

```
Popup (popup.html/js/css)
  ──SHOW_OVERLAY──▶  Background (scripts/background.js)
                       │ scripts/content.js + actions.js + css/content.css を注入後:
                       ──SHOW_OVERLAY_CS──▶  Content Script (scripts/content.js)
  ──RESET_PREFS──▶   Background ──forward──▶  Content Script
  ──UPDATE_BLUR──▶   Background ──forward──▶  Content Script
```

### Popup (`popup.html`, `popup.js`, `popup.css`)
テーマ選択 (Light/Dark/Glass)、Glass 選択時のみぼかし強度スライダー (1-20px) を表示。位置リセットボタンあり。`SHOW_OVERLAY` に `{theme, glassBlur}` を載せて background へ送信後、ポップアップを閉じる。最後のテーマ・blur 値は `chrome.storage.local` から復元。

### Background (`scripts/background.js`)
Service worker。`Object.freeze` でイミュータブル管理されたステート（theme, glassBlur）を保持。アクティブタブへ content script + CSS を動的注入（`window.__screenShadeRunning` フラグで二重注入防止）。URL のプロトコルが `http:`, `https:`, `file:` 以外のページではスキップ。`RESET_PREFS` / `UPDATE_BLUR` はアクティブタブへ中継。

### Content Script (`scripts/content.js`)
IIFE でラップ。`#screenShadeOverlay` (z-index: 2147483647) を生成。閉じるボタン（`<button>` + `aria-label`）、8方向リサイズハンドル、ドラッグ移動を Pointer Events API (`setPointerCapture`) で実装。テーマは `data-theme` 属性で切替。Glass テーマの backdrop-filter はインラインスタイルで動的適用。位置・サイズは resize/move 終了時に `chrome.storage.local` へ保存し、次回作成時に復元。テーマはポップアップ選択を常に優先（storage からは復元しない）。

### Styling (`css/content.css`)
全ルールに `!important` を使用してページスタイルを上書き。overlay は `top/left/width/height` の明示指定（`bottom/right` は未使用）。リサイズハンドル: 角 16×16px / 辺 8px。閉じるボタンは `<button>` のデフォルトスタイルをリセットした上で CSS 疑似要素で × を描画。

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 設定; permissions: `activeTab`, `scripting`, `storage` |
| `scripts/actions.js` | `Object.freeze` されたアクション定数・共通ユーティリティ (全スクリプト共有) |
| `scripts/background.js` | Service worker: イミュータブルステート管理、スクリプト注入、メッセージ中継 |
| `scripts/content.js` | オーバーレイ DOM 生成、リサイズ、ドラッグ、画面外補正、設定永続化 |
| `popup.js` | ポップアップ UI: テーマ選択、blur スライダー、リセット |
| `css/content.css` | オーバーレイスタイル (`!important` で上書き) |
| `icons/icon.svg` | ソースアイコン (512×512); PNG は `images/` に生成 |
| `webstore/` | ストア申請用: HTML テンプレート、生成画像、掲載情報テキスト |
| `privacy-policy.md` | プライバシーポリシー (GitHub Pages で公開) |

## Store Asset Generation

`icons/icon.svg` → sharp で PNG 変換 (`scripts/generate-icons.js`)。`webstore/*.html` → Puppeteer でスクリーンショット PNG 生成 (`webstore/generate-screenshots.js`)。1枚目のメインスクリーンショットは手動作成済み (`webstore/images/00-screenshot-main-1280x800.png`) でコピーのみ。Chrome Web Store 画像サイズ: スクリーンショット 1280×800、プロモ小 440×280、マーキー 1400×560。

## Important Patterns

- **`clampBlur()` は `actions.js` にのみ定義** — `popup.js` と `content.js` の両方から `actions.js` のグローバル関数として参照される。変更時は `actions.js` を更新すること。
- **content script の注入判定** — `window.__screenShadeRunning` グローバルフラグで管理。background.js で `executeScript` → `func` 実行して確認。
- **位置指定は top/left/width/height のみ** — `bottom` や `right` は使わない設計。リサイズロジックもこの前提で動いている。
- **`actions.js` は `importScripts` (background) と `executeScript` (注入) の2経路で読み込まれる** — ES modules ではなく従来のスクリプト形式。
- **画面外オーバーレイの自動補正** — `ensureVisible()` が保存座標の復元時に画面外判定（`VISIBLE_THRESHOLD=100px`）を行い、範囲外なら `centerPosition()` で中央に再配置。ドラッグ中も `onDragMove()` 内で同閾値による移動制限あり。
- **位置操作ヘルパー** — `applyPosition()` でオーバーレイの top/left/width/height を一括設定、`centerPosition(w, h)` で中央配置座標を計算。リセットや ensureVisible から共通利用される。

## Storage Keys

`StorageKeys` (`actions.js` で定義) に2つのキーがあり、用途と削除タイミングが異なる:
- **`PREFS`** (`shadePrefs`) — オーバーレイの位置・サイズ・テーマ。content.js で保存、loadPrefsAndApply で復元。
- **`GLASS_BLUR`** (`glassBlur`) — ぼかし強度。popup.js のスライダー操作時に保存。

**リセット時は両方のキーを削除すること** — `popup.js` と `content.js` の RESET_PREFS ハンドラで `[StorageKeys.PREFS, StorageKeys.GLASS_BLUR]` を同時に remove する。片方だけ消すと不整合が起きる。
