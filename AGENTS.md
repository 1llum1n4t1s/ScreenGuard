# AGENTS.md

このファイルは、このリポジトリで作業するコーディングエージェント向けの作業規約です。現行アーキテクチャと設計判断の正本は [DESIGN.md](DESIGN.md)、利用者向けの説明は [README.md](README.md) を参照してください。

## Project Overview

スクリーンカーテン (Screen Curtain) は Chrome 拡張機能 (Manifest V3)。ページ上にリサイズ・ドラッグ可能なオーバーレイを表示して内容を覆い隠す。3テーマ (Light/Dark/Glass blur) 対応。オーバーレイの位置・サイズ・テーマは `chrome.storage.local` で自動保存・復元される。UI は日本語。

## Build Commands

```bash
bun --bun run sync:support             # @kagayoi/support-extension → src/shared/ を同期
bun --bun run build                # 共通問い合わせ部品の同期 + アイコン + スクリーンショット一括生成
bun --bun run generate-icons       # icons/icon.svg → icons/icon-{16,48,128}.png (sharp)
bun --bun run generate-screenshots # webstore/store-assets.json → webstore/images/<locale>/screenshot-01..05.png と tile-*.png（vitrina・Puppeteer・Windows のみ release）
```

テストフレームワーク・リンターは未導入。動作確認は Chrome で `chrome://extensions` を開き、「パッケージ化されていない拡張機能を読み込む」からプロジェクトルートを選択して手動テスト。JS の構文だけ確認したい時は `bun build --no-bundle <file> --outdir <temporary-directory>` が使える（chrome API 未定義エラーは parse 段階では出ない）。

`generate-screenshots` は撮影用の拡張コピー（`webstore/.capture-ext/`）を作ってから `webstore/vitrina/vitrina.mjs generate` を実行する。終了コードに加えて `bun webstore/vitrina/vitrina.mjs verify` が OK（9言語×5枚＋タイル2種）で、`%TEMP%\vitrina-ScreenGuard\ui-defects.json`（作業フォルダー。OS の一時フォルダー配下）が空であることを確認する。Linux（CI）は smoke プロファイル（en のみ・実拡張なし）になり、`images/.smoke` が残るため verify は失敗する（正常）。

- **Chrome を起動するスクリプトを足すときはシード必須**: puppeteer.launch・chrome-launcher・Chrome の直接起動は、起動前に user-data-dir の `Local State` へ `{"password_manager":{"os_password_blank":false,"os_password_last_changed":"9223372036854775000"}}` を書く。Windows の Chromium は新規プロファイルごとに空パスワードで LogonUser を呼び（`password_manager_util_win.cc` の `CheckBlankPasswordWithPrefs`）、ログオン失敗（Security 4625）として数えられるため、並列・連続起動で Windows アカウントがロックされる（2026-11-15 実害）。userDataDir 未指定の起動は作らず、`webstore/vitrina/lib/capture.mjs` の `seedChromeProfile`（および一時プロファイルは %TEMP% 配下）と同等の処理を先に呼ぶ。`webstore/vitrina/` は逐語コピーで対策済み。

## Version Management

バージョン番号は以下の2ファイルに記載されており、**必ず同時に更新**すること:
- `manifest.json` — Chrome 拡張機能のバージョン
- `package.json` — パッケージのバージョン

`bun.lock` は `bun install` 時に自動同期される。

## Architecture

オーバーレイ本体は3つのコンポーネントが `chrome.runtime` メッセージパッシングで連携する。アクション定数・共通定数は `src/lib/actions.js` で定義（`Actions`, `Themes`, `BlurConfig`, `Dimensions`, `StorageKeys`, `clampBlur`, `sanitizeTheme`）。全体の責務とデータフローは [DESIGN.md](DESIGN.md) を正本とする。

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
テーマ選択 (Light/Dark/Glass)、Glass 選択時のみぼかし強度スライダー (`BlurConfig.MIN`〜`BlurConfig.MAX`) を表示。位置リセットボタンあり。`chrome.tabs.query` で自身で tabId を解決し、`SHOW_OVERLAY` に `{tabId, data: {theme, glassBlur}}` を載せて background へ送信。**応答の `ok` を検査し、`ok:true` のときだけポップアップを閉じる**。失敗時は閉じずに `#statusError`（`role="alert"`、`.status-error` の warn 配色）へ background が返した理由を表示する（閉じてしまうと「押しても何も起きない」に見えるため）。`UPDATE_BLUR` の sendMessage も 80ms デバウンスで連打を間引く。最後のテーマ・blur 値は `chrome.storage.local` から復元。popup.html の `<script src="../lib/actions.js">` は popup からの相対パスであることに注意。

