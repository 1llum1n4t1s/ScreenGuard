// ストア画像の生成入口（npm run generate-screenshots）。
// 1) 撮影用の拡張コピーを作る  2) vitrina generate を実行する（引数はそのまま渡す）。
// --work-dir は未指定ならキットの既定値（OS の一時フォルダー %TEMP% = os.tmpdir() 配下の vitrina-<リポジトリ名>）。
// CI（Linux）では vitrina が smoke プロファイルになる（en のみ・実拡張なし）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCaptureExtension } from "./prepare-capture-extension.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
prepareCaptureExtension();
const args = process.argv.slice(2);
const proc = Bun.spawnSync([process.execPath, path.join(here, "vitrina", "vitrina.mjs"), "generate", ...args], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(proc.exitCode ?? 1);
