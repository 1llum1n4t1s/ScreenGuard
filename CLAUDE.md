# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

スクリーンカーテン (Screen Curtain) は Chrome 拡張機能 (Manifest V3)。ページ上にリサイズ・ドラッグ可能なオーバーレイを表示して内容を覆い隠す。3テーマ (Light/Dark/Glass blur) 対応。オーバーレイの位置・サイズ・テーマは `chrome.storage.local` で自動保存・復元される。UI は日本語。

## Build Commands

```bash
npm run build                # アイコン + スクリーンショット一括生成
npm run generate-icons       # icons/icon.svg → icons/icon-{16,48,128}.png (sharp)
npm run generate-screenshots # webstore/*.html → webstore/images/*.png (Puppeteer)
```

テストフレームワーク・リンターは未導入。動作確認は Chrome で `chrome://extensions` を開き、「パッケージ化されていない拡張機能を読み込む」からプロジェクトルートを選択して手動テスト。JS の構文だけ確認したい時は `node --check <file>` が使える（chrome API 未定義エラーは parse 段階では出ない）。

## Version Management

バージョン番号は以下の2ファイルに記載されており、**必ず同時に更新**すること:
- `manifest.json` — Chrome 拡張機能のバージョン
- `package.json` — npm パッケージのバージョン

`package-lock.json` は `npm install` 時に自動同期される。

## Architecture

3つのコンポーネントが `chrome.runtime` メッセージパッシングで連携する。アクション定数・共通定数は `src/lib/actions.js` で定義（`Actions`, `Themes`, `BlurConfig`, `Dimensions`, `StorageKeys`, `clampBlur`, `sanitizeTheme`）。

```
Popup (src/popup/popup.{html,js,css})
  ──SHOW_OVERLAY {tabId}──▶  Background (src/background/background.js)
                              │ executeScript で順番に注入:
                              │   src/lib/actions.js → src/content/content-styles.js → src/content/content.js
                              │ （CSS は shadow root 内で適用するため insertCSS は使わない）
                              ──SHOW_OVERLAY_CS──▶  Content Script (src/content/content.js)
  ──RESET_PREFS  {tabId}──▶  Background ──forward──▶  Content Script
  ──UPDATE_BLUR  {tabId}──▶  Background ──forward──▶  Content Script
```

### Popup (`src/popup/popup.html`, `popup.js`, `popup.css`)
テーマ選択 (Light/Dark/Glass)、Glass 選択時のみぼかし強度スライダー (`BlurConfig.MIN`〜`BlurConfig.MAX`) を表示。位置リセットボタンあり。`chrome.tabs.query` で自身で tabId を解決し、`SHOW_OVERLAY` に `{tabId, data: {theme, glassBlur}}` を載せて background へ送信後、ポップアップを閉じる。`UPDATE_BLUR` の sendMessage も 80ms デバウンスで連打を間引く。最後のテーマ・blur 値は `chrome.storage.local` から復元。popup.html の `<script src="../lib/actions.js">` は popup からの相対パスであることに注意。

### Background (`src/background/background.js`)
Service worker。`importScripts("/src/lib/actions.js")` で定数をロード。`Object.freeze` でイミュータブル管理されたステート（theme, glassBlur）を保持。`onMessage` で `sender.id === chrome.runtime.id` を検証して外部メッセージを拒否。`request.tabId` を優先、次にキャッシュ、最後に `chrome.tabs.query` の順で対象タブを解決（アクティブタブ曖昧性を回避）。`handleShowOverlay` は `.catch` で reject を捕捉して `sendResponse({ok:false})` を返す。URL のプロトコルが `http:`, `https:`, `file:` 以外のページではスキップ（chrome://, edge://, about: 等）。`UPDATE_BLUR` は `state.glassBlur` も同時更新（SSoT 維持）。

### Content Script (`src/content/content.js`)
IIFE でラップ。**Shadow DOM 構成**: `#screenShadeHost` (z-index: 2147483647, `all: initial` 等の inline !important 防御付き) を `document.body` 直下に配置し、`attachShadow({ mode: "closed" })` で closed shadow root を作成。shadow 内に `<style>`（`window.__screenShadeStyles` から流し込み）と `.overlay` を置く。ページ CSS は shadow 境界で遮断されるため `.overlay` 以下のスタイルに `!important` は不要。ページ JS は host から `.shadowRoot` アクセス不可。閉じるボタン（`<button class="close">` + `aria-label`）、8方向リサイズハンドル（`.handle-{n,ne,e,...}`）、ドラッグ移動を Pointer Events API (`setPointerCapture`) で実装。**drag と resize の両方で PointerCapture を取得** してウィンドウ外移動時のリスナーリークを防ぐ。`ResizeObserver` でビューポート変化時に `ensureVisible` を再適用、`MutationObserver` で SPA による host 除去を検知して参照をリセット。`fullscreenchange` でフルスクリーン要素配下へ host を付け替え。テーマは `sanitizeTheme` で allowlist 検証してから `.overlay[data-theme]` で切替。位置・サイズは resize/move 終了時に `chrome.storage.local` へ保存し、次回作成時に復元。テーマはポップアップ選択を常に優先（storage からは復元しない）。