ポップアップ末尾の `<kagayoi-support-footer product-id="screen-guard">` は、ローカル同梱した `src/shared/kagayoi-support-popup.js`、`kagayoi-support-footer.js` と3つの `kagayoi-support-*.css` を一組で使う。これらの正本は固定版の `@kagayoi/support-extension` package であり、直接編集せず `bun --bun run sync:support` で同期して生成差分を commit する。`bun --bun run build` の先頭でも同期する。CSS は各 Web Component の Shadow DOM 内から `<link rel="stylesheet">` で読み込む。問い合わせダイアログは表示中だけ外側 document のスクロールを固定し、終了・切断時に inline style とスクロール位置を復元する。問い合わせ操作時だけ `https://support.kagayoi.com` へメール確認とチケット作成を行い、部品を読み込めない場合は Web のサポート窓口へフォールバックする。

### Background (`src/background/background.js`)
Service worker。`importScripts("/src/lib/actions.js")` で定数をロード。`Object.freeze` でイミュータブル管理されたステート（theme, glassBlur）を保持。`onMessage` で `sender.id === chrome.runtime.id` を検証して外部メッセージを拒否。`request.tabId` を優先、次にキャッシュ、最後に `chrome.tabs.query` の順で対象タブを解決（アクティブタブ曖昧性を回避）。`handleShowOverlay` は `.catch` で reject を捕捉して `sendResponse({ok:false, error})` を返す。対象ページは URL のプロトコルが `http:`, `https:`, `file:` のときのみ処理し、それ以外（chrome://, edge://, about: 等）は**日本語メッセージ付きで throw する**（早期 return すると listener が `ok:true` を返して popup が黙って閉じ、無反応と区別できなくなるため）。`chrome.tabs.sendMessage` が失敗した場合は `forceReinject`（全ての `#screenShadeHost` を除去 → `__screenShadeRunning=false` → 再注入）で 1 度だけ復帰を試みる。`UPDATE_BLUR` は `state.glassBlur` も同時更新（SSoT 維持）。

### Content Script (`src/content/content.js`)
IIFE でラップ。**Shadow DOM 構成**: `createOverlay()` は拡張更新後に残った孤立 host を含む全ての `#screenShadeHost` を生成前に除去し、同時に1つだけ存在する状態を保つ。新しい host (z-index: 2147483647, `all: initial` 等の inline !important 防御付き) を `document.body` 直下に配置し、`attachShadow({ mode: "closed" })` で closed shadow root を作成。shadow 内に `<style>`（`window.__screenShadeStyles` から流し込み）と `.overlay` を置く。ページ CSS は shadow 境界で遮断されるため `.overlay` 以下のスタイルに `!important` は不要。ページ JS は host から `.shadowRoot` アクセス不可。閉じるボタン（`<button class="close">` + `aria-label`）、8方向リサイズハンドル（`.handle-{n,ne,e,...}`）、ドラッグ移動を Pointer Events API (`setPointerCapture`) で実装。**drag と resize の両方で PointerCapture を取得** してウィンドウ外移動時のリスナーリークを防ぐ。`ResizeObserver` でビューポート変化時に `ensureVisible` を再適用、`MutationObserver` で SPA による host 除去を検知して参照をリセット。`fullscreenchange` でフルスクリーン要素配下へ host を付け替え。テーマは `sanitizeTheme` で allowlist 検証してから `.overlay[data-theme]` で切替。位置・サイズは resize/move 終了時に `chrome.storage.local` へ保存し、次回作成時に復元。テーマはポップアップ選択を常に優先（storage からは復元しない）。

