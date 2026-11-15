// 撮影専用の拡張コピーを作る。
//
// 目的: ページ上のオーバーレイは、本来 popup から activeTab で content script を注入して出す。
// headless では popup のクリック（ユーザー操作）が発火しないため activeTab が付与されない。
// そこで撮影用コピーの manifest にだけ固定ページのホスト権限を足し、実コードの
// background.handleShowOverlay（scripting.executeScript → content.js）をそのまま動かせるようにする。
// 本体（リポジトリ直下の manifest.json）には一切手を入れない。コピーは gitignore 済み。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CAPTURE_EXT_DIR = path.join(root, "webstore", ".capture-ext");
/** 固定ページを返す仮想ホスト（実通信は止めているため、遷移先は fixture に差し替わる）。 */
export const FIXTURE_ORIGIN = "https://www.example.org";

export function prepareCaptureExtension() {
  // 自分が生成した撮影用コピーだけを作り直す（パスを固定し、他の場所を消さない）
  if (path.basename(CAPTURE_EXT_DIR) !== ".capture-ext") throw new Error("撮影用コピーの場所が不正です");
  fs.rmSync(CAPTURE_EXT_DIR, { recursive: true, force: true });
  fs.mkdirSync(CAPTURE_EXT_DIR, { recursive: true });
  for (const name of ["_locales", "icons", "src"]) {
    fs.cpSync(path.join(root, name), path.join(CAPTURE_EXT_DIR, name), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  manifest.host_permissions = [...(manifest.host_permissions ?? []), `${FIXTURE_ORIGIN}/*`];
  fs.writeFileSync(path.join(CAPTURE_EXT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return CAPTURE_EXT_DIR;
}

if (import.meta.main) {
  console.log(`[prepare] ${prepareCaptureExtension()}`);
}
