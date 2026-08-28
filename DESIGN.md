# ScreenGuard 設計

## 位置付け

この文書は、現在の実装から確認できるアーキテクチャ、責務境界、データフロー、設計判断の正本です。エージェント向けの作業・検証規約は [AGENTS.md](AGENTS.md)、利用者向けの機能と使い方は [README.md](README.md) を参照してください。

## 目的と範囲

ScreenGuard（スクリーンカーテン）は Manifest V3 の Chrome 拡張機能です。利用者の操作で現在のページへオーバーレイを注入し、Light、Dark、Glass の3テーマでページ内容の一部を覆います。オーバーレイはドラッグ移動、8方向リサイズ、ビューポート追従、設定のローカル復元に対応します。

実行時の権限は、操作中のタブへ注入する `activeTab` と `scripting`、設定保存用の `storage`、利用者が問い合わせを送信するときだけ使う `https://support.kagayoi.com/*` に限定されています。

## 主要コンポーネント

| コンポーネント | 主なファイル | 責務と境界 |
| --- | --- | --- |
| Popup | `src/popup/popup.html`, `popup.js`, `popup.css` | テーマ・ぼかし強度・位置リセットの操作、対象 tabId の解決、background への要求、失敗表示 |
| Shared support UI | `src/shared/kagayoi-support-popup.js`, `kagayoi-support-footer.js` | 問い合わせダイアログ、メール確認、Kagayoi Support へのチケット作成、ストア評価導線 |
| Background service worker | `src/background/background.js` | 内部メッセージの検証、対象タブ解決、スクリプト注入、content script への中継、再注入による復旧 |
| Content script | `src/content/content.js` | closed Shadow DOM 内のオーバーレイ生成、移動・リサイズ・終了操作、SPA・フルスクリーン・ビューポート変化への追従、設定保存 |
| Content styles | `src/content/content-styles.js` | Shadow DOM へ同期注入する CSS 文字列を `window.__screenShadeStyles` として提供 |
| Shared runtime contract | `src/lib/actions.js` | メッセージ action、テーマ、寸法、storage key、値の正規化関数を3実行コンテキストへ提供 |
| Build and release | `scripts/`, `webstore/`, `.github/workflows/publish.yml` | sharp によるアイコン生成、Puppeteer によるストア画像生成、release branch からの CWS 公開 |

## データフロー

### オーバーレイ表示

1. Popup が `chrome.tabs.query` で tabId を取得し、`SHOW_OVERLAY` と選択テーマ・ぼかし強度を background へ送ります。
2. Background は送信元 extension ID、tabId、対象 URL の protocol を検証します。
3. 未注入なら `actions.js`、`content-styles.js`、`content.js` の順に `chrome.scripting.executeScript` で注入します。
4. Background が `SHOW_OVERLAY_CS` を content script へ送り、content script がオーバーレイを生成または更新します。
5. content script への送信が失敗した場合、background は既存 host と実行フラグを除去して一度だけ再注入します。

Popup は background の `{ ok: true }` を確認したときだけ閉じます。注入不能な URL や実行エラーは日本語の理由を Popup に返し、無反応と区別します。

### 設定更新と永続化

- `shadePrefs` は content script が位置、サイズ、テーマを `chrome.storage.local` へ保存します。
- `glassBlur` は Popup がスライダー値を保存し、80 ms のデバウンスで `UPDATE_BLUR` を送ります。
- リセットは Popup が両 key を削除した後に `RESET_PREFS` を送り、content script は表示位置の初期化だけを担当します。
- ResizeObserver 由来の保存は300 msでデバウンスし、手動操作終了時は即時保存します。

### 問い合わせ

1. Popup 内の `kagayoi-support-footer` が、ローカル同梱された問い合わせダイアログを開きます。
2. 利用者が送信操作をすると、メールアドレスを `/api/auth/request` へ送り、確認コードで `/api/auth/verify` を行います。
3. 取得した Bearer token で `/api/tickets` へ問い合わせ内容、製品ID、拡張バージョン、ロケールを送ります。
4. extension 向けフォームは認証 session を `window.localStorage` に保存します。HTTP cookie は使わず、request は `credentials: "omit"` です。

問い合わせ以外のオーバーレイ処理、設定保存、閲覧ページの処理は外部へ送信しません。閲覧ページの内容も問い合わせ payload へ含めません。

### ビルドと公開

- `pnpm run generate-icons` は `icons/icon.svg` から3サイズの PNG を生成します。
- `pnpm run generate-screenshots` は `webstore/*.html` からストア画像を生成します。Puppeteer は開発用生成処理だけで、拡張の実行時には含まれません。
- `release/x.y.z` への push だけが公開 workflow を起動し、branch 名と `manifest.json` の version 一致を検証します。
- workflow は SHA 固定の Actions、frozen lockfile、固定版のローカル CWS CLI を使います。

## 重要な不変条件

- MV3 で実行する JavaScript はすべて拡張へ同梱し、リモート JavaScript を実行しません。
- 外部通信と host permission は、利用者起点の Kagayoi Support 問い合わせに限定します。telemetry と analytics は持ちません。
- Background は `sender.id === chrome.runtime.id` を満たす内部メッセージだけを処理します。
- 注入対象は `http:`, `https:`, `file:` に限定し、制限ページでは明示的な失敗を返します。
- `actions.js` は module 化せず、Popup の `<script>`、background の `importScripts`、content 注入の3経路で同じ契約を共有します。
- host は inline `!important` の防御、実 UI は closed Shadow DOM でページ CSS・JS から分離します。host へ `contain`、`filter`、`perspective`、`backdrop-filter` を追加しません。
- オーバーレイ位置は `top`, `left`, `width`, `height` だけで表し、drag と resize の双方で PointerCapture を取得します。
- 閉じる手段は × ボタンと Escape の2系統を維持し、Escape は表示中だけページから横取りします。
- `manifest.json` と `package.json` の製品 version は同時に更新します。

## 採用済み設計判断

| 判断 | 理由 | トレードオフ |
| --- | --- | --- |
| `activeTab` と動的注入 | 常時の広いページ権限を避け、利用者操作時だけページへ入る | 制限 URL では動作せず、注入失敗を UI へ返す経路が必要 |
| closed Shadow DOM と host の二層防御 | ページ側の CSS と DOM 操作からオーバーレイを隔離する | 通常の DevTools から内部を調査しにくい |
| CSS を JavaScript 文字列として先行注入 | Shadow root へ同期的かつ確実にスタイルを渡せる | CSS 単体ファイルより編集時のハイライトが弱い |
| runtime 共通契約を従来 script に集約 | Popup、service worker、content 注入の3経路で同じ値検証を再利用できる | ES module の import graph は使えない |
| 設定を `chrome.storage.local` に保存 | アカウント同期や外部サービスなしで再表示時に復元できる | 端末・Chrome profile をまたいだ同期は行わない |
| 問い合わせ UI をローカル Web Components として共有 | Kagayoi 製品間で同じ入力・認証契約を再利用し、MV3 CSPを守る | Support API origin の明示的な host permission が必要 |
| release branch を公開トリガーにする | version と公開操作を branch 名で明示的に結び付ける | `main` への通常 push だけでは公開されない |