### Styling (`src/content/content-styles.js`)
CSS 文字列を `window.__screenShadeStyles` に置くだけの JS モジュール。content.js が shadow root 内の `<style>` 要素に流し込む。**shadow root 内のため `!important` 不要**、selector も `#screenShadeOverlay` ではなく `.overlay` / `.close` / `.handle-*` といった短い class ベース。overlay は `top/left/width/height` の明示指定（`bottom/right` は未使用）。リサイズハンドル: 角 16×16px / 辺 8px。`chrome.scripting.insertCSS` は shadow root に届かないため使用しない。

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 設定; permissions: `activeTab`, `scripting`, `storage`; 問い合わせ専用の `https://support.kagayoi.com/*`; `content_security_policy` 明示 |
| `src/lib/actions.js` | `Object.freeze` された定数群（`Actions`/`Themes`/`BlurConfig`/`Dimensions`/`StorageKeys`）と共通ユーティリティ（`clampBlur`/`sanitizeTheme`）|
| `src/background/background.js` | Service worker: イミュータブルステート管理、スクリプト注入、メッセージ中継、tabId キャッシュ、sender 検証 |
| `src/content/content.js` | Shadow DOM 化したオーバーレイ生成、リサイズ、ドラッグ、画面外補正、SPA 対応、フルスクリーン対応、設定永続化 |
| `src/content/content-styles.js` | Shadow DOM 内に注入する CSS 文字列（`window.__screenShadeStyles`）|
| `src/popup/popup.html` | ポップアップ UI（`<script src="../lib/actions.js">` で相対ロード）|
| `src/popup/popup.js` | ポップアップ UI: テーマ選択、blur スライダー、リセット、tabId 解決 |
| `src/popup/popup.css` | ポップアップスタイル |
| `src/shared/kagayoi-support-popup.js` | メール確認とチケット作成を行う問い合わせ Web Components |
| `src/shared/kagayoi-support-footer.js` | 問い合わせ導線とストア評価導線を提供する共通フッター |
| `src/shared/kagayoi-support-{popup,footer,form}.css` | 問い合わせ Web Components が各 Shadow DOM 内から読み込むローカル同梱スタイル |
| `icons/icon.svg` | ソースアイコン (512×512); PNG は `icons/` に生成 |
| `webstore/` | ストア申請用: `store-assets.json`（スライド定義・9言語文言）、`fixtures/page.html`（注入先の固定ページ）、`store-assets.steps.mjs`（撮影前操作）、`vitrina/`（共通キットの逐語コピー・改変禁止）、生成画像、掲載情報テキスト |
| `docs/privacy-policy.md` | プライバシーポリシー (GitHub Pages で公開) |
| `DESIGN.md` | 現行アーキテクチャ、責務境界、データフロー、設計判断の正本 |
| `.github/workflows/publish.yml` | Chrome Web Store 自動公開。Actions は SHA 固定、`bun run deps` 厳密、devDep の CLI 使用 |

## Store Asset Generation

`icons/icon.svg` → sharp で PNG 変換 (`scripts/generate-icons.js`)。ストア画像は共通キット vitrina（正本は Kagayoi.Support の `clients/chrome-extension/store-assets/`、`sync-kit.mjs --repo` で `webstore/vitrina/` へ逐語コピー）で、実拡張の実UIから9言語分を撮影・合成する（`webstore/generate-screenshots.mjs` が入口）。ポップアップ（テーマ・ぼかし）は拡張ページとして直接撮影し、ページ上のオーバーレイは固定ページ `webstore/fixtures/page.html` に対して撮る。headless では popup クリックによる activeTab が付かないため、`webstore/prepare-capture-extension.mjs` が作る撮影専用コピー（`webstore/.capture-ext/`・gitignore 済み）の manifest にだけ固定ページのホスト権限（`https://www.example.org/*`）を足し、`store-assets.steps.mjs` が拡張ページから実際の `showOverlay` メッセージを送って background の注入経路（`executeScript` → content.js）をそのまま動かす。本体の `manifest.json` は変更しない。出力は `webstore/images/<locale>/screenshot-01..05.png`（1280×800）と `tile-small.png`（440×280）・`tile-marquee.png`（1400×560）。手作りのメイン画像 `webstore/manual/00-screenshot-main-1280x800.png` は再生成できないため `webstore/images/` の外（gitignore 済み）に保持し、vitrina の検証対象にしない。

