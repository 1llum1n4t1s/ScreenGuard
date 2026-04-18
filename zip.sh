#!/bin/bash

# スクリーンカーテン 拡張機能パッケージ生成スクリプト

cd "$(dirname "$0")" || exit 1
echo "拡張機能パッケージを生成中..."

rm -f ./screen-curtain.zip

if [ -f scripts/generate-icons.js ]; then
  echo "アイコン生成中..."
  npm install --silent 2>/dev/null
  node scripts/generate-icons.js
fi

if ! command -v zip &> /dev/null; then
  echo "zipをインストールしてください"
  exit 1
fi

zip -r ./screen-curtain.zip \
  manifest.json \
  icons/ \
  src/ \
  -x "*.DS_Store" "*.swp" "*~"

if [ $? -eq 0 ]; then
  echo "ZIPファイルを作成しました: screen-curtain.zip"
  ls -lh ./screen-curtain.zip
else
  echo "ZIPファイルの作成に失敗しました"
  exit 1
fi
