#!/bin/bash

# スクリーンカーテン 拡張機能パッケージ生成スクリプト

set -euo pipefail

cd "$(dirname "$0")" || exit 1
echo "拡張機能パッケージを生成中..."

if ! command -v zip &> /dev/null; then
  echo "zipをインストールしてください"
  exit 1
fi

bun run deps
bun --bun run sync:support --check
bun --bun run generate-icons

# 入力確認までは既存 ZIP を保持する。
test -f manifest.json
test -d icons
test -d src
rm -f ./screen-curtain.zip

zip -r ./screen-curtain.zip \
  manifest.json \
  icons/ \
  src/ \
  -x "*.DS_Store" "*.swp" "*~"

echo "ZIPファイルを作成しました: screen-curtain.zip"
ls -lh ./screen-curtain.zip