## Important Patterns

- **Shadow DOM による二層防御** — host 要素 (`#screenShadeHost`) には `applyHostDefense()` で `all: initial` / `position: fixed` / `margin/padding/border: 0` / `pointer-events: none` / `transform/filter/clip-path: none` 等を **inline !important** で貼り付け、ページ側の `!important` ルール（inline !important は cascade 上 author !important と同レイヤで specificity 無限大として扱われるため勝つ）を無効化。shadow root は `mode: "closed"` で作成してページ JS の `host.shadowRoot` 経由 DOM 覗きを遮断。実オーバーレイ `.overlay` は shadow 内で `position: fixed` 直配置なので host のサイズに拘束されない。**`contain` 系プロパティは host に付けない**（paint containment が shadow descendants を 0×0 host に clip し、`filter`/`perspective`/`backdrop-filter` の非none は fixed の containing block を host に変えてしまうため — shadow 境界は layout/paint を isolate しないことに注意）。
- **`clampBlur()` / `sanitizeTheme()` は `src/lib/actions.js` にのみ定義** — popup.js / content.js / background.js すべてから `actions.js` のグローバル関数として参照される。変更時は `actions.js` を更新すること。
- **content script の注入判定** — `window.__screenShadeRunning` グローバルフラグで管理。IIFE 初期化が成功してからフラグを立てるため、エラー時の永続ロックは起きない。background.js の `ensureInjected` が `executeScript` → `func` 実行して確認し、未注入なら `actions.js → content-styles.js → content.js` の順で一括 executeScript。**フラグだけでは拡張更新後に「フラグは残っているが受信は死んでいる」状態を検出できない**ため、`sendMessage` 失敗を捕捉して `forceReinject` で強制的に作り直す経路を併設している（これが無いとページをリロードするまで無反応が続く）。
- **位置指定は top/left/width/height のみ** — `bottom` や `right` は使わない設計。リサイズロジックもこの前提で動いている。
- **`actions.js` は `importScripts` (background) と `executeScript` (注入) と `<script>` (popup) の3経路で読み込まれる** — ES modules ではなく従来のスクリプト形式。popup からは `../lib/actions.js` という相対パスで読み込む（`src/popup/` からの相対）。
- **`content-styles.js` は window.__screenShadeStyles という string グローバルを置くだけの副作用モジュール** — content.js の `createOverlay()` が shadow root 内の `<style>` textContent に流し込む。fetch / runtime.getURL を使わず JS 文字列化することで async 初期化を回避。CSS ハイライトは失うが、shadow 境界越しの CSS 配送としては最も単純。
- **画面外オーバーレイの自動補正** — `ensureVisible()` が保存座標の復元時に画面外判定（`Dimensions.VISIBLE_THRESHOLD=100px`）を行い、範囲外なら `centerPosition()` で中央に再配置。ドラッグ中も `onDragMove()` 内で同閾値による移動制限あり。
- **ビューポート変化時の中央追従** — `ResizeObserver` がビューポート変化を検知すると、`prevViewportW/H` との差分の半分だけ overlay の `top/left` を移動させて「中心-中心の相対位置」を保つ。中央配置レイアウトのコンテンツ（動画プレイヤー等）と同じ動きで追従させる狙い。drag/resize 操作中はスキップするが `prevViewport*` 自体は常に更新し、操作終了直後に「操作中の viewport delta」が一気に効くのを防ぐ。最後に `ensureVisible()` を通すので極端な縮小では従来どおり中央スナップに落ちる。連続発火するため savePrefs は `savePrefsDebounced()`（300ms）経由で間引く（drag/resize 終了時の `savePrefs()` は引き続き即時保存）。
- **位置操作ヘルパー** — `applyPosition()` でオーバーレイの top/left/width/height を一括設定、`centerPosition(w, h)` で中央配置座標を計算。リセットや ensureVisible から共通利用される。`centerPosition` は結果を **`MIN_SIZE` で下限クランプする**: ビューポートが `MIN_SIZE + DEFAULT_MARGIN*2`（70px）を下回るとマージン減算で MIN_SIZE 未満（さらに小さいと負値）になり、ResizeObserver 経由で呼ばれるためウィンドウを縮めるたびに overlay が縮んで savePrefs で永続化され、ウィンドウを戻しても復元されない。`loadPrefsAndApply` 側にも同じクランプがあり、旧バージョンが保存した潰れたサイズを読み込み時に救済して保存し直す。
- **閉じる手段は必ず 2 系統確保する** — オーバーレイを消す UI は shadow 内の × ボタンだけなので、ホバー前提にすると閉じられない環境が生まれる。`.close` は既定で常時表示にし、`@media (hover: hover) and (pointer: fine)` の環境でだけ非ホバー時に隠す。`.close:focus-visible`（`.close` より詳細度が高い）でキーボード時は必ず可視化する。加えて `installKeyboardWatcher()` が document の keydown を capture で拾い、**overlay 表示中のみ** Escape で `closeOverlay()` する（非表示時はページ側の Escape を一切妨げない）。
- **PointerCapture は drag と resize の両方で取得** — ウィンドウ外移動・Alt+Tab・タッチキャンセル時にも `pointerup/cancel` が確実に届くように、ハンドル要素側で capture する。リスナーも capture した要素に紐付けて document グローバル登録を避ける。
- **SPA / ビューポート / フルスクリーン対応** — `MutationObserver` が `document.documentElement` の childList を subtree 込みで監視して、body の差し替えと overlay 切り離しを検知する。`ResizeObserver` が `documentElement` を監視し、`fullscreenchange` で overlay を fullscreen 要素配下へ付け替える。
- **外部通信の境界を限定する** — オーバーレイ表示、設定保存、利用状況の処理は端末内で完結させる。外部通信は、利用者が問い合わせを送信したときの `https://support.kagayoi.com` へのメール確認・チケット作成だけに限定し、`host_permissions` も同 origin だけを維持する。telemetry・analytics・別の外部 API・追加 host permission が必要な場合は、実装前にユーザーの明示承認を得る。MV3 で実行する JavaScript は引き続きローカル同梱し、リモート JavaScript を実行しない。