### Styling (`src/content/content-styles.js`)
CSS 文字列を `window.__screenShadeStyles` に置くだけの JS モジュール。content.js が shadow root 内の `<style>` 要素に流し込む。**shadow root 内のため `!important` 不要**、selector も `#screenShadeOverlay` ではなく `.overlay` / `.close` / `.handle-*` といった短い class ベース。overlay は `top/left/width/height` の明示指定（`bottom/right` は未使用）。リサイズハンドル: 角 16×16px / 辺 8px。`chrome.scripting.insertCSS` は shadow root に届かないため使用しない。

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 設定; permissions: `activeTab`, `scripting`, `storage`; `content_security_policy` 明示 |
| `src/lib/actions.js` | `Object.freeze` された定数群（`Actions`/`Themes`/`BlurConfig`/`Dimensions`/`StorageKeys`）と共通ユーティリティ（`clampBlur`/`sanitizeTheme`）|
| `src/background/background.js` | Service worker: イミュータブルステート管理、スクリプト注入、メッセージ中継、tabId キャッシュ、sender 検証 |
| `src/content/content.js` | Shadow DOM 化したオーバーレイ生成、リサイズ、ドラッグ、画面外補正、SPA 対応、フルスクリーン対応、設定永続化 |
| `src/content/content-styles.js` | Shadow DOM 内に注入する CSS 文字列（`window.__screenShadeStyles`）|
| `src/popup/popup.html` | ポップアップ UI（`<script src="../lib/actions.js">` で相対ロード）|
| `src/popup/popup.js` | ポップアップ UI: テーマ選択、blur スライダー、リセット、tabId 解決 |
| `src/popup/popup.css` | ポップアップスタイル |
| `icons/icon.svg` | ソースアイコン (512×512); PNG は `icons/` に生成 |
| `webstore/` | ストア申請用: HTML テンプレート、生成画像、掲載情報テキスト |
| `docs/privacy-policy.md` | プライバシーポリシー (GitHub Pages で公開) |
| `.github/workflows/publish.yml` | Chrome Web Store 自動公開。Actions は SHA 固定、`npm ci` 厳密、devDep の CLI 使用 |

## Store Asset Generation

`icons/icon.svg` → sharp で PNG 変換 (`scripts/generate-icons.js`)。`webstore/*.html` → Puppeteer でスクリーンショット PNG 生成 (`webstore/generate-screenshots.js`)。1枚目のメインスクリーンショットは手動作成済み (`webstore/images/00-screenshot-main-1280x800.png`) でコピーのみ。Chrome Web Store 画像サイズ: スクリーンショット 1280×800、プロモ小 440×280、マーキー 1400×560。

## Important Patterns