## Storage Keys

`StorageKeys` (`src/lib/actions.js` で定義) に2つのキーがあり、用途と削除タイミングが異なる:
- **`PREFS`** (`shadePrefs`) — オーバーレイの位置・サイズ・テーマ。content.js で保存、loadPrefsAndApply で復元。
- **`GLASS_BLUR`** (`glassBlur`) — ぼかし強度。popup.js のスライダー操作時に保存。

**リセット時のキー削除は popup.js の責務に一本化** — `popup.js` の RESET_PREFS ハンドラは `resetInProgress` を立て、保留中の blur 保存・送信 debounce を両方 cancel してから `[PREFS, GLASS_BLUR]` を `chrome.storage.local.remove` し、成功後に `RESET_PREFS` を background へ送信する。`content.js` 側は表示のリセット（`resetOverlayPosition`）のみを担当し、storage 削除は popup.js に任せる（二重削除の排除）。ただし `resetOverlayPosition` は先頭で **`clearTimeout(savePrefsTimer)`** を行う: ResizeObserver 由来の debounce 保存（300ms）が未発火のまま残っていると、popup の `remove` 完了後にタイマーが発火して古い位置を書き戻し、リセットが無かったことになる。

## Release Workflow

Chrome Web Store への自動公開は **`release/x.y.z` ブランチへの push** がトリガー（`.github/workflows/publish.yml`）。workflow はブランチ名末尾と `manifest.json` の `version` が一致していることを確認してから Chrome Web Store へアップロードする。審査への申請は `cws-submit.yml`（例: `release/1.0.9` ブランチなら manifest も `1.0.9` でなければ fail する）。main への merge では公開されない。

## CI / Supply Chain

- Actions は **コミット SHA 固定**（タグはミュータブルなので、SHA でピン留めする）
- `bun run deps` のみを使用する。lockfile を書き換えるフォールバックは使わない（lockfile bypass の温床になるため）。
- Chrome Web Store 公開は `scripts/Publish-Cws.ps1` でAPIを直接呼ぶ。
- CI で OAuth refresh_token 等の CWS 資格情報は GitHub Actions Secrets (`CWS_CLIENT_ID`/`CWS_CLIENT_SECRET`/`CWS_REFRESH_TOKEN`/`CWS_EXTENSION_ID`) 経由でのみ渡す。ワークフロー内で `echo` やログには出さない。

### CWS 公開のHTTP境界

`publish.yml` はビルド済みZIPを `scripts/Publish-Cws.ps1`（PowerShell 7）へ渡す。既存のOAuth secrets・publisher/item IDを維持し、ZIPをストリーム送信し、upload成功を確認する（既定の `-Stage All` はその後publishまで行うが、CIは `-Stage Upload` でアップロードだけを行い、申請は `cws-submit.yml` が `-Stage Publish` で行う）。重複・通信断・不明な応答を公開成功として扱わず、ストア状態を確認してから再開する。公開専用npm CLIは使用しない。変更時はHTTP fixtureで成功・版/ID不一致・upload失敗・publish拒否を確認する。

CWS公開workflowはrepository固定のconcurrency groupで直列化する。同期uploadの成功・ID・版を確認した場合だけpublishし、非同期uploadはAPI v2でdraft版を要求と結び付けられないため停止する。APIにはuploadとpublishの原子的なCASが無いため、提出中はDashboardや他の手動公開操作を並行しない。

### CWS のアップロードと申請の分離

`publish.yml` は検証済みZIPを `-Stage Upload` で下書きとしてアップロードするだけで、審査へは申請しない。新ロケールの掲載画像欄はアップロード後でないと Dashboard に出ないため、申請は別workflow `.github/workflows/cws-submit.yml`（手動実行、`-Stage Publish`）で行う。

1. `release/x.y.z` を push する（publish.yml がアップロードする）
2. Dashboard（Edictora）でロケール別の掲載画像などを整えて下書き保存する
3. `gh workflow run cws-submit.yml -f version=x.y.z --ref release/x.y.z` で申請する

- API v2 は未申請の下書き版を返さないため、下書きの版そのものは確認できない。`cws-submit.yml` は次を満たす場合だけ `:publish` する: 実行 ref が `release/<version>` で manifest の版が入力と一致する。`publish.yml` の直近のアップロード成功 run（固定ステップ名 `Chrome Web Store にアップロード（下書き）`。`actions: read` で履歴を参照）が同じ commit である。fetchStatus で item identity・直近アップロード状態・公開/審査中の版を確認できる。
- 同版が申請済み・公開済み（PENDING_REVIEW / STAGED / PUBLISHED / PUBLISHED_TO_TESTERS）なら再送せず成功終了する。別版の審査中、より新しい版の存在、直近アップロードの進行中・失敗、状態不明は申請せず停止する。
- Dashboard で手動アップロードした下書きなど、同じ commit のアップロード成功 run が無い場合は申請されない。その場合は Dashboard から手動で申請する。
- 両workflowは同じ concurrency group で直列化する。申請中は Dashboard の操作を並行しない。

## Bun依存の脆弱性検出

依存の固定復元は `bun run deps` を使う。lock欠落・破損を拒否し、`[run] bun=true` 経由で依存のpostinstallまでBunで実行する。Node.jsがあるPCでも通常の `bun install` を直接使う経路へ戻さない。

依存更新は通常のDependabot PRで受け、Dependency validationで検証する。ローカルの `bun audit` でlock全体を監査できる。依存の自動修正・自動マージは行わない。