- **Shadow DOM による二層防御** — host 要素 (`#screenShadeHost`) には `applyHostDefense()` で `all: initial` / `position: fixed` / `margin/padding/border: 0` / `pointer-events: none` / `transform/filter/clip-path: none` 等を **inline !important** で貼り付け、ページ側の `!important` ルール（inline !important は cascade 上 author !important と同レイヤで specificity 無限大として扱われるため勝つ）を無効化。shadow root は `mode: "closed"` で作成してページ JS の `host.shadowRoot` 経由 DOM 覗きを遮断。実オーバーレイ `.overlay` は shadow 内で `position: fixed` 直配置なので host のサイズに拘束されない。**`contain` 系プロパティは host に付けない**（paint containment が shadow descendants を 0×0 host に clip し、`filter`/`perspective`/`backdrop-filter` の非none は fixed の containing block を host に変えてしまうため — shadow 境界は layout/paint を isolate しないことに注意）。
- **`clampBlur()` / `sanitizeTheme()` は `src/lib/actions.js` にのみ定義** — popup.js / content.js / background.js すべてから `actions.js` のグローバル関数として参照される。変更時は `actions.js` を更新すること。
- **content script の注入判定** — `window.__screenShadeRunning` グローバルフラグで管理。IIFE 初期化が成功してからフラグを立てるため、エラー時の永続ロックは起きない。background.js で `executeScript` → `func` 実行して確認。未注入なら `actions.js → content-styles.js → content.js` の順で一括 executeScript。
- **位置指定は top/left/width/height のみ** — `bottom` や `right` は使わない設計。リサイズロジックもこの前提で動いている。
- **`actions.js` は `importScripts` (background) と `executeScript` (注入) と `<script>` (popup) の3経路で読み込まれる** — ES modules ではなく従来のスクリプト形式。popup からは `../lib/actions.js` という相対パスで読み込む（`src/popup/` からの相対）。
- **`content-styles.js` は window.__screenShadeStyles という string グローバルを置くだけの副作用モジュール** — content.js の `createOverlay()` が shadow root 内の `<style>` textContent に流し込む。fetch / runtime.getURL を使わず JS 文字列化することで async 初期化を回避。CSS ハイライトは失うが、shadow 境界越しの CSS 配送としては最も単純。
- **画面外オーバーレイの自動補正** — `ensureVisible()` が保存座標の復元時に画面外判定（`Dimensions.VISIBLE_THRESHOLD=100px`）を行い、範囲外なら `centerPosition()` で中央に再配置。ドラッグ中も `onDragMove()` 内で同閾値による移動制限あり。`ResizeObserver` がビューポート変化時にも自動補正を発火させる。
- **位置操作ヘルパー** — `applyPosition()` でオーバーレイの top/left/width/height を一括設定、`centerPosition(w, h)` で中央配置座標を計算。リセットや ensureVisible から共通利用される。
- **PointerCapture は drag と resize の両方で取得** — ウィンドウ外移動・Alt+Tab・タッチキャンセル時にも `pointerup/cancel` が確実に届くように、ハンドル要素側で capture する。リスナーも capture した要素に紐付けて document グローバル登録を避ける。
- **SPA / ビューポート / フルスクリーン対応** — `MutationObserver` が `document.body` の childList を監視して overlay 切り離しを検知、`ResizeObserver` が `documentElement` を監視、`fullscreenchange` で overlay を fullscreen 要素配下へ付け替える。
- **外部通信ゼロは設計不変条件** — この拡張は `fetch` / `XMLHttpRequest` / `sendBeacon` / `WebSocket` を一切使わない。README で明示されたユーザー約束であり、telemetry・analytics・外部 API 呼び出しの追加はユーザーの明示承認なしに行わないこと。`permissions` に `host_permissions` を足す提案も同様に要承認。

## Storage Keys

`StorageKeys` (`src/lib/actions.js` で定義) に2つのキーがあり、用途と削除タイミングが異なる:
- **`PREFS`** (`shadePrefs`) — オーバーレイの位置・サイズ・テーマ。content.js で保存、loadPrefsAndApply で復元。
- **`GLASS_BLUR`** (`glassBlur`) — ぼかし強度。popup.js のスライダー操作時に保存。

**リセット時のキー削除は popup.js の責務に一本化** — `popup.js` の RESET_PREFS ハンドラが `[PREFS, GLASS_BLUR]` を `chrome.storage.local.remove` した上で `RESET_PREFS` を background に送信する。`content.js` 側は表示のリセット（`resetOverlayPosition`）のみを担当し、storage 削除は行わない（二重削除の排除）。

## Release Workflow

Chrome Web Store への自動公開は **`release/x.y.z` ブランチへの push** がトリガー（`.github/workflows/publish.yml`）。workflow はブランチ名末尾と `manifest.json` の `version` が一致していることを確認してから公開する（例: `release/1.0.9` ブランチなら manifest も `1.0.9` でなければ fail する）。main への merge では公開されない。

## CI / Supply Chain

- Actions は **コミット SHA 固定**（タグはミュータブルなので不可）
- `npm ci` のみを使用。`npm ci || npm install` のようなフォールバックは**禁止**（lockfile bypass の温床）
- Chrome Web Store CLI は `devDependencies` に固定バージョンで記載し、CI では `npx --no-install` で local node_modules の版を使用（`npx --yes @patch` の patch 版乗っ取りを回避）
- CI で OAuth refresh_token 等の CWS 資格情報は GitHub Actions Secrets (`CWS_CLIENT_ID`/`CWS_CLIENT_SECRET`/`CWS_REFRESH_TOKEN`/`CWS_EXTENSION_ID`) 経由でのみ渡す。ワークフロー内で `echo` やログに出さないこと。
